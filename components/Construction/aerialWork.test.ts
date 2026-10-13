import { describe, it, expect } from 'vitest';
import { aerialMeters, aerialIn, aerialVolumeRows, unassignedAerial } from './aerialWork';
import { volumeSheet, volumeDocHtml, costSheet } from './volumeDocs';
import { periodReport, periodDocHtml, paceChange } from './periodReports';
import {
  payroll, compareContractors, payrollContractors, meterCost, workQuantity, PAYABLE_WORKS,
} from './payroll';
import { regionProgress } from './management';
import { journalCsvRows, JOURNAL_CSV_HEADERS } from './journalCsv';
import type { AerialWorkEntry, DailyWorkEntry, WorkRate } from '@/types/construction';

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: 'g1', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod: { 'бар': 1000 }, materials: {}, contractor: 'Дозер',
    createdAt: '', updatedAt: '', ...over,
  };
}

function a(over: Partial<AerialWorkEntry> = {}): AerialWorkEntry {
  return {
    kind: 'aerial', id: 'a1', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    totalM: 500, byCable: {}, materials: {},
    createdAt: '', updatedAt: '', ...over,
  };
}

const RATES: WorkRate[] = [
  { id: 'r1', work: 'бар', price: 300, unit: 'м', from: '2026-01-01', updatedAt: '' },
  { id: 'r2', work: 'aerialM', price: 150, unit: 'м', from: '2026-01-01', updatedAt: '' },
];

describe('сколько подвешено в записи', () => {
  it('итогу дня верит, даже когда разбивка по типам меньше', () => {
    expect(aerialMeters(a({ totalM: 800, byCable: { 'ОК8': 300 } }))).toBe(800);
  });

  it('пустой итог при заполненной разбивке не считает нулём', () => {
    expect(aerialMeters(a({ totalM: 0, byCable: { 'ОК8': 300, 'ОК16': 200 } }))).toBe(500);
  });
});

describe('подвес строками ведомости', () => {
  it('тип кабеля — своей строкой, остаток дня — «тип не указан»', () => {
    const { cable } = aerialVolumeRows([
      a({ id: 'a1', totalM: 800, byCable: { 'ОК8': 500 } }),
      a({ id: 'a2', totalM: 200, byCable: {} }),
    ]);
    expect(cable).toEqual([
      { key: 'aerial-ОК8', label: 'Подвес кабеля ОК8', unit: 'м', quantity: 500 },
      { key: 'aerial', label: 'Подвес кабеля, тип не указан', unit: 'м', quantity: 500 },
    ]);
  });

  it('разбивку, которая больше итога, по типам не раскладывает', () => {
    const { cable } = aerialVolumeRows([a({ totalM: 300, byCable: { 'ОК8': 500 } })]);
    // Сколько какого кабеля повесили, не известно — выдумывать нельзя.
    expect(cable).toEqual([{ key: 'aerial', label: 'Подвес кабеля', unit: 'м', quantity: 300 }]);
  });

  it('муфту на опоре не сливает с муфтой в грунте', () => {
    const s = volumeSheet(
      [g({ materials: { 'Муфта': 2 } })],
      {},
      [a({ materials: { 'Муфта': 3, 'Опоры': 40 } })],
    );
    expect(s.rows.find((r) => r.key === 'mat-Муфта')?.quantity).toBe(2);
    expect(s.rows.find((r) => r.key === 'aerial-mat-Муфта')).toMatchObject({ label: 'Муфта (подвес)', quantity: 3 });
    expect(s.rows.find((r) => r.key === 'aerial-mat-Опоры')).toMatchObject({ unit: 'шт', quantity: 40 });
  });
});

describe('ведомость объёмов с подвесом', () => {
  const ground = [g({ id: 'g1', date: '2026-09-10' }), g({ id: 'g2', date: '2026-09-11', uchastok: 'Зеренда' })];
  const air = [a({ id: 'a1', date: '2026-09-12', totalM: 700, uchastok: 'Кокшетау — Бурабай' })];

  it('подвешенное входит во «всего протянуто», а не в «проложено»', () => {
    const s = volumeSheet(ground, {}, air);
    expect(s.groundM).toBe(2000);
    expect(s.aerialM).toBe(700);
    expect(s.totalM).toBe(2700);
    expect(s.shifts).toBe(3);
    expect(s.aerialShifts).toBe(1);
    expect(s.sections).toContain('Кокшетау — Бурабай');
    expect(s.to).toBe('2026-09-12');
  });

  it('в документе подвес итожится отдельно от прокладки и вместе с ней', () => {
    const html = volumeDocHtml({ sheet: volumeSheet(ground, {}, air) });
    expect(html).toContain('Итого проложено в грунт');
    expect(html).toContain('Итого подвешено');
    expect(html).toContain('Всего протянуто');
    expect(html).toContain('2 700');
  });

  it('без подвеса документ остаётся прежним', () => {
    const html = volumeDocHtml({ sheet: volumeSheet(ground) });
    expect(html).toContain('Итого проложено');
    expect(html).not.toContain('подвеш');
  });

  it('период и подрядчик сужают подвес так же, как подземку', () => {
    const s = volumeSheet(ground, { from: '2026-09-11', contractor: 'Дозер' }, [
      a({ id: 'x1', date: '2026-09-12', contractor: 'Дозер', totalM: 100 }),
      a({ id: 'x2', date: '2026-09-12', contractor: 'Модуль Строй', totalM: 900 }),
      a({ id: 'x3', date: '2026-09-09', contractor: 'Дозер', totalM: 50 }),
    ]);
    expect(s.aerialM).toBe(100);
  });

  it('подвес получает свою строку цены в КС-2', () => {
    const s = volumeSheet([], {}, [a({ totalM: 1000 })]);
    const cost = costSheet(s, { aerial: 120 });
    expect(cost.total).toBe(120_000);
    expect(cost.unpriced).toEqual([]);
  });
});

