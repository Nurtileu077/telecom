import { Cable, CABLE_FIBERS, CableType, District, OntBox } from '@/types/network';
import { haversineM } from './KMeans';
import { EntityRole, pickSegmentCableType } from './SergekTopology';

// In-line муфта — точка, где трасса разветвляется или меняется жильность.
// Рендерится как небольшой ⊕ маркер и учитывается в смете.
export interface InlineJoint {
  id: string;
  lat: number;
  lon: number;
  parentId: string;
  branchCount: number;
}

// Шаг квантования координат: точки ближе чем corridorM считаются одним
// узлом графа.  По умолчанию 12 м — достаточно для слияния соседних
// OSRM-нитей по одной улице (после snap-to-road OSRM возвращает узлы
// road-graph с разбросом ~5-15 м), но не сольёт две параллельные улицы.
// Меняется через settings.mergeCorridorM (см. consolidateCables).
const DEFAULT_GRID_M = 12;

function makeQuantize(gridM: number) {
  const fLat = 1 / (gridM / 111320);
  const fLon = 1 / (gridM / 81400);
  return (lat: number, lon: number) =>
    `${Math.round(lat * fLat)}_${Math.round(lon * fLon)}`;
}

function pathLength(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}

function buildEntityRoles(
  districts: District[],
  ontBoxes: OntBox[] = [],
): Map<string, EntityRole> {
  const roles = new Map<string, EntityRole>();
  for (const d of districts) {
    roles.set(d.olt.id, 'olt');
    for (const tb of d.olt.transitBoxes) {
      roles.set(tb.id, 'tb');
      for (const ork of tb.orks) {
        roles.set(ork.id, 'ork');
        for (const sub of ork.subscribers) roles.set(sub.id, 'sub');
      }
    }
  }
  for (const b of ontBoxes) roles.set(b.id, 'box');
  return roles;
}

function concatPaths(
  base: [number, number][],
  extra: [number, number][],
): [number, number][] {
  if (extra.length === 0) return base;
  if (base.length === 0) return [...extra];
  const out = [...base];
  const last = out[out.length - 1];
  const start = extra[0];
  if (
    Math.abs(last[0] - start[0]) < 1e-9 &&
    Math.abs(last[1] - start[1]) < 1e-9
  ) {
    out.push(...extra.slice(1));
  } else {
    out.push(...extra);
  }
  return out;
}

function sameCoord(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function segBearing(a: [number, number], b: [number, number]): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/** Левая/правая нить или встречное направление по одной улице (коридор mergeCorridorM). */
function segmentSharesCorridor(
  a: [number, number],
  b: [number, number],
  cand: { coords: [[number, number], [number, number]] },
  gridM: number,
): boolean {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number];
  const c = cand.coords;
  const midC = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2] as [number, number];
  if (haversineM(mid[0], mid[1], midC[0], midC[1]) > gridM * 1.5) return false;
  const b1 = segBearing(a, b);
  const b2 = segBearing(c[0], c[1]);
  let d = Math.abs(b1 - b2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d < 0.4 || Math.abs(d - Math.PI) < 0.4;
}

/** Добавить геометрию сегмента вдоль обхода (не только конечную точку). */
function appendSegmentGeometry(
  run: [number, number][],
  seg: { fromKey: string; toKey: string; coords: [[number, number], [number, number]] },
  atNodeKey: string,
): void {
  const forward = seg.fromKey === atNodeKey;
  const pts: [number, number][] = forward
    ? [seg.coords[0], seg.coords[1]]
    : [seg.coords[1], seg.coords[0]];
  if (pts.length === 0) return;
  if (run.length === 0) {
    run.push(...pts);
    return;
  }
  if (sameCoord(run[run.length - 1], pts[0])) {
    run.push(...pts.slice(1));
  } else {
    run.push(...pts);
  }
}

