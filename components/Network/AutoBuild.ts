import {
  Subscriber, ORK, TransitBox, OLT, Cable, District, ProjectSettings, DISTRICT_COLORS,
  CABLE_FIBERS, selectCableType,
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

      // Цепочка TB → ОРК₁ → ОРК₂ → … (вместо звезды TB→каждый ОРК): один проход по улицам,
      // без нескольких параллельных OSRM-маршрутов на один и тот же участок.
      const orderedOrks = orderOrksChainFromTb(tb.lat, tb.lon, updatedTBOrks);
      for (let ci = 0; ci < orderedOrks.length; ci++) {
        const downstreamSubs = orderedOrks.slice(ci).reduce((s, o) => s + o.subscribers.length, 0);
        const segmentType = selectCableType(downstreamSubs);
        const fromId = ci === 0 ? tbId : orderedOrks[ci - 1].id;
        const fromLat = ci === 0 ? tb.lat : orderedOrks[ci - 1].lat;
        const fromLon = ci === 0 ? tb.lon : orderedOrks[ci - 1].lon;
        const to = orderedOrks[ci];
        cables.push(makeCable(segmentType, fromId, to.id, [
          [fromLat, fromLon],
          [to.lat, to.lon],
        ]));
      }

      // Отводы ОРК → абонент
      for (const ork of updatedTBOrks) {
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

/** Ближайший-сосед от муфты: цепочка по трассе без N полных параллельных линий «TB→ОРК». */
function orderOrksChainFromTb(tbLat: number, tbLon: number, orks: ORK[]): ORK[] {
  if (orks.length <= 1) return [...orks];
  const remaining = [...orks];
  const ordered: ORK[] = [];
  let curLat = tbLat;
  let curLon = tbLon;
  while (remaining.length > 0) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineM(curLat, curLon, remaining[i].lat, remaining[i].lon);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const next = remaining.splice(bestI, 1)[0];
    ordered.push(next);
    curLat = next.lat;
    curLon = next.lon;
  }
  return ordered;
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
