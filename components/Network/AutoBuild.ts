import {
  Subscriber, ORK, TransitBox, OLT, Cable, District, ProjectSettings, DISTRICT_COLORS,
  CABLE_FIBERS, CABLE_SIZES, CableType, SplitterRatio, OntBox,
} from '@/types/network';
import { kmeans, centroid, haversineM } from './KMeans';

let cableIdCounter = 0;
function newCableId() { return `cable-${++cableIdCounter}`; }

// Sergek GPON cascade:
//   OLT (1 порт = 64 камеры)
//   └─ ОМСП-муфта (L1: 1:4 или 1:8)
//        └─ ОРКСП × L1-ratio (L2 такой что L1×L2 = 64)
//             └─ ОНТ-бокс на столбе у каждой камеры (цепочкой по дороге)
//                  └─ Камера
//
// Топология ДЕРЕВО, не звезда: камеры одного ОРКСП соединены цепочкой
// бокс→бокс, а не каждая отдельным дропом от шкафа.

const SPLITTER_RATIO_N: Record<SplitterRatio, number> = {
  '1:2': 2, '1:4': 4, '1:8': 8, '1:16': 16, '1:32': 32, '1:64': 64,
};

// При L1×L2=64 выбор L2 однозначно следует из L1.
function l2For(l1: SplitterRatio): SplitterRatio {
  const total = 64;
  const n = total / SPLITTER_RATIO_N[l1];
  if (n === 2) return '1:2';
  if (n === 4) return '1:4';
  if (n === 8) return '1:8';
  if (n === 16) return '1:16';
  if (n === 32) return '1:32';
  return '1:64';
}

// Минимальный стандартный кабель под N×2 волокон для участка, через который
// проходит N камер ниже по течению.  1 камера → ОК-4 (drop); ≥2 — минимум
// ОК-8 чтобы не плодить параллельные ОК-4 на одной улице.
function cableForCount(downstreamCount: number): CableType {
  if (downstreamCount <= 1) return 'ОК-4';
  const fibers = Math.max(8, downstreamCount * 2);
  for (const t of CABLE_SIZES) {
    if (t === 'ОК-96') continue;
    if (CABLE_FIBERS[t] >= fibers) return t;
  }
  return 'ОК-48';
}

export type OltLocationMap = Record<string, Array<{ lat: number; lon: number }>>;

function slugForId(districtName: string): string {
  return districtName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

// Greedy nearest-neighbour путь: начинаем от точки старта, на каждом шаге
// идём к ближайшей непосещённой камере.  Это аппроксимация trekking-вдоль-
// дороги без учёта геометрии (OSRM далее сгладит, но порядок камер уже
// будет линейным, а не «звезда от шкафа»).
function greedyChain(
  start: { lat: number; lon: number },
  pts: Subscriber[],
): Subscriber[] {
  const remaining = [...pts];
  const out: Subscriber[] = [];
  let cur = start;
  while (remaining.length > 0) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineM(cur.lat, cur.lon, remaining[i].lat, remaining[i].lon);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    const next = remaining.splice(bestI, 1)[0];
    out.push(next);
    cur = next;
  }
  return out;
}

