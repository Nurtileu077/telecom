import {
  Subscriber, ORK, TransitBox, OLT, Cable, District, ProjectSettings, DISTRICT_COLORS,
  CABLE_FIBERS, selectCableType, StreetMufta,
} from '@/types/network';
import { kmeans, centroid, haversineM } from './KMeans';

let cableIdCounter = 0;
function newCableId() { return `cable-${++cableIdCounter}`; }

export function buildNetwork(
  subscribers: Subscriber[],
  settings: ProjectSettings
): { districts: District[]; cables: Cable[] } {
  cableIdCounter = 0;

  const byDistrict = new Map<string, Subscriber[]>();
  for (const sub of subscribers) {
    if (!byDistrict.has(sub.district)) byDistrict.set(sub.district, []);
    byDistrict.get(sub.district)!.push(sub);
  }

  const districts: District[] = [];
  const cables: Cable[] = [];
  let colorIdx = 0;

  for (const [districtName, subs] of byDistrict.entries()) {
    const color = DISTRICT_COLORS[colorIdx % DISTRICT_COLORS.length];
    colorIdx++;

    const oltPos = centroid(subs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })));
    const olt: OLT = {
      id: `OLT-${districtName.slice(0, 8).replace(/\s/g, '')}`,
      lat: oltPos.lat,
      lon: oltPos.lon,
      district: districtName,
      model: 'Huawei MA5800-X7',
      capacity: 64,
      transitBoxes: [],
      l1Splitter: '1:4',
    };

    // Cluster subscribers into ORKs
    const kOrk = Math.max(1, Math.ceil(subs.length / settings.maxPerORK));
    const { clusters: orkClusters } = kmeans(
      subs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })),
      kOrk
    );

    const orks: ORK[] = [];
    const updatedSubs: Subscriber[] = [];

    for (let i = 0; i < orkClusters.length; i++) {
      const cluster = orkClusters[i];
      if (cluster.length === 0) continue;
      const orkCenter = centroid(cluster);
      const orkId = `Бокс-${districtName.slice(0, 4).replace(/\s/g, '')}-${i + 1}`;
      const splitter: '1:4' | '1:8' | '1:16' =
        cluster.length <= 4 ? '1:4' : cluster.length <= 8 ? '1:8' : '1:16';

      // Find original subscribers for this cluster
      const orkSubs: Subscriber[] = cluster
        .map((p) => subs.find((s) => s.id === p.id))
        .filter(Boolean) as Subscriber[];

      const updatedOrkSubs = orkSubs.map((s) => ({ ...s, orkId }));
      updatedSubs.push(...updatedOrkSubs);

      const orkSubCount = updatedOrkSubs.length;
      orks.push({
        id: orkId,
        lat: orkCenter.lat,
        lon: orkCenter.lon,
        district: districtName,
        splitter,
        tbId: '',
        subscribers: updatedOrkSubs,
        cableType: selectCableType(orkSubCount),
        boxType: orkSubCount <= 4 ? 'Бокс-8' : orkSubCount <= 8 ? 'Бокс-16' : 'ОРКСп-16',
      });
    }

    // Cluster ORKs into Transit Boxes
    const kTB = Math.max(1, Math.ceil(orks.length / settings.maxORKperTB));
    const { clusters: tbClusters } = kmeans(
      orks.map((o) => ({ lat: o.lat, lon: o.lon, id: o.id })),
      kTB
    );

    const transitBoxes: TransitBox[] = [];

    for (let i = 0; i < tbClusters.length; i++) {
      const cluster = tbClusters[i];
      if (cluster.length === 0) continue;
      const tbCenter = centroid(cluster);
      const tbId = `Муфта-${districtName.slice(0, 4).replace(/\s/g, '')}-${i + 1}`;

      const tbOrks = cluster
        .map((p) => orks.find((o) => o.id === p.id))
        .filter(Boolean) as ORK[];

      const updatedTBOrks = tbOrks.map((o) => ({ ...o, tbId }));
      // Update orks array references
      for (const o of updatedTBOrks) {
        const idx = orks.findIndex((x) => x.id === o.id);
        if (idx >= 0) orks[idx] = o;
      }

      const tbSubCount = updatedTBOrks.reduce((s, o) => s + o.subscribers.length, 0);
      const tbCableType = selectCableType(tbSubCount);

      const tb: TransitBox = {
        id: tbId,
        lat: tbCenter.lat,
        lon: tbCenter.lon,
        district: districtName,
        oltId: olt.id,
        orks: updatedTBOrks,
        inCable: tbCableType,
        outCable: 'ОК-8',
        muftaType: 'МТОК-96А',
      };
      transitBoxes.push(tb);

      // Cable: OLT → TB
      cables.push(makeCable(tbCableType, olt.id, tbId, [
        [olt.lat, olt.lon], [tb.lat, tb.lon]
      ]));

      // MST (Prim): каждый ОРК подключается к ближайшему уже подключённому узлу
      // (муфте или другому ОРК). Нет петель, нет задвоений на одной улице.
      const mstEdges = buildOrkMST(tbId, tb.lat, tb.lon, updatedTBOrks);
      for (const edge of mstEdges) {
        const segType = selectCableType(edge.downstreamSubs);
        cables.push(makeCable(segType, edge.fromId, edge.toId, [
          [edge.fromLat, edge.fromLon],
          [edge.toOrk.lat, edge.toOrk.lon],
        ]));
      }

      // Отводы: при ≥2 абонентах — цепочка с соединительными муфтами между соседями по углу от ОРК
      for (const ork of updatedTBOrks) {
        buildOrkSubscriberDrops(ork, cables, makeCable);
      }
    }

    olt.transitBoxes = transitBoxes;

    districts.push({
      name: districtName,
      color,
      olt,
      subscribers: updatedSubs,
    });
  }

  return { districts, cables };
}

