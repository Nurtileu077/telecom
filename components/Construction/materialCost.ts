import { MaterialKind, MATERIAL_KINDS, MATERIAL_UNIT } from '@/types/construction';
import { MaterialStock } from './materialForecast';

/**
 * Во что обошлось.
 *
 * Цены система не выдумывает: у каждого подрядчика они свои и меняются
 * от поставки к поставке. Пока цена не задана, позиция считается нулём и
 * прямо помечается как незаполненная — иначе сумма выглядела бы точной,
 * будучи наполовину придуманной.
 */

export type MaterialPrices = Partial<Record<MaterialKind, number>>;

export interface MaterialCostRow {
  material: MaterialKind;
  unit: 'м' | 'шт';
  qty: number;
  price: number;
  /** Цена задана. Нет — сумма по позиции не считается. */
  priced: boolean;
  sum: number;
}

export interface CostSummary {
  rows: MaterialCostRow[];
  /** Сумма по позициям с заданной ценой. */
  total: number;
  /** Сколько позиций осталось без цены — их в сумме нет. */
  unpriced: number;
  /** Расход есть, цены нет: сумма заведомо неполная. */
  partial: boolean;
}

function rowsFrom(
  qtyOf: (m: MaterialKind) => number,
  prices: MaterialPrices,
): CostSummary {
  const rows: MaterialCostRow[] = [];
  let total = 0;
  let unpriced = 0;
  let partial = false;

  for (const material of MATERIAL_KINDS) {
    const qty = qtyOf(material);
    const price = prices[material] ?? 0;
    const priced = price > 0;
    if (!priced && qty > 0) { unpriced++; partial = true; }
    const sum = priced ? qty * price : 0;
    total += sum;
    rows.push({ material, unit: MATERIAL_UNIT[material], qty, price, priced, sum });
  }

  return { rows: rows.filter((r) => r.qty > 0 || r.priced), total, unpriced, partial };
}

/** Во что обошёлся расход по позициям остатка. */
export function spendOf(stocks: MaterialStock[], prices: MaterialPrices): CostSummary {
  const used = new Map(stocks.map((s) => [s.material, s.used]));
  return rowsFrom((m) => used.get(m) ?? 0, prices);
}

/** Сколько стоит то, что лежит на остатке. */
export function stockValueOf(stocks: MaterialStock[], prices: MaterialPrices): CostSummary {
  const left = new Map(stocks.map((s) => [s.material, Math.max(0, s.remaining)]));
  return rowsFrom((m) => left.get(m) ?? 0, prices);
}

export const DEFAULT_CURRENCY = '₸';

/** «1 234 567 ₸» — суммы на стройке крупные, копейки в них не нужны. */
export function fmtMoney(v: number, currency = DEFAULT_CURRENCY): string {
  return `${Math.round(v).toLocaleString('ru')} ${currency}`;
}

/** Есть ли вообще смысл показывать деньги: хоть одна цена задана. */
export function hasPrices(prices: MaterialPrices): boolean {
  return MATERIAL_KINDS.some((m) => (prices[m] ?? 0) > 0);
}