// Build the network rooted at a single OLT for one (sub-)district.
// Subscribers are partitioned into groups of ≤ maxSubsPerOltPort (64 default);
// each group gets its own L1-муфта + N×ОРКСП cascade.
function buildSingleOlt(
  districtName: string,
  color: string,
  subs: Subscriber[],
  oltPos: { lat: number; lon: number },
  oltSuffix: string,
  settings: ProjectSettings,
  cables: Cable[],
  ontBoxes: OntBox[],
): District {
  const slug = slugForId(districtName);
  const olt: OLT = {
    id: `OLT-${slug}${oltSuffix}`,
    lat: oltPos.lat,
    lon: oltPos.lon,
    district: districtName,
    model: 'Huawei MA5800-X7',
    capacity: 64,
    transitBoxes: [],
    l1Splitter: settings.l1SplitterDefault ?? '1:4',
  };

  const maxPerPort = settings.maxSubsPerOltPort ?? 64;
  const L1: SplitterRatio = settings.l1SplitterDefault ?? '1:4';
  const L2: SplitterRatio = l2For(L1);
  const orkspPerPort = SPLITTER_RATIO_N[L1];      // 4 или 8
  const subsPerOrksp = SPLITTER_RATIO_N[L2];      // 16 или 8

  // ── 1. Разбиваем абонентов на порты OLT по ≤64 ──
  // kmeans по геопозиции — порты идут по компактным группам, не случайным.
  const portCount = Math.max(1, Math.ceil(subs.length / maxPerPort));
  const portGroups: Subscriber[][] = [];
  if (portCount === 1) {
    portGroups.push(subs);
  } else {
    const { clusters } = kmeans(
      subs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })),
      portCount,
    );
    for (const cluster of clusters) {
      const group = cluster
        .map((p) => subs.find((s) => s.id === p.id))
        .filter(Boolean) as Subscriber[];
      if (group.length > 0) portGroups.push(group);
    }
  }

  const transitBoxes: TransitBox[] = [];
  const allUpdatedSubs: Subscriber[] = [];

  for (let portIdx = 0; portIdx < portGroups.length; portIdx++) {
    const portSubs = portGroups[portIdx];
    if (portSubs.length === 0) continue;

    // ── 2. Муфта L1 — в точке, ближайшей к OLT по обходу группы ──
    // Берём камеру группы, ближайшую к OLT, и муфту ставим вдоль линии
    // OLT→первая камера: на 15% пути от первой камеры к OLT.
    let nearest = portSubs[0];
    let nearestD = haversineM(nearest.lat, nearest.lon, olt.lat, olt.lon);
    for (const s of portSubs) {
      const d = haversineM(s.lat, s.lon, olt.lat, olt.lon);
      if (d < nearestD) { nearestD = d; nearest = s; }
    }
    const tbLat = nearest.lat + (olt.lat - nearest.lat) * 0.15;
    const tbLon = nearest.lon + (olt.lon - nearest.lon) * 0.15;

    const tbId = `Муфта-${slug}${oltSuffix}-${portIdx + 1}`;

    // ── 3. Разбиваем камеры порта на orkspPerPort групп через kmeans ──
    const orkClusterCount = Math.min(orkspPerPort, Math.max(1, Math.ceil(portSubs.length / subsPerOrksp)));
    const { clusters: orkClusters } = orkClusterCount === 1
      ? { clusters: [portSubs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id }))] }
      : kmeans(portSubs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })), orkClusterCount);

    const orks: ORK[] = [];

    for (let orkIdx = 0; orkIdx < orkClusters.length; orkIdx++) {
      const cluster = orkClusters[orkIdx];
      if (cluster.length === 0) continue;
      const orkSubsRaw: Subscriber[] = cluster
        .map((p) => portSubs.find((s) => s.id === p.id))
        .filter(Boolean) as Subscriber[];

      // ── 4. Сортируем камеры жадным NN-обходом от муфты ──
      // ОРКСП поставим на первую камеру цепочки (ближайшую к муфте по NN).
      const chain = greedyChain({ lat: tbLat, lon: tbLon }, orkSubsRaw);
      if (chain.length === 0) continue;
      const orkAnchor = { lat: chain[0].lat, lon: chain[0].lon };

      const orkId = `ОРКСП-${slug}${oltSuffix}-${portIdx + 1}-${orkIdx + 1}`;
      const updatedChain = chain.map((s) => ({ ...s, orkId }));

      orks.push({
        id: orkId,
        lat: orkAnchor.lat,
        lon: orkAnchor.lon,
        district: districtName,
        splitter: L2,
        tbId,
        subscribers: updatedChain,
        cableType: 'ОК-4',
        boxType: subsPerOrksp >= 16 ? 'ОРКСп-16' : 'Бокс-16',
      });
      allUpdatedSubs.push(...updatedChain);

      // ── 5. Кабель Муфта → ОРКСП (несёт все камеры этой ветки) ──
      const orkTrunkType = cableForCount(updatedChain.length);
      cables.push(makeCable(orkTrunkType, tbId, orkId, [
        [tbLat, tbLon], [orkAnchor.lat, orkAnchor.lon],
      ]));

      // ── 6. Цепочка ОНТ-бокс→ОНТ-бокс вдоль камер ──
      // На каждой камере — свой бокс (тех. сущность OntBox).
      // Кабель между боксами несёт "вниз по течению" объём.
      for (let i = 0; i < updatedChain.length; i++) {
        const sub = updatedChain[i];
        const boxId = `BOX-${slug}${oltSuffix}-${portIdx + 1}-${orkIdx + 1}-${i + 1}`;
        ontBoxes.push({
          id: boxId,
          lat: sub.lat,
          lon: sub.lon,
          subscriberId: sub.id,
          orkspId: orkId,
        });

        if (i === 0) {
          // Первый бокс ко-локализован с ОРКСП — кабель ОРКСП→box несёт всю ветку.
          cables.push(makeCable(orkTrunkType, orkId, boxId, [
            [orkAnchor.lat, orkAnchor.lon], [sub.lat, sub.lon],
          ]));
        } else {
          // Транзит box[i-1] → box[i]: камер начиная с i.
          const prevSub = updatedChain[i - 1];
          const prevBoxId = `BOX-${slug}${oltSuffix}-${portIdx + 1}-${orkIdx + 1}-${i}`;
          const transitType = cableForCount(updatedChain.length - i);
          cables.push(makeCable(transitType, prevBoxId, boxId, [
            [prevSub.lat, prevSub.lon], [sub.lat, sub.lon],
          ]));
        }
      }
    }

    transitBoxes.push({
      id: tbId,
      lat: tbLat,
      lon: tbLon,
      district: districtName,
      oltId: olt.id,
      orks,
      inCable: cableForCount(portSubs.length),
      outCable: 'ОК-4',
      muftaType: 'МТОК-96А',
    });

    // ── 7. Магистральный кабель OLT → Муфта L1 (несёт все камеры порта) ──
    cables.push(makeCable(cableForCount(portSubs.length), olt.id, tbId, [
      [olt.lat, olt.lon], [tbLat, tbLon],
    ]));
  }

  olt.transitBoxes = transitBoxes;

  return {
    name: districtName,
    color,
    olt,
    subscribers: allUpdatedSubs,
  };
}

