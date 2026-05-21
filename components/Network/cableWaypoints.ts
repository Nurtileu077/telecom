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

export function recalcLengthM(coords: LatLon[]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}
