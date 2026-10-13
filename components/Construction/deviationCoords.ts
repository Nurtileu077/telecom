import { isKzLat, isKzLon } from '@/types/construction';

/**
 * Координаты отклонения в карточке.
 *
 * Обход болота рисуют на карте линией в десяток точек, а протокол
 * мобильной группы вписывают потом — в карточке отклонения, другого
 * места для него нет. Карточка же умела только «начало» и «конец»:
 * концом она считала вторую точку линии и при сохранении оставляла две.
 * Обход, вписав протокол, терял и дорогу, и точку возврата на трассу —
 * схема либо роняла его в оговорку «конец в 222 м от линии» и снова
 * печатала проектную длину, либо клала молча на несколько метров
 * проекта, завышая «Протяжённость по факту» на весь обход.
 *
 * Поэтому карточка правит только концы, а снятые между ними точки
 * оставляет как были.
 */

export interface LatLon { lat: number; lon: number }

export interface DeviationEnds {
  /** Где ушли с трассы — первая точка. */
  a?: LatLon;
  /** Где вернулись — последняя точка, а не вторая. */
  b?: LatLon;
  /** Сколько точек между ними: их карточка не показывает, но и не теряет. */
  between: number;
}

const finite = (p: LatLon | undefined): p is LatLon =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

export function deviationEnds(coords: LatLon[] | undefined): DeviationEnds {
  const pts = coords ?? [];
  return {
    a: pts[0],
    b: pts.length > 1 ? pts[pts.length - 1] : undefined,
    between: Math.max(0, pts.length - 2),
  };
}

/** «44,480565» с телефона — то же, что «44.480565»; пустое и каша — не число. */
export function parseCoord(v: string): number {
  const t = v.trim().replace(',', '.');
  return t ? Number(t) : NaN;
}

/** Точка из полей — если она в Казахстане; иначе это опечатка, а не точка. */
function kzPoint(lat: string, lon: string): LatLon | null {
  const p = { lat: parseCoord(lat), lon: parseCoord(lon) };
  return isKzLat(p.lat) && isKzLon(p.lon) ? p : null;
}

const same = (x: LatLon, y: LatLon) => x.lat === y.lat && x.lon === y.lon;

/**
 * Что сохранить в карточке.
 *
 * Не правили концы — уходит снятая линия целиком. Правили — меняются
 * первая и последняя точки, промежуточные остаются: человек поправил,
 * где обход ушёл с трассы, а не перерисовал его. Стёрли конец — значит,
 * где вернулись, неизвестно, и остаётся одна точка, как и раньше: схема
 * назовёт это сама.
 */
export function deviationCoordsToSave(
  original: LatLon[] | undefined,
  fields: { latA: string; lonA: string; latB: string; lonB: string },
): LatLon[] | undefined {
  const a = kzPoint(fields.latA, fields.lonA);
  const b = kzPoint(fields.latB, fields.lonB);
  const orig = (original ?? []).filter(finite);
  if (a && b && orig.length > 2) {
    const first = orig[0];
    const last = orig[orig.length - 1];
    if (same(a, first) && same(b, last)) return orig;
    return [a, ...orig.slice(1, -1), b];
  }
  const pts = [a, b].filter((p): p is LatLon => !!p);
  return pts.length ? pts : undefined;
}
