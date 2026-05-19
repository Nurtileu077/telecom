import {
  Subscriber, ORK, TransitBox, OLT, Cable, District, ProjectSettings, DISTRICT_COLORS,
  CABLE_FIBERS, CableType, SplitterRatio, OntBox,
} from '@/types/network';
import { kmeans, centroid, haversineM, clusterForOrkGroups } from './KMeans';
import {
  SERGEK_PORT_CAPACITY,
  CABLE_OLT_FEEDER,
  CABLE_L1_BRANCH,
  pickOrkChainCableType,
} from './SergekTopology';

let cableIdCounter = 0;
function newCableId() { return `cable-${++cableIdCounter}`; }

const SPLITTER_RATIO_N: Record<SplitterRatio, number> = {
  '1:2': 2, '1:4': 4, '1:8': 8, '1:16': 16, '1:32': 32, '1:64': 64,
};

function l2For(l1: SplitterRatio): SplitterRatio {
  const n = SERGEK_PORT_CAPACITY / SPLITTER_RATIO_N[l1];
  if (n === 2) return '1:2';
  if (n === 4) return '1:4';
  if (n === 8) return '1:8';
  if (n === 16) return '1:16';
  if (n === 32) return '1:32';
  return '1:64';
}

export type OltLocationMap = Record<string, Array<{ lat: number; lon: number }>>;

function slugForId(districtName: string): string {
  return districtName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

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
  const L1: SplitterRatio = settings.l1SplitterDefault ?? '1:8';
  const L2: SplitterRatio = l2For(L1);
  const orkspPerPort = SPLITTER_RATIO_N[L1];
  const subsPerOrksp = SPLITTER_RATIO_N[L2];
  const maxPerPort = settings.maxSubsPerOltPort ?? SERGEK_PORT_CAPACITY;

  const olt: OLT = {
    id: `OLT-${slug}${oltSuffix}`,
    lat: oltPos.lat,
    lon: oltPos.lon,
    district: districtName,
    model: 'Huawei MA5800-X7',
    capacity: SERGEK_PORT_CAPACITY,
    transitBoxes: [],
    l1Splitter: L1,
  };

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

    let nearest = portSubs[0];
    let nearestD = haversineM(nearest.lat, nearest.lon, olt.lat, olt.lon);
    for (const s of portSubs) {
      const d = haversineM(s.lat, s.lon, olt.lat, olt.lon);
      if (d < nearestD) { nearestD = d; nearest = s; }
    }
    const tbLat = nearest.lat + (olt.lat - nearest.lat) * 0.15;
    const tbLon = nearest.lon + (olt.lon - nearest.lon) * 0.15;
    const tbId = `Муфта-${slug}${oltSuffix}-${portIdx + 1}`;

    const portPoints = portSubs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id }));
    const orkClusters = clusterForOrkGroups(portPoints, subsPerOrksp, orkspPerPort);

    const orks: ORK[] = [];

    for (let orkIdx = 0; orkIdx < orkClusters.length; orkIdx++) {
      const cluster = orkClusters[orkIdx];
      if (cluster.length === 0) continue;
      const orkSubsRaw: Subscriber[] = cluster
        .map((p) => portSubs.find((s) => s.id === p.id))
        .filter(Boolean) as Subscriber[];

      const orkCent = centroid(
        orkSubsRaw.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })),
      );
      const chain = greedyChain(orkCent, orkSubsRaw);
      if (chain.length === 0) continue;
      const orkAnchor = orkCent;
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
        cableType: pickOrkChainCableType(updatedChain.length),
        boxType: subsPerOrksp >= 16 ? 'ОРКСп-16' : 'Бокс-16',
      });
      allUpdatedSubs.push(...updatedChain);

      cables.push(makeCable(CABLE_L1_BRANCH, tbId, orkId, [
        [tbLat, tbLon], [orkAnchor.lat, orkAnchor.lon],
      ]));

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

        const remaining = updatedChain.length - i;
        const hopType = pickOrkChainCableType(remaining);

        if (i === 0) {
          cables.push(makeCable(pickOrkChainCableType(updatedChain.length), orkId, boxId, [
            [orkAnchor.lat, orkAnchor.lon], [sub.lat, sub.lon],
          ]));
        } else {
          const prevSub = updatedChain[i - 1];
          const prevBoxId = `BOX-${slug}${oltSuffix}-${portIdx + 1}-${orkIdx + 1}-${i}`;
          cables.push(makeCable(hopType, prevBoxId, boxId, [
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
      inCable: CABLE_OLT_FEEDER,
      outCable: CABLE_L1_BRANCH,
      muftaType: 'МТОК-96А',
    });

    cables.push(makeCable(CABLE_OLT_FEEDER, olt.id, tbId, [
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
      districts.push(buildSingleOlt(
        `${districtName}-${i + 1}`,
        DISTRICT_COLORS[(colorIdx + i) % DISTRICT_COLORS.length],
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
