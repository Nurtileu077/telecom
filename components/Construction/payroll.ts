import {
  DailyWorkEntry, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
  WorkRate, Payment, PaymentKind, PAYMENT_KIND_LABEL, MATERIAL_KINDS, type MaterialKind,
  type AerialWorkEntry,
} from '@/types/construction';
import { entryMeters, isIdleShift, weekStart } from './entriesTable';
import { aerialMeters } from './aerialWork';
import { normName } from './areaImport';
import type { MaterialPrices } from './materialCost';
import { monthRange, monthName, monthOf, fmtDay } from './moneyPeriod';

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
  // Подвес оплачивают по метрам подвешенного кабеля — «по протянутым
  // километрам», как и прокладку; опоры и зажимы отдельно не расцениваются.
  { key: 'aerialM', label: 'Подвес кабеля', unit: 'м' },
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

/** Сколько единиц этой работы в смене или записи подвеса. */
export function workQuantity(e: DailyWorkEntry | AerialWorkEntry, work: string): number {
  if (e.kind === 'aerial') return work === 'aerialM' ? aerialMeters(e) : 0;
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
  /** Начислено по расценкам за период. */
  accrued: number;
  /** Позиции без расценки: их стоимость неизвестна, а не равна нулю. */
  unpriced: string[];
  /** Аванс, удержания и оплаты, отнесённые к этому периоду. */
  advances: number;
  deductions: number;
  paid: number;
  /**
   * Долг на начало периода: всё начисленное до него минус всё выплаченное
   * за прошлые месяцы. Отрицательный — переплата, она переходит дальше.
   */
  opening: number;
  /**
   * Работы до периода без расценки: долг на начало из-за них неполный, и
   * сказать это нужно, а не показывать его точным.
   */
  openingUnpriced: string[];
  /**
   * Сколько осталось заплатить на конец периода — нарастающим итогом:
   * долг на начало плюс начисленное минус аванс, удержания и оплаты.
   */
  due: number;
  /** Смены с работой, и подземки, и подвеса, — по ним «метров за смену». */
  shifts: number;
  /**
   * Смены простоя: за них по метрам не начисляется, но и потерять их
   * нельзя — спор «почему так мало» начинается именно с них.
   */
  idleShifts: number;
  /**
   * Протянуто за период: в грунт и на опоры. По этим метрам платят
   * субподрядчику, на них и делится цена метра.
   */
  meters: number;
  /** Из них подвешено. */
  aerialM: number;
  /** Расход материала по сменам периода — для полной цены метра. */
  materials: Partial<Record<MaterialKind, number>>;
}

export interface PayrollFilter {
  from?: string;
  to?: string;
  /**
   * С какого числа отчётный месяц — чтобы платёж «за сентябрь» лёг в
   * сентябрь и при периоде с 26-го по 25-е.
   */
  startDay?: number;
}

function inPeriod(date: string, f: PayrollFilter): boolean {
  if (f.from && (date || '') < f.from) return false;
  if (f.to && (date || '') > f.to) return false;
  return true;
}

/**
 * Каким днём платёж ложится в расчёт.
 *
 * По дате, если месяц не назван. Назван — днём того месяца: аванс за июль,
 * внесённый 5 августа, ложится последним днём июля и гасит июль, а не
 * август. Если деньги и ушли в том же месяце — остаётся настоящая дата.
 */
export function paymentDay(p: Pick<Payment, 'date' | 'forMonth'>, startDay = 1): string {
  if (!p.forMonth) return p.date;
  const r = monthRange(p.forMonth, startDay);
  if (!r.from) return p.date;
  if (p.date >= r.from && p.date <= r.to) return p.date;
  return p.date > r.to ? r.to : r.from;
}

interface Accrual {
  qty: Map<string, number>;
  pricedQty: Map<string, number>;
  sums: Map<string, number>;
  seenPrices: Map<string, Set<number>>;
}

