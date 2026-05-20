import { haversineM } from './KMeans';

export type CorridorSegment = {
  key: string;
  fromKey: string;
  toKey: string;
  coords: [[number, number], [number, number]];
  subs: Set<string>;
  lengthM: number;
};

function segBearing(a: [number, number], b: [number, number]): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/** Параллельные / встречные нити одной улицы → один сегмент графа. */
export function segmentSharesCorridor(
  a: [number, number],
  b: [number, number],
  cand: { coords: [[number, number], [number, number]] },
  gridM: number,
): boolean {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number];
  const c = cand.coords;
  const midC = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2] as [number, number];
  if (haversineM(mid[0], mid[1], midC[0], midC[1]) > gridM * 2.5) return false;
  const b1 = segBearing(a, b);
  const b2 = segBearing(c[0], c[1]);
  let d = Math.abs(b1 - b2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d < 0.45 || Math.abs(d - Math.PI) < 0.45;
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Слить сегменты одного коридора (параллельные OSRM-нити) в один узел графа
 * с объединённым набором абонентов. Возвращает remap старых key → канонический.
 */
export function mergeCorridorSegments(
  segments: Map<string, CorridorSegment>,
  gridM: number,
): { segments: Map<string, CorridorSegment>; keyRemap: Map<string, string> } {
  const list = [...segments.values()];
  const keyRemap = new Map<string, string>();
  for (const s of list) keyRemap.set(s.key, s.key);

  if (list.length < 2) return { segments, keyRemap };

  const uf = new UnionFind(list.length);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const si = list[i];
      const sj = list[j];
      if (
        segmentSharesCorridor(si.coords[0], si.coords[1], sj, gridM) ||
        segmentSharesCorridor(sj.coords[0], sj.coords[1], si, gridM)
      ) {
        uf.union(i, j);
      }
    }
  }

  const buckets = new Map<number, CorridorSegment[]>();
  for (let i = 0; i < list.length; i++) {
    const r = uf.find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r)!.push(list[i]);
  }

  const out = new Map<string, CorridorSegment>();
  for (const group of buckets.values()) {
    const primary = group.reduce((best, cur) =>
      cur.lengthM > best.lengthM ? cur : best,
    );
    const mergedSubs = new Set<string>();
    for (const g of group) {
      for (const s of g.subs) mergedSubs.add(s);
      keyRemap.set(g.key, primary.key);
    }
    out.set(primary.key, {
      ...primary,
      subs: mergedSubs,
      lengthM: Math.max(...group.map((g) => g.lengthM)),
    });
  }
  return { segments: out, keyRemap };
}
