import { describe, it, expect } from 'vitest';
import {
  materialForecast, lowStock, negativeStock, daysLeftText, LOW_STOCK_DAYS,
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

  it('расход без поставок даёт отрицательный остаток, а не ноль', () => {
    // Это сигнал, что поставки внесены не полностью. Прятать нельзя.
    const rows = materialForecast([g('2026-09-10', { 'МКТ': 5000 })], []);
    expect(find(rows, 'МКТ').remaining).toBe(-5000);
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

  it('при отрицательном остатке прогноз ноль, а не отрицательный', () => {
    const rows = materialForecast([g('2026-09-10', { 'МКТ': 1000 })], []);
    expect(find(rows, 'МКТ').daysLeft).toBe(0);
  });

  it('отрицательный остаток не выдаётся за нехватку — это дыра в учёте', () => {
    // Поставок нет вовсе: сообщать «пора отправлять» бессмысленно, пока
    // приход не внесён. Для этого есть отдельное предупреждение.
    const rows = materialForecast([g('2026-09-10', { 'МКТ': 1000 })], []);
    expect(lowStock(rows)).toHaveLength(0);
    expect(negativeStock(rows).map((s) => s.material)).toEqual(['МКТ']);
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
    delivered: 0, used: 0, remaining: 100, perDay: 10, daysLeft: 10, workingDays: 5,
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