/** Кабели ОРКСП → BOX → BOX … в порядке прокладки (tree AutoBuild). */
export function walkOrkBoxChain(
  orkId: string,
  cableByEndpoint: Map<string, Cable>,
): Cable[] {
  const chain: Cable[] = [];
  const used = new Set<string>();
  let fromId = orkId;
  while (true) {
    const hops = [...cableByEndpoint.entries()].filter(([k]) =>
      k.startsWith(`${fromId}::`),
    );
    if (hops.length === 0) break;
    const boxHop = hops.find(([, c]) => c.toId.startsWith('BOX-'));
    const picked = boxHop ?? hops[0];
    const [, cable] = picked;
    if (used.has(cable.id)) break;
    used.add(cable.id);
    chain.push(cable);
    if (!cable.toId.startsWith('BOX-')) break;
    fromId = cable.toId;
  }
  return chain;
}

/**
 * Глобальная консолидация: строит граф дорог из всех кабелей одного района,
 * для каждого сегмента считает уникальных абонентов, проходящих через него,
 * и эмитирует кабели так, чтобы по одной дороге шёл только один кабель нужной
 * жильности. В точках, где меняется счётчик абонентов или происходит развилка,
 * автоматически создаются in-line муфты.
 */
export function consolidateCables(
  cables: Cable[],
  districts?: District[],
  /** Корпус слияния (м).  По умолчанию 12 — настраивается через
   *  settings.mergeCorridorM.  Использовался жёстко 40 → слипал две
   *  параллельные улицы; 12 м только сливает соседние OSRM-нити одной
   *  дороги. */
  gridM: number = DEFAULT_GRID_M,
  ontBoxes: OntBox[] = [],
): { cables: Cable[]; joints: InlineJoint[] } {
  if (!districts || districts.length === 0) {
    return { cables, joints: [] };
  }

  // Квантование только для ключей узлов графа; геометрию OSRM не упрощаем —
  // иначе pass 2 превращает изгибы дорог в прямые диагонали.
  const quantize = makeQuantize(gridM);

  const cableByEndpoint = new Map<string, Cable>();
  for (const c of cables) {
    cableByEndpoint.set(`${c.fromId}::${c.toId}`, c);
  }

  const outCables: Cable[] = [];
  const outJoints: InlineJoint[] = [];
  let cableSeq = 0;
  let jointSeq = 0;
  const nextCableId = () => `cable-g-${++cableSeq}`;
  const nextJointId = () => `J-${++jointSeq}`;
  const usedCableIds = new Set<string>();
  const entityRoles = buildEntityRoles(districts, ontBoxes);
  const orkCountByTbId = new Map<string, number>();
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      orkCountByTbId.set(tb.id, tb.orks.length);
    }
  }

  for (const district of districts) {
    const olt = district.olt;

    // === Шаг 1. Строим граф сегментов ===
    type Segment = {
      key: string;
      fromKey: string;
      toKey: string;
      coords: [[number, number], [number, number]];
      subs: Set<string>;       // уникальные абоненты, проходящие через сегмент
      lengthM: number;
    };
    const segments = new Map<string, Segment>();
    const nodeCoord = new Map<string, [number, number]>();

    const addSeg = (a: [number, number], b: [number, number], subId: string) => {
      const aK = quantize(a[0], a[1]);
      const bK = quantize(b[0], b[1]);
      if (aK === bK) return;
      nodeCoord.set(aK, a);
      nodeCoord.set(bK, b);
      const key = aK < bK ? `${aK}|${bK}` : `${bK}|${aK}`;
      let s = segments.get(key);
      if (!s) {
        for (const cand of segments.values()) {
          if (segmentSharesCorridor(a, b, cand, gridM)) {
            s = cand;
            break;
          }
        }
      }
      if (!s) {
        s = {
          key,
          fromKey: aK,
          toKey: bK,
          coords: [a, b],
          subs: new Set(),
          lengthM: haversineM(a[0], a[1], b[0], b[1]),
        };
        segments.set(key, s);
      }
      s.subs.add(subId);
    };

    // Фактическая позиция узла в графе дорог после OSRM-снэппинга.
    // OLT/ТМ/ОРК/абонент часто стоят не на дороге, OSRM сдвигает старт/конец
    // к ближайшему road-node. Эта снэпленная точка и есть узел графа —
    // именно она должна использоваться для BFS и для распознавания терминалов.
    const effectivePos = new Map<string, [number, number]>();

    // Для каждого абонента склеиваем полный путь OLT→TB→ORK→sub и
    // регистрируем его прохождение по каждому сегменту.
    let hasAnyPath = false;
    for (const tb of olt.transitBoxes) {
      const oltTb = cableByEndpoint.get(`${olt.id}::${tb.id}`);
      if (!oltTb) continue;
      if (oltTb.coords.length >= 2) {
        if (!effectivePos.has(olt.id)) effectivePos.set(olt.id, oltTb.coords[0]);
        effectivePos.set(tb.id, oltTb.coords[oltTb.coords.length - 1]);
      }
      for (const ork of tb.orks) {
        const tbOrk = cableByEndpoint.get(`${tb.id}::${ork.id}`);
        if (!tbOrk) continue;
        if (tbOrk.coords.length >= 2) {
          effectivePos.set(ork.id, tbOrk.coords[tbOrk.coords.length - 1]);
        }
        const boxChain = walkOrkBoxChain(ork.id, cableByEndpoint);
        for (const hop of boxChain) {
          if (hop.coords.length >= 2) {
            effectivePos.set(hop.toId, hop.coords[hop.coords.length - 1]);
          }
        }

        for (let subIdx = 0; subIdx < ork.subscribers.length; subIdx++) {
          const sub = ork.subscribers[subIdx];
          const orkSub = cableByEndpoint.get(`${ork.id}::${sub.id}`);

          let path: [number, number][] = concatPaths(
            [...oltTb.coords],
            tbOrk.coords.length >= 2 ? tbOrk.coords.slice(1) : [],
          );

          const pathCables: Cable[] = [oltTb, tbOrk];

          if (orkSub) {
            path = concatPaths(path, orkSub.coords.length >= 2 ? orkSub.coords.slice(1) : []);
            pathCables.push(orkSub);
            if (orkSub.coords.length >= 2) {
              effectivePos.set(sub.id, orkSub.coords[orkSub.coords.length - 1]);
            }
          } else if (boxChain.length > 0) {
            const hops = Math.min(subIdx + 1, boxChain.length);
            for (let i = 0; i < hops; i++) {
              const hop = boxChain[i];
              path = concatPaths(
                path,
                hop.coords.length >= 2 ? hop.coords.slice(1) : [],
              );
              pathCables.push(hop);
              if (hop.coords.length >= 2) {
                const end = hop.coords[hop.coords.length - 1];
                effectivePos.set(hop.toId, end);
                if (i === hops - 1) effectivePos.set(sub.id, end);
              }
            }
          } else {
            continue;
          }

          for (const pc of pathCables) usedCableIds.add(pc.id);
          if (path.length < 2) continue;
          for (let i = 1; i < path.length; i++) {
            addSeg(path[i - 1], path[i], sub.id);
          }
          hasAnyPath = true;
        }
      }
    }
    if (!hasAnyPath) continue;

    // OLT-узел в графе — это снэпленная позиция (начало OLT→TB кабеля).
    // Иначе BFS стартует в пустой клетке и ничего не находит.
    const oltCoord = effectivePos.get(olt.id) ?? [olt.lat, olt.lon];
    const oltKey = quantize(oltCoord[0], oltCoord[1]);
    nodeCoord.set(oltKey, oltCoord);

    // === Шаг 2. Adjacency: для каждого узла — список сегментов. ===
    const adj = new Map<string, string[]>();
    for (const seg of segments.values()) {
      if (!adj.has(seg.fromKey)) adj.set(seg.fromKey, []);
      if (!adj.has(seg.toKey)) adj.set(seg.toKey, []);
      adj.get(seg.fromKey)!.push(seg.key);
      adj.get(seg.toKey)!.push(seg.key);
    }

    // === Шаг 3. Обход от OLT и эмиссия кабелей ===
    const usedSeg = new Set<string>();

    // Для каждого узла храним: какой ID представляет эту точку (OLT/joint/ORK-id/sub-id).
    // Используем СНЭПЛЕННЫЕ позиции (фактический узел графа дорог), а не
    // исходные координаты сущности — иначе BFS не распознает терминал.
    const nodeId = new Map<string, string>();
    nodeId.set(oltKey, olt.id);
    for (const tb of olt.transitBoxes) {
      const tbCoord = effectivePos.get(tb.id) ?? [tb.lat, tb.lon];
      nodeId.set(quantize(tbCoord[0], tbCoord[1]), tb.id);
      for (const ork of tb.orks) {
        const orkCoord = effectivePos.get(ork.id) ?? [ork.lat, ork.lon];
        nodeId.set(quantize(orkCoord[0], orkCoord[1]), ork.id);
        const boxChainForNodes = walkOrkBoxChain(ork.id, cableByEndpoint);
        for (const hop of boxChainForNodes) {
          const boxCoord = effectivePos.get(hop.toId) ??
            (hop.coords.length >= 2
              ? hop.coords[hop.coords.length - 1]
              : undefined);
          if (boxCoord) {
            nodeId.set(quantize(boxCoord[0], boxCoord[1]), hop.toId);
          }
        }
        for (const sub of ork.subscribers) {
          const subCoord = effectivePos.get(sub.id) ?? [sub.lat, sub.lon];
          nodeId.set(quantize(subCoord[0], subCoord[1]), sub.id);
        }
      }
    }

    // Получить «соседа» (другой конец сегмента, не равный nodeKey).
    const otherEnd = (s: Segment, nodeKey: string): string =>
      s.fromKey === nodeKey ? s.toKey : s.fromKey;

    // Эмитим кабель.
    const emitCable = (
      coords: [number, number][],
      subsCount: number,
      fromId: string,
      toId: string,
      routed: boolean,
    ) => {
      if (coords.length < 2) return;
      const type = pickSegmentCableType(subsCount, fromId, toId, entityRoles, orkCountByTbId);
      outCables.push({
        id: nextCableId(),
        type,
        fibers: CABLE_FIBERS[type],
        fromId,
        toId,
        coords,
        lengthM: pathLength(coords),
        routedByOSRM: routed,
      });
    };

    // BFS-обход: используем очередь стартовых точек (узел + откуда-id).
    type Start = { nodeKey: string; fromId: string };
    const queue: Start[] = [{ nodeKey: oltKey, fromId: olt.id }];

    while (queue.length > 0) {
      const { nodeKey, fromId } = queue.shift()!;
      // Берём все свободные сегменты, начинающиеся в этой точке.
      const segKeys = (adj.get(nodeKey) || []).filter((k) => !usedSeg.has(k));
      if (segKeys.length === 0) continue;

      // Группируем по subscriber-set: сегменты с одним и тем же набором
      // абонентов формируют одну цепочку (магистраль).
      const groups = new Map<string, string[]>();
      for (const k of segKeys) {
        const s = segments.get(k)!;
        const groupKey = [...s.subs].sort().join(',');
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey)!.push(k);
      }

      // Если из одной точки выходит несколько разных «групп» кабелей или
      // несколько сегментов в одной группе — нужна муфта на этой точке.
      // Если только одна цепочка с одним сегментом — продолжаем без муфты.
      let branchOrigin = fromId;
      const isStartNode = nodeKey === oltKey;
      const totalBranches = segKeys.length;
      const distinctGroups = groups.size;
      const needJoint =
        !isStartNode &&
        totalBranches >= 2 &&
        (distinctGroups >= 2 || !nodeId.has(nodeKey));
      if (needJoint) {
        const jid = nextJointId();
        const coord = nodeCoord.get(nodeKey)!;
        outJoints.push({
          id: jid,
          lat: coord[0],
          lon: coord[1],
          parentId: fromId,
          branchCount: totalBranches,
        });
        branchOrigin = jid;
      } else if (nodeId.has(nodeKey) && nodeKey !== oltKey) {
        // Точка совпадает с существующим объектом (TB/ORK/sub) — используем её id.
        branchOrigin = nodeId.get(nodeKey)!;
      }

      // Для каждой цепочки идём по графу пока subs не меняется и нет развилки.
      for (const [, segs] of groups) {
        // У группы один и тот же subscriber-set. Если в группе сразу 2+
        // сегмента из одной точки — это «звезда» из одной точки (редко). Тогда
        // мы уже создали joint выше; каждый из них становится отдельной ветвью.
        for (const startSegKey of segs) {
          if (usedSeg.has(startSegKey)) continue;
          // Идём по цепочке.
          let curNode = nodeKey;
          let curSeg = segments.get(startSegKey)!;
          const runCoords: [number, number][] = [nodeCoord.get(curNode)!];
          let runSubsRef = curSeg.subs;
          while (true) {
            usedSeg.add(curSeg.key);
            appendSegmentGeometry(runCoords, curSeg, curNode);
            const next = otherEnd(curSeg, curNode);
            // Условия остановки: соседний узел — это OLT/ORK/sub/TB; или там
            // есть развилка; или меняется subs-set.
            const isTerminalNode = nodeId.has(next);
            const nextAdjFree = (adj.get(next) || []).filter((k) => !usedSeg.has(k));
            // Сегменты с тем же subs-set, исходящие из next.
            const continuingSegs = nextAdjFree.filter((k) => {
              const ss = segments.get(k)!;
              if (ss.subs.size !== runSubsRef.size) return false;
              for (const x of ss.subs) if (!runSubsRef.has(x)) return false;
              return true;
            });
            const otherSegs = nextAdjFree.filter((k) => !continuingSegs.includes(k));
            // Если впереди ровно одна продолжающая цепочка И нет других веток
            // И это не terminal — продолжаем без муфты.
            if (
              !isTerminalNode &&
              continuingSegs.length === 1 &&
              otherSegs.length === 0
            ) {
              curNode = next;
              curSeg = segments.get(continuingSegs[0])!;
              continue;
            }
            // Иначе — обрываем кабель здесь.
            let toId: string;
            if (isTerminalNode) {
              toId = nodeId.get(next)!;
            } else if (nextAdjFree.length === 0) {
              // Тупик без terminal — редкий случай, делаем синтетический joint.
              toId = nextJointId();
              outJoints.push({
                id: toId,
                lat: nodeCoord.get(next)![0],
                lon: nodeCoord.get(next)![1],
                parentId: branchOrigin,
                branchCount: 0,
              });
            } else {
              // Развилка или смена subs-set — ставим муфту здесь.
              toId = nextJointId();
              outJoints.push({
                id: toId,
                lat: nodeCoord.get(next)![0],
                lon: nodeCoord.get(next)![1],
                parentId: branchOrigin,
                branchCount: nextAdjFree.length,
              });
            }
            emitCable(runCoords, runSubsRef.size, branchOrigin, toId, true);
            // Записываем id для next, чтобы следующая итерация знала его.
            if (!nodeId.has(next)) nodeId.set(next, toId);
            // Запускаем продолжение обхода от next.
            queue.push({ nodeKey: next, fromId: toId });
            break;
          }
        }
      }
    }
  }

  // Кабели без пути OLT→…→абонент (отводы и пр.) — без изменений.
  let passthrough = 0;
  for (const c of cables) {
    if (!usedCableIds.has(c.id)) { outCables.push(c); passthrough++; }
  }

  if (typeof console !== 'undefined') {
    console.log(
      `[Consolidation] in=${cables.length} → out=${outCables.length} ` +
      `(consolidated=${cableSeq}, joints=${outJoints.length}, passthrough=${passthrough})`,
    );
  }

  return { cables: outCables, joints: outJoints };
}
