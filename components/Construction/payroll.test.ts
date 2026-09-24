import { describe, it, expect } from 'vitest';
import {
  rateFor, workQuantity, payroll, costPerMeter, compareContractors,
  payrollSummary, paymentLines, PAYABLE_WORKS, moneyBehind,
} from './payroll';
import type { DailyWorkEntry, WorkRate, Payment } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: 'x', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'У1', kato: '1',
    byMethod: { 'бар': 400 }, materials: {}, createdAt: '', updatedAt: '',
    contractor: 'Дозер', ...patch,
  } as DailyWorkEntry;
}

const RATES: WorkRate[] = [
  { id: 'r1', work: 'бар', price: 300, unit: 'м', from: '2026-01-01', updatedAt: '' },
  { id: 'r2', work: 'бар', price: 350, unit: 'м', from: '2026-08-01', updatedAt: '' },
  {
    id: 'r3', work: 'бар', price: 280, unit: 'м', from: '2026-01-01',
    contractor: 'TERRA TECH', updatedAt: '',
  },
  { id: 'r4', work: 'drillM', price: 5000, unit: 'м', from: '2026-01-01', updatedAt: '' },
];

const PAYMENTS: Payment[] = [
  {
    id: 'p1', contractor: 'Дозер', kind: 'advance', amount: 100_000,
    date: '2026-07-10', createdAt: '', updatedAt: '',
  },
  {
    id: 'p2', contractor: 'Дозер', kind: 'deduction', amount: 20_000,
    date: '2026-07-20', note: 'перерасход МКТ', createdAt: '', updatedAt: '',
  },
];

describe('rateFor', () => {
  it('берёт расценку, действовавшую в день работы', () => {
    expect(rateFor(RATES, 'бар', '2026-07-25')?.price).toBe(300);
    expect(rateFor(RATES, 'бар', '2026-08-15')?.price).toBe(350);
  });

  it('своя расценка подрядчика важнее общей', () => {
    expect(rateFor(RATES, 'бар', '2026-07-25', 'TERRA TECH')?.price).toBe(280);
  });

  it('до начала действия расценки её нет', () => {
    expect(rateFor(RATES, 'бар', '2025-12-31')).toBeNull();
  });

  it('незнакомая работа — нет расценки', () => {
    expect(rateFor(RATES, 'вручную', '2026-07-25')).toBeNull();
  });
});

describe('workQuantity', () => {
  it('достаёт количество по виду работ', () => {
    const row = e({ byMethod: { 'бар': 400 }, drillM: 72, drillCount: 2 });
    expect(workQuantity(row, 'бар')).toBe(400);
    expect(workQuantity(row, 'drillM')).toBe(72);
    expect(workQuantity(row, 'drillCount')).toBe(2);
    expect(workQuantity(row, 'вручную')).toBe(0);
  });

  it('все платные виды работ умеет доставать', () => {
    const row = e();
    for (const w of PAYABLE_WORKS) expect(workQuantity(row, w.key)).toBeGreaterThanOrEqual(0);
  });
});

describe('payroll', () => {
  const rows = [
    e({ id: 'a', date: '2026-07-25', byMethod: { 'бар': 400 }, drillM: 72 }),
    e({ id: 'b', date: '2026-07-27', byMethod: { 'бар': 600, 'вручную': 100 } }),
    e({ id: 'c', date: '2026-07-28', contractor: 'TERRA TECH', byMethod: { 'бар': 1000 } }),
  ];

  it('считает по метрам журнала и расценке дня', () => {
    const r = payroll('Дозер', rows, RATES, PAYMENTS);
    expect(r.lines.find((l) => l.work === 'бар')?.quantity).toBe(1000);
    expect(r.lines.find((l) => l.work === 'бар')?.sum).toBe(300_000);
    expect(r.lines.find((l) => l.work === 'drillM')?.sum).toBe(360_000);
  });

  it('работа без расценки в сумму не попадает и названа отдельно', () => {
    const r = payroll('Дозер', rows, RATES, PAYMENTS);
    expect(r.unpriced).toContain('Ручным способом');
    expect(r.accrued).toBe(660_000);
  });

  it('аванс и удержания уменьшают долг', () => {
    const r = payroll('Дозер', rows, RATES, PAYMENTS);
    expect(r.advances).toBe(100_000);
    expect(r.deductions).toBe(20_000);
    expect(r.due).toBe(660_000 - 120_000);
  });

  it('чужие смены и чужие деньги не считает', () => {
    const r = payroll('TERRA TECH', rows, RATES, PAYMENTS);
    expect(r.shifts).toBe(1);
    expect(r.advances).toBe(0);
    // У TERRA TECH своя расценка 280.
    expect(r.accrued).toBe(280_000);
  });

  it('период сужает и работы, и деньги', () => {
    const r = payroll('Дозер', rows, RATES, PAYMENTS, { from: '2026-07-26' });
    expect(r.shifts).toBe(1);
    expect(r.advances).toBe(0);
  });

  it('пусто — нули, а не выдуманный долг', () => {
    const r = payroll('Никто', rows, RATES, PAYMENTS);
    expect(r.accrued).toBe(0);
    expect(r.due).toBe(0);
  });
});

describe('costPerMeter', () => {
  const rows = [e({ id: 'a', byMethod: { 'бар': 1000 } })];

  it('делит начисленное на оплаченные метры', () => {
    const r = payroll('Дозер', rows, RATES, []);
    expect(costPerMeter(r)).toBe(300);
  });

  it('без расценок метр не стоит ноль — он неизвестен', () => {
    const r = payroll('Дозер', rows, [], []);
    expect(costPerMeter(r)).toBeNull();
  });
});

