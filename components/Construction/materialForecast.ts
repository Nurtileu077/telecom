import {
  DailyWorkEntry, MaterialDelivery, MaterialKind, MATERIAL_KINDS, MATERIAL_UNIT,
} from '@/types/construction';

/**
 * Остатки материалов и прогноз, на сколько их хватит.
 *
 * Считается из того, что уже есть: приход — из поставок, расход — из дневных
 * отчётов. Темп берётся по последним рабочим дням, а не по календарным:
 * в выходные и в простой расхода нет, и деление на календарные дни занижало
 * бы темп вдвое, а прогноз получался бы самоуспокоительным.
 */

export interface MaterialStock {
  material: MaterialKind;
  unit: 'м' | 'шт';
  /** Поступило всего. */
  delivered: number;
  /** Израсходовано всего. */
  used: number;
  /** Остаток: приход минус расход. Может быть отрицательным — это сигнал,
   *  что поставки внесены не полностью, а не повод прятать цифру. */
  remaining: number;
  /** Средний расход за рабочий день. */
  perDay: number;
  /** На сколько дней хватит. null — расхода нет, прогноз невозможен. */
  daysLeft: number | null;
  /** Сколько рабочих дней участвовало в расчёте темпа. */
  workingDays: number;
  /**
   * Приход по позиции вообще вносили. Без него остаток не из чего считать,
   * и минус в клетке означает не нехватку, а дырку в учёте — такую цифру
   * показывать как остаток нельзя.
   */
  hasDeliveries: boolean;
}

export interface ForecastOptions {
  oblast?: string;
  /** Район: поставки без района в разрез района не попадают. */
  rayon?: string;
  /** По скольким последним рабочим дням считать темп. */
  window?: number;
  /** Дата, от которой отсчитывать окно. По умолчанию — последний рабочий день. */
  asOf?: string;
}

/** Порог, ниже которого остаток считается тревожным, в рабочих днях. */
export const LOW_STOCK_DAYS = 7;

function usedByMaterial(entries: DailyWorkEntry[]): Map<MaterialKind, number> {
  const m = new Map<MaterialKind, number>();
  for (const e of entries) {
    for (const [k, v] of Object.entries(e.materials)) {
      if (!v) continue;
      const key = k as MaterialKind;
      m.set(key, (m.get(key) ?? 0) + v);
    }
  }
  return m;
}

export function materialForecast(
  entries: DailyWorkEntry[],
  deliveries: MaterialDelivery[],
  opts: ForecastOptions = {},
): MaterialStock[] {
  const window = opts.window ?? 14;
  const inScope = <T extends { oblast: string; rayon?: string }>(x: T) =>
    (!opts.oblast || x.oblast === opts.oblast)
    && (!opts.rayon || x.rayon === opts.rayon);

  const rows = entries.filter(inScope);
  const supplies = deliveries.filter(inScope);

  const used = usedByMaterial(rows);
  const delivered = new Map<MaterialKind, number>();
  for (const d of supplies) {
    delivered.set(d.material, (delivered.get(d.material) ?? 0) + d.qty);
  }

  // Рабочие дни — те, в которые что-то расходовали. Считаем темп по ним.
  const daysWithUse = [...new Set(
    rows.filter((e) => e.date && Object.values(e.materials).some((v) => (v ?? 0) > 0))
        .map((e) => e.date),
  )].sort();

  const lastDay = opts.asOf ?? daysWithUse[daysWithUse.length - 1] ?? '';
  const windowDays = daysWithUse.filter((d) => d <= lastDay).slice(-window);
  const windowSet = new Set(windowDays);
  const windowRows = rows.filter((e) => windowSet.has(e.date));
  const usedInWindow = usedByMaterial(windowRows);

  return MATERIAL_KINDS.map((material) => {
    const d = delivered.get(material) ?? 0;
    const u = used.get(material) ?? 0;
    // Без внесённого прихода остаток показываем нулём: минус в этой клетке
    // означал бы, что материал ушёл в минус, а на деле его просто не
    // отметили при поступлении.
    const remaining = d > 0 ? d - u : 0;
    const inWindow = usedInWindow.get(material) ?? 0;
    const workingDays = windowDays.length;
    const perDay = workingDays > 0 ? inWindow / workingDays : 0;
    return {
      material,
      unit: MATERIAL_UNIT[material],
      delivered: d,
      used: u,
      remaining,
      perDay,
      daysLeft: d > 0 && perDay > 0 ? Math.floor(Math.max(0, remaining) / perDay) : null,
      workingDays,
      hasDeliveries: d > 0,
    };
  });
}

