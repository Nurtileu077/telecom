import { Subscriber, ORK, TransitBox, OLT, Cable, District, ProjectSettings, DISTRICT_COLORS } from '@/types/network';
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
      const orkId = `ОРК-${districtName.slice(0, 4).replace(/\s/g, '')}-${i + 1}`;
      const splitter: '1:4' | '1:8' | '1:16' =
        cluster.length <= 4 ? '1:4' : cluster.length <= 8 ? '1:8' : '1:16';

      // Find original subscribers for this cluster
      const orkSubs: Subscriber[] = cluster
        .map((p) => subs.find((s) => s.id === p.id))
        .filter(Boolean) as Subscriber[];

      const updatedOrkSubs = orkSubs.map((s) => ({ ...s, orkId }));
      updatedSubs.push(...updatedOrkSubs);

      orks.push({
        id: orkId,
        lat: orkCenter.lat,
        lon: orkCenter.lon,
        district: districtName,
        splitter,
        tbId: '',
        subscribers: updatedOrkSubs,
        cableType: 'ОКСНН-4',
        box: 'ОРБ-32',
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
      const tbId = `TB-${districtName.slice(0, 4).replace(/\s/g, '')}-${i + 1}`;

      const tbOrks = cluster
        .map((p) => orks.find((o) => o.id === p.id))
        .filter(Boolean) as ORK[];

      const updatedTBOrks = tbOrks.map((o) => ({ ...o, tbId }));
      // Update orks array references
      for (const o of updatedTBOrks) {
        const idx = orks.findIndex((x) => x.id === o.id);
        if (idx >= 0) orks[idx] = o;
      }

      const tb: TransitBox = {
        id: tbId,
        lat: tbCenter.lat,
        lon: tbCenter.lon,
        district: districtName,
        oltId: olt.id,
        orks: updatedTBOrks,
        inCable: 'ОКСНН-8',
        outCable: 'ОКСНН-4',
        muftaType: 'МТОК-96А',
      };
      transitBoxes.push(tb);

      // Cable: OLT → TB (ОКСНН-8)
      cables.push(makeCable('ОКСНН-8', 8, olt.id, tbId, [
        [olt.lat, olt.lon], [tb.lat, tb.lon]
      ]));

      // Cables: TB → each ORK (ОКСНН-4)
      for (const ork of updatedTBOrks) {
        cables.push(makeCable('ОКСНН-4', 4, tbId, ork.id, [
          [tb.lat, tb.lon], [ork.lat, ork.lon]
        ]));

        // Cables: ORK → each subscriber (ОКА-2)
        for (const sub of ork.subscribers) {
          cables.push(makeCable('ОКА-2', 2, ork.id, sub.id, [
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
  fibers: Cable['fibers'],
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
    fibers,
    fromId,
    toId,
    coords,
    lengthM,
    routedByOSRM: false,
  };
}
