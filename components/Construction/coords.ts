import { DrillPoint, isKzLat, isKzLon } from '@/types/construction';

/**
 * Разбор координат из свободного текста журнала ГНБ.
 *
 * В рабочей таблице координаты лежат строкой, причём порядок широты и долготы
 * непостоянен даже внутри одной колонки:
 *
 *   «Координаты:\n1. 52.091435,44.480565 (72м);»   ← долгота, широта
 *   «Координаты:\n44.366046, 52.090369»            ← широта, долгота
 *
 * Обе записи указывают на Мангистау. Порядок восстанавливаем по границам
 * Казахстана: 44.48 не может быть долготой (западнее страны), значит пара
 * перевёрнута. Когда оба варианта попадают в границы (запад и север страны,
 * где широта и долгота пересекаются в 46–56°), используем подсказку —
 * центр области из самой записи.
 *
 * Исходный текст никогда не выбрасывается: вызывающий код кладёт его в
 * rawCoords, чтобы ничего не потерялось при неудачном разборе.
 */

export interface ParsedCoords {
  points: DrillPoint[];
  /** Пары, где порядок пришлось выбирать по подсказке или по умолчанию. */
  ambiguousCount: number;
  /** Пары чисел, не попавшие в границы Казахстана ни в одном порядке. */
  invalidCount: number;
}

type Order = { lat: number; lon: number };

/** Приблизительные центры областей — только для снятия неоднозначности. */
export const OBLAST_HINTS: Record<string, Order> = {
  'Алматинская область':            { lat: 44.5, lon: 77.0 },
  'Область Жетісу':                 { lat: 45.0, lon: 78.4 },
  'Западно-Казахстанская область':  { lat: 51.2, lon: 51.4 },
  'Акмолинская область':            { lat: 52.0, lon: 69.5 },
  'Костанайская область':           { lat: 53.2, lon: 63.6 },
  'Атырауская область':             { lat: 47.1, lon: 51.9 },
  'Мангистауская область':          { lat: 43.7, lon: 51.9 },
};

export function hintForOblast(oblast?: string): Order | undefined {
  if (!oblast) return undefined;
  const key = oblast.trim();
  if (OBLAST_HINTS[key]) return OBLAST_HINTS[key];
  const lower = key.toLowerCase();
  for (const [name, h] of Object.entries(OBLAST_HINTS)) {
    if (name.toLowerCase() === lower) return h;
  }
  return undefined;
}

function dist2(a: Order, b: Order): number {
  const dLat = a.lat - b.lat;
  const dLon = a.lon - b.lon;
  return dLat * dLat + dLon * dLon;
}

/**
 * Выбирает порядок пары чисел.
 * Возвращает точку и признак того, что выбор был неоднозначным.
 */
export function orderPair(
  a: number,
  b: number,
  hint?: Order,
): { point: Order; ambiguous: boolean } | null {
  const ab = isKzLat(a) && isKzLon(b);
  const ba = isKzLat(b) && isKzLon(a);

  if (ab && !ba) return { point: { lat: a, lon: b }, ambiguous: false };
  if (ba && !ab) return { point: { lat: b, lon: a }, ambiguous: false };

  if (ab && ba) {
    // Оба варианта формально допустимы — решаем по близости к центру области.
    if (hint) {
      const d1 = dist2({ lat: a, lon: b }, hint);
      const d2 = dist2({ lat: b, lon: a }, hint);
      return { point: d1 <= d2 ? { lat: a, lon: b } : { lat: b, lon: a }, ambiguous: true };
    }
    // Без подсказки оставляем как записано — «широта, долгота».
    return { point: { lat: a, lon: b }, ambiguous: true };
  }

  return null;
}

/** Число вида 52.091435 или 52,091435 — не меньше трёх знаков после запятой,
 *  чтобы не принять за координату длину «20 м» или «1.5 км». */
const NUM_RE = /-?\d{1,3}[.,]\d{3,}/g;
/** Пометка длины прокола: «(72м)», «(105 м)». */
const METERS_RE = /\((\d+(?:[.,]\d+)?)\s*м\.?\)/gi;

function toNum(token: string): number {
  return parseFloat(token.replace(',', '.'));
}

export function parseCoordBlob(text: string, hint?: Order): ParsedCoords {
  const out: ParsedCoords = { points: [], ambiguousCount: 0, invalidCount: 0 };
  if (!text || typeof text !== 'string') return out;

  // Сначала собираем пометки длины с их позициями в строке.
  const meterMarks: { value: number; index: number }[] = [];
  METERS_RE.lastIndex = 0;
  for (let m = METERS_RE.exec(text); m; m = METERS_RE.exec(text)) {
    meterMarks.push({ value: toNum(m[1]), index: m.index });
  }

  // Затем все числа, похожие на координаты.
  const nums: { value: number; index: number; end: number }[] = [];
  NUM_RE.lastIndex = 0;
  for (let m = NUM_RE.exec(text); m; m = NUM_RE.exec(text)) {
    nums.push({ value: toNum(m[0]), index: m.index, end: m.index + m[0].length });
  }

  // Числа идут парами: широта-долгота в том или ином порядке.
  const pairs: { a: typeof nums[0]; b: typeof nums[0] }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pairs.push({ a: nums[i], b: nums[i + 1] });
  }

  pairs.forEach((pair, idx) => {
    const res = orderPair(pair.a.value, pair.b.value, hint);
    if (!res) { out.invalidCount++; return; }
    if (res.ambiguous) out.ambiguousCount++;

    // Длина прокола — первая пометка после этой пары и до начала следующей.
    const nextStart = idx + 1 < pairs.length ? pairs[idx + 1].a.index : Infinity;
    const mark = meterMarks.find((mm) => mm.index >= pair.b.end && mm.index < nextStart);

    const point: DrillPoint = { lat: res.point.lat, lon: res.point.lon };
    if (mark) point.meters = mark.value;
    out.points.push(point);
  });

  return out;
}
