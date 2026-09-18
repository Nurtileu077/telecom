import { describe, it, expect } from 'vitest';
import {
  materialForecast, lowStock, negativeStock, unknownStock, daysLeftText, LOW_STOCK_DAYS,
  materialByScope,
} from './materialForecast';
import type { DailyWorkEntry, MaterialDelivery, MaterialKind } from '@/types/construction';

const now = '2026-09-17T00:00:00.000Z';

function g(date: string, materials: Partial<Record<MaterialKind, number>>, oblast = 'Акмолинская область'): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date, smu: '',
    oblast, uchastok: 'У-1', kato: '191',
    byMethod: {}, materials,
    createdAt: now, updatedAt: now,
  };
}

function d(material: MaterialKind, qty: number, oblast = 'Акмолинская область'): MaterialDelivery {
  return {
    id: `d${Math.random()}`, date: '2026-09-01', oblast, material, qty,
    createdAt: now, updatedAt: now,
  };
}

const find = (rows: ReturnType<typeof materialForecast>, m: MaterialKind) =>
  rows.find((r) => r.material === m)!;

describe('остатки материалов', () => {
  it('остаток равен приходу минус расход', () => {
    const rows = materialForecast(
      [g('2026-09-10', { 'МКТ': 3000 }), g('2026-09-11', { 'МКТ': 2000 })],
      [d('МКТ', 20000)],
    );
    const mkt = find(rows, 'МКТ');
    expect(mkt.delivered).toBe(20000);
    expect(mkt.used).toBe(5000);
    expect(mkt.remaining).toBe(15000);
  });

  it('приход не внесён — остаток ноль, а не минус пять тысяч', () => {
    // Минус в этой клетке означал бы, что материал ушёл в минус. На деле
    // его просто не отметили при поступлении, и это другая беда.
    const rows = materialForecast([g('2026-09-10', { 'МКТ': 5000 })], []);
    const mkt = find(rows, 'МКТ');
    expect(mkt.remaining).toBe(0);
    expect(mkt.hasDeliveries).toBe(false);
    expect(unknownStock(rows).map((s) => s.material)).toEqual(['МКТ']);
    expect(negativeStock(rows)).toHaveLength(0);
  });

  it('приход внесён, а расход его перебил — вот это настоящий минус', () => {
    const rows = materialForecast([g('2026-09-10', { 'МКТ': 5000 })], [d('МКТ', 3000)]);
    expect(find(rows, 'МКТ').remaining).toBe(-2000);
    expect(negativeStock(rows).map((s) => s.material)).toEqual(['МКТ']);
  });

  it('показывает все позиции, даже нетронутые', () => {
    const rows = materialForecast([], []);
    expect(rows).toHaveLength(6);
    expect(find(rows, 'Муфта').remaining).toBe(0);
  });

  it('различает единицы учёта', () => {
    const rows = materialForecast([], []);
    expect(find(rows, 'МКТ').unit).toBe('м');
    expect(find(rows, 'Муфта').unit).toBe('шт');
  });
});

describe('темп расхода', () => {
  it('считается по рабочим дням, а не по календарным', () => {
    // Два дня расхода с пропуском между ними: темп 1000, а не 500.
    const rows = materialForecast(
      [g('2026-09-10', { 'МКТ': 1000 }), g('2026-09-14', { 'МКТ': 1000 })],
      [d('МКТ', 10000)],
    );
    const mkt = find(rows, 'МКТ');
    expect(mkt.workingDays).toBe(2);
    expect(mkt.perDay).toBe(1000);
  });

  it('несколько записей за один день считаются одним днём', () => {
    const rows = materialForecast(
      [g('2026-09-10', { 'МКТ': 600 }), g('2026-09-10', { 'МКТ': 400 })],
      [d('МКТ', 10000)],
    );
    expect(find(rows, 'МКТ').workingDays).toBe(1);
    expect(find(rows, 'МКТ').perDay).toBe(1000);
  });

  it('окно ограничивает расчёт последними днями', () => {
    const entries = [
      g('2026-09-01', { 'МКТ': 5000 }),
      g('2026-09-10', { 'МКТ': 1000 }),
      g('2026-09-11', { 'МКТ': 1000 }),
    ];
    const rows = materialForecast(entries, [d('МКТ', 20000)], { window: 2 });
    // Старый всплеск в окно не попал — темп по двум последним дням.
    expect(find(rows, 'МКТ').perDay).toBe(1000);
  });

  it('без расхода прогноз не выдумывается', () => {
    const rows = materialForecast([], [d('МКТ', 10000)]);
    const mkt = find(rows, 'МКТ');
    expect(mkt.perDay).toBe(0);
    expect(mkt.daysLeft).toBeNull();
  });
});