/**
 * Позиции, по которым пора отправлять материал.
 *
 * Отрицательный остаток сюда НЕ попадает: это не прогноз снабжения, а
 * признак того, что поставки внесены не полностью. Смешивать нельзя —
 * иначе снабжение будет отгружать по цифре, которой не доверяют, а
 * настоящая нехватка утонет среди дырок в учёте.
 */
export function lowStock(stocks: MaterialStock[], thresholdDays = LOW_STOCK_DAYS): MaterialStock[] {
  return stocks.filter(
    (s) => s.hasDeliveries && s.daysLeft !== null && s.perDay > 0 && s.daysLeft <= thresholdDays,
  );
}

/**
 * Позиции, по которым расход идёт, а приход не внесён ни разу.
 *
 * Это не нехватка материала, а пробел в учёте, и лечится он не отгрузкой,
 * а внесением накладных. Поэтому список отдельный.
 */
export function unknownStock(stocks: MaterialStock[]): MaterialStock[] {
  return stocks.filter((s) => !s.hasDeliveries && s.used > 0);
}

/** Позиции, где расход превысил приход — поставки внесены не полностью. */
export function negativeStock(stocks: MaterialStock[]): MaterialStock[] {
  return stocks.filter((s) => s.hasDeliveries && s.remaining < 0);
}

/** «на 5 дней», «меньше дня», «расхода нет» — для подписи под цифрой. */
export function daysLeftText(s: MaterialStock): string {
  if (!s.hasDeliveries) return s.used > 0 ? 'приход не внесён' : 'нет движения';
  if (s.daysLeft === null) return 'расхода нет';
  if (s.remaining <= 0) return 'закончился';
  if (s.daysLeft === 0) return 'меньше дня';
  const n = s.daysLeft;
  const last = n % 10;
  const tens = Math.floor((n % 100) / 10);
  const word = tens === 1 || last === 0 || last >= 5 ? 'дней' : last === 1 ? 'день' : 'дня';
  return `на ${n} ${word}`;
}

// ── Разрезы по территории ────────────────────────────────────────────────────

export interface ScopeStock {
  oblast: string;
  rayon?: string;
  stocks: MaterialStock[];
  /** Позиции, по которым пора отправлять. */
  low: MaterialStock[];
  /** Расход идёт, приход не внесён. */
  unknown: MaterialStock[];
  /** Наименьший запас в днях среди позиций с внесённым приходом. */
  minDaysLeft: number | null;
  /** Всего израсходовано метровых позиций — чтобы отсортировать по объёму. */
  usedM: number;
}

/**
 * Остатки по территории.
 *
 * Поставки в журнале приходят на область, поэтому остаток по району
 * появляется только тогда, когда накладную завели с районом. Пока этого
 * нет, район честно показывает расход, а остаток остаётся областным —
 * делить областной приход между районами система не вправе.
 */
export function materialByScope(
  entries: DailyWorkEntry[],
  deliveries: MaterialDelivery[],
  level: 'oblast' | 'rayon',
  opts: Omit<ForecastOptions, 'oblast' | 'rayon'> = {},
): ScopeStock[] {
  const keys = new Map<string, { oblast: string; rayon?: string }>();
  for (const e of entries) {
    if (!e.oblast) continue;
    const rayon = level === 'rayon' ? (e.rayon || '') : undefined;
    keys.set(`${e.oblast}|${rayon ?? ''}`, { oblast: e.oblast, rayon });
  }

  const out: ScopeStock[] = [];
  for (const { oblast, rayon } of keys.values()) {
    const stocks = materialForecast(entries, deliveries, { ...opts, oblast, rayon });
    const low = lowStock(stocks);
    const days = stocks
      .filter((s) => s.hasDeliveries && s.daysLeft !== null)
      .map((s) => s.daysLeft as number);
    out.push({
      oblast, rayon,
      stocks,
      low,
      unknown: unknownStock(stocks),
      minDaysLeft: days.length ? Math.min(...days) : null,
      usedM: stocks.filter((s) => s.unit === 'м').reduce((sum, s) => sum + s.used, 0),
    });
  }

  // Первым — там, где запас кончается раньше; без прогноза сортируем по объёму.
  return out.sort((a, b) => {
    const ad = a.minDaysLeft ?? Number.POSITIVE_INFINITY;
    const bd = b.minDaysLeft ?? Number.POSITIVE_INFINITY;
    return ad - bd || b.usedM - a.usedM;
  });
}