/** Что начислено по сменам: количество, оценённое количество и сумма по видам. */
function accrue(
  entries: (DailyWorkEntry | AerialWorkEntry)[],
  rates: WorkRate[],
  contractor: string,
): Accrual {
  const acc: Accrual = {
    qty: new Map(), pricedQty: new Map(), sums: new Map(),
    // Какие цены встретились за период: одна — её и показываем, несколько —
    // показывать любую из них нельзя, иначе строка не сойдётся.
    seenPrices: new Map(),
  };
  for (const e of entries) {
    for (const w of PAYABLE_WORKS) {
      const q = workQuantity(e, w.key);
      if (q <= 0) continue;
      acc.qty.set(w.key, (acc.qty.get(w.key) ?? 0) + q);
      // Цену берём на день работы: договор меняют с какого-то числа, и
      // пересчитывать по нему старые смены нельзя.
      const rate = rateFor(rates, w.key, e.date, contractor);
      if (rate) {
        acc.pricedQty.set(w.key, (acc.pricedQty.get(w.key) ?? 0) + q);
        acc.sums.set(w.key, (acc.sums.get(w.key) ?? 0) + q * rate.price);
        const set = acc.seenPrices.get(w.key) ?? new Set<number>();
        set.add(rate.price);
        acc.seenPrices.set(w.key, set);
      }
    }
  }
  return acc;
}

function linesOf(acc: Accrual): PayLine[] {
  return PAYABLE_WORKS
    .filter((w) => (acc.qty.get(w.key) ?? 0) > 0)
    .map((w) => {
      const prices = acc.seenPrices.get(w.key);
      return {
        work: w.key,
        label: w.label,
        unit: w.unit,
        quantity: acc.qty.get(w.key) ?? 0,
        pricedQuantity: acc.pricedQty.get(w.key) ?? 0,
        price: prices?.size === 1 ? [...prices][0] : undefined,
        sum: acc.sums.get(w.key),
      };
    });
}

// Не только «расценки нет вовсе», но и «на часть объёма её нет»: молчать о
// второй половине — значит занижать начисление молча.
function unpricedOf(lines: PayLine[]): string[] {
  return lines
    .filter((l) => l.pricedQuantity < l.quantity)
    .map((l) => (l.pricedQuantity === 0
      ? l.label
      : `${l.label} (${Math.round(l.quantity - l.pricedQuantity).toLocaleString('ru')} ${l.unit} вне расценки)`));
}

// Сумма всегда положительная — знак задаёт вид; минус, пришедший из
// старого файла, не должен превращать оплату в долг.
const amountOf = (p: Payment) => Math.max(0, p.amount);

/**
 * Расчёт по подрядчику за период.
 *
 * Работа без расценки в сумму не попадает и называется отдельно: ноль
 * здесь означал бы «бесплатно», а это не так.
 *
 * Долг — нарастающим итогом. Раньше «к оплате» считалось только внутри
 * окна: неоплаченный август в сентябрьском расчёте исчезал, будто его
 * заплатили, и долг Дозеру с тетрадью бухгалтера не сходился. Теперь
 * прошлое приходит строкой «долг на начало», а сам месяц виден отдельно —
 * так сверяются оба способа вести тетрадь: и помесячно, и итогом.
 */