export function buildNetwork(
  subscribers: Subscriber[],
  settings: ProjectSettings,
  oltLocations: OltLocationMap = {},
): { districts: District[]; cables: Cable[]; ontBoxes: OntBox[] } {
  cableIdCounter = 0;

  const byDistrict = new Map<string, Subscriber[]>();
  for (const sub of subscribers) {
    if (!byDistrict.has(sub.district)) byDistrict.set(sub.district, []);
    byDistrict.get(sub.district)!.push(sub);
  }

  const districts: District[] = [];
  const cables: Cable[] = [];
  const ontBoxes: OntBox[] = [];
  let colorIdx = 0;

  for (const [districtName, subs] of byDistrict.entries()) {
    const overrides = oltLocations[districtName] ?? [];
    const baseColor = DISTRICT_COLORS[colorIdx % DISTRICT_COLORS.length];
    colorIdx++;

    if (overrides.length <= 1) {
      const oltPos = overrides[0]
        ?? centroid(subs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })));
      districts.push(buildSingleOlt(districtName, baseColor, subs, oltPos, '', settings, cables, ontBoxes));
      continue;
    }

    // Multiple OLTs: Voronoi → sub-districts
    const groups: Subscriber[][] = overrides.map(() => []);
    for (const s of subs) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < overrides.length; i++) {
        const d = haversineM(s.lat, s.lon, overrides[i].lat, overrides[i].lon);
        if (d < bestD) { bestD = d; best = i; }
      }
      groups[best].push(s);
    }

    for (let i = 0; i < overrides.length; i++) {
      const groupSubs = groups[i];
      if (groupSubs.length === 0) continue;
      const subDistrictName = `${districtName}-${i + 1}`;
      const subColor = DISTRICT_COLORS[(colorIdx + i) % DISTRICT_COLORS.length];
      districts.push(buildSingleOlt(
        subDistrictName,
        subColor,
        groupSubs,
        overrides[i],
        '',
        settings,
        cables,
        ontBoxes,
      ));
    }
    colorIdx += overrides.length - 1;
  }

  return { districts, cables, ontBoxes };
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