function midpointLL(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

/** Порядок абонентов вдоль «улицы»: по азимуту от ОРК. */
function sortSubscribersByAngleFromOrk(ork: { lat: number; lon: number }, subs: Subscriber[]): Subscriber[] {
  return [...subs].sort((a, b) => {
    const ang = (s: Subscriber) => Math.atan2(s.lon - ork.lon, s.lat - ork.lat);
    return ang(a) - ang(b);
  });
}

/**
 * Один абонент — прямой дроп. Несколько — цепочка ОРК→B₀→…→Bₙ₋₁ с дропами Bᵢ→sᵢ,
 * B₀ между ОРК и s₀, Bᵢ между sᵢ₋₁ и sᵢ (соединительные муфты «между абонентами»).
 */
function buildOrkSubscriberDrops(
  ork: ORK,
  cables: Cable[],
  mk: typeof makeCable,
) {
  const subs = ork.subscribers;
  if (subs.length === 0) {
    ork.streetMuftas = [];
    return;
  }
  if (subs.length === 1) {
    const sub = subs[0];
    ork.streetMuftas = [];
    cables.push(mk('ОК-4', ork.id, sub.id, [[ork.lat, ork.lon], [sub.lat, sub.lon]]));
    return;
  }

  const ordered = sortSubscribersByAngleFromOrk(ork, subs);
  const n = ordered.length;
  const Branches: StreetMufta[] = [];
  const bid = (k: number) => `МС-${ork.id}-${k}`;
  Branches.push({ id: bid(0), ...midpointLL(ork, ordered[0]) });
  for (let k = 1; k < n; k++) {
    Branches.push({ id: bid(k), ...midpointLL(ordered[k - 1], ordered[k]) });
  }
  ork.streetMuftas = Branches;

  const B = Branches;
  cables.push(mk(selectCableType(n), ork.id, B[0].id, [[ork.lat, ork.lon], [B[0].lat, B[0].lon]]));
  for (let k = 0; k < n - 1; k++) {
    const downstream = n - k - 1;
    cables.push(mk(selectCableType(downstream), B[k].id, B[k + 1].id, [
      [B[k].lat, B[k].lon], [B[k + 1].lat, B[k + 1].lon],
    ]));
  }
  for (let k = 0; k < n; k++) {
    cables.push(mk('ОК-4', B[k].id, ordered[k].id, [
      [B[k].lat, B[k].lon], [ordered[k].lat, ordered[k].lon],
    ]));
  }
}

// ---------------------------------------------------------------------------
// MST — алгоритм Прима для топологии TB→ОРК
// ---------------------------------------------------------------------------

type MSTEdge = {
  fromId: string; fromLat: number; fromLon: number;
  toId: string;   toOrk: ORK;
  downstreamSubs: number;
};

/**
 * Минимальное остовное дерево (Prim) для набора ОРК с корнем в муфте.
 * Каждый ОРК подключается к ближайшему уже подключённому узлу —
 * узлы на противоположных сторонах дороги не тянут кабель «через весь квартал».
 * После построения дерева вычисляем нагрузку «вниз по дереву»
 * для правильного выбора сечения кабеля на каждом звене.
 */
function buildOrkMST(
  tbId: string, tbLat: number, tbLon: number,
  orks: ORK[],
): MSTEdge[] {
  if (orks.length === 0) return [];

  type Node = { id: string; lat: number; lon: number };

  const inTree: Node[] = [{ id: tbId, lat: tbLat, lon: tbLon }];
  const notInTree: Node[] = orks.map((o) => ({ id: o.id, lat: o.lat, lon: o.lon }));
  const parentOf = new Map<string, Node>(); // orkId → parent node
  const orkById = new Map(orks.map((o) => [o.id, o]));

  while (notInTree.length > 0) {
    let bestDist = Infinity;
    let bestFromNode: Node | null = null;
    let bestCandIdx = -1;

    for (let ci = 0; ci < notInTree.length; ci++) {
      const cand = notInTree[ci];
      for (const tn of inTree) {
        const d = haversineM(tn.lat, tn.lon, cand.lat, cand.lon);
        if (d < bestDist) { bestDist = d; bestFromNode = tn; bestCandIdx = ci; }
      }
    }
    if (bestCandIdx < 0 || !bestFromNode) break;

    const next = notInTree.splice(bestCandIdx, 1)[0];
    parentOf.set(next.id, bestFromNode);
    inTree.push(next);
  }

  // Дерево детей: parentId → [childId, …]
  const children = new Map<string, string[]>();
  for (const [child, par] of parentOf) {
    const list = children.get(par.id) ?? [];
    list.push(child);
    children.set(par.id, list);
  }

  // Рекурсивный подсчёт абонентов «вниз» по поддереву
  function subtreeSubs(nodeId: string): number {
    const ork = orkById.get(nodeId);
    const own = ork ? ork.subscribers.length : 0;
    return own + (children.get(nodeId) ?? []).reduce((s, kid) => s + subtreeSubs(kid), 0);
  }

  // Собираем рёбра
  const edges: MSTEdge[] = [];
  const nodeById = new Map(inTree.map((n) => [n.id, n]));

  for (const [childId, parentNode] of parentOf) {
    const ork = orkById.get(childId)!;
    edges.push({
      fromId: parentNode.id,
      fromLat: parentNode.lat,
      fromLon: parentNode.lon,
      toId: childId,
      toOrk: ork,
      downstreamSubs: subtreeSubs(childId),
    });
  }

  return edges;
}

function makeCable(
  type: Cable['type'],
  fromId: string,
  toId: string,
  coords: [number, number][]
): Cable {
  const lengthM = coords.length >= 2
    ? haversineM(coords[0][0], coords[0][1], coords[coords.length - 1][0], coords[coords.length - 1][1])
    : 0;
  return {
    id: newCableId(),
    type,
    fibers: CABLE_FIBERS[type],
    fromId,
    toId,
    coords,
    lengthM,
    routedByOSRM: false,
  };
}
