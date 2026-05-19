/**
 * Смещение OSRM-трассы на одну сторону проезжей части.
 * «Правая» — относительно движения по трассе к OLT (абонент → магистраль).
 */

import { Cable } from '@/types/network';
import { haversineM } from './KMeans';

export type RoadSidePreference = 'center' | 'left' | 'right';

const M_LAT = 111320;
const MITER_LIMIT_DEG = 52;

function mLonAt(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function segmentUnit(
  a: [number, number],
  b: [number, number],
): [number, number] | null {
  const latMid = (a[0] + b[0]) / 2;
  const mx = (b[1] - a[1]) * mLonAt(latMid);
  const my = (b[0] - a[0]) * M_LAT;
  const len = Math.hypot(mx, my);
  if (len < 0.01) return null;
  return [mx / len, my / len];
}

function leftNormal(ux: number, uy: number): [number, number] {
  return [-uy, ux];
}

function applyOffset(
  lat: number,
  lon: number,
  nx: number,
  ny: number,
  sign: number,
  offsetM: number,
): [number, number] {
  const mLon = mLonAt(lat);
  const dLon = (sign * offsetM * nx) / mLon;
  const dLat = (sign * offsetM * ny) / M_LAT;
  return [lat + dLat, lon + dLon];
}

function offsetPointOnLeg(
  pivot: [number, number],
  ux: number,
  uy: number,
  side: RoadSidePreference,
  offsetM: number,
): [number, number] {
  const sideSign = side === 'left' ? 1 : -1;
  const [nx, ny] = leftNormal(ux, uy);
  return applyOffset(pivot[0], pivot[1], nx, ny, sideSign, offsetM);
}

/** Ранг узла: меньше = ближе к OLT. */
export function entityRank(id: string): number {
  if (id.startsWith('OLT')) return 0;
  if (id.startsWith('Муфта')) return 1;
  if (id.startsWith('J-')) return 2;
  if (id.startsWith('ОРКСП')) return 3;
  if (id.startsWith('BOX')) return 4;
  return 5;
}

/** Кабель в coords идёт от OLT к абоненту — для смещения разворачиваем к OLT. */
export function shouldReverseForRoadOffset(fromId: string, toId: string): boolean {
  return entityRank(fromId) < entityRank(toId);
}

function vertexBearing(
  coords: [number, number][],
  i: number,
): [number, number] | null {
  if (i === 0) return segmentUnit(coords[0], coords[1]);
  if (i === coords.length - 1) return segmentUnit(coords[i - 1], coords[i]);
  const u1 = segmentUnit(coords[i - 1], coords[i]);
  const u2 = segmentUnit(coords[i], coords[i + 1]);
  if (!u1 && !u2) return null;
  if (!u1) return u2;
  if (!u2) return u1;
  let ux = u1[0] + u2[0];
  let uy = u1[1] + u2[1];
  const len = Math.hypot(ux, uy);
  if (len < 0.01) return u1;
  return [ux / len, uy / len];
}

function turnAngleDeg(u1: [number, number], u2: [number, number]): number {
  const dot = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Смещение с фаской на острых углах (перекрёстки, повороты) — без «ёжика».
 */
export function offsetPolylineToSide(
  coords: [number, number][],
  side: RoadSidePreference,
  offsetM = 4,
): [number, number][] {
  if (side === 'center' || coords.length < 2 || offsetM <= 0) return coords;

  const sideSign = side === 'left' ? 1 : -1;
  const n = coords.length;

  if (n === 2) {
    const u = segmentUnit(coords[0], coords[1]);
    if (!u) return coords;
    const [nx, ny] = leftNormal(u[0], u[1]);
    return [
      applyOffset(coords[0][0], coords[0][1], nx, ny, sideSign, offsetM),
      applyOffset(coords[1][0], coords[1][1], nx, ny, sideSign, offsetM),
    ];
  }

  const out: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    if (i > 0 && i < n - 1) {
      const u1 = segmentUnit(coords[i - 1], coords[i])!;
      const u2 = segmentUnit(coords[i], coords[i + 1])!;
      const angle = turnAngleDeg(u1, u2);
      if (angle > MITER_LIMIT_DEG) {
        const p1 = offsetPointOnLeg(coords[i], u1[0], u1[1], side, offsetM);
        const p2 = offsetPointOnLeg(coords[i], u2[0], u2[1], side, offsetM);
        out.push([
          (p1[0] + p2[0]) / 2,
          (p1[1] + p2[1]) / 2,
        ]);
        continue;
      }
    }

    const bear = vertexBearing(coords, i);
    if (!bear) {
      out.push(coords[i]);
      continue;
    }
    const [nx, ny] = leftNormal(bear[0], bear[1]);
    out.push(applyOffset(coords[i][0], coords[i][1], nx, ny, sideSign, offsetM));
  }

  return out;
}

/** Убрать лишние точки на почти прямых участках после смещения. */
export function simplifyColinear(
  coords: [number, number][],
  maxBendDeg = 11,
): [number, number][] {
  if (coords.length <= 2) return coords;
  const out: [number, number][] = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const u1 = segmentUnit(out[out.length - 1], coords[i]);
    const u2 = segmentUnit(coords[i], coords[i + 1]);
    if (!u1 || !u2) {
      out.push(coords[i]);
      continue;
    }
    if (turnAngleDeg(u1, u2) > maxBendDeg) out.push(coords[i]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

/** Смещение с учётом направления к OLT. */
export function offsetCablePath(
  coords: [number, number][],
  fromId: string,
  toId: string,
  side: RoadSidePreference,
  offsetM: number,
): [number, number][] {
  if (side === 'center' || coords.length < 2) return coords;
  const reverse = shouldReverseForRoadOffset(fromId, toId);
  const path = reverse ? [...coords].reverse() : coords;
  const shifted = offsetPolylineToSide(path, side, offsetM);
  const restored = reverse ? [...shifted].reverse() : shifted;
  return simplifyColinear(restored, 11);
}

export function pickSnapOnRoadSide(
  origin: { lat: number; lon: number },
  candidates: [number, number][],
  toward: { lat: number; lon: number } | null,
  side: RoadSidePreference,
): [number, number] | null {
  if (candidates.length === 0) return null;
  if (side === 'center' || !toward) return candidates[0];

  const latMid = origin.lat;
  const ox = origin.lon * mLonAt(latMid);
  const oy = origin.lat * M_LAT;
  const tx = toward.lon * mLonAt(latMid);
  const ty = toward.lat * M_LAT;
  let fux = tx - ox;
  let fuy = ty - oy;
  const fl = Math.hypot(fux, fuy);
  if (fl < 0.5) return candidates[0];
  fux /= fl;
  fuy /= fl;

  let best: [number, number] | null = null;
  let bestDist = Infinity;

  for (const [lat, lon] of candidates) {
    const cx = lon * mLonAt(latMid);
    const cy = lat * M_LAT;
    const vx = cx - ox;
    const vy = cy - oy;
    const cross = fux * vy - fuy * vx;
    const onSide = side === 'left' ? cross > 0 : cross < 0;
    if (!onSide) continue;
    const d = Math.hypot(vx, vy);
    if (d < bestDist) {
      bestDist = d;
      best = [lat, lon];
    }
  }

  return best ?? candidates[0];
}

type VertexRef = { cableId: string; idx: number; lat: number; lon: number };

/**
 * В перекрёстках несколько кабелей сходятся в одну точку — ровный узел без хаоса.
 */
export function harmonizeCableIntersections(
  cables: Cable[],
  radiusM = 12,
): Cable[] {
  const refs: VertexRef[] = [];
  for (const c of cables) {
    if (!c.routedByOSRM || c.coords.length < 2) continue;
    for (let i = 0; i < c.coords.length; i++) {
      refs.push({
        cableId: c.id,
        idx: i,
        lat: c.coords[i][0],
        lon: c.coords[i][1],
      });
    }
  }
  if (refs.length === 0) return cables;

  const parent = refs.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      if (
        haversineM(refs[i].lat, refs[i].lon, refs[j].lat, refs[j].lon) <= radiusM
      ) {
        unite(i, j);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < refs.length; i++) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(i);
  }

  const coordPatches = new Map<string, [number, number]>();
  for (const indices of clusters.values()) {
    if (indices.length < 2) continue;
    const cableIds = new Set(indices.map((i) => refs[i].cableId));
    if (cableIds.size < 2) continue;

    let lat = 0;
    let lon = 0;
    for (const i of indices) {
      lat += refs[i].lat;
      lon += refs[i].lon;
    }
    lat /= indices.length;
    lon /= indices.length;

    for (const i of indices) {
      coordPatches.set(`${refs[i].cableId}:${refs[i].idx}`, [lat, lon]);
    }
  }

  if (coordPatches.size === 0) return cables;

  return cables.map((c) => {
    let changed = false;
    const coords = c.coords.map((pt, idx) => {
      const patch = coordPatches.get(`${c.id}:${idx}`);
      if (patch) {
        changed = true;
        return patch;
      }
      return pt;
    });
    if (!changed) return c;
    let lengthM = 0;
    for (let i = 1; i < coords.length; i++) {
      lengthM += haversineM(
        coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1],
      );
    }
    return { ...c, coords, lengthM };
  });
}