describe('отчёт за период с подвесом', () => {
  const ground = [
    g({ id: 'g1', date: '2026-09-07' }),
    g({ id: 'g2', date: '2026-09-08', byMethod: {}, downtime: 'дождь' }),
  ];
  const air = [
    a({ id: 'a1', date: '2026-09-09', totalM: 600 }),
    a({ id: 'a2', date: '2026-09-15', totalM: 400, uchastok: 'Зеренда', oblast: '' }),
  ];

  it('сходится с фактом на «Руководству»', () => {
    const r = periodReport(ground, {}, air);
    const fact = regionProgress({
      orders: [], ground, aerial: air, progress: [], crews: [], deviations: [],
    }).reduce((s, x) => s + x.factM, 0);
    expect(r.meters).toBe(fact);
    expect(r.groundM).toBe(1000);
    expect(r.aerialM).toBe(1000);
  });

  it('день подвеса — рабочий день, а не «без единой смены»', () => {
    const r = periodReport(ground, { from: '2026-09-07', to: '2026-09-09' }, air);
    expect(r.idleDays).toEqual([]);
    expect(r.days).toBe(2);
    expect(r.shifts).toBe(2);
    expect(r.aerialShifts).toBe(1);
    expect(r.idleShifts).toBe(1);
  });

  it('подвес ложится на свой участок и в свою неделю', () => {
    const r = periodReport(ground, {}, air);
    expect(r.sections.find((x) => x.uchastok === 'Еленовка')).toMatchObject({ meters: 1600, aerialM: 600 });
    expect(r.sections.find((x) => x.uchastok === 'Зеренда')).toMatchObject({ meters: 400, aerialM: 400 });
    expect(r.weeks.map((w) => w.meters)).toEqual([400, 1600]);
  });

  it('подвес без области оговаривает, как и смену без области', () => {
    const r = periodReport(ground, {}, air);
    expect(r.noOblast.meters).toBe(400);
    expect(r.noOblast.shifts).toBe(1);
  });

  it('в документе называет, сколько из выполненного на опорах', () => {
    const html = periodDocHtml({ report: periodReport(ground, {}, air) });
    expect(html).toContain('подвешено 1,00 км');
    expect(html).toContain('Из них подвес, м');
  });

  it('только подвес — так и пишет, без «в грунт 0 км»', () => {
    const html = periodDocHtml({ report: periodReport([], {}, air) });
    expect(html).toContain('Всё выполненное — подвес кабеля');
    expect(html).not.toContain('в грунт');
  });

  it('темп сравнивает с прошлым отрезком вместе с подвесом', () => {
    const p = paceChange(
      [g({ id: 'p1', date: '2026-09-01', byMethod: { 'бар': 500 } })],
      { from: '2026-09-08', to: '2026-09-14' },
      [a({ id: 'p2', date: '2026-09-02', totalM: 500 }), a({ id: 'p3', date: '2026-09-09', totalM: 1500 })],
    );
    expect(p).toEqual({ previousM: 1000, currentM: 1500, change: 0.5 });
  });
});