export function payroll(
  contractor: string,
  rows: DailyWorkEntry[],
  rates: WorkRate[],
  payments: Payment[],
  filter: PayrollFilter = {},
  aerial: AerialWorkEntry[] = [],
): PayrollResult {
  const own = rows.filter((e) => (e.contractor || '') === contractor);
  const mine = own.filter((e) => inPeriod(e.date, filter));
  // Подвес подрядчика — в том же расчёте. Раньше его не было ни в сумме, ни
  // в метрах: бригада, неделю висевшая на опорах, выглядела простаивающей.
  // Тем же правилом, что смены: «пустой» подрядчик — не «все подрядчики».
  const ownAir = aerial.filter((e) => (e.contractor || '') === contractor);
  const mineAir = ownAir.filter((e) => inPeriod(e.date, filter));
  const lines = linesOf(accrue([...mine, ...mineAir], rates, contractor));

  // Всё, что было до периода, — одним итогом. Смена без даты сюда тоже
  // попадает: расценки на «никакой день» нет, и она будет названа
  // неоценённой, а не потеряна.
  const earlier = filter.from
    ? [...own, ...ownAir].filter((e) => (e.date || '') < filter.from!)
    : [];
  const earlierLines = linesOf(accrue(earlier, rates, contractor));

  const startDay = filter.startDay ?? 1;
  const theirs = payments.filter((p) => p.contractor === contractor);
  const money = theirs.filter((p) => inPeriod(paymentDay(p, startDay), filter));
  const before = filter.from
    ? theirs.filter((p) => paymentDay(p, startDay) < filter.from!)
    : [];
  const sumOf = (list: Payment[], kind?: Payment['kind']) => list
    .filter((p) => !kind || p.kind === kind)
    .reduce((s, p) => s + amountOf(p), 0);

  const accrued = lines.reduce((s, l) => s + (l.sum ?? 0), 0);
  const advances = sumOf(money, 'advance');
  const deductions = sumOf(money, 'deduction');
  const paid = sumOf(money, 'payment');
  const opening = earlierLines.reduce((s, l) => s + (l.sum ?? 0), 0) - sumOf(before);
  const dates = [...mine, ...mineAir].map((e) => e.date).filter(Boolean).sort();
  const aerialM = mineAir.reduce((s, e) => s + aerialMeters(e), 0);

  return {
    contractor,
    from: filter.from || dates[0] || '',
    to: filter.to || dates[dates.length - 1] || '',
    lines,
    accrued,
    unpriced: unpricedOf(lines),
    advances,
    deductions,
    paid,
    opening,
    openingUnpriced: unpricedOf(earlierLines),
    due: opening + accrued - advances - deductions - paid,
    // Дождливая неделя не должна делать подрядчика «медленнее» в
    // сравнении: средние — по сменам, в которые работали.
    // Запись подвеса — рабочий день бригады на опорах: простоя в листе
    // «DATA ПОДВЕС» не пишут.
    shifts: mine.filter((e) => !isIdleShift(e)).length + mineAir.length,
    idleShifts: mine.filter(isIdleShift).length,
    meters: mine.reduce((s, e) => s + entryMeters(e), 0) + aerialM,
    aerialM,
    materials: materialsOf(mine),
  };
}

function materialsOf(entries: DailyWorkEntry[]): Partial<Record<MaterialKind, number>> {
  const out: Partial<Record<MaterialKind, number>> = {};
  for (const e of entries) {
    for (const m of MATERIAL_KINDS) {
      const q = e.materials?.[m] ?? 0;
      if (q > 0) out[m] = (out[m] ?? 0) + q;
    }
  }
  return out;
}

/** Сам месяц, без долга прошлых: начислено минус выплаченное за него. */
export function periodBalance(r: PayrollResult): number {
  return r.accrued - r.advances - r.deductions - r.paid;
}

/** Цена метра одним способом прокладки — или подвеса. */
export interface MethodMeterPrice {
  method: LayMethod | 'aerialM';
  label: string;
  /** Протянуто этим способом за период. */
  meters: number;
  pricedMeters: number;
  /**
   * Сумма на оценённые метры: при одной расценке — она сама, при смене
   * цены внутри периода — средняя. null — расценки нет вовсе.
   */
  perMeter: number | null;
}

/** Цена метра, которую можно и не знать целиком. */
export interface PerMeter {
  /** При неполных данных — нижняя граница: «не меньше». null — не из чего считать. */
  value: number | null;
  /** Всё оценено: false — value только «не меньше». */
  complete: boolean;
  /** Чего не хватает, словами. */
  missing: string[];
}

