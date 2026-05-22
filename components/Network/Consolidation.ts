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

// Радиус слияния узлов графа дорог. Точки ближе MERGE_RADIUS_M считаются одним
// узлом — это сливает параллельные нити одной дороги. OSRM «не умный»: правую и
// левую сторону одной улицы он тянет отдельными полилиниями со сдвигом ~10–20 м
// и они не видят друг друга → две синие линии на одной дороге. Гриди-снэп по
// радиусу (в отличие от фиксированной сетки) фазонезависим: он объединяет такие
// полосы независимо от того, как легли вершины.
//
// 30 м надёжно сливает полосы одной улицы, но НЕ склеивает соседние параллельные
// улицы (обычно ≥40 м между осями).
const MERGE_RADIUS_M = 30;

interface SnapNode { lat: number; lon: number; key: string }

// Гриди-снэппер узлов. Привязывает каждую дорожную вершину к ближайшему уже
// существующему узлу в радиусе R, иначе создаёт новый. В отличие от фиксированной
// сетки нет жёстких границ ячеек — две точки в 15 м всегда сливаются, даже если
// лежат по разные стороны воображаемой клетки.
//
// ВАЖНО: сущности (OLT/муфта/ОРКСП/камера) регистрируются как ЯКОРЯ (addAnchor)
// и НИКОГДА не сливаются друг с другом. Поэтому близко стоящие камеры (даже <30 м)
// остаются отдельными точками с отдельными дропами — радиус влияет только на
// промежуточные дорожные вершины, а не на положение оборудования.
function makeSnapper(R: number) {
  const buckets = new Map<string, SnapNode[]>();
  const fLat = 1 / (R / 111320);
  const fLon = 1 / (R / 81400);
  let seq = 0;
  const bucketKey = (lat: number, lon: number) =>
    `${Math.round(lat * fLat)}_${Math.round(lon * fLon)}`;
  const put = (n: SnapNode) => {
    const k = bucketKey(n.lat, n.lon);
    let arr = buckets.get(k);
    if (!arr) { arr = []; buckets.set(k, arr); }
    arr.push(n);
  };
  const nearest = (lat: number, lon: number): SnapNode | null => {
    const ci = Math.round(lat * fLat), cj = Math.round(lon * fLon);
    let best: SnapNode | null = null;
    let bd = R;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const arr = buckets.get(`${ci + di}_${cj + dj}`);
        if (!arr) continue;
        for (const n of arr) {
          const d = haversineM(lat, lon, n.lat, n.lon);
          if (d < bd) { bd = d; best = n; }
        }
      }
    }
    return best;
  };
  return {
    // Защищённый узел сущности — никогда не сливается с другими.
    addAnchor(lat: number, lon: number): string {
      const n: SnapNode = { lat, lon, key: `a${seq++}` };
      put(n);
      return n.key;
    },
    // Дорожная вершина — привязка к ближайшему узлу в радиусе R или новый узел.
    snap(lat: number, lon: number): string {
      const f = nearest(lat, lon);
      if (f) return f.key;
      const n: SnapNode = { lat, lon, key: `q${seq++}` };
      put(n);
      return n.key;
    },
    // Как snap, но возвращает КАНОНИЧЕСКУЮ координату узла (а не ключ). Нужна
    // для глобального наложения со-трассных кабелей: одинаковые дорожные вершины
    // получают одну и ту же точку → линии ложатся друг на друга, без сдвига.
    snapCoord(lat: number, lon: number): [number, number] {
      const f = nearest(lat, lon);
      if (f) return [f.lat, f.lon];
      const n: SnapNode = { lat, lon, key: `q${seq++}` };
      put(n);
      return [n.lat, n.lon];
    },
  };
}

