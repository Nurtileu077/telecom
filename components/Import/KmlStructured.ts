// Smart structured KML loader.  Takes vendor KML (folders by entity type +
// LineString cables) and produces a real District[] + Cable[] tree — instead
// of the previous "flat" raw mode that dumped everything as subscribers /
// annotations and left the AI / consolidation / export systems blind to it.

import {
  District, Cable, OLT, TransitBox, ORK, Subscriber, CableType,
  CABLE_FIBERS, DISTRICT_COLORS,
  CameraKind, ProjectSide, CAMERA_MIN_BANDWIDTH_MBPS, cameraKindToSide,
} from '@/types/network';
import { haversineM } from '../Network/KMeans';

export interface KmlPoint {
  lat: number;
  lon: number;
  name: string;
  desc: string;
  folderPath: string[];
  fileDistrict: string;
  // Custom fields from <ExtendedData><SchemaData><SimpleData …>.  Key is the
  // schema's displayName (preferred) or raw field id; value is the cell value.
  // Used by the classifier: if extData contains "itemType: ЦОД" that wins
  // over folder-name guessing.
  extData?: Record<string, string>;
}

export interface KmlLine {
  coords: [number, number][];
  name: string;
  folderPath: string[];
  fileDistrict: string;
  extData?: Record<string, string>;
}

// In Sergek-cameras projects every Placemark is one of:
//   olt   — узел связи / ЦОД / АМС
//   tb    — ОМСП-муфта / транзитная муфта МТОК (L1-сплиттер)
//   ork   — ОРКСП-шкаф / Бокс на столбе (L2-сплиттер + ONT)
//   joint — сварная муфта, точка соединения 3+ кабелей
//   cam_lu        — камера ЛУ (линейный участок, baseline + скорость)
//   cam_intersect — камера на перекрёстке (полный комплекс)
//   cam_ovn       — камера ОВН (общественное видеонаблюдение)
//   radio         — РРЛ (радиорелейная линия) — НЕ оптический кабель, игнор
//   skip          — декоративные сущности (полигоны и т.п.)
export type EntityKind =
  | 'olt' | 'tb' | 'ork' | 'joint'
  | 'cam_lu' | 'cam_intersect' | 'cam_ovn'
  | 'radio' | 'skip';

// JS \b doesn't work for Cyrillic — explicit non-letter neighbours instead.
const NONL = '(?:^|[^а-яА-Яa-zA-Z0-9])';
const NONR = '(?:[^а-яА-Яa-zA-Z0-9]|$)';

const RE_OLT          = new RegExp(`${NONL}(?:olt|цод|амс|узел[\\s_-]*связ|data[\\s-]?center)${NONR}|magistral`, 'i');
const RE_TB           = new RegExp(`мток|омсп|транзит[нaаыое]*[\\s_-]+муфт|${NONL}(?:tb|sleeve)${NONR}`, 'i');
const RE_ORK          = new RegExp(`${NONL}(?:орк|оркс|бокс|nap|шкаф)${NONR}|distribu`, 'i');
const RE_JOINT        = new RegExp(`${NONL}муфт|${NONL}joint${NONR}|splice|сварн`, 'i');
const RE_RADIO        = new RegExp(`${NONL}ррл${NONR}|радиорелей|wireless[\\s-]?link`, 'i');

// Camera-type regexes — checked BEFORE joint/support so "Перекресток" /
// "ЛУ" / "ОВН" don't get demoted to junctions/poles.
const RE_CAM_INTERSECT = new RegExp(`перекрест|перекрёст|intersection|crossroad`, 'i');
const RE_CAM_LU        = new RegExp(`${NONL}лу${NONR}|линейн.+участок|baseline`, 'i');
// ОВН matches both "ОВН" and "ОВН (с)" — vendors use both for surveillance cams.
const RE_CAM_OVN       = new RegExp(`${NONL}овн${NONR}|обществ.*видео|public[\\s-]*surveil`, 'i');

