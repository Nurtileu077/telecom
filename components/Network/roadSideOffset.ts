/**
 * Смещение OSRM-трассы (ось дороги) на одну сторону проезжей части.
 * «Слева» / «справа» — относительно направления движения вдоль линии (from → to).
 */

export type RoadSidePreference = 'center' | 'left' | 'right';

const M_LAT = 111320;

function mLonAt(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/** Единичный вектор направления сегмента в метрах (east, north). */
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

/** Перпендикуляр «слева» от направления (ux, uy). */
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

/**
 * Сдвигает полилинию на offsetM метров влево или вправо от направления трассы.
 */
export function offsetPolylineToSide(
  coords: [number, number][],
  side: RoadSidePreference,
  offsetM = 4,
): [number, number][] {
  if (side === 'center' || coords.length < 2 || offsetM <= 0) return coords;

  const sideSign = side === 'left' ? 1 : -1;
  const out: [number, number][] = [];

  for (let i = 0; i < coords.length; i++) {
    let ux = 0;
    let uy = 0;
    if (i === 0) {
      const u = segmentUnit(coords[0], coords[1]);
      if (u) [ux, uy] = u;
    } else if (i === coords.length - 1) {
      const u = segmentUnit(coords[i - 1], coords[i]);
      if (u) [ux, uy] = u;
    } else {
      const u1 = segmentUnit(coords[i - 1], coords[i]);
      const u2 = segmentUnit(coords[i], coords[i + 1]);
      if (u1 && u2) {
        ux = u1[0] + u2[0];
        uy = u1[1] + u2[1];
        const len = Math.hypot(ux, uy);
        if (len > 0.01) {
          ux /= len;
          uy /= len;
        } else {
          [ux, uy] = u1;
        }
      } else if (u1) {
        [ux, uy] = u1;
      } else if (u2) {
        [ux, uy] = u2;
      }
    }

    if (ux === 0 && uy === 0) {
      out.push(coords[i]);
      continue;
    }

    const [nx, ny] = leftNormal(ux, uy);
    out.push(applyOffset(coords[i][0], coords[i][1], nx, ny, sideSign, offsetM));
  }

  return out;
}

/**
 * Выбрать снэп на нужной стороне дороги.
 * @param toward — точка «впереди» (к OLT / следующий узел); задаёт направление «вдоль» дороги.
 */
export function pickSnapOnRoadSide(
  origin: { lat: number; lon: number },
  candidates: [number, number][],
  toward: { lat: number; lon: number } | null,
  side: RoadSidePreference,
): [number, number] | null {
  if (candidates.length === 0) return null;
  if (side === 'center' || !toward) {
    return candidates[0];
  }

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
