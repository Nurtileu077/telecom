import {
  Subscriber, ORK, TransitBox, OLT, Cable, District, ProjectSettings, DISTRICT_COLORS,
  CABLE_FIBERS, CableType, SplitterRatio, OntBox,
} from '@/types/network';
import { kmeans, centroid, haversineM } from './KMeans';

let cableIdCounter = 0;
function newCableId() { return `cable-${++cableIdCounter}`; }

// Sergek GPON cascade (физическая модель оператора):
//   OLT (1 порт = до 64 камер)
//   └─ Муфта L1 (сплиттер по числу веток-ОРКСП)
//        └─ ОРКСП — пассивный паук 1:16, ПРИХОДИТ 1 жила (ОК-4),
//           внутри делится на порты (до 8 камер на корпус)
//             └─ ОНТ-бокс на столбе у каждой камеры (цепочкой по дороге)
//                  └─ Камера (2 волокна: рабочее + резерв)
//
// Жёсткие лимиты:
const MAX_CAMERAS_PER_ORKSP = 8;   // L2: до 8 камер на корпус ОРКСП
const MAX_ORKSP_PER_MUFTA   = 16;  // L1: до 16 веток на муфту
const MAX_CAMERAS_PER_PORT  = 64;  // порт OLT

// OLT → Муфта: 1 жила на каждую ветку-ОРКСП.  Жильность по ЧИСЛУ ОРКСП,
// НЕ по числу камер (это был баг с ОК-48 — считали по камерам).
function cableForBranches(orkCount: number): CableType {
  if (orkCount <= 4)  return 'ОК-4';
  if (orkCount <= 8)  return 'ОК-8';
  if (orkCount <= 12) return 'ОК-12';
  return 'ОК-16'; // 13-16
}

// L1-сплиттер на муфте — по числу веток-ОРКСП.
function l1ForBranches(orkCount: number): SplitterRatio {
  if (orkCount <= 4) return '1:4';
  if (orkCount <= 8) return '1:8';
  return '1:16'; // 9-16
}

// Цепочка ОРКСП → бокс → камера: жильность по числу камер «ниже по течению»
// (сколько камер обслуживает этот участок к концу цепочки).
//   1–2 камеры → ОК-4 · 3–4 → ОК-8 · 5–6 → ОК-12 · 7–8 → ОК-16.
function cableForChain(downstreamCameras: number): CableType {
  if (downstreamCameras <= 2) return 'ОК-4';
  if (downstreamCameras <= 4) return 'ОК-8';
  if (downstreamCameras <= 6) return 'ОК-12';
  return 'ОК-16'; // 7-8
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
    l1Splitter: '1:8',
  };

  const maxPerPort = settings.maxSubsPerOltPort ?? MAX_CAMERAS_PER_PORT;

  // ── 1. Разбиваем абонентов на порты OLT по ≤64 ──
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

    // ── 2. Сколько ОРКСП нужно: по 8 камер на корпус, до 16 веток ──
    const orkCount = Math.min(
      MAX_ORKSP_PER_MUFTA,
      Math.max(1, Math.ceil(portSubs.length / MAX_CAMERAS_PER_ORKSP)),
    );
    const L1: SplitterRatio = l1ForBranches(orkCount);
    olt.l1Splitter = L1;

    // ── 3. Муфта L1 — ближе к OLT, на магистрали (15% пути к группе) ──
    let nearest = portSubs[0];
    let nearestD = haversineM(nearest.lat, nearest.lon, olt.lat, olt.lon);
    for (const s of portSubs) {
      const d = haversineM(s.lat, s.lon, olt.lat, olt.lon);
      if (d < nearestD) { nearestD = d; nearest = s; }
    }
    const tbLat = nearest.lat + (olt.lat - nearest.lat) * 0.15;
    const tbLon = nearest.lon + (olt.lon - nearest.lon) * 0.15;
    const tbId = `Муфта-${slug}${oltSuffix}-${portIdx + 1}`;

    // ── 4. Кластеризуем камеры порта в orkCount групп ──
    const { clusters: orkClusters } = orkCount === 1
      ? { clusters: [portSubs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id }))] }
      : kmeans(portSubs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })), orkCount);

    const orks: ORK[] = [];

    for (let orkIdx = 0; orkIdx < orkClusters.length; orkIdx++) {
      const cluster = orkClusters[orkIdx];
      if (cluster.length === 0) continue;
      const orkSubsRaw: Subscriber[] = cluster
        .map((p) => portSubs.find((s) => s.id === p.id))
        .filter(Boolean) as Subscriber[];

      // ── 5. ОРКСП в ЦЕНТРОИДЕ группы камер (не на первой камере) ──
      const orkAnchor = centroid(orkSubsRaw.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })));

      // Цепочку камер обходим жадным NN, стартуя от центроида ОРКСП.
      const chain = greedyChain(orkAnchor, orkSubsRaw);
      if (chain.length === 0) continue;

      const orkId = `ОРКСП-${slug}${oltSuffix}-${portIdx + 1}-${orkIdx + 1}`;
      const updatedChain = chain.map((s) => ({ ...s, orkId }));

      orks.push({
        id: orkId,
        lat: orkAnchor.lat,
        lon: orkAnchor.lon,
        district: districtName,
        splitter: '1:16',                 // ОРКСП — пассивный паук 1:16
        tbId,
        subscribers: updatedChain,
        cableType: 'ОК-4',
        boxType: 'ОРКСп-16',
      });
      allUpdatedSubs.push(...updatedChain);

      // ── 6. Муфта → ОРКСП: ВСЕГДА ОК-4 (одна жила варится в муфте) ──
      cables.push(makeCable('ОК-4', tbId, orkId, [
        [tbLat, tbLon], [orkAnchor.lat, orkAnchor.lon],
      ]));

      // ── 7. Цепочка ОРКСП → бокс → … → камера ──
      // Каждая камера = ОНТ-бокс на столбе.  Кабель сегмента — по числу
      // камер ниже по течению (от ОРКСП к концу цепочки убывает).
      for (let i = 0; i < updatedChain.length; i++) {
        const sub = updatedChain[i];
        const boxId = `BOX-${slug}${oltSuffix}-${portIdx + 1}-${orkIdx + 1}-${i + 1}`;
        ontBoxes.push({
          id: boxId, lat: sub.lat, lon: sub.lon,
          subscriberId: sub.id, orkspId: orkId,
        });

        const downstream = updatedChain.length - i; // камер на этом участке
        if (i === 0) {
          // ОРКСП → первый бокс: несёт ВСЕ камеры цепочки.
          cables.push(makeCable(cableForChain(downstream), orkId, boxId, [
            [orkAnchor.lat, orkAnchor.lon], [sub.lat, sub.lon],
          ]));
        } else {
          const prevSub = updatedChain[i - 1];
          const prevBoxId = `BOX-${slug}${oltSuffix}-${portIdx + 1}-${orkIdx + 1}-${i}`;
          cables.push(makeCable(cableForChain(downstream), prevBoxId, boxId, [
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
      inCable: cableForBranches(orks.length),
      outCable: 'ОК-4',
      muftaType: 'МТОК-96А',
    });

    // ── 8. Магистраль OLT → Муфта L1: жильность по числу веток-ОРКСП ──
    cables.push(makeCable(cableForBranches(orks.length), olt.id, tbId, [
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