export interface MeterCost {
  /** Цена одной прокладки — по каждому способу отдельно. */
  byMethod: MethodMeterPrice[];
  /** Вся работа подрядчика — прокладка, ГНБ, задувка, переходы — на протянутый метр. */
  work: PerMeter;
  /** Материал на протянутый метр, по нынешней цене закупки. */
  material: PerMeter;
  /** Работа и материал вместе. */
  total: PerMeter;
}

/**
 * Во сколько обошёлся метр.
 *
 * Раньше одна цифра делила все деньги — вместе с ГНБ и задувкой — на все
 * метры, вместе с теми, на которые расценки нет: бар по 300 ₸ и ГНБ
 * по 5000 ₸ давали «метр в 660 ₸», а неоценённая ручная прокладка ещё и
 * занижала её. Какой из двух вопросов задают — «почём прокладка» или
 * «почём метр трассы целиком» — заранее не известно, поэтому отвечаем на
 * оба отдельно: цена метра по каждому способу и полная цена метра трассы,
 * с работой и с материалом.
 *
 * Делим на протянутые метры: по ним и платят субподрядчику. Если что-то
 * не оценено, полная цена — «не меньше», с названием того, чего нет, а не
 * красивая и заниженная цифра.
 */
export function meterCost(r: PayrollResult, prices: MaterialPrices = {}): MeterCost {
  const byMethod: MethodMeterPrice[] = r.lines
    .filter((l) => LAY_METHODS.includes(l.work as LayMethod) || l.work === 'aerialM')
    .map((l) => ({
      method: l.work as LayMethod | 'aerialM',
      label: l.label,
      meters: l.quantity,
      pricedMeters: l.pricedQuantity,
      perMeter: l.pricedQuantity > 0 && l.sum !== undefined ? l.sum / l.pricedQuantity : null,
    }));

  const noMeters = r.meters <= 0 ? ['протянутых метров за период нет'] : [];
  const work: PerMeter = r.meters > 0 && r.accrued > 0
    ? { value: r.accrued / r.meters, complete: r.unpriced.length === 0, missing: [...r.unpriced] }
    : {
      value: null,
      complete: false,
      missing: noMeters.length ? noMeters : r.unpriced.length ? [...r.unpriced] : ['расценок нет'],
    };

  // Материал — по нынешней цене закупки: цены поставок по датам журнал не
  // хранит, и выдавать нынешнюю за тогдашнюю молча нельзя — поэтому она
  // так и подписана на экране.
  const used = MATERIAL_KINDS.filter((m) => (r.materials[m] ?? 0) > 0);
  const noPrice = used.filter((m) => !((prices[m] ?? 0) > 0));
  const matSum = used.reduce((s, m) => s + (r.materials[m] ?? 0) * (prices[m] ?? 0), 0);
  // Опоры, зажимы и арматуру подвеса закупочными ценами не ведём: метры
  // подвеса в делителе есть, а их материала в сумме нет — значит, цена с
  // материалом только «не меньше», и сказать это нужно словами.
  const airGap = (r.aerialM ?? 0) > 0 ? ['материал подвеса — цен закупки на него нет'] : [];
  const material: PerMeter = r.meters <= 0
    ? { value: null, complete: false, missing: noMeters }
    : used.length === 0
      // Расход не записан — это не «материал бесплатный».
      ? { value: null, complete: false, missing: ['расход материала в сменах не записан', ...airGap] }
      : matSum <= 0
        ? { value: null, complete: false, missing: [`нет цены: ${noPrice.join(', ')}`, ...airGap] }
        : {
          value: matSum / r.meters,
          complete: noPrice.length === 0 && airGap.length === 0,
          missing: [...(noPrice.length ? [`нет цены: ${noPrice.join(', ')}`] : []), ...airGap],
        };

  const total: PerMeter = work.value === null
    ? { value: null, complete: false, missing: [...work.missing, ...material.missing] }
    : {
      value: work.value + (material.value ?? 0),
      complete: work.complete && material.complete,
      missing: [...work.missing, ...material.missing],
    };

  return { byMethod, work, material, total };
}

