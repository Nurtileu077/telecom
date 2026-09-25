import { describe, it, expect } from 'vitest';
import {
  timesheet, crewsWithoutMembers, shiftsWithoutCrew, timesheetTotals, timesheetToText,
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

/**
 * «Колонна 1» есть и у TERRA TECH, и у Дозера — это разные бригады с
 * одинаковым номером. Сводить их по названию значит приписать чужой
 * бригаде чужие смены, а по табелю считают деньги.
 */
describe('одинаковые названия у разных подрядчиков', () => {
  const TWO: Crew[] = [
    {
      id: 'd1', kind: 'mkt', name: 'Колонна 1', contractor: 'Дозер',
      status: 'working', members: [{ name: 'Ахметов А.', role: 'Мастер' }],
      equipment: {}, updatedAt: '',
    } as Crew,
    {
      id: 't1', kind: 'mkt', name: 'Колонна 1', contractor: 'TERRA TECH',
      status: 'working', members: [{ name: 'Жумабеков С.', role: 'Мастер' }],
      equipment: {}, updatedAt: '',
    } as Crew,
  ];
  const rows = [
    e({ id: 'a', column: 'Колонна 1', contractor: 'Дозер', byMethod: { 'бар': 400 } }),
    e({ id: 'b', column: 'Колонна 1', contractor: 'Дозер', byMethod: { 'бар': 600 } }),
    e({
      id: 'c', column: 'Колонна 1', contractor: 'TERRA TECH', date: '2026-07-26',
      byMethod: { 'бар': 1000 },
    }),
  ];

  it('каждой бригаде — свои смены, а не общие', () => {
    const t = timesheet(rows, TWO);
    const dozer = t.find((r) => r.name === 'Ахметов А.')!;
    const terra = t.find((r) => r.name === 'Жумабеков С.')!;
    expect(dozer.shifts).toBe(2);
    expect(dozer.crewMeters).toBe(1000);
    expect(terra.shifts).toBe(1);
    expect(terra.crewMeters).toBe(1000);
  });

  it('когда название уникально, подрядчика в смене можно и не писать', () => {
    const one: Crew[] = [TWO[0]];
    const t = timesheet([e({ id: 'a', column: 'Колонна 1', contractor: undefined })], one);
    expect(t).toHaveLength(1);
    expect(t[0].shifts).toBe(1);
  });
});

/**
 * Смена, в которой колонну не записали, не попадает в табель ни к кому.
 * Раньше об этом никто не говорил, и человек решал, что потерялись
 * данные, хотя потерялось поле в паре строк.
 */
describe('shiftsWithoutCrew', () => {
  it('считает смены без колонны и их метры', () => {
    const r = shiftsWithoutCrew([
      e({ id: 'a', column: '1-колонна' }),
      e({ id: 'b', column: '', byMethod: { 'бар': 700 } }),
      e({ id: 'c', column: '   ', date: '2026-07-26', byMethod: { 'бар': 300 } }),
    ]);
    expect(r.shifts).toBe(2);
    expect(r.meters).toBe(1000);
    expect(r.dates).toEqual(['2026-07-25', '2026-07-26']);
  });

  it('когда колонна есть везде — сообщать не о чем', () => {
    expect(shiftsWithoutCrew([e({ id: 'a' })]).shifts).toBe(0);
  });

  it('считает только внутри периода', () => {
    const rows = [
      e({ id: 'a', column: '', date: '2026-07-01' }),
      e({ id: 'b', column: '', date: '2026-07-25' }),
    ];
    expect(shiftsWithoutCrew(rows, [], { from: '2026-07-20', to: '2026-07-31' }).shifts).toBe(1);
  });
});

/**
 * Дыра, которую завело само исправление «одинаковые названия у разных
 * подрядчиков»: смена с общим именем колонны и без подрядчика не
 * попадала ни к кому и при этом нигде не называлась. Семьсот метров
 * исчезали из табеля молча.
 */
describe('смена, которую некому отнести', () => {
  const TWO: Crew[] = [
    {
      id: 'd1', kind: 'mkt', name: 'Колонна 1', contractor: 'Дозер',
      status: 'working', members: [{ name: 'Ахметов А.' }], equipment: {}, updatedAt: '',
    } as Crew,
    {
      id: 't1', kind: 'mkt', name: 'Колонна 1', contractor: 'TERRA TECH',
      status: 'working', members: [{ name: 'Жумабеков С.' }], equipment: {}, updatedAt: '',
    } as Crew,
  ];

  const rows = [
    e({ id: 'a', column: 'Колонна 1', contractor: 'TERRA TECH', byMethod: { 'бар': 500 } }),
    // Подрядчика не записали, а имя колонны делят двое.
    e({ id: 'b', column: 'Колонна 1', contractor: undefined, byMethod: { 'бар': 700 } }),
  ];

  it('чужой бригаде её не приписывает', () => {
    const t = timesheet(rows, TWO);
    const terra = t.find((r) => r.name === 'Жумабеков С.')!;
    expect(terra.crewMeters).toBe(500);
    expect(t.find((r) => r.name === 'Ахметов А.')).toBeUndefined();
  });

  it('но и не теряет молча — называет вслух', () => {
    const out = shiftsWithoutCrew(rows, TWO);
    expect(out.shifts).toBe(1);
    expect(out.meters).toBe(700);
    expect(out.reasons[0].why).toContain('подрядчик в смене не указан');
    expect(out.reasons[0].columns).toEqual(['Колонна 1']);
  });

  it('колонну, которой нет в справочнике, тоже называет', () => {
    const out = shiftsWithoutCrew([e({ id: 'x', column: 'Колонна 9' })], TWO);
    expect(out.shifts).toBe(1);
    expect(out.reasons[0].why).toContain('нет в справочнике');
  });

  it('разные причины считает порознь', () => {
    const out = shiftsWithoutCrew([
      e({ id: 'a', column: '', byMethod: { 'бар': 100 } }),
      e({ id: 'b', column: 'Колонна 1', contractor: undefined, byMethod: { 'бар': 200 } }),
      e({ id: 'c', column: 'Колонна 9', byMethod: { 'бар': 300 } }),
    ], TWO);
    expect(out.shifts).toBe(3);
    expect(out.meters).toBe(600);
    expect(out.reasons).toHaveLength(3);
  });

  it('когда имя уникально, подрядчика можно не писать и смена не теряется', () => {
    const one: Crew[] = [TWO[0]];
    const rows2 = [e({ id: 'a', column: 'Колонна 1', contractor: undefined })];
    expect(timesheet(rows2, one)).toHaveLength(1);
    expect(shiftsWithoutCrew(rows2, one).shifts).toBe(0);
  });

  it('без справочника судить не берётся: там и колонн никаких нет', () => {
    const out = shiftsWithoutCrew([e({ id: 'a', column: 'Колонна 1' })], []);
    expect(out.shifts).toBe(0);
  });

  it('метры сошлись: что в табеле плюс что названо равно всему', () => {
    const t = timesheet(rows, TWO);
    const inSheet = new Set(t.map((r) => r.crew + r.contractor));
    const sheetM = [...inSheet].reduce(
      (s, k) => s + (t.find((r) => r.crew + r.contractor === k)?.crewMeters ?? 0), 0,
    );
    expect(sheetM + shiftsWithoutCrew(rows, TWO).meters).toBe(1200);
  });
});

/**
 * Итог считался по имени колонны. «Колонна 1» есть и у TERRA TECH, и у
 * Дозера — по одному имени они схлопывались в одну, и половина
 * выработки пропадала из итога при том, что в самих строках табеля она
 * есть. Человек видел, что итог не сходится со строками.
 */
describe('итог по одноимённым колоннам', () => {
  const TWO: Crew[] = [
    {
      id: 'd1', kind: 'mkt', name: 'Колонна 1', contractor: 'Дозер',
      status: 'working', members: [{ name: 'Ахметов А.' }], equipment: {}, updatedAt: '',
    } as Crew,
    {
      id: 't1', kind: 'mkt', name: 'Колонна 1', contractor: 'TERRA TECH',
      status: 'working', members: [{ name: 'Жумабеков С.' }], equipment: {}, updatedAt: '',
    } as Crew,
  ];
  const rows = [
    e({ id: 'a', column: 'Колонна 1', contractor: 'Дозер', byMethod: { 'бар': 400 } }),
    e({ id: 'b', column: 'Колонна 1', contractor: 'TERRA TECH', byMethod: { 'бар': 600 } }),
  ];

  it('метры обеих колонн попадают в итог', () => {
    expect(timesheetTotals(timesheet(rows, TWO)).meters).toBe(1000);
  });

  it('итог сходится с тем, что видно в строках', () => {
    const t = timesheet(rows, TWO);
    const seen = new Map<string, number>();
    for (const r of t) seen.set(`${r.contractor}|${r.crew}`, r.crewMeters);
    const bySight = [...seen.values()].reduce((s, v) => s + v, 0);
    expect(timesheetTotals(t).meters).toBe(bySight);
  });

  it('людей считает по колоннам, а не по одинаковым фамилиям', () => {
    const namesakes: Crew[] = [
      { ...TWO[0], members: [{ name: 'Ахметов А.' }] } as Crew,
      { ...TWO[1], members: [{ name: 'Ахметов А.' }] } as Crew,
    ];
    expect(timesheetTotals(timesheet(rows, namesakes)).people).toBe(2);
  });

  it('выработку колонны на людей не множит', () => {
    const big: Crew[] = [{
      id: 'c1', kind: 'mkt', name: 'Большая', contractor: 'Дозер', status: 'working',
      members: [{ name: 'А' }, { name: 'Б' }, { name: 'В' }], equipment: {}, updatedAt: '',
    } as Crew];
    const t = timesheet([e({ id: 'a', column: 'Большая', contractor: 'Дозер', byMethod: { 'бар': 900 } })], big);
    expect(t).toHaveLength(3);
    expect(timesheetTotals(t).meters).toBe(900);
  });
});
