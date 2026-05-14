import { Cable, CABLE_FIBERS, CABLE_SIZES, CableType, District } from '@/types/network';
import { haversineM } from './KMeans';

// In-line муфта — точка, где трасса разветвляется или меняется жильность.
// Рендерится как небольшой ⊕ маркер и учитывается в смете.
export interface InlineJoint {
  id: string;
  lat: number;
  lon: number;
  parentId: string;
  branchCount: number;
}

// Шаг квантования координат: точки ближе ≈30 м считаются одним узлом графа.
// Квантование используется ТОЛЬКО для ключей графа — сами координаты кабеля
// при эмиссии остаются исходными (OSRM), чтобы не было «лесенки» на прямых дорогах.
// 30м выбран эмпирически: OSRM-маршруты на одной дороге обычно расходятся
// не больше чем на 15м латерально, а соседние улицы обычно дальше 30м.
const GRID_M = 30;
// Шаг плотности: перед построением графа вставляем промежуточные вершины,
// чтобы два почти-одинаковых OSRM-маршрута гарантированно прошли через
// одни и те же клетки сетки и объединились в один кабель.
const DENSIFY_STEP_M = 8;

function quantize(lat: number, lon: number): string {
  const fLat = 1 / (GRID_M / 111320);
  const fLon = 1 / (GRID_M / 81400);
  return `${Math.round(lat * fLat)}_${Math.round(lon * fLon)}`;
}

// Уплотняет ломаную: между парами вершин длиннее DENSIFY_STEP_M * 1.5
// вставляет дополнительные точки шагом ≈DENSIFY_STEP_M. Это гарантирует,
// что параллельные кабели на одной дороге попадают в одни клетки сетки.
function densifyPath(coords: [number, number][], stepM: number): [number, number][] {
  if (coords.length < 2) return coords;
  const out: [number, number][] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [a0, a1] = coords[i - 1];
    const [b0, b1] = coords[i];
    const segLen = haversineM(a0, a1, b0, b1);
    if (segLen > stepM * 1.5) {
      const n = Math.ceil(segLen / stepM);
      for (let j = 1; j < n; j++) {
        const t = j / n;
        out.push([a0 + (b0 - a0) * t, a1 + (b1 - a1) * t]);
      }
    }
    out.push([b0, b1]);
  }
  return out;
}

function pathLength(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}

