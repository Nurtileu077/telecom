import { Cable, CABLE_FIBERS, CableType, District } from '@/types/network';
import { haversineM } from './KMeans';

// In-line муфта — точка, где трасса разветвляется (degree ≥ 3) или меняется
// жильность.  Рендерится как небольшой ⊕ маркер и учитывается в смете.
export interface InlineJoint {
  id: string;
  lat: number;
  lon: number;
  parentId: string;
  branchCount: number;
}

// Шаг квантования координат: точки ближе чем corridorM считаются одним узлом
// графа.  По умолчанию 12 м — сливает соседние OSRM-нити одной улицы, но не
// слепляет две параллельные улицы.  Меняется через settings.mergeCorridorM.
const DEFAULT_GRID_M = 12;

function makeQuantize(gridM: number) {
  const fLat = 1 / (gridM / 111320);
  const fLon = 1 / (gridM / 81400);
  return (lat: number, lon: number) =>
    `${Math.round(lat * fLat)}_${Math.round(lon * fLon)}`;
}

function makeSnap(gridM: number) {
  const fLat = 1 / (gridM / 111320);
  const fLon = 1 / (gridM / 81400);
  return (lat: number, lon: number): [number, number] =>
    [Math.round(lat * fLat) / fLat, Math.round(lon * fLon) / fLon];
}

// Снэпает координаты кабеля к сетке (промежуточные — к центрам клеток,
// концы — точные, чтобы кабель начинался/заканчивался у сущности).
function makeSnapCablePath(gridM: number) {
  const quantize = makeQuantize(gridM);
  const snapCoord = makeSnap(gridM);
  return (coords: [number, number][]): [number, number][] => {
    if (coords.length < 2) return coords;
    const out: [number, number][] = [coords[0]];
    let lastKey = quantize(coords[0][0], coords[0][1]);
    for (let i = 1; i < coords.length - 1; i++) {
      const [la, lo] = coords[i];
      const snapped = snapCoord(la, lo);
      const k = quantize(snapped[0], snapped[1]);
      if (k !== lastKey) {
        out.push(snapped);
        lastKey = k;
      }
    }
    const last = coords[coords.length - 1];
    const lastK = quantize(last[0], last[1]);
    if (lastK !== lastKey) out.push(last);
    else out[out.length - 1] = last;
    return out;
  };
}

function pathLength(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}

function maxType(a: CableType, b: CableType): CableType {
  return CABLE_FIBERS[a] >= CABLE_FIBERS[b] ? a : b;
}

/**
 * ГЕОМЕТРИЧЕСКАЯ консолидация (топология-агностик).
 *
 * Раньше алгоритм шёл по дереву OLT→TB→ORK→sub и ломался на новой
 * daisy-chain топологии (ОРКСП→бокс→бокс→камера) — прямого кабеля
 * `ork::sub` больше нет, поэтому ничего не сливалось.
 *
 * Новый подход работает на ЧИСТОЙ ГЕОМЕТРИИ кабелей:
 *   1. Снэпаем вершины всех кабелей к сетке corridorM (концы точные).
 *   2. Строим граф сегментов; на каждом сегменте копим макс. требуемую
 *      жильность (самый толстый проходящий кабель) — две параллельные
 *      нити одной улицы попадают в один сегмент → рисуются одной линией.
 *   3. Узлы-«разрывы» = сущности (OLT/TB/ОРКСП/камера) ИЛИ degree ≠ 2.
 *   4. Схлопываем degree-2 цепочки между разрывами в один кабель.
 *   5. В неэнтити-разрывах degree ≥ 3 ставим муфту (InlineJoint).
 *
 * Это убирает параллельные синие линии на одной дороге (issues #1/#2):
 * перекрывающиеся участки получают общую снэпленную геометрию и одну линию.
 */
