import { Cable, CableType, CABLE_FIBERS, selectCableTypeByFiberCount } from '@/types/network';
import { haversineM } from './KMeans';

/** Не отвод ОК-4 к абоненту — участок для объединения параллелей. */
export function isTrunkishCable(c: Cable): boolean {
  return c.type !== 'ОК-4';
}

function chordEndpoints(c: Cable): { s: [number, number]; e: [number, number] } {
  const coords = c.coords;
  if (coords.length < 2) return { s: [0, 0], e: [0, 0] };
  return { s: coords[0], e: coords[coords.length - 1] };
}

function endpointsCloseForMerge(a: Cable, b: Cable, radiusM: number): boolean {
  if (!isTrunkishCable(a) || !isTrunkishCable(b)) return false;
  const A = chordEndpoints(a);
  const B = chordEndpoints(b);
  if (haversineM(A.s[0], A.s[1], B.s[0], B.s[1]) > radiusM) return false;
  if (haversineM(A.e[0], A.e[1], B.e[0], B.e[1]) > radiusM) return false;
  const la = a.lengthM;
  const lb = b.lengthM;
  if (la <= 0 || lb <= 0) return false;
  if (Math.abs(la - lb) / Math.max(la, lb) > 0.42) return false;
  return true;
}

/** Кластеры магистралей с почти совпадающими концами и длиной. */
export function clusterParallelTrunkCables(cables: Cable[], radiusM: number): Cable[][] {
  const trunks = cables.filter(isTrunkishCable);
  const clusters: Cable[][] = [];
  for (const c of trunks) {
    let placed = false;
    for (const cl of clusters) {
      if (cl.some((x) => endpointsCloseForMerge(x, c, radiusM))) {
        cl.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([c]);
  }
  return clusters;
}

/**
 * Смета: виртуальные кабели после объединения параллельных магистралей.
 */
export function consolidateTrunksForMaterialsAccounting(cables: Cable[], radiusM: number): Cable[] {
  const drops = cables.filter((c) => !isTrunkishCable(c));
  const clusters = clusterParallelTrunkCables(cables, radiusM);

  const merged: Cable[] = clusters.map((g) => {
    if (g.length === 1) return g[0];
    const maxLen = Math.max(...g.map((x) => x.lengthM));
    const totalFibers = g.reduce((s, x) => s + CABLE_FIBERS[x.type], 0);
    const t = selectCableTypeByFiberCount(totalFibers);
    const ref = g.reduce((a, b) => (a.lengthM >= b.lengthM ? a : b));
    return {
      ...ref,
      id: `acct-merge:${g.map((x) => x.id).join('+')}`,
      type: t,
      fibers: CABLE_FIBERS[t],
      lengthM: maxLen,
      routedByOSRM: g.some((x) => x.routedByOSRM),
    };
  });

  return [...merged, ...drops];
}

/** Суммарная длина кабеля для отображения в шапке (с учётом объединения). */
export function totalCableLengthMeters(cables: Cable[], consolidate: boolean, radiusM: number): number {
  const list = consolidate
    ? consolidateTrunksForMaterialsAccounting(cables, radiusM > 0 ? radiusM : 18)
    : cables;
  return list.reduce((s, c) => s + c.lengthM, 0);
}

/**
 * Проставляет physicalSegmentId одинаковым для кабелей одного физического кластера.
 * При выключенном объединении поле снимается (не сериализуем лишнее в старых JSON).
 */
export function applyPhysicalSegmentIds(
  cables: Cable[],
  consolidate: boolean,
  radiusM: number,
): Cable[] {
  const r = radiusM > 0 ? radiusM : 18;
  const stripped = cables.map(({ physicalSegmentId: _p, ...rest }) => rest as Cable);
  if (!consolidate) return stripped;

  const trunks = stripped.filter(isTrunkishCable);
  const clusters = clusterParallelTrunkCables(trunks, r);
  const idToSeg = new Map<string, string>();
  clusters.forEach((cl, idx) => {
    const seg = `phys-${idx}`;
    for (const c of cl) idToSeg.set(c.id, seg);
  });

  return stripped.map((c) => {
    if (!isTrunkishCable(c)) return c;
    const sid = idToSeg.get(c.id);
    return sid ? { ...c, physicalSegmentId: sid } : c;
  });
}

/** Тип и волокна для отрисовки сегмента (как в смете после объединения). */
export function mergedDisplayTypeForSegment(group: Cable[]): { type: CableType; fibers: number } {
  const totalFibers = group.reduce((s, c) => s + CABLE_FIBERS[c.type], 0);
  const t = selectCableTypeByFiberCount(totalFibers);
  return { type: t, fibers: CABLE_FIBERS[t] };
}
