import {
  Subscriber, ORK, TransitBox, OLT, Cable, District, ProjectSettings, DISTRICT_COLORS,
  CABLE_FIBERS, selectCableType, CableType,
} from '@/types/network';
import { kmeans, centroid, haversineM, Point } from './KMeans';

let cableIdCounter = 0;
function newCableId() { return `cable-${++cableIdCounter}`; }

// k-means не ограничивает ни РАЗМЕР, ни РАДИУС кластера. При неравномерной
// плотности один кластер собирал 17–19 камер (порты 8/16 → перегруз) ИЛИ был
// «рыхлым» — 8 камер растянуты на 1–2 км, что давало километровые дропы и
// «висящие» прямые линии. Режем кластер, если он крупнее maxSize ИЛИ если
// какая-то точка дальше maxRadiusM от центра. Дробим под-kmeans и рекурсивно
// дочищаем; для вырожденного случая (совпавшие точки) — нарезка срезами.
function capClusters(clusters: Point[][], maxSize: number, maxRadiusM = Infinity): Point[][] {
  const out: Point[][] = [];
  const tooWide = (c: Point[]): boolean => {
    if (!isFinite(maxRadiusM) || c.length <= 1) return false;
    const ct = centroid(c);
    return c.some((p) => haversineM(p.lat, p.lon, ct.lat, ct.lon) > maxRadiusM);
  };
  const split = (cluster: Point[]) => {
    const oversize = cluster.length > maxSize;
    if (!oversize && !tooWide(cluster)) {
      if (cluster.length > 0) out.push(cluster);
      return;
    }
    // По размеру делим на ⌈len/maxSize⌉; если делим только по радиусу — минимум 2.
    const k = oversize ? Math.ceil(cluster.length / maxSize) : 2;
    const { clusters: sub } = kmeans(cluster, k);
    const progressed = sub.some((sc) => sc.length > 0 && sc.length < cluster.length);
    if (!progressed) {
      for (let i = 0; i < cluster.length; i += maxSize) out.push(cluster.slice(i, i + maxSize));
      return;
    }
    for (const sc of sub) split(sc);
  };
  for (const c of clusters) split(c);
  return out;
}

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

// One district can have many OLTs.  When the user supplies N coords for a
// district, subscribers are partitioned by nearest OLT (Voronoi) and each
// partition becomes its own sub-network ("Туркестан-1", "Туркестан-2"…).
export type OltLocationMap = Record<string, Array<{ lat: number; lon: number }>>;

