import {
  Subscriber, ORK, TransitBox, OLT, Cable, District, ProjectSettings, DISTRICT_COLORS,
  CABLE_FIBERS, CABLE_SIZES, selectCableType, OBJECT_FIBERS, CableType,
} from '@/types/network';
import { kmeans, centroid, haversineM } from './KMeans';

// Select cable type in P2P mode: based on actual total fibers needed by downstream objects
function selectCableByFibers(subs: Subscriber[]): CableType {
  const total = subs.reduce((sum, s) => {
    const obj = OBJECT_FIBERS[s.objectType ?? 'абонент'];
    return sum + obj.working + obj.spare;
  }, 0);
  return CABLE_SIZES.find((t) => CABLE_FIBERS[t] >= total) ?? 'ОК-96';
}

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

    const isP2P = settings.networkType === 'p2p';

    // In P2P mode all objects cluster into Боксы with dedicated fibers (no splitters)
    // In GPON mode: separate P2P subscribers, route them directly
    const p2pSubs = !isP2P ? subs.filter((s) => s.connectionType === 'p2p') : [];
    const gponSubs = !isP2P ? subs.filter((s) => s.connectionType !== 'p2p') : [];
    const clusterSubs = isP2P ? subs : (gponSubs.length > 0 ? gponSubs : subs);

    const oltPos = centroid(clusterSubs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })));
    const nodePrefix = isP2P ? 'УС' : 'OLT';
    const olt: OLT = {
      id: `${nodePrefix}-${districtName.slice(0, 8).replace(/\s/g, '')}`,
      lat: oltPos.lat,
      lon: oltPos.lon,
      district: districtName,
      model: 'Huawei MA5800-X7',
      capacity: 64,
      transitBoxes: [],
      l1Splitter: '1:4',
    };

    // P2P subscribers: direct cable OLT → subscriber (no ORK, no splitter)
    for (const sub of p2pSubs) {
      cables.push(makeCable('ОК-4', olt.id, sub.id, [
        [olt.lat, olt.lon], [sub.lat, sub.lon],
      ]));
    }

    // Cluster GPON subscribers into ORKs
    const kOrk = Math.max(1, Math.ceil(clusterSubs.length / settings.maxPerORK));
    const { clusters: orkClusters } = kmeans(
      clusterSubs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })),
      kOrk
    );

    const orks: ORK[] = [];
    const updatedSubs: Subscriber[] = [];

    for (let i = 0; i < orkClusters.length; i++) {
      const cluster = orkClusters[i];
      if (cluster.length === 0) continue;
      const orkCenter = centroid(cluster);
      const orkId = `Бокс-${districtName.slice(0, 4).replace(/\s/g, '')}-${i + 1}`;

      // Find original subscribers for this cluster
      const orkSubs: Subscriber[] = cluster
        .map((p) => clusterSubs.find((s) => s.id === p.id))
        .filter(Boolean) as Subscriber[];

      const updatedOrkSubs = orkSubs.map((s) => ({ ...s, orkId }));
      updatedSubs.push(...updatedOrkSubs);

      const orkSubCount = updatedOrkSubs.length;
      // Cameras always use 1:8 splitter; mixed clusters use normal logic
      const hasMostlyCameras = updatedOrkSubs.filter((s) => s.objectType === 'камера').length > orkSubCount / 2;
      const effectiveSplitter: '1:4' | '1:8' | '1:16' = hasMostlyCameras
        ? '1:8'
        : cluster.length <= 4 ? '1:4' : cluster.length <= 8 ? '1:8' : '1:16';
      orks.push({
        id: orkId,
        lat: orkCenter.lat,
        lon: orkCenter.lon,
        district: districtName,
        splitter: effectiveSplitter,
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
      // Bias TB toward OLT: include OLT position in centroid so the muft is placed
      // on the OLT-facing side of the cluster, avoiding cable backtracking
      const tbCenter = centroid([{ lat: oltPos.lat, lon: oltPos.lon, id: '_olt' }, ...cluster]);
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

      const tbAllSubs = updatedTBOrks.flatMap((o) => o.subscribers);
      const tbCableType = isP2P ? selectCableByFibers(tbAllSubs) : selectCableType(tbAllSubs.length);

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

      // Cables: TB → each ORK
      for (const ork of updatedTBOrks) {
        const orkCableType = isP2P
          ? selectCableByFibers(ork.subscribers)
          : selectCableType(ork.subscribers.length);
        cables.push(makeCable(orkCableType, tbId, ork.id, [
          [tb.lat, tb.lon], [ork.lat, ork.lon]
        ]));

        // Cables: ORK/Бокс → each subscriber
        // P2P: ОК-8 aerial drop; GPON: ОК-4 indoor drop
        const dropType = 'ОК-4';
        for (const sub of ork.subscribers) {
          cables.push(makeCableForSub(dropType, ork.id, sub, [
            [ork.lat, ork.lon], [sub.lat, sub.lon],
          ]));
        }
      }
    }

    olt.transitBoxes = transitBoxes;

    districts.push({
      name: districtName,
      color,
      olt,
      subscribers: [...updatedSubs, ...p2pSubs],
    });
  }

  return { districts, cables };
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

function makeCableForSub(
  type: Cable['type'],
  fromId: string,
  sub: Subscriber,
  coords: [number, number][]
): Cable {
  const base = makeCable(type, fromId, sub.id, coords);
  const objFibers = OBJECT_FIBERS[sub.objectType ?? 'абонент'];
  return { ...base, fibers: objFibers.working + objFibers.spare };
}
