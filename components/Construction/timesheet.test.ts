import { describe, it, expect } from 'vitest';
import {
  timesheet, crewsWithoutMembers, timesheetTotals, timesheetToText,
} from './timesheet';
import type { DailyWorkEntry, Crew } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: patch.id ?? 'x', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'У1', kato: '1',
    byMethod: { 'бар': 400 }, materials: {}, createdAt: '', updatedAt: '',
    column: '1-колонна', ...patch,
  } as DailyWorkEntry;
}

const CREWS: Crew[] = [
  {
    id: 'c1', kind: 'mkt', name: '1-колонна', contractor: 'Дозер',
    status: 'working', members: [
      { name: 'Ахметов А.', role: 'Мастер' },
      { name: 'Сериков Б.', role: 'Машинист' },
    ],
    equipment: {}, updatedAt: '',
  } as Crew,
  {
    id: 'c2', kind: 'mkt', name: 'Колонна-2', contractor: 'TERRA TECH',
    status: 'working', members: [], equipment: {}, updatedAt: '',
  } as Crew,
];

const ROWS = [
  e({ id: 'a', date: '2026-07-25', byMethod: { 'бар': 400 } }),
  e({ id: 'b', date: '2026-07-26', byMethod: { 'бар': 600 } }),
  e({ id: 'c', date: '2026-08-01', column: 'Колонна-2', byMethod: { 'бар': 900 } }),
];

describe('timesheet', () => {
  it('раскладывает смены колонны на её людей', () => {
    const t = timesheet(ROWS, CREWS);
    expect(t).toHaveLength(2);
    expect(t[0].shifts).toBe(2);
    expect(t.map((r) => r.name)).toContain('Ахметов А.');
  });

  it('метры колонны не делит на людей', () => {
    const t = timesheet(ROWS, CREWS);
    expect(t.every((r) => r.crewMeters === 1000)).toBe(true);
  });

  it('две смены в один день — это один день', () => {
    const t = timesheet([
      e({ id: '1', date: '2026-07-25' }), e({ id: '2', date: '2026-07-25' }),
    ], CREWS);
    expect(t[0].shifts).toBe(2);
    expect(t[0].days).toBe(1);
  });

  it('период сужает выборку', () => {
    const t = timesheet(ROWS, CREWS, { from: '2026-07-26', to: '2026-07-31' });
    expect(t[0].shifts).toBe(1);
  });

  it('колонна без состава в табель не попадает', () => {
    const t = timesheet(ROWS, CREWS);
    expect(t.some((r) => r.crew === 'Колонна-2')).toBe(false);
  });

  it('смен нет — и табеля нет', () => {
    expect(timesheet([], CREWS)).toEqual([]);
  });
});

describe('crewsWithoutMembers', () => {
  it('называет колонны, которые в табель не попали', () => {
    expect(crewsWithoutMembers(ROWS, CREWS)).toEqual(['Колонна-2']);
  });

  it('незнакомая колонна тоже считается', () => {
    expect(crewsWithoutMembers([e({ id: 'z', column: 'Колонна-9' })], CREWS))
      .toEqual(['Колонна-9']);
  });

  it('у всех есть состав — и говорить не о чем', () => {
    expect(crewsWithoutMembers([e({ id: 'a' })], CREWS)).toEqual([]);
  });
});

describe('timesheetTotals', () => {
  it('метры считает по колоннам, а не по строкам табеля', () => {
    const t = timesheet(ROWS, CREWS);
    const totals = timesheetTotals(t);
    // Два человека одной колонны — метры всё равно одни.
    expect(totals.meters).toBe(1000);
    expect(totals.people).toBe(2);
    expect(totals.shifts).toBe(4);
  });

  it('пустой табель — нули', () => {
    expect(timesheetTotals([])).toEqual({ people: 0, shifts: 0, meters: 0 });
  });
});

describe('timesheetToText', () => {
  it('колонки через табуляцию — вставится в расчёт', () => {
    const text = timesheetToText(timesheet(ROWS, CREWS));
    expect(text.split('\n')[0].split('\t')).toHaveLength(7);
    expect(text).toContain('Ахметов А.');
  });
});
