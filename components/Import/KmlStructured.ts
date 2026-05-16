// Smart structured KML loader.  Takes vendor KML (folders by entity type +
// LineString cables) and produces a real District[] + Cable[] tree — instead
// of the previous "flat" raw mode that dumped everything as subscribers /
// annotations and left the AI / consolidation / export systems blind to it.

import {
  District, Cable, OLT, TransitBox, ORK, Subscriber, CableType,
  CABLE_FIBERS, DISTRICT_COLORS,
} from '@/types/network';
import { haversineM } from '../Network/KMeans';

export interface KmlPoint {
  lat: number;
  lon: number;
  name: string;
  desc: string;
  folderPath: string[];
  fileDistrict: string;
}

export interface KmlLine {
  coords: [number, number][];
  name: string;
  folderPath: string[];
  fileDistrict: string;
}

export type EntityKind = 'olt' | 'tb' | 'ork' | 'sub';

const RE_OLT  = /\bolt\b|узел[\s_-]*связ|magistral/i;
const RE_TB   = /муфт|\btb\b|sleeve|транзит/i;
const RE_ORK  = /орк|\bбокс\b|\bnap\b|шкаф|distribu/i;
const RE_SUB  = /абонент|\bsub\b|\bont\b|client|клиент|drop/i;
const RE_CABLE = /кабел|\bок[\s_-]?\d/i;

function joinText(folderPath: string[], name: string): string {
  return [...folderPath, name].filter(Boolean).join(' ').toLowerCase();
}

export function classifyEntity(folderPath: string[], name: string): EntityKind {
  const t = joinText(folderPath, name);
  if (RE_OLT.test(t))  return 'olt';
  if (RE_TB.test(t))   return 'tb';
  if (RE_ORK.test(t))  return 'ork';
  // Default: subscriber (covers both classified sub folders and unknowns)
  return 'sub';
}

export function classifyCableType(folderPath: string[], name: string): CableType {
  const t = joinText(folderPath, name);
  // Explicit ОК-N marker in folder/line name has top priority.
  const m = t.match(/ок[\s_-]?(\d{1,3})/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n === 96 || n === 48 || n === 32 || n === 24 || n === 16 || n === 12 || n === 8 || n === 4) {
      return (`ОК-${n}`) as CableType;
    }
  }
  if (/магистрал|trunk|backbone/.test(t)) return 'ОК-48';
  if (/распред|distrib/.test(t))          return 'ОК-12';
  if (/дроп|drop|абонент/.test(t))        return 'ОК-4';
  return 'ОК-12';
}

interface DistrictBuckets {
  olts: KmlPoint[];
  tbs: KmlPoint[];
  orks: KmlPoint[];
  subs: KmlPoint[];
  lines: KmlLine[];
}

function slugForId(s: string): string {
  return s.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '');
}

interface BuildOutcome {
  districts: District[];
  cables: Cable[];
  stats: {
    olt: number; tb: number; ork: number; sub: number;
    cablesMatched: number;
    cablesOrphan: number; // line endpoints didn't snap to any entity
  };
}

// Snap a polyline endpoint to the nearest entity (any kind) within `maxSnapM`.
function snapEndpoint(
  pt: [number, number],
  entities: Array<{ id: string; lat: number; lon: number }>,
  maxSnapM: number,
): { id: string; dist: number } | null {
  let best: { id: string; dist: number } | null = null;
  for (const e of entities) {
    const d = haversineM(pt[0], pt[1], e.lat, e.lon);
    if (d <= maxSnapM && (!best || d < best.dist)) {
      best = { id: e.id, dist: d };
    }
  }
  return best;
}