/**
 * Полная цена работы на протянутый метр — для сравнения подрядчиков.
 *
 * Только когда оценено всё: иначе у того, чью ручную прокладку забыли
 * оценить, метр выходил «дешевле», и сравнение награждало пробел в
 * расценках. Неполная — `null`; «не меньше» показывает `meterCost`.
 */
export function costPerMeter(r: PayrollResult): number | null {
  const w = meterCost(r).work;
  return w.complete ? w.value : null;
}

export interface ContractorSummary {
  contractor: string;
  shifts: number;
  meters: number;
  accrued: number;
  due: number;
  /** Средние метры за смену — по ним сравнивают. */
  perShift: number;
  /** Вся работа на протянутый метр; при неоценённой части — «не меньше». */
  perMeter: number | null;
  /** perMeter — точная цифра, а не нижняя граница. */
  perMeterComplete: boolean;
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
  aerial: AerialWorkEntry[] = [],
): ContractorSummary[] {
  const names = payrollContractors(rows, aerial);
  return names.map((contractor) => {
    const r = payroll(contractor, rows, rates, payments, filter, aerial);
    const w = meterCost(r).work;
    return {
      contractor,
      shifts: r.shifts,
      meters: r.meters,
      accrued: r.accrued,
      due: r.due,
      perShift: r.shifts > 0 ? r.meters / r.shifts : 0,
      perMeter: w.value,
      perMeterComplete: w.complete,
      deviations: deviationsBy.get(contractor) ?? 0,
    };
  }).sort((a, b) => b.meters - a.meters);
}

/**
 * С кем считаемся: у кого есть смены подземки или записи подвеса.
 *
 * Подрядчик, который весь месяц висел на опорах, без этого не появлялся в
 * «Расчётах» вовсе — смен подземки у него нет.
 */