export function consolidateCables(
  cables: Cable[],
  districts?: District[],
  gridM: number = DEFAULT_GRID_M,
): { cables: Cable[]; joints: InlineJoint[] } {
  if (!districts || districts.length === 0 || cables.length === 0) {
    return { cables, joints: [] };
  }

  const quantize = makeQuantize(gridM);
  const snapCablePath = makeSnapCablePath(gridM);

  // ── 1. Карта: grid-узел → id сущности (для подписи концов кабелей) ──
  // Регистрируем в порядке sub → ОРКСП → TB → OLT, чтобы при совпадении
  // координат победил более «высокий» узел (ОРКСП важнее ко-локализованной
  // камеры; OLT важнее всех).
  const entityAt = new Map<string, string>();
  const entityCoordById = new Map<string, [number, number]>();
  const reg = (id: string, lat: number, lon: number) => {
    entityAt.set(quantize(lat, lon), id);
    entityCoordById.set(id, [lat, lon]);
  };
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        for (const s of ork.subscribers) reg(s.id, s.lat, s.lon);
      }
    }
  }
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) reg(ork.id, ork.lat, ork.lon);
    }
  }
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) reg(tb.id, tb.lat, tb.lon);
  }
  for (const d of districts) reg(d.olt.id, d.olt.lat, d.olt.lon);

  // ── 2. Граф сегментов ──
  interface Seg {
    key: string;
    a: string; b: string;
    ca: [number, number]; cb: [number, number];
    type: CableType;          // макс. жильность проходящих кабелей
  }
  const segs = new Map<string, Seg>();
  const nodeCoord = new Map<string, [number, number]>();

  const addSeg = (p: [number, number], q: [number, number], type: CableType) => {
    const aK = quantize(p[0], p[1]);
    const bK = quantize(q[0], q[1]);
    if (aK === bK) return;
    nodeCoord.set(aK, p);
    nodeCoord.set(bK, q);
    const key = aK < bK ? `${aK}|${bK}` : `${bK}|${aK}`;
    const existing = segs.get(key);
    if (existing) {
      existing.type = maxType(existing.type, type);
    } else {
      segs.set(key, { key, a: aK, b: bK, ca: p, cb: q, type });
    }
  };

  for (const c of cables) {
    const snapped = snapCablePath(c.coords);
    for (let i = 1; i < snapped.length; i++) {
      addSeg(snapped[i - 1], snapped[i], c.type);
    }
  }

  // ── 3. Adjacency ──
  const adj = new Map<string, string[]>();
  for (const seg of segs.values()) {
    if (!adj.has(seg.a)) adj.set(seg.a, []);
    if (!adj.has(seg.b)) adj.set(seg.b, []);
    adj.get(seg.a)!.push(seg.key);
    adj.get(seg.b)!.push(seg.key);
  }

  // Узел-разрыв: сущность ИЛИ степень ≠ 2 (концы, развилки).
  const isBreak = (node: string): boolean =>
    entityAt.has(node) || (adj.get(node)?.length ?? 0) !== 2;

  // ── 4. Схлопывание degree-2 цепочек ──
  const outCables: Cable[] = [];
  const outJoints: InlineJoint[] = [];
  let cableSeq = 0;
  let jointSeq = 0;
  const jointIdAt = new Map<string, string>();   // grid-узел → joint id

  const idForNode = (node: string, parentId: string, degree: number): string => {
    const ent = entityAt.get(node);
    if (ent) return ent;
    let jid = jointIdAt.get(node);
    if (!jid) {
      jid = `J-${++jointSeq}`;
      jointIdAt.set(node, jid);
      const co = nodeCoord.get(node)!;
      outJoints.push({ id: jid, lat: co[0], lon: co[1], parentId, branchCount: degree });
    }
    return jid;
  };

  const otherEnd = (seg: Seg, node: string) => (seg.a === node ? seg.b : seg.a);
  const usedSeg = new Set<string>();

  const breakNodes = Array.from(adj.keys()).filter(isBreak);

  for (const start of breakNodes) {
    for (const firstKey of adj.get(start) ?? []) {
      if (usedSeg.has(firstKey)) continue;

      // Идём по цепочке от start через degree-2 узлы до следующего разрыва.
      const coords: [number, number][] = [nodeCoord.get(start)!];
      let chainType: CableType = 'ОК-4';
      let cur = start;
      let segKey: string | undefined = firstKey;

      while (segKey) {
        if (usedSeg.has(segKey)) break;
        usedSeg.add(segKey);
        const seg = segs.get(segKey)!;
        const next = otherEnd(seg, cur);
        coords.push(nodeCoord.get(next)!);
        chainType = maxType(chainType, seg.type);
        cur = next;
        if (isBreak(cur)) break;
        // продолжаем по единственному свободному сегменту
        const cont = (adj.get(cur) ?? []).filter((k) => k !== segKey && !usedSeg.has(k));
        segKey = cont.length === 1 ? cont[0] : undefined;
      }

      if (coords.length < 2) continue;

      const startDeg = adj.get(start)?.length ?? 0;
      const endDeg = adj.get(cur)?.length ?? 0;
      const fromId = idForNode(start, '', startDeg);
      const toId = idForNode(cur, fromId, endDeg);
      if (fromId === toId) continue;

      outCables.push({
        id: `cable-g-${++cableSeq}`,
        type: chainType,
        fibers: CABLE_FIBERS[chainType],
        fromId,
        toId,
        coords,
        lengthM: pathLength(coords),
        routedByOSRM: true,
      });
    }
  }

  if (typeof console !== 'undefined') {
    console.log(
      `[Consolidation/geo] in=${cables.length} → out=${outCables.length} ` +
      `(segments=${segs.size}, joints=${outJoints.length}, corridor=${gridM}m)`,
    );
  }

  // Если по какой-то причине ничего не схлопнулось — возвращаем исходные
  // кабели (со снэпом), чтобы не потерять сеть.
  if (outCables.length === 0) {
    return {
      cables: cables.map((c) => ({ ...c, coords: snapCablePath(c.coords) })),
      joints: [],
    };
  }

  return { cables: outCables, joints: outJoints };
}