describe('расчёт с подрядчиком за подвес', () => {
  it('подвес — свой вид работ с расценкой за метр', () => {
    const w = PAYABLE_WORKS.find((x) => x.key === 'aerialM');
    expect(w).toMatchObject({ label: 'Подвес кабеля', unit: 'м' });
    expect(workQuantity(a({ totalM: 700 }), 'aerialM')).toBe(700);
    expect(workQuantity(a({ totalM: 700 }), 'бар')).toBe(0);
    expect(workQuantity(g(), 'aerialM')).toBe(0);
  });

  it('начисляет подвес по протянутым метрам и делит цену метра на них же', () => {
    const r = payroll('Дозер', [g()], RATES, [], {}, [a({ contractor: 'Дозер', totalM: 500 })]);
    expect(r.lines.find((l) => l.work === 'aerialM')).toMatchObject({ quantity: 500, sum: 75_000 });
    expect(r.accrued).toBe(300_000 + 75_000);
    expect(r.meters).toBe(1500);
    expect(r.aerialM).toBe(500);
    expect(r.shifts).toBe(2);
    expect(meterCost(r).work.value).toBe(375_000 / 1500);
    expect(meterCost(r).byMethod.find((m) => m.method === 'aerialM')?.perMeter).toBe(150);
  });

  it('подвес без расценки называет, а не считает бесплатным', () => {
    const r = payroll('Дозер', [], RATES.slice(0, 1), [], {}, [a({ contractor: 'Дозер' })]);
    expect(r.accrued).toBe(0);
    expect(r.unpriced).toEqual(['Подвес кабеля']);
  });

  it('подвес до периода уходит в долг на начало', () => {
    const r = payroll('Дозер', [], RATES, [], { from: '2026-09-01', to: '2026-09-30' }, [
      a({ id: 'old', date: '2026-08-20', contractor: 'Дозер', totalM: 100 }),
      a({ id: 'new', date: '2026-09-20', contractor: 'Дозер', totalM: 200 }),
    ]);
    expect(r.opening).toBe(15_000);
    expect(r.accrued).toBe(30_000);
    expect(r.due).toBe(45_000);
  });

  it('ничей подвес ни в чей расчёт не кладёт', () => {
    const air = [a({ id: 'x', contractor: undefined, totalM: 900 })];
    const r = payroll('Дозер', [g()], RATES, [], {}, air);
    expect(r.aerialM).toBe(0);
    expect(r.lines.some((l) => l.work === 'aerialM')).toBe(false);
  });

  it('расчёт «без подрядчика» не забирает себе чужой подвес', () => {
    const r = payroll('', [], RATES, [], {}, [a({ id: 'x', contractor: 'Дозер', totalM: 900 })]);
    expect(r.aerialM).toBe(0);
  });

  it('подрядчик, который только вешал, есть в расчётах и в сравнении', () => {
    const air = [a({ contractor: 'Модуль Строй', totalM: 2000 })];
    expect(payrollContractors([g()], air)).toEqual(['Дозер', 'Модуль Строй']);
    const table = compareContractors([g()], RATES, [], new Map(), {}, air);
    const mod = table.find((c) => c.contractor === 'Модуль Строй');
    expect(mod).toMatchObject({ meters: 2000, shifts: 1, accrued: 300_000 });
  });

  it('цену метра с материалом при подвесе не выдаёт за точную', () => {
    const r = payroll('Дозер', [g({ materials: { 'МКТ': 1000 } })], RATES, [], {},
      [a({ contractor: 'Дозер' })]);
    const c = meterCost(r, { 'МКТ': 100 });
    expect(c.material.complete).toBe(false);
    expect(c.material.missing.join(' ')).toContain('материал подвеса');
    expect(c.total.complete).toBe(false);
  });
});

describe('ничей подвес', () => {
  it('называет по участкам, сколько и за какие дни', () => {
    const groups = unassignedAerial([
      a({ id: '1', date: '2026-09-10', totalM: 300 }),
      a({ id: '2', date: '2026-09-12', totalM: 200, uchastok: ' еленовка' }),
      a({ id: '3', date: '2026-09-12', totalM: 900, uchastok: 'Зеренда' }),
      a({ id: '4', date: '2026-09-12', totalM: 50, contractor: 'Дозер' }),
    ]);
    expect(groups).toEqual([
      { uchastok: 'Зеренда', ids: ['3'], meters: 900, days: 1, from: '2026-09-12', to: '2026-09-12' },
      { uchastok: 'Еленовка', ids: ['1', '2'], meters: 500, days: 2, from: '2026-09-10', to: '2026-09-12' },
    ]);
  });

  it('берёт только записи периода', () => {
    const groups = unassignedAerial(
      [a({ id: '1', date: '2026-08-31' }), a({ id: '2', date: '2026-09-01' })],
      { from: '2026-09-01', to: '2026-09-30' },
    );
    expect(groups.map((x) => x.ids)).toEqual([['2']]);
  });

  it('запись без даты при заданном периоде в выборку не берёт', () => {
    expect(aerialIn([a({ date: '' })], { from: '2026-09-01' })).toEqual([]);
  });
});

describe('журнал таблицей для 1С', () => {
  it('подвес идёт своей строкой и своей последней колонкой', () => {
    const { headers, rows } = journalCsvRows(
      [g({ id: 'g1', date: '2026-09-11' })],
      [a({ id: 'a1', date: '2026-09-10', totalM: 500 })],
    );
    expect(headers).toBe(JOURNAL_CSV_HEADERS);
    expect(headers[headers.length - 1]).toBe('Подвес, м');
    // Старые колонки на своих местах: загрузку в 1С настраивают по номерам.
    expect(headers.indexOf('Автор')).toBe(headers.length - 2);
    expect(rows[0][0]).toBe('2026-09-10');
    expect(rows[0][rows[0].length - 1]).toBe(500);
    expect(rows[1][rows[1].length - 1]).toBe(0);
  });
});
