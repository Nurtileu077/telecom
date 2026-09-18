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
}

export interface ForecastOptions {
  oblast?: string;
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
  const inOblast = <T extends { oblast: string }>(x: T) =>
    !opts.oblast || x.oblast === opts.oblast;

  const rows = entries.filter(inOblast);
  const supplies = deliveries.filter(inOblast);

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
    const remaining = d - u;
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
      daysLeft: perDay > 0 ? Math.floor(Math.max(0, remaining) / perDay) : null,
      workingDays,
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
    (s) => s.remaining >= 0 && s.daysLeft !== null && s.perDay > 0 && s.daysLeft <= thresholdDays,
  );
}

/** Позиции, где расход превысил приход — поставки внесены не полностью. */
export function negativeStock(stocks: MaterialStock[]): MaterialStock[] {
  return stocks.filter((s) => s.remaining < 0);
}

/** «на 5 дней», «меньше дня», «расхода нет» — для подписи под цифрой. */
export function daysLeftText(s: MaterialStock): string {
  if (s.daysLeft === null) return 'расхода нет';
  if (s.remaining <= 0) return 'закончился';
  if (s.daysLeft === 0) return 'меньше дня';
  const n = s.daysLeft;
  const last = n % 10;
  const tens = Math.floor((n % 100) / 10);
  const word = tens === 1 || last === 0 || last >= 5 ? 'дней' : last === 1 ? 'день' : 'дня';
  return `на ${n} ${word}`;
}
