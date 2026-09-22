import { describe, it, expect } from 'vitest';
import {
  planProgress, planSummary, suggestTarget, orderText, ordersForWeek,
  type PlanRow,
} from './weekPlan';
import type { DailyWorkEntry, Crew } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: 'x', kind: 'ground', date: '2026-07-20', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'Зеренда', kato: '1',
    byMethod: { 'бар': 400 }, materials: {}, createdAt: '', updatedAt: '',
    column: '1-колонна', ...patch,
  } as DailyWorkEntry;
}

const PLAN: PlanRow = {
  id: 'p1', week: '2026-07-20', crew: '1-колонна', uchastok: 'Зеренда',
  targetM: 3000, contractor: 'Дозер', createdAt: '', updatedAt: '',
};

describe('planProgress', () => {
  const rows = [
    e({ id: 'a', date: '2026-07-20', byMethod: { 'бар': 1000 } }),
    e({ id: 'b', date: '2026-07-22', byMethod: { 'бар': 800 } }),
    // Другая неделя — в этот план не идёт.
    e({ id: 'c', date: '2026-07-27', byMethod: { 'бар': 900 } }),
    // Другой участок той же бригады — тоже не идёт.
    e({ id: 'd', date: '2026-07-21', uchastok: 'Щучинск', byMethod: { 'бар': 700 } }),
  ];

  it('считает факт по той же неделе, бригаде и участку', () => {
    const [p] = planProgress([PLAN], rows);
    expect(p.doneM).toBe(1800);
    expect(p.shifts).toBe(2);
    expect(p.share).toBeCloseTo(0.6, 5);
    expect(p.leftM).toBe(1200);
  });

  it('чужой работой план не закрывается', () => {
    const [p] = planProgress([PLAN], rows);
    expect(p.doneM).not.toBe(2500);
  });

  it('перевыполнение показывает больше единицы, а не «100%»', () => {
    const [p] = planProgress([{ ...PLAN, targetM: 1000 }], rows);
    expect(p.share).toBeCloseTo(1.8, 5);
    expect(p.leftM).toBe(0);
  });

  it('нулевое задание не делит на ноль', () => {
    const [p] = planProgress([{ ...PLAN, targetM: 0 }], rows);
    expect(p.share).toBe(0);
  });
});

describe('planSummary', () => {
  const rows = [e({ id: 'a', byMethod: { 'бар': 1000 } })];

  it('называет отстающих и опередивших', () => {
    const plans = [
      { ...PLAN, id: 'p1', targetM: 3000 },
      { ...PLAN, id: 'p2', crew: '2-колонна', targetM: 500 },
    ];
    const s = planSummary(planProgress(plans, rows));
    expect(s.behind.map((b) => b.id)).toContain('p1');
    expect(s.targetM).toBe(3500);
  });

  it('пустой план — пустая сводка', () => {
    expect(planSummary([]).share).toBe(0);
  });
});

describe('suggestTarget', () => {
  it('подсказывает средний недельный темп этой бригады', () => {
    const rows = [
      e({ id: 'a', date: '2026-07-20', byMethod: { 'бар': 1000 } }),
      e({ id: 'b', date: '2026-07-21', byMethod: { 'бар': 1000 } }),
      e({ id: 'c', date: '2026-07-27', byMethod: { 'бар': 3000 } }),
    ];
    // Две недели: 2000 и 3000 — среднее 2500.
    expect(suggestTarget(rows, '1-колонна', 'Зеренда')).toBe(2500);
  });

  it('истории нет — не выдумываем цифру', () => {
    expect(suggestTarget([], '1-колонна', 'Зеренда')).toBeNull();
    expect(suggestTarget([e()], '9-колонна', 'Зеренда')).toBeNull();
  });
});

describe('orderText', () => {
  const crew: Crew = {
    id: 'c1', kind: 'mkt', name: '1-колонна', contractor: 'Дозер', status: 'working',
    members: [{ name: 'Ахметов А.' }, { name: 'Сериков Б.', dayOff: true }],
    equipment: { 'Кабелеукладчик': 1, 'Самосвал': 2 }, updatedAt: '',
  };

  it('пишет то, что нужно бригаде, и ничего лишнего', () => {
    const [plan] = planProgress([PLAN], [e({ byMethod: { 'бар': 1000 } })]);
    const text = orderText({ plan, crew, date: '2026-07-21', issuedBy: 'Прораб' });
    expect(text).toContain('НАРЯД на 21.07.2026');
    expect(text).toContain('Зеренда');
    // toLocaleString('ru') разделяет тысячи неразрывным пробелом.
    expect(text).toContain('осталось 2\u00a0000 м');
    expect(text).toContain('Кабелеукладчик');
    expect(text).toContain('Выдал: Прораб');
  });

  it('выходной в состав наряда не попадает', () => {
    const [plan] = planProgress([PLAN], []);
    const text = orderText({ plan, crew, date: '2026-07-21' });
    expect(text).toContain('Ахметов А.');
    expect(text).not.toContain('Сериков Б.');
  });

  it('закрытое задание так и называется', () => {
    const [plan] = planProgress([{ ...PLAN, targetM: 500 }], [e({ byMethod: { 'бар': 1000 } })]);
    expect(orderText({ plan, date: '2026-07-21' })).toContain('задание закрыто');
  });
});

describe('ordersForWeek', () => {
  it('выписывает только тем, у кого осталось', () => {
    const plans = planProgress([
      { ...PLAN, id: 'p1', targetM: 3000 },
      { ...PLAN, id: 'p2', crew: '2-колонна', targetM: 100 },
    ], [
      e({ id: 'a', byMethod: { 'бар': 1000 } }),
      e({ id: 'b', column: '2-колонна', byMethod: { 'бар': 500 } }),
    ]);
    const orders = ordersForWeek(plans, '2026-07-20', '2026-07-21', []);
    expect(orders.map((o) => o.crew)).toEqual(['1-колонна']);
  });
});
