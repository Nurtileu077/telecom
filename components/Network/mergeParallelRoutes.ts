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

/** Одна улица: тот же азимут или противоположный (вверх/вниз по оси). */
export function bearingsSameCorridor(a: number, b: number, maxRad = 0.4): boolean {
  if (bearingsClose(a, b, maxRad)) return true;
  let d = Math.abs(Math.abs(a - b) - Math.PI);
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

  const polylineMid = (p: [number, number][]): [number, number] => {
    if (p.length === 2) {
      return [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
    }
    return p[Math.floor(p.length / 2)];
  };
  const midA = polylineMid(a);
  const midB = polylineMid(b);
  if (haversineM(midA[0], midA[1], midB[0], midB[1]) > corridorM * 2) return false;

  const bearA = bearing(a[0], a[a.length - 1]);
  const bearB = bearing(b[0], b[b.length - 1]);
  if (!bearingsSameCorridor(bearA, bearB)) return false;

  const distToPolyline = (p: [number, number], line: [number, number][]) => {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      best = Math.min(best, distPointToSegment(p, line[i - 1], line[i]));
    }
    return best;
  };

  const samples = a.length <= 6 ? a : a.filter((_, i) => i % Math.ceil(a.length / 6) === 0);
  let near = 0;
  for (const p of samples) {
    if (distToPolyline(p, b) <= corridorM) near++;
  }
  const need = Math.max(1, Math.ceil(samples.length * 0.6));
  if (near >= need) return true;

  // Короткая линия / встречное направление: оба конца у соседней трассы.
  if (bearingsSameCorridor(bearA, bearB)) {
    const dStart = distToPolyline(a[0], b);
    const dEnd = distToPolyline(a[a.length - 1], b);
    if (dStart <= corridorM && dEnd <= corridorM) return true;
  }
  return false;
}

/**
 * Проход 1.5: выровнять параллельные OSRM-трассы к одной линии.
 * Транзитивное слияние: A∥B и B∥C → одна геометрия для всех.
 */
export function mergeParallelCableGeometry(
  cables: Cable[],
  corridorM = 15,
): Cable[] {
  if (cables.length < 2) return cables;

  const uf = new Array(cables.length).fill(0).map((_, i) => i);
  const find = (x: number): number => {
    if (uf[x] !== x) uf[x] = find(uf[x]);
    return uf[x];
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) uf[rb] = ra;
  };

  for (let i = 0; i < cables.length; i++) {
    for (let j = i + 1; j < cables.length; j++) {
      if (polylinesShareCorridor(cables[i].coords, cables[j].coords, corridorM)) {
        union(i, j);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < cables.length; i++) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(i);
  }

  const out: Cable[] = [];
  for (const idxs of clusters.values()) {
    if (idxs.length === 1) {
      out.push(cables[idxs[0]]);
      continue;
    }
    const cluster = idxs.map((i) => cables[i]);
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
    const multi = [...clusters.values()].filter((c) => c.length > 1).length;
    if (multi > 0) {
      console.log(
        `[mergeParallel] aligned ${cables.length} cables, ${multi} corridor cluster(s) (corridor=${corridorM}m)`,
      );
    }
  }

  return out;
}
