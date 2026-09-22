import {
  DailyWorkEntry, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
  WorkRate, Payment, PAYMENT_KIND_LABEL,
} from '@/types/construction';
import { entryMeters } from './entriesTable';

/**
 * Расчёт с подрядчиками.
 *
 * Объёмы записаны в журнале, расценки — в договоре, авансы — в тетради,
 * а «сколько мы должны Дозеру» знает один человек и по памяти. Отсюда
 * половина споров о деньгах: подрядчик считает по своим цифрам, мы по
 * своим, и сходятся они только на планёрке.
 *
 * Считаем по тем же метрам, которые уже в журнале, и по расценке,
 * действовавшей в день работы: цену меняют не задним числом.
 */

/** Что считаем платно: способы прокладки плюс отдельные виды. */
export const PAYABLE_WORKS: { key: string; label: string; unit: 'м' | 'шт' }[] = [
  ...LAY_METHODS.map((m) => ({ key: m, label: LAY_METHOD_LABEL[m], unit: 'м' as const })),
  { key: 'drillM', label: 'Переходы ГНБ / ГНП', unit: 'м' },
  { key: 'drillCount', label: 'Переходов ГНБ / ГНП', unit: 'шт' },
  { key: 'blowingM', label: 'Задувка ОК', unit: 'м' },
  { key: 'openCrossings', label: 'Открытые переходы', unit: 'шт' },
];

export const PAYABLE_LABEL = new Map(PAYABLE_WORKS.map((w) => [w.key, w.label]));

/**
 * Расценка на этот день.
 *
 * Своя расценка подрядчика важнее общей, а из нескольких своих —
 * последняя, начавшая действовать не позже дня работы.
 */
export function rateFor(
  rates: WorkRate[],
  work: string,
  date: string,
  contractor?: string,
): WorkRate | null {
  const fits = rates.filter((r) => r.work === work
    && (r.from || '') <= (date || '')
    && (!r.contractor || r.contractor === contractor));
  if (fits.length === 0) return null;
  return fits.sort((a, b) => {
    // Своя расценка бьёт общую при любой дате.
    const own = Number(!!b.contractor) - Number(!!a.contractor);
    return own !== 0 ? own : (b.from || '').localeCompare(a.from || '');
  })[0];
}

/** Сколько единиц этой работы в смене. */
export function workQuantity(e: DailyWorkEntry, work: string): number {
  if (LAY_METHODS.includes(work as LayMethod)) return e.byMethod[work as LayMethod] ?? 0;
  if (work === 'drillM') return e.drillM ?? 0;
  if (work === 'drillCount') return e.drillCount ?? 0;
  if (work === 'blowingM') return e.blowingM ?? 0;
  if (work === 'openCrossings') return e.openCrossings ?? 0;
  return 0;
}

export interface PayLine {
  work: string;
  label: string;
  unit: 'м' | 'шт';
  quantity: number;
  /** Расценка; пусто — её нет, и сумма неизвестна. */
  price?: number;
  sum?: number;
}

export interface PayrollResult {
  contractor: string;
  from: string;
  to: string;
  lines: PayLine[];
  /** Начислено по расценкам. */
  accrued: number;
  /** Позиции без расценки: их стоимость неизвестна, а не равна нулю. */
  unpriced: string[];
  advances: number;
  deductions: number;
  paid: number;
  /** Сколько осталось заплатить: начислено минус аванс, удержания и оплаты. */
  due: number;
  shifts: number;
  meters: number;
}

export interface PayrollFilter {
  from?: string;
  to?: string;
}

function inPeriod(date: string, f: PayrollFilter): boolean {
  if (f.from && (date || '') < f.from) return false;
  if (f.to && (date || '') > f.to) return false;
  return true;
}

/**
 * Расчёт по подрядчику за период.
 *
 * Работа без расценки в сумму не попадает и называется отдельно: ноль
 * здесь означал бы «бесплатно», а это не так.
 */
export function payroll(
  contractor: string,
  rows: DailyWorkEntry[],
  rates: WorkRate[],
  payments: Payment[],
  filter: PayrollFilter = {},
): PayrollResult {
  const mine = rows.filter((e) => (e.contractor || '') === contractor
    && inPeriod(e.date, filter));

  const qty = new Map<string, number>();
  const sums = new Map<string, number>();
  const priced = new Map<string, number>();

  for (const e of mine) {
    for (const w of PAYABLE_WORKS) {
      const q = workQuantity(e, w.key);
      if (q <= 0) continue;
      qty.set(w.key, (qty.get(w.key) ?? 0) + q);
      // Цену берём на день работы: договор меняют с какого-то числа, и
      // пересчитывать по нему старые смены нельзя.
      const rate = rateFor(rates, w.key, e.date, contractor);
      if (rate) {
        sums.set(w.key, (sums.get(w.key) ?? 0) + q * rate.price);
        priced.set(w.key, rate.price);
      }
    }
  }

  const lines: PayLine[] = PAYABLE_WORKS
    .filter((w) => (qty.get(w.key) ?? 0) > 0)
    .map((w) => ({
      work: w.key,
      label: w.label,
      unit: w.unit,
      quantity: qty.get(w.key) ?? 0,
      price: priced.get(w.key),
      sum: sums.get(w.key),
    }));

  const money = payments.filter((p) => p.contractor === contractor && inPeriod(p.date, filter));
  const sumOf = (kind: Payment['kind']) => money
    .filter((p) => p.kind === kind)
    .reduce((s, p) => s + Math.max(0, p.amount), 0);

  const accrued = lines.reduce((s, l) => s + (l.sum ?? 0), 0);
  const advances = sumOf('advance');
  const deductions = sumOf('deduction');
  const paid = sumOf('payment');
  const dates = mine.map((e) => e.date).filter(Boolean).sort();

  return {
    contractor,
    from: filter.from || dates[0] || '',
    to: filter.to || dates[dates.length - 1] || '',
    lines,
    accrued,
    unpriced: lines.filter((l) => l.sum === undefined).map((l) => l.label),
    advances,
    deductions,
    paid,
    due: accrued - advances - deductions - paid,
    shifts: mine.length,
    meters: mine.reduce((s, e) => s + entryMeters(e), 0),
  };
}