describe('compareContractors', () => {
  const rows = [
    e({ id: 'a', byMethod: { 'бар': 1000 } }),
    e({ id: 'b', contractor: 'TERRA TECH', byMethod: { 'бар': 2000 } }),
  ];

  it('отвечает на три разных вопроса сразу', () => {
    const list = compareContractors(rows, RATES, [], new Map([['Дозер', 3]]));
    expect(list[0].contractor).toBe('TERRA TECH');
    expect(list[0].perShift).toBe(2000);
    expect(list.find((c) => c.contractor === 'Дозер')?.deviations).toBe(3);
    expect(list.find((c) => c.contractor === 'TERRA TECH')?.perMeter).toBe(280);
  });

  it('пустой журнал — пустое сравнение', () => {
    expect(compareContractors([], RATES, [], new Map())).toEqual([]);
  });
});

describe('moneyBehind', () => {
  const plans = [
    { crew: '1-колонна', uchastok: 'Зеренда', leftM: 1000, week: '2026-07-20' },
    { crew: '2-колонна', uchastok: 'Щучинск', leftM: 500, week: '2026-07-20' },
    { crew: '3-колонна', uchastok: 'Аккол', leftM: 0, week: '2026-07-20' },
  ];
  const rates: WorkRate[] = [
    { id: 'k', work: 'кабелеукладчик', price: 200, unit: 'м', from: '2026-01-01', updatedAt: '' },
  ];

  it('переводит недобор метров в тенге', () => {
    const r = moneyBehind(plans, rates);
    expect(r.totalM).toBe(1500);
    expect(r.totalMoney).toBe(300_000);
    expect(r.rows[0].crew).toBe('1-колонна');
  });

  it('закрытые задания в отставание не идут', () => {
    expect(moneyBehind(plans, rates).rows).toHaveLength(2);
  });

  it('без расценки отставание считается только в метрах', () => {
    const r = moneyBehind(plans, []);
    expect(r.totalM).toBe(1500);
    expect(r.totalMoney).toBe(0);
  });
});

describe('payrollSummary', () => {
  it('говорит словами, что откуда и сколько осталось', () => {
    const r = payroll('Дозер', [e({ byMethod: { 'бар': 1000 } })], RATES, PAYMENTS);
    const s = payrollSummary(r);
    expect(s).toContain('начислено');
    expect(s).toContain('аванс');
    expect(s).toContain('к оплате');
  });

  it('переплату называет переплатой, а не отрицательным долгом', () => {
    const r = payroll('Дозер', [], RATES, PAYMENTS);
    expect(payrollSummary(r)).toContain('переплата');
  });
});

describe('paymentLines', () => {
  it('перечисляет движения с датами и пояснениями', () => {
    const lines = paymentLines(PAYMENTS, 'Дозер');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Удержание');
    expect(lines[0]).toContain('перерасход МКТ');
  });
});

/**
 * Договор начинается с какого-то числа, а работы до него уже сделаны.
 * Такой объём в сумму не попадает — и об этом надо говорить вслух, иначе
 * в строке расчёта цена × количество не сойдётся с суммой, а сходятся
 * там на встрече с подрядчиком.
 */
describe('объём вне расценки', () => {
  const LATE: WorkRate[] = [
    { id: 'l1', work: 'бар', price: 300, unit: 'м', from: '2026-07-27', updatedAt: '' },
  ];
  const rows = [
    e({ id: 'a', date: '2026-07-25', byMethod: { 'бар': 400 } }),
    e({ id: 'b', date: '2026-07-28', byMethod: { 'бар': 600 } }),
  ];

  it('в объём попадает всё, в сумму — только оценённое', () => {
    const l = payroll('Дозер', rows, LATE, []).lines.find((x) => x.work === 'бар')!;
    expect(l.quantity).toBe(1000);
    expect(l.pricedQuantity).toBe(600);
    expect(l.sum).toBe(180_000);
  });

  it('о неоценённой части говорит, а не молчит', () => {
    const r = payroll('Дозер', rows, LATE, []);
    expect(r.unpriced).toHaveLength(1);
    expect(r.unpriced[0]).toContain('400');
    expect(r.unpriced[0]).toContain('вне расценки');
  });

  it('цена × количество сходится с суммой, когда оценено всё', () => {
    const only = [e({ id: 'b', date: '2026-07-28', byMethod: { 'бар': 600 } })];
    const l = payroll('Дозер', only, LATE, []).lines.find((x) => x.work === 'бар')!;
    expect(l.price).toBe(300);
    expect(l.price! * l.pricedQuantity).toBe(l.sum);
    expect(l.pricedQuantity).toBe(l.quantity);
  });

  it('когда цена за период менялась, одну не показывает', () => {
    const rows2 = [
      e({ id: 'a', date: '2026-07-25', byMethod: { 'бар': 400 } }),
      e({ id: 'b', date: '2026-08-05', byMethod: { 'бар': 600 } }),
    ];
    const l = payroll('Дозер', rows2, RATES, []).lines.find((x) => x.work === 'бар')!;
    expect(l.sum).toBe(400 * 300 + 600 * 350);
    expect(l.price).toBeUndefined();
    expect(l.pricedQuantity).toBe(1000);
  });

  it('работа, на которую расценки нет вовсе, названа без оговорок', () => {
    const manual = [e({ id: 'a', date: '2026-07-28', byMethod: { 'вручную': 100 } })];
    const r = payroll('Дозер', manual, LATE, []);
    expect(r.unpriced).toEqual(['Ручным способом']);
  });
});
