import {
  Subscriber, ORK, TransitBox, OLT, Cable, District, ProjectSettings, DISTRICT_COLORS,
  CABLE_FIBERS, selectCableType, CableType,
} from '@/types/network';
import { kmeans, centroid, haversineM } from './KMeans';

let cableIdCounter = 0;
function newCableId() { return `cable-${++cableIdCounter}`; }

// GPON fiber requirements (per logical hop):
//   OLT → TB:  one fiber per ORK served (carries pre-splitter signal) + spare
//   TB  → ORK: one fiber (входное волокно для L2-сплиттера) + 1 резерв = ОК-4 хватает всегда
//   ORK → sub: один drop (ОК-4) до абонента; реально работают 1–2 волокна
function trunkCableType(orkCount: number): CableType {
  // 1 fiber per ORK + 100% spare, минимум ОК-4
  const needed = Math.max(2, orkCount * 2);
  return selectCableType(orkCount, 1) === 'ОК-4' && needed <= 4 ? 'ОК-4' : selectCableType(orkCount, 1);
}

// Choose ORK position on the boundary closest to the parent TB (so trunk
// terminates at the road edge rather than deep in the cluster).
function pickOrkAnchor(subs: Subscriber[]): { lat: number; lon: number } {
  if (subs.length === 1) return { lat: subs[0].lat, lon: subs[0].lon };
  // centroid is already a fine logical center; just return it
  return centroid(subs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })));
}

// Place TB at the median position of its ORKs projected toward the OLT axis.
// This shifts the TB toward the magistral side, so OSRM doesn't have to make
// long detours from a deep-in-cluster centroid back to the OLT road.
function pickTbAnchor(
  orks: { lat: number; lon: number }[],
  oltLat: number, oltLon: number,
): { lat: number; lon: number } {
  if (orks.length === 0) return { lat: oltLat, lon: oltLon };
  if (orks.length === 1) {
    // Place TB ~30% of the way from ORK toward OLT, so trunk has somewhere to
    // join and the тб-ORK link stays short.
    return {
      lat: orks[0].lat + (oltLat - orks[0].lat) * 0.30,
      lon: orks[0].lon + (oltLon - orks[0].lon) * 0.30,
    };
  }
  // Take ORK closest to OLT — that's the natural junction point on the trunk.
  let best = orks[0];
  let bestD = Infinity;
  for (const o of orks) {
    const d = haversineM(o.lat, o.lon, oltLat, oltLon);
    if (d < bestD) { bestD = d; best = o; }
  }
  // Pull TB slightly off the closest ORK toward OLT so it sits between them
  return {
    lat: best.lat + (oltLat - best.lat) * 0.15,
    lon: best.lon + (oltLon - best.lon) * 0.15,
  };
}

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
      const orkSubsRaw: Subscriber[] = cluster
        .map((p) => subs.find((s) => s.id === p.id))
        .filter(Boolean) as Subscriber[];
      const orkAnchor = pickOrkAnchor(orkSubsRaw);
      const orkId = `Бокс-${districtName.slice(0, 4).replace(/\s/g, '')}-${i + 1}`;
      const splitter: '1:4' | '1:8' | '1:16' =
        cluster.length <= 4 ? '1:4' : cluster.length <= 8 ? '1:8' : '1:16';

      const updatedOrkSubs = orkSubsRaw.map((s) => ({ ...s, orkId }));
      updatedSubs.push(...updatedOrkSubs);

      const orkSubCount = updatedOrkSubs.length;
      orks.push({
        id: orkId,
        lat: orkAnchor.lat,
        lon: orkAnchor.lon,
        district: districtName,
        splitter,
        tbId: '',
        subscribers: updatedOrkSubs,
        // В GPON: TB→ORK всегда ОК-4 (одно несущее волокно + резерв)
        cableType: 'ОК-4',
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

      // Place TB smartly: along the OLT→cluster axis, near the closest ORK to OLT.
      const tbAnchor = pickTbAnchor(
        updatedTBOrks.map((o) => ({ lat: o.lat, lon: o.lon })),
        olt.lat, olt.lon,
      );

      // Магистраль OLT→TB: считаем по количеству ОРК, а не абонентов
      const trunkType = trunkCableType(updatedTBOrks.length);
      // Распределение TB→ORK: всегда ОК-4
      const tbToOrkType: CableType = 'ОК-4';

      const tb: TransitBox = {
        id: tbId,
        lat: tbAnchor.lat,
        lon: tbAnchor.lon,
        district: districtName,
        oltId: olt.id,
        orks: updatedTBOrks,
        inCable: trunkType,
        outCable: tbToOrkType,
        muftaType: 'МТОК-96А',
      };
      transitBoxes.push(tb);

      // Cable: OLT → TB
      cables.push(makeCable(trunkType, olt.id, tbId, [
        [olt.lat, olt.lon], [tb.lat, tb.lon]
      ]));

      // Cables: TB → each ORK
      for (const ork of updatedTBOrks) {
        cables.push(makeCable(tbToOrkType, tbId, ork.id, [
          [tb.lat, tb.lon], [ork.lat, ork.lon]
        ]));

        // Cables: ORK → each subscriber (drop, всегда ОК-4)
        for (const sub of ork.subscribers) {
          cables.push(makeCable('ОК-4', ork.id, sub.id, [
            [ork.lat, ork.lon], [sub.lat, sub.lon]
          ]));
        }
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