describe('на сколько хватит', () => {
  it('делит остаток на дневной темп', () => {
    const rows = materialForecast(
      [g('2026-09-10', { 'МКТ': 1000 })],
      [d('МКТ', 10000)],
    );
    // Остаток 9000 при темпе 1000 — на девять дней.
    expect(find(rows, 'МКТ').daysLeft).toBe(9);
  });

  it('без внесённого прихода прогноза нет — считать не от чего', () => {
    const rows = materialForecast([g('2026-09-10', { 'МКТ': 1000 })], []);
    expect(find(rows, 'МКТ').daysLeft).toBeNull();
  });

  it('при отрицательном остатке прогноз ноль, а не отрицательный', () => {
    const rows = materialForecast([g('2026-09-10', { 'МКТ': 1000 })], [d('МКТ', 500)]);
    expect(find(rows, 'МКТ').daysLeft).toBe(0);
  });

  it('позиция без прихода не выдаётся за нехватку — это дыра в учёте', () => {
    // Сообщать «пора отправлять» бессмысленно, пока приход не внесён.
    // Для этого есть отдельное предупреждение.
    const rows = materialForecast([g('2026-09-10', { 'МКТ': 1000 })], []);
    expect(lowStock(rows)).toHaveLength(0);
    expect(unknownStock(rows).map((s) => s.material)).toEqual(['МКТ']);
  });

  it('выделяет позиции, по которым пора отправлять', () => {
    const rows = materialForecast(
      [g('2026-09-10', { 'МКТ': 1000, 'Лента': 100 })],
      [d('МКТ', 4000), d('Лента', 100000)],
    );
    const low = lowStock(rows, LOW_STOCK_DAYS).map((s) => s.material);
    expect(low).toContain('МКТ');   // хватит на 3 дня
    expect(low).not.toContain('Лента');
  });
});

describe('отбор по области', () => {
  it('считает только выбранную область', () => {
    const rows = materialForecast(
      [g('2026-09-10', { 'МКТ': 1000 }, 'Акмолинская область'),
       g('2026-09-10', { 'МКТ': 9000 }, 'Костанайская область')],
      [d('МКТ', 5000, 'Акмолинская область'), d('МКТ', 50000, 'Костанайская область')],
      { oblast: 'Акмолинская область' },
    );
    const mkt = find(rows, 'МКТ');
    expect(mkt.used).toBe(1000);
    expect(mkt.delivered).toBe(5000);
  });

  it('без указания области считает всё вместе', () => {
    const rows = materialForecast(
      [g('2026-09-10', { 'МКТ': 1000 }, 'А'), g('2026-09-10', { 'МКТ': 2000 }, 'Б')],
      [],
    );
    expect(find(rows, 'МКТ').used).toBe(3000);
  });
});

