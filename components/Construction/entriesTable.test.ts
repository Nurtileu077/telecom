import { describe, it, expect } from 'vitest';
import {
  entryMeters, filterEntries, sortEntries, weekStart, groupByWeek,
  tableTotals, rowsToText, planFact,
} from './entriesTable';
import type { DailyWorkEntry, PlanRoute } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry>): DailyWorkEntry {
  return {
    id: patch.id ?? 'x', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'Зеренда — Серафимовка',
    kato: '116240100', byMethod: { 'кабелеукладчик': 480 }, materials: {},
    createdAt: '', updatedAt: '', ...patch,
  } as DailyWorkEntry;
}

const ROWS = [
  e({ id: 'a', date: '2026-07-25', byMethod: { 'кабелеукладчик': 480 }, contractor: 'Дозер' }),
  e({ id: 'b', date: '2026-07-27', byMethod: { 'бар': 1200 }, contractor: 'TERRA TECH', note: 'скальный грунт' }),
  e({ id: 'c', date: '2026-08-03', byMethod: { 'вручную': 90 }, contractor: 'Дозер', uchastok: 'Щучинск — Бурабай' }),
];

describe('entryMeters', () => {
  it('складывает все способы', () => {
    expect(entryMeters(e({ byMethod: { 'бар': 100, 'вручную': 50 } }))).toBe(150);
  });

  it('пустая смена — ноль, а не NaN', () => {
    expect(entryMeters(e({ byMethod: {} }))).toBe(0);
  });
});

describe('filterEntries', () => {
  it('ищет и по примечанию, а не только по названию', () => {
    expect(filterEntries(ROWS, 'скальный').map((r) => r.id)).toEqual(['b']);
  });

  it('несколько слов — все должны найтись', () => {
    expect(filterEntries(ROWS, 'дозер щучинск').map((r) => r.id)).toEqual(['c']);
    expect(filterEntries(ROWS, 'дозер терра')).toEqual([]);
  });

  it('пустой запрос ничего не отсеивает', () => {
    expect(filterEntries(ROWS, '   ')).toHaveLength(3);
  });

  it('ё и е — одна буква', () => {
    expect(filterEntries([e({ id: 'z', note: 'щебёнка' })], 'щебенка')).toHaveLength(1);
  });
});

describe('sortEntries', () => {
  it('по метрам — от большего', () => {
    expect(sortEntries(ROWS, 'meters', 'desc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('по дате — от старого', () => {
    expect(sortEntries(ROWS, 'date', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('по подрядчику — по алфавиту, внутри по дате', () => {
    const ids = sortEntries(ROWS, 'contractor', 'asc').map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(['a', 'c']);
  });

  it('исходный список не трогаем', () => {
    const before = ROWS.map((r) => r.id);
    sortEntries(ROWS, 'meters', 'asc');
    expect(ROWS.map((r) => r.id)).toEqual(before);
  });
});

describe('weekStart', () => {
  it('суббота относится к своему понедельнику', () => {
    // 25 июля 2026 — суббота.
    expect(weekStart('2026-07-25')).toBe('2026-07-20');
  });

  it('понедельник — сам себе начало', () => {
    expect(weekStart('2026-07-20')).toBe('2026-07-20');
  });

  it('воскресенье относится к прошедшей неделе, а не к следующей', () => {
    expect(weekStart('2026-07-26')).toBe('2026-07-20');
  });

  it('мусор вместо даты не ломает разбор', () => {
    expect(weekStart('')).toBe('');
  });
});

describe('groupByWeek', () => {
  it('раскладывает по неделям, свежие сверху', () => {
    const g = groupByWeek([
      e({ id: 'a', date: '2026-07-20', byMethod: { 'бар': 100 } }),  // понедельник
      e({ id: 'b', date: '2026-07-26', byMethod: { 'бар': 200 } }),  // воскресенье той же
      e({ id: 'c', date: '2026-07-27', byMethod: { 'бар': 300 } }),  // следующий понедельник
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].week).toBe('2026-07-27');
    expect(g[1].rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(g[1].meters).toBe(300);
  });

  it('у недели есть человеческая подпись', () => {
    expect(groupByWeek([e({ date: '2026-07-25' })])[0].label).toMatch(/20.*26/);
  });
});

describe('tableTotals', () => {
  it('считает метры, смены и дни', () => {
    const t = tableTotals(ROWS);
    expect(t.meters).toBe(1770);
    expect(t.shifts).toBe(3);
    expect(t.days).toBe(3);
    expect(t.perShift).toBe(590);
  });

  it('две смены в один день — это один день', () => {
    const t = tableTotals([e({ id: '1' }), e({ id: '2' })]);
    expect(t.shifts).toBe(2);
    expect(t.days).toBe(1);
  });

  it('пусто — нули, а не деление на ноль', () => {
    expect(tableTotals([]).perShift).toBe(0);
  });

  it('спорные считаются отдельно', () => {
    expect(tableTotals([e({ disputed: true }), e({ id: '2' })]).disputed).toBe(1);
  });
});

describe('rowsToText', () => {
  it('колонки разделены табуляцией — вставится в Excel', () => {
    const text = rowsToText([ROWS[0]]);
    const [head, row] = text.split('\n');
    expect(head.split('\t')).toHaveLength(8);
    expect(row.split('\t')).toHaveLength(8);
    expect(row).toContain('480');
  });

  it('пустой выбор — только шапка', () => {
    expect(rowsToText([]).split('\n')).toHaveLength(1);
  });
});

describe('planFact', () => {
  const routes: PlanRoute[] = [{
    id: 'r1', name: 'Зеренда — Серафимовка', coords: [], lengthM: 1000,
    source: 'plan.kml', createdAt: '', updatedAt: '',
  }];

  it('показывает, где факт ушёл от проекта', () => {
    const rows = planFact([e({ byMethod: { 'бар': 1400 } })], routes);
    expect(rows).toHaveLength(1);
    expect(rows[0].diffM).toBe(400);
    expect(rows[0].share).toBeCloseTo(0.4, 5);
  });

  it('мелкое расхождение — не новость', () => {
    expect(planFact([e({ byMethod: { 'бар': 1050 } })], routes)).toEqual([]);
  });

  it('участок без проекта не сравниваем', () => {
    expect(planFact([e({ uchastok: 'Неизвестный' })], routes)).toEqual([]);
  });

  it('недобор тоже виден — со знаком минус', () => {
    const rows = planFact([e({ byMethod: { 'бар': 600 } })], routes);
    expect(rows[0].diffM).toBe(-400);
  });
});