function joinText(folderPath: string[], name: string, extData?: Record<string, string>): string {
  const parts: string[] = [...folderPath, name];
  if (extData) {
    for (const v of Object.values(extData)) if (v) parts.push(String(v));
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export function classifyEntity(
  folderPath: string[],
  name: string,
  extData?: Record<string, string>,
): EntityKind {
  const t = joinText(folderPath, name, extData);
  // Order matters — cameras and infrastructure share root words:
  //   "Перекресток" → camera (NOT joint)
  //   "ЛУ" / "Линейный участок" → camera (NOT joint, despite the "линейн" root)
  //   "ОВН" / "ОВН (с)" → camera (NOT support pole)
  // Therefore we check camera-types FIRST, then infrastructure.
  // РРЛ wins over everything (it's a radio link, not a fibre subscriber).
  if (RE_RADIO.test(t))         return 'radio';
  if (RE_CAM_INTERSECT.test(t)) return 'cam_intersect';
  if (RE_CAM_LU.test(t))        return 'cam_lu';
  if (RE_CAM_OVN.test(t))       return 'cam_ovn';
  // TB before joint so "Транзитная муфта МТОК" wins over plain "муфт"→joint.
  if (RE_TB.test(t))            return 'tb';
  if (RE_JOINT.test(t))         return 'joint';
  if (RE_OLT.test(t))           return 'olt';
  if (RE_ORK.test(t))           return 'ork';
  // Anything else — pessimistically treat as ОВН camera (low-rate fallback)
  // so we don't drop it.  The user can re-classify on the map.
  return 'cam_ovn';
}

// Map a classified camera kind to the EntityKind enum.
export function cameraEntityKind(kind: CameraKind): EntityKind {
  switch (kind) {
    case 'lu':           return 'cam_lu';
    case 'intersection': return 'cam_intersect';
    case 'ovn':          return 'cam_ovn';
    default:             return 'cam_ovn';
  }
}

// Inverse — for the Subscriber.kind field.
export function entityToCameraKind(ek: EntityKind): CameraKind {
  switch (ek) {
    case 'cam_lu':        return 'lu';
    case 'cam_intersect': return 'intersection';
    case 'cam_ovn':       return 'ovn';
    default:              return 'unknown';
  }
}

export function classifyCableType(
  folderPath: string[],
  name: string,
  extData?: Record<string, string>,
): CableType {
  const t = joinText(folderPath, name, extData);
  // Explicit ОК-N marker has top priority.
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

// True for line itemTypes we don't want to treat as a fibre cable
// (currently only radio links).  Caller can stash them as annotations.
export function isRadioLine(
  folderPath: string[],
  name: string,
  extData?: Record<string, string>,
): boolean {
  return RE_RADIO.test(joinText(folderPath, name, extData));
}

interface CameraPoint extends KmlPoint {
  cameraKind: CameraKind;
}

interface DistrictBuckets {
  olts: KmlPoint[];
  tbs: KmlPoint[];
  orks: KmlPoint[];
  cameras: CameraPoint[]; // ЛУ / Перекр / ОВН — типизированные камеры
  joints: KmlPoint[];     // сварные муфты — snap-targets, не сущности
  lines: KmlLine[];
  radioLines: KmlLine[];
}

function slugForId(s: string): string {
  return s.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '');
}

interface BuildOutcome {
  districts: District[];
  cables: Cable[];
  // Lines that aren't fibre cables (РРЛ) — caller renders as annotations.
  radioLines: Array<{ coords: [number, number][]; name: string; district: string }>;
  stats: {
    olt: number; tb: number; ork: number;
    camLu: number; camIntersect: number; camOvn: number;
    joints: number; radio: number;
    cablesMatched: number;
    cablesOrphan: number;
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
  opts: { snapMaxM?: number; mergeAll?: boolean; mergedName?: string } = {},
): BuildOutcome {
  const SNAP_M = opts.snapMaxM ?? 75; // endpoints often a few metres off the icon
  const stats = {
    olt: 0, tb: 0, ork: 0,
    camLu: 0, camIntersect: 0, camOvn: 0,
    joints: 0, radio: 0,
    cablesMatched: 0, cablesOrphan: 0,
  };

  // When the user imports several KML files in one go, each file would
  // normally become its own district — but vendors split a single project
  // across files by LAYER (Боксы.kml / Кабели-ОК-48.kml / Абоненты.kml).
  // In that case cables from one file can't find their endpoints in another
  // and subscribers from a 3rd file have no ORK to attach to.  mergeAll=true
  // collapses everything into a single district so cross-file matching works.
  const partitionKey = (p: { fileDistrict: string }): string =>
    opts.mergeAll ? (opts.mergedName ?? 'Сеть') : p.fileDistrict;

  const byDistrict = new Map<string, DistrictBuckets>();
  const bucket = (name: string) => {
    if (!byDistrict.has(name)) {
      byDistrict.set(name, { olts: [], tbs: [], orks: [], cameras: [], joints: [], lines: [], radioLines: [] });
    }
    return byDistrict.get(name)!;
  };

  for (const p of rawPoints) {
    const kind = classifyEntity(p.folderPath, p.name, p.extData);
    const b = bucket(partitionKey(p));
    if      (kind === 'olt') b.olts.push(p);
    else if (kind === 'tb')  b.tbs.push(p);
    else if (kind === 'ork') b.orks.push(p);
    else if (kind === 'joint') { b.joints.push(p); stats.joints++; }
    else if (kind === 'skip' || kind === 'radio') { /* drop from fibre tree */ }
    else if (kind === 'cam_lu' || kind === 'cam_intersect' || kind === 'cam_ovn') {
      const ck = entityToCameraKind(kind);
      b.cameras.push({ ...p, cameraKind: ck });
      if      (ck === 'lu')           stats.camLu++;
      else if (ck === 'intersection') stats.camIntersect++;
      else                            stats.camOvn++;
    } else {
      // unknown → treat as ОВН camera (low-rate default)
      b.cameras.push({ ...p, cameraKind: 'unknown' });
      stats.camOvn++;
    }
  }
  for (const l of rawLines) {
    const b = bucket(partitionKey(l));
    if (isRadioLine(l.folderPath, l.name, l.extData)) {
      b.radioLines.push(l);
      stats.radio++;
    } else {
      b.lines.push(l);
    }
  }

  const outDistricts: District[] = [];
  const outCables: Cable[] = [];
  let cableSeq = 0;
  let colorIdx = 0;

  // Global entity index used for cable snap-matching across ALL districts /
  // OLT subtrees.  Vendor magistral cables routinely connect points that we
  // assigned to different Voronoi partitions — without a global index those
  // would become orphans.
  const globalEntityIndex: Array<{ id: string; lat: number; lon: number }> = [];

  for (const [districtName, b] of byDistrict.entries()) {
    if (b.olts.length === 0 && b.tbs.length === 0 && b.orks.length === 0 && b.cameras.length === 0 && b.joints.length === 0 && b.lines.length === 0) continue;

    // ── 1. Determine OLT positions ──
    // KML may have multiple OLTs (ЦОД + АМС etc.) — each becomes its own
    // sub-district.  No explicit OLT → one virtual at the entity centroid.
    type OltPos = { lat: number; lon: number; name: string };
    let oltPositions: OltPos[];
    if (b.olts.length > 0) {
      oltPositions = b.olts.map((o) => ({ lat: o.lat, lon: o.lon, name: o.name || 'OLT' }));
    } else {
      const refs: KmlPoint[] = b.tbs.length > 0 ? b.tbs : (b.orks.length > 0 ? b.orks : b.cameras);
      if (refs.length === 0) continue;
      oltPositions = [{
        lat: refs.reduce((s, p) => s + p.lat, 0) / refs.length,
        lon: refs.reduce((s, p) => s + p.lon, 0) / refs.length,
        name: 'OLT-auto',
      }];
    }

    // ── 2. Voronoi-assign every other entity to its nearest OLT ──
    const nearestOltIdx = (lat: number, lon: number): number => {
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < oltPositions.length; i++) {
        const d = haversineM(lat, lon, oltPositions[i].lat, oltPositions[i].lon);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      return bestI;
    };
    const assignedTBs: KmlPoint[][] = oltPositions.map(() => []);
    const assignedOrks: KmlPoint[][] = oltPositions.map(() => []);
    const assignedCams: CameraPoint[][] = oltPositions.map(() => []);
    const assignedJoints: KmlPoint[][] = oltPositions.map(() => []);
    for (const p of b.tbs)     assignedTBs[nearestOltIdx(p.lat, p.lon)].push(p);
    for (const p of b.orks)    assignedOrks[nearestOltIdx(p.lat, p.lon)].push(p);
    for (const p of b.cameras) assignedCams[nearestOltIdx(p.lat, p.lon)].push(p);
    for (const p of b.joints)  assignedJoints[nearestOltIdx(p.lat, p.lon)].push(p);

    // ── 3. Build subtree per OLT ──
    for (let oi = 0; oi < oltPositions.length; oi++) {
      const oltPos = oltPositions[oi];
      const subName = oltPositions.length === 1 ? districtName : `${districtName}-${oi + 1}`;
      const slug = slugForId(subName);
      const oltId = `OLT-${slug}`;
      stats.olt++;

      // Transit boxes: explicit, else one virtual at the OLT so ORK→TB→OLT exists.
      const tbInput = assignedTBs[oi].length > 0
        ? assignedTBs[oi]
        : (assignedOrks[oi].length > 0
            ? [{ lat: oltPos.lat, lon: oltPos.lon, name: 'TB-auto', desc: '', folderPath: [], fileDistrict: subName } as KmlPoint]
            : []);
      const tbs: TransitBox[] = tbInput.map((t, i) => ({
        id: `TB-${slug}-${i + 1}`,
        lat: t.lat, lon: t.lon,
        district: subName,
        oltId,
        orks: [],
        inCable: 'ОК-48',
        outCable: 'ОК-4',
        muftaType: 'МТОК-96А',
      }));
      stats.tb += tbs.length;

      const orks: ORK[] = assignedOrks[oi].map((o, i) => {
        let nearest = tbs[0];
        let bestD = nearest ? haversineM(o.lat, o.lon, nearest.lat, nearest.lon) : Infinity;
        for (const tb of tbs) {
          const d = haversineM(o.lat, o.lon, tb.lat, tb.lon);
          if (d < bestD) { bestD = d; nearest = tb; }
        }
        return {
          id: `ORK-${slug}-${i + 1}`,
          lat: o.lat, lon: o.lon,
          district: subName,
          splitter: '1:8' as const,
          tbId: nearest?.id ?? '',
          subscribers: [],
          cableType: 'ОК-4' as CableType,
          boxType: 'Бокс-16',
        };
      });
      stats.ork += orks.length;

      const subs: Subscriber[] = assignedCams[oi].map((s, i) => {
        let nearest = orks[0];
        let bestD = nearest ? haversineM(s.lat, s.lon, nearest.lat, nearest.lon) : Infinity;
        for (const o of orks) {
          const d = haversineM(s.lat, s.lon, o.lat, o.lon);
          if (d < bestD) { bestD = d; nearest = o; }
        }
        const ck = s.cameraKind;
        return {
          id: `sub-${slug}-${i + 1}`,
          lat: s.lat, lon: s.lon,
          desc: s.name || s.desc || `Камера ${i + 1}`,
          district: subName,
          orkId: nearest?.id,
          fibers: { working: 2, spare: 1 },
          kind: ck,
          side: cameraKindToSide(ck),
          minBandwidthMbps: CAMERA_MIN_BANDWIDTH_MBPS[ck],
        };
      });

      for (const o of orks) o.subscribers = subs.filter((s) => s.orkId === o.id);
      for (const tb of tbs) tb.orks = orks.filter((o) => o.tbId === tb.id);

      const olt: OLT = {
        id: oltId,
        lat: oltPos.lat, lon: oltPos.lon,
        district: subName,
        model: 'Huawei MA5800-X7',
        capacity: 64,
        transitBoxes: tbs,
        l1Splitter: '1:4',
      };
      outDistricts.push({
        name: subName,
        color: DISTRICT_COLORS[colorIdx++ % DISTRICT_COLORS.length],
        olt,
        subscribers: subs,
      });

      // Add this subtree's entities + its support poles / joints to the global
      // snap index so any cable from any district can attach to them.
      globalEntityIndex.push({ id: oltId, lat: olt.lat, lon: olt.lon });
      for (const tb of tbs)  globalEntityIndex.push({ id: tb.id, lat: tb.lat, lon: tb.lon });
      for (const o  of orks) globalEntityIndex.push({ id: o.id, lat: o.lat, lon: o.lon });
      for (const s  of subs) globalEntityIndex.push({ id: s.id, lat: s.lat, lon: s.lon });
      assignedJoints[oi].forEach((p, i) => globalEntityIndex.push({ id: `J-${slug}-${i + 1}`, lat: p.lat, lon: p.lon }));
    }
  }

  // ── 4. Cable matching — pass over ALL lines from ALL districts using the
  // global index built above.  Each line's endpoints snap to the nearest
  // known entity within SNAP_M; unmatched ends → orphan.
  for (const [, b] of byDistrict.entries()) {
    for (const line of b.lines) {
      if (line.coords.length < 2) continue;
      const start = line.coords[0];
      const end = line.coords[line.coords.length - 1];
      const a = snapEndpoint(start, globalEntityIndex, SNAP_M);
      const c = snapEndpoint(end, globalEntityIndex, SNAP_M);
      if (!a || !c || a.id === c.id) {
        stats.cablesOrphan++;
        continue;
      }
      const type = classifyCableType(line.folderPath, line.name, line.extData);
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
        routedByOSRM: true,
      });
      stats.cablesMatched++;
    }
  }

  // Collect radio lines (РРЛ) so the caller can show them as annotations.
  const radioLines: Array<{ coords: [number, number][]; name: string; district: string }> = [];
  for (const [districtName, b] of byDistrict.entries()) {
    for (const r of b.radioLines) {
      radioLines.push({ coords: r.coords, name: r.name || 'РРЛ', district: districtName });
    }
  }

  return { districts: outDistricts, cables: outCables, radioLines, stats };
}