export function payrollContractors(
  rows: Pick<DailyWorkEntry, 'contractor'>[],
  aerial: Pick<AerialWorkEntry, 'contractor'>[] = [],
): string[] {
  return [...new Set([...rows, ...aerial]
    .map((e) => e.contractor)
    .filter((v): v is string => !!v?.trim()))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

export interface MoneyGap {
  /** Задание, к которому относится строка, — если у него есть id. */
  id?: string;
  crew: string;
  uchastok: string;
  /** Сколько метров недодали к обещанному. */
  shortM: number;
  /**
   * Во что недобор обходится по расценке способа этой бригады. При
   * неоценённой части способов — нижняя граница; null — оценить нечем.
   */
  shortMoney: number | null;
  /** Каким способом бригада работает: «Бар» или «Бар 70 %, Ручным способом 30 %». */
  method: string;
  /** Оценка полная. */
  complete: boolean;
  /** Почему не полная: способ неизвестен или на него нет расценки. */
  why?: string;
}

export interface MoneyBehind {
  rows: MoneyGap[];
  totalM: number;
  /** Сумма по оценённому; при complete = false — «не меньше». */
  totalMoney: number;
  complete: boolean;
  /** Метры недобора, которые в деньги не перевести вовсе. */
  unknownM: number;
}

type PlanLike = {
  id?: string; crew: string; uchastok: string; leftM: number; contractor?: string; week: string;
};

/**
 * Каким способом бригада прокладывает — доли по метрам.
 *
 * Сначала — эта неделя на этом участке: так она работает здесь и сейчас.
 * Нет смен — вся её история до конца недели: бригада с баром обычно и
 * дальше идёт с баром. Нет и её — способ неизвестен, и придумывать его
 * нельзя. «Колонна 1» бывает у двух подрядчиков: если подрядчик задания
 * известен, чужие смены не берём.
 */
export function crewMethodMix(rows: DailyWorkEntry[], p: PlanLike): Map<LayMethod, number> {
  const weekEnd = shiftIso(p.week, 6);
  const crewRows = rows.filter((e) => normName(e.column ?? '') === normName(p.crew)
    && (!p.contractor || !e.contractor || e.contractor === p.contractor));
  const here = crewRows.filter((e) => weekStart(e.date) === p.week
    && normName(e.uchastok ?? '') === normName(p.uchastok));
  const history = crewRows.filter((e) => !!e.date && e.date <= weekEnd);
  for (const pool of [here, history]) {
    const by = new Map<LayMethod, number>();
    for (const e of pool) {
      for (const m of LAY_METHODS) {
        const v = e.byMethod?.[m] ?? 0;
        if (v > 0) by.set(m, (by.get(m) ?? 0) + v);
      }
    }
    const total = [...by.values()].reduce((s, v) => s + v, 0);
    if (total > 0) return new Map([...by.entries()].map(([m, v]) => [m, v / total]));
  }
  return new Map();
}

function shiftIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

function mixLabel(mix: Map<LayMethod, number>): string {
  const list = [...mix.entries()].sort((a, b) => b[1] - a[1]);
  if (list.length === 1) return LAY_METHOD_LABEL[list[0][0]];
  return list.map(([m, share]) => `${LAY_METHOD_LABEL[m]} ${Math.round(share * 100)} %`).join(', ');
}

/**
 * Отставание в деньгах.
 *
 * Метры недобора понятны прорабу, а руководству нужен тот же недобор в
 * тенге: по нему считают, чем это кончится для сроков и для выручки.
 *
 * Раньше любой недобор оценивался по расценке кабелеукладчика — и у
 * бригады с баром, и у ручной. Теперь — по расценке того способа, которым
 * эта бригада работает (по её же сменам), долями, если способов несколько.
 * Способ неизвестен или расценки на него нет — так и пишем, а не
 * подставляем чужую.
 */
export function moneyBehind(
  plans: PlanLike[],
  rates: WorkRate[],
  rows: DailyWorkEntry[] = [],
): MoneyBehind {
  const out: MoneyGap[] = [];
  for (const p of plans) {
    if (p.leftM <= 0) continue;
    const mix = crewMethodMix(rows, p);
    if (mix.size === 0) {
      out.push({
        id: p.id, crew: p.crew, uchastok: p.uchastok, shortM: p.leftM, shortMoney: null,
        method: 'способ неизвестен', complete: false,
        why: 'бригада ещё не записала ни одной смены с метрами — способ прокладки неизвестен',
      });
      continue;
    }
    let price = 0;
    const noRate: string[] = [];
    for (const [m, share] of mix) {
      const rate = rateFor(rates, m, p.week, p.contractor);
      if (rate) price += share * rate.price;
      else noRate.push(LAY_METHOD_LABEL[m]);
    }
    out.push({
      id: p.id,
      crew: p.crew,
      uchastok: p.uchastok,
      shortM: p.leftM,
      // Без расценки денег не считаем: ноль означал бы «отставание
      // ничего не стоит», а это не так.
      shortMoney: price > 0 ? p.leftM * price : null,
      method: mixLabel(mix),
      complete: noRate.length === 0,
      why: noRate.length ? `нет расценки: ${noRate.join(', ')}` : undefined,
    });
  }
  const rowsOut = out.sort((a, b) => (b.shortMoney ?? -1) - (a.shortMoney ?? -1) || b.shortM - a.shortM);
  return {
    rows: rowsOut,
    totalM: rowsOut.reduce((s, r) => s + r.shortM, 0),
    totalMoney: rowsOut.reduce((s, r) => s + (r.shortMoney ?? 0), 0),
    complete: rowsOut.every((r) => r.complete),
    unknownM: rowsOut.filter((r) => r.shortMoney === null).reduce((s, r) => s + r.shortM, 0),
  };
}

/** Строка расчёта словами — её вставляют в акт и в переписку. */
export function payrollSummary(r: PayrollResult): string {
  const money = (v: number) => `${Math.round(v).toLocaleString('ru')} ₸`;
  const parts: string[] = [];
  // Долг прошлых месяцев называем первым: без него «к оплате» в конце
  // строки не сходится с начисленным, и подрядчик спросит, откуда цифра.
  if (Math.round(r.opening) !== 0) {
    parts.push(r.opening > 0 ? `долг на начало ${money(r.opening)}` : `переплата на начало ${money(-r.opening)}`);
  }
  parts.push(`начислено ${money(r.accrued)}`);
  if (r.advances > 0) parts.push(`аванс ${money(r.advances)}`);
  if (r.deductions > 0) parts.push(`удержано ${money(r.deductions)}`);
  if (r.paid > 0) parts.push(`оплачено ${money(r.paid)}`);
  parts.push(r.due >= 0 ? `к оплате ${money(r.due)}` : `переплата ${money(-r.due)}`);
  return parts.join(', ');
}

/** «за сентябрь 2026», если платёж отнесён не к своему месяцу. */
export function paymentFor(p: Pick<Payment, 'date' | 'forMonth'>, startDay = 1): string {
  if (!p.forMonth || p.forMonth === monthOf(p.date, startDay)) return '';
  return `за ${monthName(p.forMonth)}`;
}

/** Что за деньги были: список движений с подписями. */
export function paymentLines(payments: Payment[], contractor: string, startDay = 1): string[] {
  return payments
    .filter((p) => p.contractor === contractor)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map((p) => {
      const forWhat = paymentFor(p, startDay);
      return `${fmtDay(p.date)} · `
        + `${PAYMENT_KIND_LABEL[p.kind]}${forWhat ? ` ${forWhat}` : ''} `
        + `${Math.round(p.amount).toLocaleString('ru')} ₸`
        + (p.note ? ` — ${p.note}` : '');
    });
}

export interface PaymentDraft {
  id?: string;
  kind: PaymentKind;
  amount: string;
  /** Когда деньги ушли. */
  date: string;
  /** За какой месяц «ГГГГ-ММ»; пусто — по дате. */
  forMonth: string;
  note: string;
}

/**
 * Платёж из формы.
 *
 * Раньше дата ставилась сама — днём нажатия кнопки, причём по UTC: аванс,
 * записанный 5 августа, гасил август, а внесённый после полуночи ложился
 * вчерашним числом. Теперь дату выбирают, и месяц, за который платят,
 * тоже. Сумму с пробелами и запятой понимаем: так её и набирают.
 */
export function checkPayment(
  draft: PaymentDraft,
  contractor: string,
  now: string,
  newId: () => string,
  author?: string,
  createdAt?: string,
): { payment: Payment } | { error: string } {
  if (!contractor) return { error: 'Не выбран подрядчик' };
  const amount = Number(draft.amount.replace(/\s|\u00a0/g, '').replace(',', '.'));
  if (!draft.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
    return { error: 'Сумма — число больше нуля' };
  }
  const date = parseRateDate(draft.date);
  if (!date) return { error: 'Дата не читается — выберите её в календаре' };
  const forMonth = draft.forMonth.trim();
  if (forMonth && !monthRange(forMonth).from) return { error: 'Месяц не читается — выберите его из списка' };
  return {
    payment: {
      id: draft.id || newId(),
      contractor,
      kind: draft.kind,
      amount,
      date,
      forMonth: forMonth || undefined,
      note: draft.note.trim() || undefined,
      author,
      createdAt: createdAt || now,
      updatedAt: now,
    },
  };
}