/**
 * Во сколько обошёлся метр.
 *
 * Считаем по тому, что начислено, и по тем метрам, за которые начислено:
 * делить сумму на всю длину трассы, включая неоплаченные работы, —
 * значит получить красивую, но неверную цифру.
 */
export function costPerMeter(r: PayrollResult): number | null {
  if (r.meters <= 0 || r.accrued <= 0) return null;
  return r.accrued / r.meters;
}

export interface ContractorSummary {
  contractor: string;
  shifts: number;
  meters: number;
  accrued: number;
  due: number;
  /** Средние метры за смену — по ним сравнивают. */
  perShift: number;
  /** Стоимость метра; пусто, если расценок нет. */
  perMeter: number | null;
  /** Сколько отклонений на его участках — качество работы. */
  deviations: number;
}

/**
 * Сравнение подрядчиков.
 *
 * Кто быстрее, кто дешевле, у кого больше замечаний — три разных
 * вопроса, и отвечать на них одной цифрой нельзя. Показываем все три.
 */
export function compareContractors(
  rows: DailyWorkEntry[],
  rates: WorkRate[],
  payments: Payment[],
  deviationsBy: Map<string, number>,
  filter: PayrollFilter = {},
): ContractorSummary[] {
  const names = [...new Set(rows.map((e) => e.contractor).filter((v): v is string => !!v))];
  return names.map((contractor) => {
    const r = payroll(contractor, rows, rates, payments, filter);
    return {
      contractor,
      shifts: r.shifts,
      meters: r.meters,
      accrued: r.accrued,
      due: r.due,
      perShift: r.shifts > 0 ? r.meters / r.shifts : 0,
      perMeter: costPerMeter(r),
      deviations: deviationsBy.get(contractor) ?? 0,
    };
  }).sort((a, b) => b.meters - a.meters);
}

export interface MoneyGap {
  crew: string;
  uchastok: string;
  /** Сколько метров недодали к обещанному. */
  shortM: number;
  /** Во сколько это обошлось по расценке. */
  shortMoney: number;
}

/**
 * Отставание в деньгах.
 *
 * Метры недобора понятны прорабу, а руководству нужен тот же недобор в
 * тенге: по нему считают, чем это кончится для сроков и для выручки.
 * Считаем по расценке того же участка — иначе цифра получится средней
 * по больнице.
 */
export function moneyBehind(
  plans: { crew: string; uchastok: string; leftM: number; contractor?: string; week: string }[],
  rates: WorkRate[],
  work = 'кабелеукладчик',
): { rows: MoneyGap[]; totalM: number; totalMoney: number } {
  const rows: MoneyGap[] = [];
  for (const p of plans) {
    if (p.leftM <= 0) continue;
    const rate = rateFor(rates, work, p.week, p.contractor);
    rows.push({
      crew: p.crew,
      uchastok: p.uchastok,
      shortM: p.leftM,
      // Без расценки денег не считаем: ноль означал бы «отставание
      // ничего не стоит», а это не так.
      shortMoney: rate ? p.leftM * rate.price : 0,
    });
  }
  return {
    rows: rows.sort((a, b) => b.shortMoney - a.shortMoney || b.shortM - a.shortM),
    totalM: rows.reduce((s, r) => s + r.shortM, 0),
    totalMoney: rows.reduce((s, r) => s + r.shortMoney, 0),
  };
}

/** Строка расчёта словами — её вставляют в акт и в переписку. */
export function payrollSummary(r: PayrollResult): string {
  const money = (v: number) => `${Math.round(v).toLocaleString('ru')} ₸`;
  const parts = [`начислено ${money(r.accrued)}`];
  if (r.advances > 0) parts.push(`аванс ${money(r.advances)}`);
  if (r.deductions > 0) parts.push(`удержано ${money(r.deductions)}`);
  if (r.paid > 0) parts.push(`оплачено ${money(r.paid)}`);
  parts.push(r.due >= 0 ? `к оплате ${money(r.due)}` : `переплата ${money(-r.due)}`);
  return parts.join(', ');
}

/** Что за деньги были: список движений с подписями. */
export function paymentLines(payments: Payment[], contractor: string): string[] {
  return payments
    .filter((p) => p.contractor === contractor)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map((p) => `${new Date(`${p.date}T00:00:00Z`).toLocaleDateString('ru')} · `
      + `${PAYMENT_KIND_LABEL[p.kind]} ${Math.round(p.amount).toLocaleString('ru')} ₸`
      + (p.note ? ` — ${p.note}` : ''));
}
