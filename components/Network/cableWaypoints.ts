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

function lerp(a: LatLon, b: LatLon, f: number): LatLon {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function nearExisting(coords: LatLon[], p: LatLon, thresholdM: number): boolean {
  return coords.some((c) => haversineM(c[0], c[1], p[0], p[1]) < thresholdM);
}

/** Точки каждые step по длине (0.25 → 5 маркеров на отрезке A–B). */
export function densifyByFraction(coords: LatLon[], step = 0.25): LatLon[] {
  if (coords.length < 2) return coords.map((c) => [...c] as LatLon);

  const out: LatLon[] = [];
  for (let t = 0; t <= 1.0001; t += step) {
    const p = pointAtFraction(coords, Math.min(1, t));
    if (!nearExisting(out, p, 4)) out.push(p);
  }
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (out.length === 0 || haversineM(out[0][0], out[0][1], first[0], first[1]) > 2) out.unshift([...first]);
  if (haversineM(out[out.length - 1][0], out[out.length - 1][1], last[0], last[1]) > 2) out.push([...last]);
  return out;
}

export function offsetPerpendicularM(
  lat: number,
  lon: number,
  prev: LatLon,
  next: LatLon,
  meters: number,
  sign: 1 | -1,
): LatLon {
  const dx = next[1] - prev[1];
  const dy = next[0] - prev[0];
  const len = Math.hypot(dx, dy) || 1e-12;
  const nx = (-dy / len) * sign;
  const ny = (dx / len) * sign;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return [
    lat + (meters / 111320) * ny,
    lon + (meters / (111320 * Math.max(cosLat, 0.2))) * nx,
  ];
}

/**
 * После изменения точки index: до 2 точек вдоль сегментов + 2 ⊥ «сверху/снизу» у узла.
 */
export function insertSmoothPointsNearIndex(
  coords: LatLon[],
  index: number,
  opts?: { minSegM?: number; perpM?: number; dupM?: number; maxPoints?: number },
): LatLon[] {
  const minSegM = opts?.minSegM ?? 15;
  const perpM = opts?.perpM ?? 3.5;
  const dupM = opts?.dupM ?? 5;
  const maxPoints = opts?.maxPoints ?? 64;

  if (coords.length < 2 || index < 0 || index >= coords.length) {
    return coords.map((c) => [...c] as LatLon);
  }

  let out: LatLon[] = coords.map((c) => [...c] as LatLon);
  if (out.length >= maxPoints) return out;

  const curr = out[index];
  const prev = index > 0 ? out[index - 1] : null;
  const next = index < out.length - 1 ? out[index + 1] : null;
  const inserts: LatLon[] = [];

  if (prev) {
    const d = haversineM(prev[0], prev[1], curr[0], curr[1]);
    if (d > minSegM) {
      const p = lerp(prev, curr, 0.7);
      if (!nearExisting(out, p, dupM)) inserts.push(p);
    }
  }
  if (next) {
    const d = haversineM(curr[0], curr[1], next[0], next[1]);
    if (d > minSegM) {
      const p = lerp(curr, next, 0.3);
      if (!nearExisting(out, p, dupM)) inserts.push(p);
    }
  }
  if (prev && next) {
    const up = offsetPerpendicularM(curr[0], curr[1], prev, next, perpM, 1);
    const down = offsetPerpendicularM(curr[0], curr[1], prev, next, perpM, -1);
    if (!nearExisting(out, up, dupM)) inserts.push(up);
    if (!nearExisting(out, down, dupM)) inserts.push(down);
  }

  for (const p of inserts) {
    if (out.length >= maxPoints) break;
    if (nearExisting(out, p, dupM)) continue;
    out.splice(index + 1, 0, p);
  }

  return out;
}

export function recalcLengthM(coords: LatLon[]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}
