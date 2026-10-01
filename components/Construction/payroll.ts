import {
  DailyWorkEntry, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
  WorkRate, Payment, PAYMENT_KIND_LABEL,
} from '@/types/construction';
import { entryMeters, isIdleShift } from './entriesTable';

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

/** Вид работ в списке: название и единица — «Переходы ГНБ / ГНП, м». */
export function payableOption(key: string): string {
  const w = PAYABLE_WORKS.find((x) => x.key === key);
  return w ? `${w.label}, ${w.unit}` : key;
}

/**
 * Дата начала расценки — как её пишут люди.
 *
 * Дату вводили строкой «ГГГГ-ММ-ДД», а люди пишут «01.09.2026». Такая
 * строка при сравнении оказывалась «раньше» любой даты, и расценка с
 * сентября ложилась на все смены с начала работ — молча. Принимаем оба
 * вида, а несуществующий день («31.02.2026») не принимаем вовсе.
 */
export function parseRateDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  let y: number; let m: number; let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const ru = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (ru) { y = +ru[3]; m = +ru[2]; d = +ru[1]; }
  else return null;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** С какого дня расценка действует; null — дату прочитать нельзя. */
export function rateStart(r: Pick<WorkRate, 'from'>): string | null {
  return parseRateDate(r.from);
}

/**
 * Расценки, у которых дата не читается.
 *
 * В расчёт они не идут: применить такую «с начала времён» — значит
 * выдумать, с какого числа подрядчику платят по новой цене. Вместо
 * этого их показываем, чтобы дату поправили.
 */
export function brokenRates(rates: WorkRate[]): WorkRate[] {
  return rates.filter((r) => rateStart(r) === null);
}

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
  const fits = rates.filter((r) => {
    const start = rateStart(r);
    return r.work === work
      && start !== null && start <= (date || '')
      && (!r.contractor || r.contractor === contractor);
  });
  if (fits.length === 0) return null;
  return fits.sort((a, b) => {
    // Своя расценка бьёт общую при любой дате.
    const own = Number(!!b.contractor) - Number(!!a.contractor);
    return own !== 0 ? own : (rateStart(b) ?? '').localeCompare(rateStart(a) ?? '');
  })[0];
}

export interface RateDraft {
  id?: string;
  work: string;
  price: string;
  from: string;
  /** Пусто — расценка для всех подрядчиков. */
  contractor?: string;
}

/**
 * Проверка расценки перед записью.
 *
 * Вид работ выбирают из списка, а не набирают: служебное «drillM» никто
 * не знает, а «гнб» программа не узнавала и отвечала «такого вида работ
 * нет». Цена и дата — с ответом, что не так, а не молчаливым «ничего не
 * произошло».
 */
export function checkRate(
  draft: RateDraft,
  now: string,
  newId: () => string,
): { rate: WorkRate } | { error: string } {
  const spec = PAYABLE_WORKS.find((w) => w.key === draft.work);
  if (!spec) return { error: 'Выберите вид работ из списка' };
  const price = Number(draft.price.replace(/\s|\u00a0/g, '').replace(',', '.'));
  if (!draft.price.trim() || !Number.isFinite(price) || price <= 0) {
    return { error: 'Цена — число больше нуля' };
  }
  const from = parseRateDate(draft.from);
  if (!from) return { error: 'Дата не читается — выберите её в календаре' };
  return {
    rate: {
      id: draft.id || newId(),
      contractor: draft.contractor?.trim() || undefined,
      work: spec.key,
      price,
      unit: spec.unit,
      from,
      updatedAt: now,
    },
  };
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
  /** Сделано всего за период. */
  quantity: number;
  /**
   * Объём, на который расценка нашлась.
   *
   * Отдельно от общего, потому что договор подписывают с какого-то
   * числа: смены до него сделаны, но не оценены. Показать их в объёме и
   * промолчать — значит отдать подрядчику строку, где цена × количество
   * не сходится с суммой, и получить спор на ровном месте.
   */
  pricedQuantity: number;
  /** Расценка; пусто — её нет или за период она менялась. */
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
  /** Смены с работой — по ним «метров за смену» в сравнении подрядчиков. */
  shifts: number;
  /**
   * Смены простоя: за них по метрам не начисляется, но и потерять их
   * нельзя — спор «почему так мало» начинается именно с них.
   */
  idleShifts: number;
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
  const pricedQty = new Map<string, number>();
  const sums = new Map<string, number>();
  // Какие цены встретились за период: одна — её и показываем, несколько —
  // показывать любую из них нельзя, иначе строка не сойдётся.
  const seenPrices = new Map<string, Set<number>>();

  for (const e of mine) {
    for (const w of PAYABLE_WORKS) {
      const q = workQuantity(e, w.key);
      if (q <= 0) continue;
      qty.set(w.key, (qty.get(w.key) ?? 0) + q);
      // Цену берём на день работы: договор меняют с какого-то числа, и
      // пересчитывать по нему старые смены нельзя.
      const rate = rateFor(rates, w.key, e.date, contractor);
      if (rate) {
        pricedQty.set(w.key, (pricedQty.get(w.key) ?? 0) + q);
        sums.set(w.key, (sums.get(w.key) ?? 0) + q * rate.price);
        const set = seenPrices.get(w.key) ?? new Set<number>();
        set.add(rate.price);
        seenPrices.set(w.key, set);
      }
    }
  }

  const lines: PayLine[] = PAYABLE_WORKS
    .filter((w) => (qty.get(w.key) ?? 0) > 0)
    .map((w) => {
      const prices = seenPrices.get(w.key);
      return {
        work: w.key,
        label: w.label,
        unit: w.unit,
        quantity: qty.get(w.key) ?? 0,
        pricedQuantity: pricedQty.get(w.key) ?? 0,
        price: prices?.size === 1 ? [...prices][0] : undefined,
        sum: sums.get(w.key),
      };
    });

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
    // Не только «расценки нет вовсе», но и «на часть объёма её нет»:
    // молчать о второй половине — значит занижать начисление молча.
    unpriced: lines
      .filter((l) => l.pricedQuantity < l.quantity)
      .map((l) => (l.pricedQuantity === 0
        ? l.label
        : `${l.label} (${Math.round(l.quantity - l.pricedQuantity).toLocaleString('ru')} ${l.unit} вне расценки)`)),
    advances,
    deductions,
    paid,
    due: accrued - advances - deductions - paid,
    // Дождливая неделя не должна делать подрядчика «медленнее» в
    // сравнении: средние — по сменам, в которые работали.
    shifts: mine.filter((e) => !isIdleShift(e)).length,
    idleShifts: mine.filter(isIdleShift).length,
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
