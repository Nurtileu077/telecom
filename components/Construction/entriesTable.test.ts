import { describe, it, expect } from 'vitest';
import {
  entryMeters, filterEntries, sortEntries, weekStart, groupByWeek,
  tableTotals, rowsToText, planFact, entryHasWork, isIdleShift,
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

/**
 * Один участок, записанный по-разному, — это по-прежнему один участок.
 * Раньше «Исаковка» и «исаковка » давали две строки, и каждая
 * сравнивалась с полной проектной длиной: один недобор превращался в два.
 */
describe('planFact и разное написание участка', () => {
  const routes: PlanRoute[] = [{
    id: 'r1', name: 'Исаковка', uchastok: 'Исаковка',
    coords: [[52, 71], [52, 71.1]], lengthM: 6000,
    source: 'plan.kml', createdAt: '', updatedAt: '',
  }];

  it('складывает факт по всем написаниям в одну строку', () => {
    const rows = planFact([
      e({ id: 'a', uchastok: 'Исаковка', byMethod: { 'бар': 2000 } }),
      e({ id: 'b', uchastok: 'исаковка ', byMethod: { 'бар': 1500 } }),
    ], routes);
    expect(rows).toHaveLength(1);
    expect(rows[0].factM).toBe(3500);
    expect(rows[0].planM).toBe(6000);
    expect(rows[0].diffM).toBe(-2500);
  });

  it('когда факт сошёлся с проектом, строки нет вовсе', () => {
    const rows = planFact([
      e({ id: 'a', uchastok: 'Исаковка', byMethod: { 'бар': 3000 } }),
      e({ id: 'b', uchastok: 'ИСАКОВКА', byMethod: { 'бар': 3000 } }),
    ], routes);
    expect(rows).toHaveLength(0);
  });

  it('в строке показывает то написание, что встретилось первым', () => {
    const rows = planFact([
      e({ id: 'a', uchastok: 'Исаковка', byMethod: { 'бар': 1000 } }),
      e({ id: 'b', uchastok: 'исаковка', byMethod: { 'бар': 1000 } }),
    ], routes);
    expect(rows[0].uchastok).toBe('Исаковка');
  });
});

/**
 * Дождь или ждём разрешения: бригада на объекте, метров ноль, причина
 * названа. Это смена простоя — не ошибка ввода и не пустая строка.
 */
describe('смена простоя', () => {
  it('без работ и с причиной — простой', () => {
    expect(isIdleShift(e({ byMethod: {}, downtime: 'дождь' }))).toBe(true);
  });

  it('без причины — не простой, а пустая строка', () => {
    expect(isIdleShift(e({ byMethod: {} }))).toBe(false);
    expect(isIdleShift(e({ byMethod: {}, downtime: '   ' }))).toBe(false);
  });

  it('работали полдня и записали причину — это рабочая смена', () => {
    expect(isIdleShift(e({ byMethod: { 'бар': 200 }, downtime: 'после обеда дождь' }))).toBe(false);
  });

  it('задувка без укладки — работа, а не простой', () => {
    expect(entryHasWork(e({ byMethod: {}, blowingM: 2400 }))).toBe(true);
    expect(isIdleShift(e({ byMethod: {}, blowingM: 2400, downtime: 'ждали кабель' }))).toBe(false);
  });

  it('ГНБ, открытый переход и операции инженера — тоже работа', () => {
    expect(entryHasWork(e({ byMethod: {}, drillM: 72 }))).toBe(true);
    expect(entryHasWork(e({ byMethod: {}, openCrossings: 2 }))).toBe(true);
    expect(entryHasWork(e({ byMethod: {}, operations: { proporka: 600 } }))).toBe(true);
    expect(entryHasWork(e({ byMethod: {}, totalMktM: 900 }))).toBe(true);
  });

  it('в итогах таблицы простой считается отдельно и не размазывает средние', () => {
    const t = tableTotals([
      e({ id: '1', date: '2026-07-20', byMethod: { 'бар': 600 } }),
      e({ id: '2', date: '2026-07-21', byMethod: { 'бар': 400 } }),
      e({ id: '3', date: '2026-07-22', byMethod: {}, downtime: 'дождь' }),
    ]);
    expect(t.shifts).toBe(3);
    expect(t.idle).toBe(1);
    expect(t.days).toBe(3);
    expect(t.perShift).toBe(500);
  });

  it('одни простои — средняя ноль, а не деление на ноль', () => {
    expect(tableTotals([e({ byMethod: {}, downtime: 'дождь' })]).perShift).toBe(0);
  });
});
