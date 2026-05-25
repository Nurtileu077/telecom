import { haversineM } from './KMeans';

export type LatLon = [number, number];

export function polylineLengths(coords: LatLon[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
  }
  return cum;
}

export function pointAtFraction(coords: LatLon[], t: number): LatLon {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1 || t <= 0) return [...coords[0]];
  if (t >= 1) return [...coords[coords.length - 1]];

  const cum = polylineLengths(coords);
  const total = cum[cum.length - 1];
  if (total <= 0) return [...coords[0]];

  const target = t * total;
  let i = 1;
  while (i < cum.length && cum[i] < target) i++;
  const i0 = i - 1;
  const segLen = cum[i] - cum[i0];
  const f = segLen > 0 ? (target - cum[i0]) / segLen : 0;
  const [a0, a1] = [coords[i0], coords[i]];
  return [a0[0] + (a1[0] - a0[0]) * f, a0[1] + (a1[1] - a0[1]) * f];
}

function nearExisting(coords: LatLon[], p: LatLon, thresholdM: number): boolean {
  return coords.some((c) => haversineM(c[0], c[1], p[0], p[1]) < thresholdM);
}

/** Точки 0%, 25%, 50%, 75%, 100% — только для короткой линии A–B (2 вершины). */
export function densifyByFraction(coords: LatLon[], step = 0.25): LatLon[] {
  if (coords.length !== 2) return coords.map((c) => [...c] as LatLon);

  const out: LatLon[] = [];
  for (let t = 0; t <= 1.0001; t += step) {
    const p = pointAtFraction(coords, Math.min(1, t));
    if (!nearExisting(out, p, 3)) out.push(p);
  }
  return out.length >= 2 ? out : coords.map((c) => [...c] as LatLon);
}

/** Обновить одну вершину по индексу (без вставки ⊥ — иначе «каракули»). */
export function updateWaypointAt(coords: LatLon[], index: number, lat: number, lon: number): LatLon[] {
  if (index < 0 || index >= coords.length) return coords.map((c) => [...c] as LatLon);
  const out = coords.map((c) => [...c] as LatLon);
  out[index] = [lat, lon];
  return out;
}

/** Концы A/B: сдвиг всей линии — промежуточные точки едут вместе с кабелем. */
export function moveEndpointRigid(coords: LatLon[], index: number, lat: number, lon: number): LatLon[] {
  if (coords.length === 0) return [];
  if (index !== 0 && index !== coords.length - 1) {
    return updateWaypointAt(coords, index, lat, lon);
  }
  const old = coords[index];
  const dLat = lat - old[0];
  const dLon = lon - old[1];
  return coords.map((c) => [c[0] + dLat, c[1] + dLon] as LatLon);
}

/** Сохранить доли t вдоль полилинии при перетаскивании конца (для длинных OSRM-трасс). */
export function moveEndpointPreserveFractions(
  coords: LatLon[],
  index: number,
  lat: number,
  lon: number,
): LatLon[] {
  const n = coords.length;
  if (n < 2 || (index !== 0 && index !== n - 1)) {
    return updateWaypointAt(coords, index, lat, lon);
  }
  const cum = polylineLengths(coords);
  const total = cum[cum.length - 1];
  if (total <= 0) return moveEndpointRigid(coords, index, lat, lon);

  const fractions: number[] = coords.map((_, i) => cum[i] / total);
  fractions[index] = index === 0 ? 0 : 1;
  const out = coords.map((c) => [...c] as LatLon);
  out[index] = [lat, lon];

  const newCum = polylineLengths(out);
  const newTotal = newCum[newCum.length - 1];
  if (newTotal <= 0) return out;

  for (let i = 1; i < n - 1; i++) {
    out[i] = pointAtFraction(out, fractions[i]);
  }
  return out;
}

/**
 * Перетащить видимую ручку в точку (lat, lon), схлопнув «спрятанные» вершины её
 * пролёта между соседними ручками в одну точку. prevH/nextH — индексы соседних
 * ВИДИМЫХ ручек в исходном массиве (или null, если ручка крайняя = конец A/B).
 *
 * Это даёт два нужных эффекта на длинной OSRM-трассе с прорежёнными ручками:
 *  - конец реально укорачивает/удлиняет кабель (а не переносит его целиком);
 *  - серединная ручка не оставляет зигзаг между плотными промежуточными точками.
 * Когда ручки идут подряд (prevH=idx-1, nextH=idx+1) — это обычный сдвиг вершины.
 */
export function collapseWaypoint(
  coords: LatLon[],
  prevH: number | null,
  nextH: number | null,
  lat: number,
  lon: number,
): LatLon[] {
  const left = prevH == null ? [] : coords.slice(0, prevH + 1).map((c) => [...c] as LatLon);
  const right = nextH == null ? [] : coords.slice(nextH).map((c) => [...c] as LatLon);
  return [...left, [lat, lon] as LatLon, ...right];
}

export function recalcLengthM(coords: LatLon[]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}
