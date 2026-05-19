import { Cable } from '@/types/network';
import { haversineM } from './KMeans';

function bearing(a: [number, number], b: [number, number]): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

function bearingsClose(a: number, b: number, maxRad = 0.4): boolean {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d <= maxRad;
}

function pathLengthM(coords: [number, number][]): number {
  let l = 0;
  for (let i = 1; i < coords.length; i++) {
    l += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return l;
}

function distPointToSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const latRad = ((a[0] + b[0]) / 2) * Math.PI / 180;
  const mLat = 111320;
  const mLon = 111320 * Math.cos(latRad);
  const ax = a[1] * mLon;
  const ay = a[0] * mLat;
  const bx = b[1] * mLon;
  const by = b[0] * mLat;
  const px = p[1] * mLon;
  const py = p[0] * mLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Две трассы идут по одному коридору (типично OSRM слева/справа проезжей части). */
export function polylinesShareCorridor(
  a: [number, number][],
  b: [number, number][],
  corridorM: number,
): boolean {
  if (a.length < 2 || b.length < 2) return false;

  const midA: [number, number] = a[Math.floor(a.length / 2)];
  const midB: [number, number] = b[Math.floor(b.length / 2)];
  if (haversineM(midA[0], midA[1], midB[0], midB[1]) > corridorM * 2) return false;

  const bearA = bearing(a[0], a[a.length - 1]);
  const bearB = bearing(b[0], b[b.length - 1]);
  if (!bearingsClose(bearA, bearB)) return false;

  let near = 0;
  const samples = a.length <= 6 ? a : a.filter((_, i) => i % Math.ceil(a.length / 6) === 0);
  for (const p of samples) {
    let best = Infinity;
    for (let i = 1; i < b.length; i++) {
      best = Math.min(best, distPointToSegment(p, b[i - 1], b[i]));
    }
    if (best <= corridorM) near++;
  }
  return near >= Math.max(1, Math.ceil(samples.length * 0.6));
}

/**
 * Проход 1.5: выровнять параллельные OSRM-трассы к одной линии по центру улицы,
 * чтобы проход 2 не оставлял «левый» и «правый» кабель.
 */
export function mergeParallelCableGeometry(
  cables: Cable[],
  corridorM = 15,
): Cable[] {
  const used = new Set<string>();
  const out: Cable[] = [];

  for (let i = 0; i < cables.length; i++) {
    const c = cables[i];
    if (used.has(c.id)) continue;

    const cluster: Cable[] = [c];
    used.add(c.id);

    for (let j = i + 1; j < cables.length; j++) {
      const o = cables[j];
      if (used.has(o.id)) continue;
      if (polylinesShareCorridor(c.coords, o.coords, corridorM)) {
        cluster.push(o);
        used.add(o.id);
      }
    }

    if (cluster.length === 1) {
      out.push(c);
      continue;
    }

    const ref = cluster.reduce((best, cur) =>
      pathLengthM(cur.coords) > pathLengthM(best.coords) ? cur : best,
    );

    for (const member of cluster) {
      out.push({
        ...member,
        coords: ref.coords,
        lengthM: ref.lengthM,
        routedByOSRM: ref.routedByOSRM,
      });
    }
  }

  if (typeof console !== 'undefined' && cables.length > 0) {
    const merged = cables.length - out.length;
    if (merged !== 0) {
      console.log(
        `[mergeParallel] aligned ${cables.length} cables → ${out.length} unique corridors (corridor=${corridorM}m)`,
      );
    }
  }

  return out;
}