// Подбираем минимальный тип кабеля под нужное число волокон.
// Ограничение по проекту: ОК-48 — максимальная жильность; ОК-96 не используем.
function pickCableType(fibers: number): CableType {
  for (const t of CABLE_SIZES) {
    if (t === 'ОК-96') continue;
    if (CABLE_FIBERS[t] >= fibers) return t;
  }
  return 'ОК-48';
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
): { cables: Cable[]; joints: InlineJoint[] } {
  if (!districts || districts.length === 0) {
    return { cables, joints: [] };
  }

  // Карта кабелей по конечным точкам — для прохода вверх по иерархии.
  // Используем исходные координаты (не снэпленные к сетке), чтобы при эмиссии
  // линия шла по дороге, а не зигзагом по центрам клеток.
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

  for (const district of districts) {
    const olt = district.olt;

    // === Шаг 1. Строим граф сегментов ===
    type Segment = {
      key: string;
      fromKey: string;
      toKey: string;
      coords: [[number, number], [number, number]];
      orks: Set<string>;       // ОРК, питаемые через этот сегмент
      lengthM: number;
    };
    const segments = new Map<string, Segment>();
    const nodeCoord = new Map<string, [number, number]>();
    // Кол-во абонентов в каждом ОРК — для подсчёта жильности магистрали.
    const orkSubCount = new Map<string, number>();

    const addSeg = (a: [number, number], b: [number, number], orkId: string) => {
      const aK = quantize(a[0], a[1]);
      const bK = quantize(b[0], b[1]);
      if (aK === bK) return;
      nodeCoord.set(aK, a);
      nodeCoord.set(bK, b);
      const key = aK < bK ? `${aK}|${bK}` : `${bK}|${aK}`;
      let s = segments.get(key);
      if (!s) {
        s = {
          key,
          fromKey: aK,
          toKey: bK,
          coords: [a, b],
          orks: new Set(),
          lengthM: haversineM(a[0], a[1], b[0], b[1]),
        };
        segments.set(key, s);
      }
      s.orks.add(orkId);
    };

    // Фактическая позиция узла в графе дорог после OSRM-снэппинга.
    // OLT/ТМ/ОРК часто стоят не на дороге, OSRM сдвигает старт/конец
    // к ближайшему road-node. Эта снэпленная точка и есть узел графа —
    // именно она должна использоваться для BFS и для распознавания терминалов.
    const effectivePos = new Map<string, [number, number]>();

    // Консолидируем только МАГИСТРАЛЬ: OLT→TB→ORK. Дропы ORK→sub оставляем
    // как индивидуальные кабели (passthrough) — иначе в каждой точке выхода
    // абонента появляется муфта, и трасса покрывается сотнями узлов.
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
        usedCableIds.add(oltTb.id);
        usedCableIds.add(tbOrk.id);
        orkSubCount.set(ork.id, ork.subscribers.length);
        const path: [number, number][] = [
          ...oltTb.coords,
          ...tbOrk.coords.slice(1),
        ];
        const dense = densifyPath(path, DENSIFY_STEP_M);
        for (let i = 1; i < dense.length; i++) {
          addSeg(dense[i - 1], dense[i], ork.id);
        }
        hasAnyPath = true;
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

    // Для каждого узла храним: какой ID представляет эту точку (OLT/joint/ORK-id).
    // Используем СНЭПЛЕННЫЕ позиции (фактический узел графа дорог), а не
    // исходные координаты сущности — иначе BFS не распознает терминал.
    // Абоненты НЕ являются терминалами магистрали — их дропы остаются passthrough.
    const nodeId = new Map<string, string>();
    nodeId.set(oltKey, olt.id);
    for (const tb of olt.transitBoxes) {
      const tbCoord = effectivePos.get(tb.id) ?? [tb.lat, tb.lon];
      nodeId.set(quantize(tbCoord[0], tbCoord[1]), tb.id);
      for (const ork of tb.orks) {
        const orkCoord = effectivePos.get(ork.id) ?? [ork.lat, ork.lon];
        nodeId.set(quantize(orkCoord[0], orkCoord[1]), ork.id);
      }
    }

    // Суммарное число абонентов через набор ОРК — для расчёта жильности.
    const subsFromOrks = (orks: Set<string>): number => {
      let n = 0;
      for (const o of orks) n += orkSubCount.get(o) || 1;
      return n;
    };

    // Получить «соседа» (другой конец сегмента, не равный nodeKey).
    const otherEnd = (s: Segment, nodeKey: string): string =>
      s.fromKey === nodeKey ? s.toKey : s.fromKey;

    // Получить координату «другого конца».
    const otherCoord = (s: Segment, nodeKey: string): [number, number] => {
      const aK = quantize(s.coords[0][0], s.coords[0][1]);
      return aK === nodeKey ? s.coords[1] : s.coords[0];
    };

    // Эмитим кабель.
    const emitCable = (
      coords: [number, number][],
      subsCount: number,
      fromId: string,
      toId: string,
      routed: boolean,
    ) => {
      if (coords.length < 2) return;
      const type = pickCableType(Math.max(2, subsCount * 2));
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

      // Группируем по ORK-set: сегменты, питающие один и тот же набор
      // ОРК, формируют одну цепочку (магистраль).
      const groups = new Map<string, string[]>();
      for (const k of segKeys) {
        const s = segments.get(k)!;
        const groupKey = [...s.orks].sort().join(',');
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey)!.push(k);
      }

      // Если из одной точки выходит несколько разных «групп» кабелей или
      // несколько сегментов в одной группе — нужна муфта на этой точке.
      // Если только одна цепочка с одним сегментом — продолжаем без муфты.
      let branchOrigin = fromId;
      const isStartNode = nodeKey === oltKey;
      const totalBranches = segKeys.length;
      const needJoint =
        !isStartNode &&
        // Уже не OLT/ORK/sub точка
        !nodeId.has(nodeKey) &&
        totalBranches >= 2;
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
          let runOrksRef = curSeg.orks;
          while (true) {
            usedSeg.add(curSeg.key);
            const next = otherEnd(curSeg, curNode);
            runCoords.push(otherCoord(curSeg, curNode));
            // Условия остановки: соседний узел — это OLT/TB/ORK; или там
            // есть развилка; или меняется ORK-set.
            const isTerminalNode = nodeId.has(next);
            const nextAdjFree = (adj.get(next) || []).filter((k) => !usedSeg.has(k));
            // Сегменты с тем же ORK-set, исходящие из next.
            const continuingSegs = nextAdjFree.filter((k) => {
              const ss = segments.get(k)!;
              if (ss.orks.size !== runOrksRef.size) return false;
              for (const x of ss.orks) if (!runOrksRef.has(x)) return false;
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
            emitCable(runCoords, subsFromOrks(runOrksRef), branchOrigin, toId, true);
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

  // Кабели, которые НЕ были покрыты глобальной консолидацией (например, если
  // нет соответствующего OLT→TB→ORK→sub звена), оставляем как есть.
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