// Sanitize a district name into an ID-safe slug.  Critical: must preserve
// uniqueness across districts — sub-districts after Voronoi split are named
// like "Sheet1-10", "Sheet1-11", "Sheet1-12" and the old slice(0, 8) collapsed
// all three to "Sheet1-1", producing duplicate OLT/TB/ORK ids.  When the
// consolidation engine looked up cables by "${olt.id}::${tb.id}", it matched
// across districts and emitted phantom 10+ km cables through the entire city.
//
// Now we keep the full name (just strip whitespace and a small list of
// punctuation that's awkward in ids).  Cyrillic stays — Russian district
// names need it; the rest of the codebase already handles unicode ids.
function slugForId(districtName: string): string {
  return districtName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

// Build the network rooted at a single OLT for one (sub-)district.
function buildSingleOlt(
  districtName: string,
  color: string,
  subs: Subscriber[],
  oltPos: { lat: number; lon: number },
  oltSuffix: string,
  settings: ProjectSettings,
  cables: Cable[],
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
    l1Splitter: '1:4',
  };

  // Cluster subscribers into ORKs (с жёстким ограничением размера: ≤ maxPerORK
  // камер на ОРКСП — иначе перегруз портов и длинные дропы).
  const kOrk = Math.max(1, Math.ceil(subs.length / settings.maxPerORK));
  const { clusters: orkClustersRaw } = kmeans(
    subs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })),
    kOrk,
  );
  // Радиус-лимит ОРКСП по умолчанию выключен (короткие дропы = в 2–3 раза больше
  // шкафов). Включается через settings.maxOrkRadiusM, если нужно.
  const orkClusters = capClusters(orkClustersRaw, settings.maxPerORK, settings.maxOrkRadiusM ?? Infinity);

  const orks: ORK[] = [];
  const updatedSubs: Subscriber[] = [];

  for (let i = 0; i < orkClusters.length; i++) {
    const cluster = orkClusters[i];
    if (cluster.length === 0) continue;
    const orkSubsRaw: Subscriber[] = cluster
      .map((p) => subs.find((s) => s.id === p.id))
      .filter(Boolean) as Subscriber[];
    const orkAnchor = pickOrkAnchor(orkSubsRaw);
    const orkId = `Бокс-${slug}${oltSuffix}-${i + 1}`;
    // Default L2-сплиттер из настроек проекта (выбран пользователем на импорте);
    // если он явно меньше чем нужно для кластера, поднимаем минимально.
    const userSplitter = settings.defaultSplitter ?? '1:8';
    const minByCluster: '1:4' | '1:8' | '1:16' =
      cluster.length <= 4 ? '1:4' : cluster.length <= 8 ? '1:8' : '1:16';
    const order = ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64'] as const;
    const splitter = order.indexOf(userSplitter) > order.indexOf(minByCluster)
      ? userSplitter
      : minByCluster;

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
      cableType: 'ОК-4',
      boxType: orkSubCount <= 4 ? 'Бокс-8' : orkSubCount <= 8 ? 'Бокс-16' : 'ОРКСп-16',
    });
  }

  // Cluster ORKs into Transit Boxes (≤ maxORKperTB ОРКСП на муфту).
  const kTB = Math.max(1, Math.ceil(orks.length / settings.maxORKperTB));
  const { clusters: tbClustersRaw } = kmeans(
    orks.map((o) => ({ lat: o.lat, lon: o.lon, id: o.id })),
    kTB,
  );
  const tbClusters = capClusters(tbClustersRaw, settings.maxORKperTB);

  const transitBoxes: TransitBox[] = [];

  for (let i = 0; i < tbClusters.length; i++) {
    const cluster = tbClusters[i];
    if (cluster.length === 0) continue;
    const tbId = `Муфта-${slug}${oltSuffix}-${i + 1}`;

    const tbOrks = cluster
      .map((p) => orks.find((o) => o.id === p.id))
      .filter(Boolean) as ORK[];

    const updatedTBOrks = tbOrks.map((o) => ({ ...o, tbId }));
    for (const o of updatedTBOrks) {
      const idx = orks.findIndex((x) => x.id === o.id);
      if (idx >= 0) orks[idx] = o;
    }

    const tbAnchor = pickTbAnchor(
      updatedTBOrks.map((o) => ({ lat: o.lat, lon: o.lon })),
      olt.lat, olt.lon,
    );

    const trunkType = trunkCableType(updatedTBOrks.length);
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

    cables.push(makeCable(trunkType, olt.id, tbId, [
      [olt.lat, olt.lon], [tb.lat, tb.lon],
    ]));

    for (const ork of updatedTBOrks) {
      cables.push(makeCable(tbToOrkType, tbId, ork.id, [
        [tb.lat, tb.lon], [ork.lat, ork.lon],
      ]));
      for (const sub of ork.subscribers) {
        cables.push(makeCable('ОК-4', ork.id, sub.id, [
          [ork.lat, ork.lon], [sub.lat, sub.lon],
        ]));
      }
    }
  }

  olt.transitBoxes = transitBoxes;

  return {
    name: districtName,
    color,
    olt,
    subscribers: updatedSubs,
  };
}

export function buildNetwork(
  subscribers: Subscriber[],
  settings: ProjectSettings,
  oltLocations: OltLocationMap = {},
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
    const overrides = oltLocations[districtName] ?? [];
    const baseColor = DISTRICT_COLORS[colorIdx % DISTRICT_COLORS.length];
    colorIdx++;

    // Auto-2-OLT for large projects: when the user didn't override and the
    // district has more cameras than one OLT can serve (~512), synthesise
    // two OLT positions via kmeans so each subtree stays under the limit.
    // Single OLT still wins when overrides explicitly specify one.
    const MAX_PER_OLT = settings.maxCamerasPerOlt ?? 512;
    if (overrides.length === 0 && subs.length > MAX_PER_OLT) {
      const need = Math.ceil(subs.length / MAX_PER_OLT);
      const points = subs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id }));
      const { centers } = kmeans(points, need);
      // Treat the kmeans centres as if the user supplied them.
      const synth = centers.map((c) => ({ lat: c.lat, lon: c.lon }));
      const groups: Subscriber[][] = synth.map(() => []);
      for (const s of subs) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < synth.length; i++) {
          const d = haversineM(s.lat, s.lon, synth[i].lat, synth[i].lon);
          if (d < bd) { bd = d; bi = i; }
        }
        groups[bi].push(s);
      }
      for (let i = 0; i < synth.length; i++) {
        if (groups[i].length === 0) continue;
        const subDistrictName = `${districtName}-${i + 1}`;
        const subColor = DISTRICT_COLORS[(colorIdx + i) % DISTRICT_COLORS.length];
        districts.push(buildSingleOlt(subDistrictName, subColor, groups[i], synth[i], '', settings, cables));
      }
      colorIdx += synth.length - 1;
      continue;
    }

    if (overrides.length <= 1) {
      // Single OLT (override or auto-centroid). Same as before.
      const oltPos = overrides[0]
        ?? centroid(subs.map((s) => ({ lat: s.lat, lon: s.lon, id: s.id })));
      districts.push(buildSingleOlt(districtName, baseColor, subs, oltPos, '', settings, cables));
      continue;
    }

    // Multiple OLTs: assign each subscriber to the nearest OLT (Voronoi),
    // then build each partition as its own sub-network. Sub-districts get a
    // numeric suffix so IDs stay unique.
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
      ));
    }
    colorIdx += overrides.length - 1;
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