// Лёгкое упрощение полилинии: выкидываем промежуточные точки ближе ~5 м к
// предыдущей сохранённой (концы всегда остаются). Снижает шум вершин перед
// гриди-снэпом, не теряя геометрию дороги.
function simplifyPath(coords: [number, number][]): [number, number][] {
  if (coords.length < 3) return coords;
  const out: [number, number][] = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const [la, lo] = coords[i];
    const prev = out[out.length - 1];
    if (haversineM(prev[0], prev[1], la, lo) >= 5) out.push([la, lo]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

function pathLength(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}

// Уплотнение полилинии: вставляем точки каждые stepM метров вдоль каждого
// сегмента. Нужно перед глобальным снэпом — у прямой магистрали OSRM оставляет
// всего 2 точки (старт/финиш), снэпать нечего; после уплотнения вдоль неё
// появляются вершины, которые могут лечь на общие узлы соседней нити.
function densify(coords: [number, number][], stepM: number): [number, number][] {
  if (coords.length < 2) return coords;
  const out: [number, number][] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [ay, ax] = coords[i - 1];
    const [by, bx] = coords[i];
    const seg = haversineM(ay, ax, by, bx);
    const n = Math.floor(seg / stepM);
    for (let k = 1; k <= n; k++) {
      const t = (k * stepM) / seg;
      out.push([ay + (by - ay) * t, ax + (bx - ax) * t]);
    }
    out.push([by, bx]);
  }
  return out;
}

// Фикс A — наложение со-трассных кабелей. Слияние работает ВНУТРИ района, поэтому
// распред/питающие/магистрали РАЗНЫХ OLT по одной улице (разные цвета) идут
// сдвинутыми параллельными линиями. Волокна сваривать нельзя (разные PON), но
// геометрия должна совпадать (одна трасса/канализация). Уплотняем каждую линию и
// прогоняем вершины через ЕДИНЫЙ гриди-снэппер: точки соседних нитей в пределах R
// садятся на один узел → линии ложатся друг на друга. Концы (оборудование/муфты)
// оставляем точными. Радиус = MERGE_RADIUS_M (сливает полосы одной улицы, но не
// соседние улицы). Дропы (ОК-4/ОК-8) не трогаем — короткие подводки к камере.
function overlayCoRouted(cables: Cable[], R = MERGE_RADIUS_M): Cable[] {
  const snapper = makeSnapper(R);
  const STEP = 12;
  return cables.map((c) => {
    if (c.type === 'ОК-4' || c.type === 'ОК-8' || c.coords.length < 2) return c;
    const first = c.coords[0];
    const last = c.coords[c.coords.length - 1];
    const dense = densify(c.coords, STEP);
    const snapped: [number, number][] = [first];
    for (let i = 1; i < dense.length - 1; i++) {
      snapped.push(snapper.snapCoord(dense[i][0], dense[i][1]));
    }
    snapped.push(last);
    // Чистим подряд идущие совпавшие вершины (последнюю всегда сохраняем).
    const dd: [number, number][] = [snapped[0]];
    for (let i = 1; i < snapped.length; i++) {
      const p = snapped[i];
      const prev = dd[dd.length - 1];
      if (i === snapped.length - 1 || haversineM(prev[0], prev[1], p[0], p[1]) > 1) dd.push(p);
    }
    if (dd.length < 2) return c;
    return { ...c, coords: dd, lengthM: pathLength(dd) };
  });
}

// Cap at ОК-48 per project requirement — never emit ОК-96.
function pickCableType(fibers: number): CableType {
  for (const t of CABLE_SIZES) {
    if (t === 'ОК-96') continue;
    if (CABLE_FIBERS[t] >= fibers) return t;
  }
  return 'ОК-48';
}

// Cable type for a segment shared by N subscribers.
// - 1 subscriber  → ОК-4 (a normal drop)
// - 2+ subscribers → ОК-8 minimum.  In practice 2×ОК-4 was being emitted
//   for the shared run + 2 short ОК-4 drops after the splice, which looks
//   like "two parallel ОК-4 along a road" to the user.  Using ОК-8 with a
//   muffta-splice into 2 drops is the standard физический design and adds
//   spare fibers for future subscribers along the same road.
function pickSharedCableType(subsCount: number): CableType {
  if (subsCount <= 1) return 'ОК-4';
  const fibers = Math.max(8, subsCount * 2);
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

  // Лёгкое упрощение геометрии всех кабелей (слияние узлов делает гриди-снэппер
  // внутри района, фазонезависимо).
  const snappedCables: Cable[] = cables.map((c) => ({
    ...c,
    coords: simplifyPath(c.coords),
  }));

  // Карта кабелей по конечным точкам — для прохода вверх по иерархии.
  const cableByEndpoint = new Map<string, Cable>();
  for (const c of snappedCables) {
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

    // Свой снэппер узлов на район (OLT). quantize() = привязка точки к узлу.
    const snapper = makeSnapper(MERGE_RADIUS_M);
    const quantize = (lat: number, lon: number) => snapper.snap(lat, lon);

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

    // === Пре-пасс: позиции сущностей + регистрация ЯКОРЕЙ ===
    // Сначала вычисляем эффективную (OSRM-снэпнутую) позицию каждого OLT/муфты/
    // ОРКСП/камеры и регистрируем их как защищённые якоря — ДО построения графа.
    // Иначе две близко стоящие камеры могли бы слиться в один дорожный узел и
    // одна из них потеряла бы свой дроп.
    for (const tb of olt.transitBoxes) {
      const oltTb = cableByEndpoint.get(`${olt.id}::${tb.id}`);
      if (!oltTb || oltTb.coords.length < 2) continue;
      if (!effectivePos.has(olt.id)) effectivePos.set(olt.id, oltTb.coords[0]);
      effectivePos.set(tb.id, oltTb.coords[oltTb.coords.length - 1]);
      for (const ork of tb.orks) {
        const tbOrk = cableByEndpoint.get(`${tb.id}::${ork.id}`);
        if (tbOrk && tbOrk.coords.length >= 2) {
          effectivePos.set(ork.id, tbOrk.coords[tbOrk.coords.length - 1]);
        }
        for (const sub of ork.subscribers) {
          const orkSub = cableByEndpoint.get(`${ork.id}::${sub.id}`);
          if (orkSub && orkSub.coords.length >= 2) {
            effectivePos.set(sub.id, orkSub.coords[orkSub.coords.length - 1]);
          }
        }
      }
    }
    for (const [, co] of effectivePos) snapper.addAnchor(co[0], co[1]);

    // === Регистрируем прохождение каждого абонента по сегментам ===
    // Для каждого абонента склеиваем полный путь OLT→TB→ORK→sub и копим его на
    // каждом сегменте графа (узлы уже привязываются гриди-снэппером к радиусу).
    let hasAnyPath = false;
    for (const tb of olt.transitBoxes) {
      const oltTb = cableByEndpoint.get(`${olt.id}::${tb.id}`);
      if (!oltTb || oltTb.coords.length < 2) continue;
      for (const ork of tb.orks) {
        const tbOrk = cableByEndpoint.get(`${tb.id}::${ork.id}`);
        if (!tbOrk || tbOrk.coords.length < 2) continue;
        for (const sub of ork.subscribers) {
          const orkSub = cableByEndpoint.get(`${ork.id}::${sub.id}`);
          if (!orkSub || orkSub.coords.length < 2) continue;
          usedCableIds.add(oltTb.id);
          usedCableIds.add(tbOrk.id);
          usedCableIds.add(orkSub.id);
          const path: [number, number][] = [
            ...oltTb.coords,
            ...tbOrk.coords.slice(1),
            ...orkSub.coords.slice(1),
          ];
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
        for (const sub of ork.subscribers) {
          const subCoord = effectivePos.get(sub.id) ?? [sub.lat, sub.lon];
          nodeId.set(quantize(subCoord[0], subCoord[1]), sub.id);
        }
      }
    }

    // Размер кабеля: одна точка → ОК-4 (одиночный дроп).
    // 2+ абонента через сегмент → минимум ОК-8 (общий магистральный с
    // муфтой-разветвителем, а не два параллельных ОК-4).
    const segCableType = (s: Segment): CableType =>
      pickSharedCableType(s.subs.size);

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
      const type = pickSharedCableType(subsCount);
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
          let runSubsRef = curSeg.subs;
          while (true) {
            usedSeg.add(curSeg.key);
            const next = otherEnd(curSeg, curNode);
            // Каноническая координата узла (а не локальная копия сегмента): иначе
            // кабели, сходящиеся в один снэпнутый узел, заканчиваются в разных
            // физических точках (до ~радиуса слияния) → визуальные разрывы.
            runCoords.push(nodeCoord.get(next)!);
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

  // Кабели, которые НЕ были покрыты глобальной консолидацией (например, если
  // нет соответствующего OLT→TB→ORK→sub звена), оставляем как есть (со снэпом).
  let passthrough = 0;
  for (const c of snappedCables) {
    if (!usedCableIds.has(c.id)) { outCables.push(c); passthrough++; }
  }

  // ── Страховка связности: «не достаёт» ──────────────────────────────────
  // BFS-консолидация изредка не доводит кабель до терминала (камера/ОРКСП
  // оказывается на снэпнутом узле, чей сегмент схлопнулся или ушёл в чужую
  // цепочку). Тогда оборудование «висит» без кабеля. Проверяем КАЖДУЮ сущность:
  // если она не является концом ни одного итогового кабеля — до-кладываем её
  // исходный родительский кабель (OLT→муфта / муфта→ОРКСП / ОРКСП→камера).
  const reached = new Set<string>();
  const endpoints: { id: string; lat: number; lon: number }[] = [];
  for (const c of outCables) {
    reached.add(c.fromId);
    reached.add(c.toId);
    if (c.coords.length >= 2) {
      endpoints.push({ id: c.fromId, lat: c.coords[0][0], lon: c.coords[0][1] });
      const L = c.coords[c.coords.length - 1];
      endpoints.push({ id: c.toId, lat: L[0], lon: L[1] });
    }
  }
  let patched = 0;
  const addOriginal = (fromId: string, toId: string) => {
    const orig = cableByEndpoint.get(`${fromId}::${toId}`);
    if (!orig || orig.coords.length < 2) return;
    outCables.push({ ...orig, id: `cable-fix-${++cableSeq}` });
    reached.add(fromId);
    reached.add(toId);
    patched++;
  };

  // Фикс C: камеру, до которой BFS не довёл кабель, подключаем КОРОТКИМ дропом от
  // ближайшего конца кабеля/муфты (≤ NEAR_M), а не дублируем полный ОРК→камера
  // поверх магистрали — именно дубль-дроп давал треугольники-циклы у боксов.
  const NEAR_M = 35;
  const nearestEnd = (lat: number, lon: number, exclude: string) => {
    let best: { id: string; lat: number; lon: number } | null = null;
    let bd = NEAR_M;
    for (const e of endpoints) {
      if (e.id === exclude) continue;
      const d = haversineM(lat, lon, e.lat, e.lon);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  for (const d of districts) {
    const olt = d.olt;
    for (const tb of olt.transitBoxes) {
      if (!reached.has(tb.id)) addOriginal(olt.id, tb.id);
      for (const ork of tb.orks) {
        if (!reached.has(ork.id)) addOriginal(tb.id, ork.id);
        for (const sub of ork.subscribers) {
          if (reached.has(sub.id)) continue;
          const near = nearestEnd(sub.lat, sub.lon, sub.id);
          if (near) {
            outCables.push({
              id: `cable-fix-${++cableSeq}`,
              type: 'ОК-4',
              fibers: CABLE_FIBERS['ОК-4'],
              fromId: near.id,
              toId: sub.id,
              coords: [[near.lat, near.lon], [sub.lat, sub.lon]],
              lengthM: haversineM(near.lat, near.lon, sub.lat, sub.lon),
              routedByOSRM: false,
            });
            reached.add(sub.id);
            patched++;
          } else {
            addOriginal(ork.id, sub.id);
          }
        }
      }
    }
  }

  // Фикс A: накладываем со-трассные кабели разных районов на общие дорожные
  // вершины, чтобы они рисовались одной линией, а не сдвинутыми параллелями.
  const finalCables = overlayCoRouted(outCables);

  if (typeof console !== 'undefined') {
    console.log(
      `[Consolidation] in=${cables.length} → out=${finalCables.length} ` +
      `(consolidated=${cableSeq}, joints=${outJoints.length}, passthrough=${passthrough}, fixed=${patched})`,
    );
  }

  return { cables: finalCables, joints: outJoints };
}
