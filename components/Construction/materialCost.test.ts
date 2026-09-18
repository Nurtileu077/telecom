import { describe, it, expect } from 'vitest';
import { spendOf, stockValueOf, fmtMoney, hasPrices } from './materialCost';
import type { MaterialStock } from './materialForecast';
import type { MaterialKind } from '@/types/construction';

function stock(material: MaterialKind, over: Partial<MaterialStock> = {}): MaterialStock {
  return {
    material, unit: material === 'МКТ' || material === 'ПЭТ' || material === 'Лента' ? 'м' : 'шт',
    delivered: 0, used: 0, remaining: 0, perDay: 0, daysLeft: null,
    workingDays: 0, hasDeliveries: false, ...over,
  };
}

describe('во что обошёлся расход', () => {
  it('умножает расход на цену', () => {
    const c = spendOf([stock('МКТ', { used: 1000 })], { 'МКТ': 120 });
    expect(c.total).toBe(120000);
    expect(c.rows[0].sum).toBe(120000);
  });

  it('позиция без цены в сумму не попадает и помечается', () => {
    const c = spendOf(
      [stock('МКТ', { used: 1000 }), stock('ФИТИНГ', { used: 20 })],
      { 'МКТ': 120 },
    );
    expect(c.total).toBe(120000);
    expect(c.unpriced).toBe(1);
    expect(c.partial).toBe(true);
  });

  it('все цены заданы — сумма полная', () => {
    const c = spendOf(
      [stock('МКТ', { used: 1000 }), stock('ФИТИНГ', { used: 20 })],
      { 'МКТ': 120, 'ФИТИНГ': 3000 },
    );
    expect(c.total).toBe(180000);
    expect(c.partial).toBe(false);
  });

  it('без расхода и без цены позиция не показывается', () => {
    const c = spendOf([stock('МКТ'), stock('КОД')], {});
    expect(c.rows).toHaveLength(0);
  });

  it('цена без расхода всё же видна — её только что завели', () => {
    const c = spendOf([stock('МКТ')], { 'МКТ': 120 });
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].sum).toBe(0);
  });
});

describe('сколько стоит остаток', () => {
  it('считает по остатку, а не по расходу', () => {
    const c = stockValueOf(
      [stock('МКТ', { used: 1000, remaining: 4000, hasDeliveries: true })],
      { 'МКТ': 120 },
    );
    expect(c.total).toBe(480000);
  });

  it('отрицательный остаток стоит ноль, а не минус', () => {
    const c = stockValueOf(
      [stock('МКТ', { used: 5000, remaining: -2000, hasDeliveries: true })],
      { 'МКТ': 120 },
    );
    expect(c.total).toBe(0);
  });
});

describe('мелочи', () => {
  it('сумма пишется без копеек и с разрядами', () => {
    expect(fmtMoney(1234567.4)).toBe('1 234 567 ₸'.replace(/ /g, ' ').replace(/ ₸/, ' ₸'));
  });

  it('нулевые цены — это отсутствие цен', () => {
    expect(hasPrices({})).toBe(false);
    expect(hasPrices({ 'МКТ': 0 })).toBe(false);
    expect(hasPrices({ 'МКТ': 120 })).toBe(true);
  });
});
