import {
  DailyWorkEntry, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
} from '@/types/construction';

/**
 * Норматив выработки: сколько метров бригада делает за смену.
 *
 * План «пройдём село за неделю» держится либо на опыте одного человека,
 * либо на цифрах. Цифры уже есть: в журнале лежат сотни смен с метрами
 * и способами. Из них выводится честный темп — не «сколько хотелось бы»,
 * а «сколько выходит».
 *
 * Считаем по способам отдельно: кабелеукладчиком за смену проходят
 * километры, вручную — сотни метров, и усреднять их вместе бессмысленно.
 *
 * Смена — это день, в который этим способом что-то сделали. Дни с нулём
 * в средний темп не входят: простой — это отдельный разговор, и если
 * подмешать его в норматив, тот перестанет отвечать на свой вопрос
 * («сколько выходит, когда работают»), а на вопрос про простои всё равно
 * не ответит.
 */

export interface RateRow {
  /** Бригада, подрядчик или способ — смотря как считали. */
  key: string;
  method: LayMethod;
  /** Смен с ненулевой выработкой этим способом. */
  shifts: number;
  meters: number;
  /** Средняя за смену. */
  perShift: number;
  /** Медиана — она устойчивее к одной рекордной смене. */
  median: number;
  /** Лучшая смена. */
  best: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

function build(samples: Map<string, Map<LayMethod, number[]>>): RateRow[] {
  const out: RateRow[] = [];
  for (const [key, byMethod] of samples) {
    for (const m of LAY_METHODS) {
      const list = byMethod.get(m);
      if (!list?.length) continue;
      const meters = list.reduce((s, v) => s + v, 0);
      out.push({
        key, method: m,
        shifts: list.length,
        meters,
        perShift: Math.round(meters / list.length),
        median: median(list),
        best: Math.max(...list),
      });
    }
  }
  return out.sort((a, b) => b.meters - a.meters);
}

/**
 * Темп по способам — общий по всей стройке.
 *
 * Отдельная запись за один день не смена: за день одна бригада могла
 * сдать две записи по разным участкам. Поэтому метры сначала
 * складываются по дню, и только потом день считается сменой.
 */
export function methodRates(entries: DailyWorkEntry[]): RateRow[] {
  const byDay = new Map<string, Map<LayMethod, number>>();
  for (const e of entries) {
    if (!e.date) continue;
    const crew = (e.column || e.contractor || e.smu || '—').trim().toLowerCase();
    const dayKey = `${e.date}|${crew}`;
    const acc = byDay.get(dayKey) ?? new Map<LayMethod, number>();
    for (const m of LAY_METHODS) {
      const v = e.byMethod[m] ?? 0;
      if (v > 0) acc.set(m, (acc.get(m) ?? 0) + v);
    }
    byDay.set(dayKey, acc);
  }

  const samples = new Map<string, Map<LayMethod, number[]>>();
  const all = new Map<LayMethod, number[]>();
  samples.set('all', all);
  for (const acc of byDay.values()) {
    for (const [m, v] of acc) {
      if (v <= 0) continue;
      const list = all.get(m) ?? [];
      list.push(v);
      all.set(m, list);
    }
  }
  return build(samples);
}

/** Темп по бригадам: кто сколько делает за смену и каким способом. */
export function crewRates(entries: DailyWorkEntry[]): RateRow[] {
  const byDay = new Map<string, { crew: string; byMethod: Map<LayMethod, number> }>();
  for (const e of entries) {
    if (!e.date) continue;
    const crew = (e.column || e.contractor || e.smu || '').trim();
    if (!crew) continue;
    const dayKey = `${e.date}|${crew.toLowerCase()}`;
    const rec = byDay.get(dayKey) ?? { crew, byMethod: new Map<LayMethod, number>() };
    for (const m of LAY_METHODS) {
      const v = e.byMethod[m] ?? 0;
      if (v > 0) rec.byMethod.set(m, (rec.byMethod.get(m) ?? 0) + v);
    }
    byDay.set(dayKey, rec);
  }

  const samples = new Map<string, Map<LayMethod, number[]>>();
  for (const { crew, byMethod } of byDay.values()) {
    const forCrew = samples.get(crew) ?? new Map<LayMethod, number[]>();
    for (const [m, v] of byMethod) {
      if (v <= 0) continue;
      const list = forCrew.get(m) ?? [];
      list.push(v);
      forCrew.set(m, list);
    }
    samples.set(crew, forCrew);
  }
  return build(samples);
}

export const METHOD_LABEL = LAY_METHOD_LABEL;

/**
 * Сколько смен займёт остаток.
 *
 * Считаем по медиане, а не по среднему: одна рекордная смена не должна
 * обещать, что так будет каждый день. Способ берём тот, которым здесь
 * и работают, — если он неизвестен, берём самый ходовой.
 */
export function shiftsLeft(
  remainingM: number,
  rates: RateRow[],
  method?: LayMethod,
): number | null {
  if (remainingM <= 0) return 0;
  const row = method
    ? rates.find((r) => r.method === method)
    : rates.slice().sort((a, b) => b.meters - a.meters)[0];
  if (!row || row.median <= 0) return null;
  return Math.ceil(remainingM / row.median);
}

/** Сколько всего смен отработано — по дням с ненулевой выработкой. */
export function totalShifts(entries: DailyWorkEntry[]): number {
  const days = new Set<string>();
  for (const e of entries) {
    if (!e.date) continue;
    const m = LAY_METHODS.reduce((s, k) => s + (e.byMethod[k] ?? 0), 0);
    if (m > 0) days.add(e.date);
  }
  return days.size;
}