describe('подпись под цифрой', () => {
  const stock = (over: Partial<ReturnType<typeof materialForecast>[0]>) => ({
    material: 'МКТ' as MaterialKind, unit: 'м' as const,
    delivered: 200, used: 100, remaining: 100, perDay: 10, daysLeft: 10, workingDays: 5,
    hasDeliveries: true,
    ...over,
  });

  it('склоняет дни по-русски', () => {
    expect(daysLeftText(stock({ daysLeft: 1 }))).toBe('на 1 день');
    expect(daysLeftText(stock({ daysLeft: 3 }))).toBe('на 3 дня');
    expect(daysLeftText(stock({ daysLeft: 5 }))).toBe('на 5 дней');
    expect(daysLeftText(stock({ daysLeft: 11 }))).toBe('на 11 дней');
    expect(daysLeftText(stock({ daysLeft: 21 }))).toBe('на 21 день');
    expect(daysLeftText(stock({ daysLeft: 22 }))).toBe('на 22 дня');
  });

  it('отдельно говорит про закончился и про отсутствие расхода', () => {
    expect(daysLeftText(stock({ remaining: 0 }))).toBe('закончился');
    expect(daysLeftText(stock({ remaining: -5 }))).toBe('закончился');
    expect(daysLeftText(stock({ daysLeft: null }))).toBe('расхода нет');
    expect(daysLeftText(stock({ daysLeft: 0 }))).toBe('меньше дня');
  });
});

describe('разрезы по территории', () => {
  const entry = (oblast: string, rayon: string, materials: Partial<Record<MaterialKind, number>>): DailyWorkEntry => ({
    kind: 'ground', id: `${oblast}-${rayon}-${Math.random()}`, date: '2026-09-10', smu: '',
    oblast, rayon, uchastok: 'Еленовка', kato: '191',
    byMethod: {}, materials,
    createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
  });

  const supply = (oblast: string, material: MaterialKind, qty: number, rayon?: string): MaterialDelivery => ({
    id: `${oblast}-${material}-${qty}`, date: '2026-09-01', oblast, rayon, material, qty,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  });

  it('считает области отдельно', () => {
    const rows = materialByScope(
      [entry('Акмолинская', 'Зерендинский', { 'МКТ': 1000 }),
       entry('Костанайская', 'Алтынсаринский', { 'МКТ': 4000 })],
      [supply('Акмолинская', 'МКТ', 10000)],
      'oblast',
    );
    expect(rows).toHaveLength(2);
    const akmola = rows.find((r) => r.oblast === 'Акмолинская')!;
    expect(find(akmola.stocks, 'МКТ').remaining).toBe(9000);
    const kostanay = rows.find((r) => r.oblast === 'Костанайская')!;
    expect(find(kostanay.stocks, 'МКТ').hasDeliveries).toBe(false);
  });

  it('районы показывают расход, пока приход на них не заводят', () => {
    const rows = materialByScope(
      [entry('Акмолинская', 'Зерендинский', { 'МКТ': 1000 }),
       entry('Акмолинская', 'Бурабайский', { 'МКТ': 3000 })],
      [supply('Акмолинская', 'МКТ', 10000)],
      'rayon',
    );
    expect(rows.map((r) => r.rayon).sort()).toEqual(['Бурабайский', 'Зерендинский']);
    const zerenda = rows.find((r) => r.rayon === 'Зерендинский')!;
    expect(find(zerenda.stocks, 'МКТ').used).toBe(1000);
    expect(find(zerenda.stocks, 'МКТ').hasDeliveries).toBe(false);
  });

  it('накладная с районом даёт районный остаток', () => {
    const rows = materialByScope(
      [entry('Акмолинская', 'Зерендинский', { 'МКТ': 1000 })],
      [supply('Акмолинская', 'МКТ', 4000, 'Зерендинский')],
      'rayon',
    );
    expect(find(rows[0].stocks, 'МКТ').remaining).toBe(3000);
  });

  it('первым идёт тот, у кого запас кончается раньше', () => {
    const rows = materialByScope(
      [entry('Скоро', 'р1', { 'МКТ': 1000 }), entry('Ещё есть', 'р2', { 'МКТ': 1000 })],
      [supply('Скоро', 'МКТ', 2000), supply('Ещё есть', 'МКТ', 50000)],
      'oblast',
    );
    expect(rows[0].oblast).toBe('Скоро');
    expect(rows[0].minDaysLeft).toBe(1);
  });
});
