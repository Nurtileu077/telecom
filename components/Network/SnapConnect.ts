import type { Cable, District } from '@/types/network';
import { haversineM } from './KMeans';
import type { LatLon } from './cableWaypoints';

export const SNAP_ENTITY_M = 45;
export const SNAP_CABLE_M = 35;

export type EntityKind = 'olt' | 'tb' | 'ork';

export interface MapEntity {
  kind: EntityKind;
  id: string;
  lat: number;
  lon: number;
  label: string;
}

export interface CableHit {
  cableId: string;
  fromId: string;
  toId: string;
  point: LatLon;
  segIndex: number;
  distM: number;
}

export interface NearestEntity {
  kind: EntityKind;
  id: string;
  lat: number;
  lon: number;
  label: string;
  distM: number;
}

export function listEntities(districts: District[]): MapEntity[] {
  const out: MapEntity[] = [];
  for (const d of districts) {
    const { olt } = d;
    out.push({ kind: 'olt', id: olt.id, lat: olt.lat, lon: olt.lon, label: 'OLT' });
    for (const tb of olt.transitBoxes) {
      out.push({ kind: 'tb', id: tb.id, lat: tb.lat, lon: tb.lon, label: 'Муфта' });
      for (const ork of tb.orks) {
        out.push({ kind: 'ork', id: ork.id, lat: ork.lat, lon: ork.lon, label: 'ОРК' });
      }
    }
  }
  return out;
}

export function nearestEntity(
  lat: number,
  lon: number,
  districts: District[],
  maxM = SNAP_ENTITY_M,
  excludeId?: string,
): NearestEntity | null {
  let best: NearestEntity | null = null;
  for (const e of listEntities(districts)) {
    if (excludeId && e.id === excludeId) continue;
    const distM = haversineM(lat, lon, e.lat, e.lon);
    if (distM <= maxM && (!best || distM < best.distM)) {
      best = { kind: e.kind, id: e.id, lat: e.lat, lon: e.lon, label: e.label, distM };
    }
  }
  return best;
}

function distPointToSegmentM(
  p: LatLon,
  a: LatLon,
  b: LatLon,
): { distM: number; closest: LatLon; t: number } {
  const [plat, plon] = p;
  const [a0, a1] = a;
  const [b0, b1] = b;
  const dx = b0 - a0;
  const dy = b1 - a1;
  const len2 = dx * dx + dy * dy;
  let t = len2 < 1e-14 ? 0 : ((plat - a0) * dx + (plon - a1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const clat = a0 + t * dx;
  const clon = a1 + t * dy;
  return { distM: haversineM(plat, plon, clat, clon), closest: [clat, clon], t };
}

export function nearestPointOnCable(cable: Cable, lat: number, lon: number): CableHit | null {
  const coords = cable.coords;
  if (coords.length < 2) return null;
  const p: LatLon = [lat, lon];
  let best: CableHit | null = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const { distM, closest } = distPointToSegmentM(p, coords[i], coords[i + 1]);
    if (!best || distM < best.distM) {
      best = {
        cableId: cable.id,
        fromId: cable.fromId,
        toId: cable.toId,
        point: closest,
        segIndex: i,
        distM,
      };
    }
  }
  return best;
}

export function findCablesNearPoint(
  lat: number,
  lon: number,
  cables: Cable[],
  maxM = SNAP_CABLE_M,
): CableHit[] {
  const hits: CableHit[] = [];
  for (const c of cables) {
    if (c.fromId.startsWith('pt-') || c.toId.startsWith('pt-')) continue;
    const hit = nearestPointOnCable(c, lat, lon);
    if (hit && hit.distM <= maxM) hits.push(hit);
  }
  hits.sort((a, b) => a.distM - b.distM);
  return hits;
}

/** Разрезать кабель в точке P: два отрезка через tbId. */
export function splitCableAt(
  cable: Cable,
  hit: CableHit,
  tbId: string,
): { removedId: string; added: Cable[] } {
  const coords = cable.coords.map((c) => [...c] as LatLon);
  const i = hit.segIndex;
  const p = hit.point;
  const part1: LatLon[] = [...coords.slice(0, i + 1), p];
  const part2: LatLon[] = [p, ...coords.slice(i + 1)];
  const dedupe = (arr: LatLon[]) => {
    const out: LatLon[] = [];
    for (const pt of arr) {
      const last = out[out.length - 1];
      if (!last || haversineM(last[0], last[1], pt[0], pt[1]) > 2) out.push(pt);
    }
    return out.length >= 2 ? out : null;
  };
  const c1 = dedupe(part1);
  const c2 = dedupe(part2);
  if (!c1 || !c2) return { removedId: cable.id, added: [] };

  const len = (cs: LatLon[]) => {
    let l = 0;
    for (let j = 1; j < cs.length; j++) {
      l += haversineM(cs[j - 1][0], cs[j - 1][1], cs[j][0], cs[j][1]);
    }
    return l;
  };

  const stamp = Date.now();
  const a: Cable = {
    ...cable,
    id: `${cable.id}-a-${stamp}`,
    toId: tbId,
    coords: c1 as [number, number][],
    lengthM: len(c1),
    routedByOSRM: false,
  };
  const b: Cable = {
    ...cable,
    id: `${cable.id}-b-${stamp}`,
    fromId: tbId,
    coords: c2 as [number, number][],
    lengthM: len(c2),
    routedByOSRM: false,
  };
  return { removedId: cable.id, added: [a, b] };
}

export function cablesForEntity(cables: Cable[], entityId: string): Cable[] {
  return cables.filter((c) => c.fromId === entityId || c.toId === entityId);
}

export function entityKindLabel(kind: EntityKind): string {
  return kind === 'olt' ? 'OLT' : kind === 'tb' ? 'Муфта' : 'ОРК';
}

/** Какой конец кабеля ближе к точке (для «Соединить»). */
export function nearestCableEnd(
  cable: Cable,
  lat: number,
  lon: number,
): 'from' | 'to' {
  const [a, b] = [cable.coords[0], cable.coords[cable.coords.length - 1]];
  const d0 = haversineM(lat, lon, a[0], a[1]);
  const d1 = haversineM(lat, lon, b[0], b[1]);
  return d0 <= d1 ? 'from' : 'to';
}

/** Узлы, к которым можно примагнитить конец кабеля (не противоположный конец). */
export function compatibleTargetsForCable(
  cable: Cable,
  end: 'from' | 'to',
  districts: District[],
): string[] {
  const otherId = end === 'from' ? cable.toId : cable.fromId;
  return listEntities(districts)
    .filter((e) => e.id !== otherId && !e.id.startsWith('pt-'))
    .map((e) => e.id);
}