export function buildStructured(
  rawPoints: KmlPoint[],
  rawLines: KmlLine[],
  opts: { snapMaxM?: number } = {},
): BuildOutcome {
  const SNAP_M = opts.snapMaxM ?? 75; // endpoints often a few metres off the icon
  const stats = { olt: 0, tb: 0, ork: 0, sub: 0, cablesMatched: 0, cablesOrphan: 0 };

  // Bucket by district (defaults to the KML file name).
  const byDistrict = new Map<string, DistrictBuckets>();
  const bucket = (name: string) => {
    if (!byDistrict.has(name)) {
      byDistrict.set(name, { olts: [], tbs: [], orks: [], subs: [], lines: [] });
    }
    return byDistrict.get(name)!;
  };

  for (const p of rawPoints) {
    const kind = classifyEntity(p.folderPath, p.name);
    const b = bucket(p.fileDistrict);
    if (kind === 'olt') b.olts.push(p);
    else if (kind === 'tb') b.tbs.push(p);
    else if (kind === 'ork') b.orks.push(p);
    else b.subs.push(p);
  }
  for (const l of rawLines) bucket(l.fileDistrict).lines.push(l);

  const outDistricts: District[] = [];
  const outCables: Cable[] = [];
  let cableSeq = 0;
  let colorIdx = 0;

  for (const [districtName, b] of byDistrict.entries()) {
    if (b.olts.length === 0 && b.tbs.length === 0 && b.orks.length === 0 && b.subs.length === 0) continue;

    // ── Synthesize a single OLT for this district ──
    // If the KML had an OLT use the first one; else put it at the TB/sub centroid
    // so the rest of the tree still has a root.
    let oltLat: number;
    let oltLon: number;
    if (b.olts.length > 0) {
      oltLat = b.olts[0].lat;
      oltLon = b.olts[0].lon;
    } else {
      const refs = b.tbs.length > 0 ? b.tbs : (b.orks.length > 0 ? b.orks : b.subs);
      if (refs.length === 0) continue;
      oltLat = refs.reduce((s, p) => s + p.lat, 0) / refs.length;
      oltLon = refs.reduce((s, p) => s + p.lon, 0) / refs.length;
    }
    const slug = slugForId(districtName);
    const oltId = `OLT-${slug}`;
    stats.olt++;

    // ── Transit boxes ──
    // If KML had explicit TBs use them.  Otherwise create a single virtual TB
    // co-located with the OLT so the ORK→TB→OLT chain still exists.
    const tbInput = b.tbs.length > 0
      ? b.tbs
      : (b.orks.length > 0
          ? [{ lat: oltLat, lon: oltLon, name: 'TB-auto', desc: '', folderPath: [], fileDistrict: districtName } as KmlPoint]
          : []);

    const tbs: TransitBox[] = tbInput.map((t, i) => ({
      id: `TB-${slug}-${i + 1}`,
      lat: t.lat, lon: t.lon,
      district: districtName,
      oltId,
      orks: [],
      inCable: 'ОК-48',
      outCable: 'ОК-4',
      muftaType: 'МТОК-96А',
    }));
    stats.tb += tbs.length;

    // ── ORKs ── each ORK joins the nearest TB.
    const orks: ORK[] = b.orks.map((o, i) => {
      let nearest = tbs[0];
      let bestD = nearest ? haversineM(o.lat, o.lon, nearest.lat, nearest.lon) : Infinity;
      for (const tb of tbs) {
        const d = haversineM(o.lat, o.lon, tb.lat, tb.lon);
        if (d < bestD) { bestD = d; nearest = tb; }
      }
      return {
        id: `ORK-${slug}-${i + 1}`,
        lat: o.lat, lon: o.lon,
        district: districtName,
        splitter: '1:8' as const,
        tbId: nearest?.id ?? '',
        subscribers: [],
        cableType: 'ОК-4' as CableType,
        boxType: 'Бокс-16',
      };
    });
    stats.ork += orks.length;

    // ── Subscribers ── attached to nearest ORK if one exists.
    const subs: Subscriber[] = b.subs.map((s, i) => {
      let nearest = orks[0];
      let bestD = nearest ? haversineM(s.lat, s.lon, nearest.lat, nearest.lon) : Infinity;
      for (const o of orks) {
        const d = haversineM(s.lat, s.lon, o.lat, o.lon);
        if (d < bestD) { bestD = d; nearest = o; }
      }
      return {
        id: `sub-${slug}-${i + 1}`,
        lat: s.lat, lon: s.lon,
        desc: s.name || s.desc || `Або. ${i + 1}`,
        district: districtName,
        orkId: nearest?.id,
        fibers: { working: 2, spare: 1 },
      };
    });
    stats.sub += subs.length;

    for (const o of orks) {
      o.subscribers = subs.filter((s) => s.orkId === o.id);
    }
    for (const tb of tbs) {
      tb.orks = orks.filter((o) => o.tbId === tb.id);
    }

    const olt: OLT = {
      id: oltId,
      lat: oltLat, lon: oltLon,
      district: districtName,
      model: 'Huawei MA5800-X7',
      capacity: 64,
      transitBoxes: tbs,
      l1Splitter: '1:4',
    };

    outDistricts.push({
      name: districtName,
      color: DISTRICT_COLORS[colorIdx++ % DISTRICT_COLORS.length],
      olt,
      subscribers: subs,
    });

    // ── Cables — match each LineString to a pair of entities by snap-to-nearest.
    const entityIndex = [
      { id: oltId, lat: olt.lat, lon: olt.lon },
      ...tbs.map((t) => ({ id: t.id, lat: t.lat, lon: t.lon })),
      ...orks.map((o) => ({ id: o.id, lat: o.lat, lon: o.lon })),
      ...subs.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon })),
    ];

    for (const line of b.lines) {
      if (line.coords.length < 2) continue;
      const start = line.coords[0];
      const end = line.coords[line.coords.length - 1];
      const a = snapEndpoint(start, entityIndex, SNAP_M);
      const c = snapEndpoint(end, entityIndex, SNAP_M);
      if (!a || !c || a.id === c.id) {
        stats.cablesOrphan++;
        continue;
      }
      const type = classifyCableType(line.folderPath, line.name);
      let lengthM = 0;
      for (let i = 1; i < line.coords.length; i++) {
        lengthM += haversineM(line.coords[i - 1][0], line.coords[i - 1][1], line.coords[i][0], line.coords[i][1]);
      }
      outCables.push({
        id: `cable-kml-${++cableSeq}`,
        type,
        fibers: CABLE_FIBERS[type],
        fromId: a.id,
        toId: c.id,
        coords: line.coords,
        lengthM,
        // KML-drawn paths are pre-routed by whoever made the file — treat them
        // as routed so the per-cable renderer doesn't dash them as "straight".
        routedByOSRM: true,
      });
      stats.cablesMatched++;
    }
  }

  return { districts: outDistricts, cables: outCables, stats };
}
