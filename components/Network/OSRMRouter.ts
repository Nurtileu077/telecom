import { Cable } from '@/types/network';
import {
  offsetPolylineToSide,
  pickSnapOnRoadSide,
  RoadSidePreference,
} from './roadSideOffset';

const OSRM_BASE = 'https://router.project-osrm.org';

export type ProgressCallback = (done: number, total: number, current: string) => void;

export interface OsrmRouteOptions {
  roadSide?: RoadSidePreference;
  /** Смещение от оси дороги, м (типично 3–6 м — край проезжей части / тротуар). */
  roadSideOffsetM?: number;
}

const DEFAULT_OSRM_OPTS: Required<OsrmRouteOptions> = {
  roadSide: 'center',
  roadSideOffsetM: 4,
};

function resolveOpts(opts?: OsrmRouteOptions): Required<OsrmRouteOptions> {
  return { ...DEFAULT_OSRM_OPTS, ...opts };
}

async function fetchRoute(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  signal: AbortSignal,
): Promise<[number, number][]> {
  const url = `${OSRM_BASE}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.any
    ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
    : signal,
  });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route');
  return data.routes[0].geometry.coordinates.map(
    ([lon, lat]: [number, number]) => [lat, lon] as [number, number],
  );
}

function applyRoadSide(
  coords: [number, number][],
  opts: Required<OsrmRouteOptions>,
  endpoints?: { from: [number, number]; to: [number, number] },
): [number, number][] {
  if (opts.roadSide === 'center' || coords.length < 2) return coords;
  const shifted = offsetPolylineToSide(coords, opts.roadSide, opts.roadSideOffsetM);
  if (endpoints) {
    shifted[0] = endpoints.from;
    shifted[shifted.length - 1] = endpoints.to;
  }
  return shifted;
}

export async function getRoute(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  opts?: OsrmRouteOptions,
): Promise<[number, number][]> {
  const o = resolveOpts(opts);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const coords = await fetchRoute(lat1, lon1, lat2, lon2, ctrl.signal);
    return applyRoadSide(coords, o, {
      from: [lat1, lon1],
      to: [lat2, lon2],
    });
  } catch {
    return [[lat1, lon1], [lat2, lon2]];
  } finally {
    clearTimeout(timer);
  }
}

export async function snapToRoad(
  lat: number, lon: number,
  maxDistM = 60,
  opts?: OsrmRouteOptions,
  toward?: { lat: number; lon: number } | null,
): Promise<[number, number] | null> {
  const o = resolveOpts(opts);
  const number = o.roadSide === 'center' ? 1 : 5;
  try {
    const url = `${OSRM_BASE}/nearest/v1/driving/${lon},${lat}?number=${number}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok' || !data.waypoints?.length) return null;

    const candidates: [number, number][] = data.waypoints.map(
      (w: { location: [number, number] }) => {
        const [snLon, snLat] = w.location;
        return [snLat, snLon] as [number, number];
      },
    );

    const R = 6371000;
    const distM = (a: [number, number]) => {
      const dLat = ((a[0] - lat) * Math.PI) / 180;
      const dLon = ((a[1] - lon) * Math.PI) / 180;
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat * Math.PI) / 180) * Math.cos((a[0] * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    };

    const inRange = candidates.filter((c) => distM(c) <= maxDistM);
    if (inRange.length === 0) return null;

    const picked = pickSnapOnRoadSide(
      { lat, lon },
      inRange,
      toward ?? null,
      o.roadSide,
    );
    return picked;
  } catch {
    return null;
  }
}

export async function snapBatch(
  pts: { lat: number; lon: number; toward?: { lat: number; lon: number } }[],
  maxDistM = 60,
  concurrency = 4,
  opts?: OsrmRouteOptions,
): Promise<Map<string, [number, number]>> {
  const seen = new Map<string, { lat: number; lon: number; toward?: { lat: number; lon: number } }>();
  for (const p of pts) seen.set(`${p.lat},${p.lon}`, p);
  const queue = Array.from(seen.values());
  const result = new Map<string, [number, number]>();
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const p = queue[idx];
      const key = `${p.lat},${p.lon}`;
      const snapped = await snapToRoad(p.lat, p.lon, maxDistM, opts, p.toward ?? null);
      if (snapped) result.set(key, snapped);
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return result;
}

export function simplifyPath(coords: [number, number][], toleranceM = 5): [number, number][] {
  if (coords.length <= 2) return coords;
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    let maxD = 0;
    let maxI = -1;
    const [ay, ax] = coords[lo];
    const [by, bx] = coords[hi];
    for (let k = lo + 1; k < hi; k++) {
      const [py, px] = coords[k];
      const latRad = ((ay + by) / 2) * Math.PI / 180;
      const M_LAT = 111320;
      const M_LON = 111320 * Math.cos(latRad);
      const Ax = ax * M_LON, Ay = ay * M_LAT;
      const Bx = bx * M_LON, By = by * M_LAT;
      const Px = px * M_LON, Py = py * M_LAT;
      const dx = Bx - Ax, dy = By - Ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((Px - Ax) * dx + (Py - Ay) * dy) / len2)) : 0;
      const cx = Ax + t * dx, cy = Ay + t * dy;
      const d = Math.hypot(Px - cx, Py - cy);
      if (d > maxD) { maxD = d; maxI = k; }
    }
    if (maxI > 0 && maxD > toleranceM) {
      keep[maxI] = 1;
      stack.push([lo, maxI], [maxI, hi]);
    }
  }
  const out: [number, number][] = [];
  for (let k = 0; k < coords.length; k++) if (keep[k]) out.push(coords[k]);
  return out;
}

function calcLength(coords: [number, number][]): number {
  let len = 0;
  const R = 6371000;
  for (let i = 1; i < coords.length; i++) {
    const [la, lo] = coords[i - 1];
    const [lb, lob] = coords[i];
    const dLat = ((lb - la) * Math.PI) / 180;
    const dLon = ((lob - lo) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((la * Math.PI) / 180) *
        Math.cos((lb * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    len += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return len;
}

export async function routeCables(
  cables: Cable[],
  delay: number,
  routeDrops: boolean,
  onProgress: ProgressCallback,
  signal: AbortSignal,
  onCableRouted?: (cable: Cable) => void,
  opts?: OsrmRouteOptions,
): Promise<Cable[]> {
  const o = resolveOpts(opts);
  const priority: Cable['type'][] = ['ОК-96', 'ОК-48', 'ОК-32', 'ОК-24', 'ОК-16', 'ОК-12', 'ОК-8', 'ОК-4'];
  const toRoute = cables
    .filter((c) => routeDrops || c.type !== 'ОК-4')
    .sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));

  const result = new Map<string, Cable>(cables.map((c) => [c.id, c]));
  let done = 0;

  for (const cable of toRoute) {
    if (signal.aborted) break;

    const from = cable.coords[0];
    const to = cable.coords[cable.coords.length - 1];
    onProgress(done, toRoute.length, `${cable.type}: ${cable.fromId} → ${cable.toId}`);

    let routedCoords: [number, number][] | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) break;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        const coords = await fetchRoute(from[0], from[1], to[0], to[1], ctrl.signal);
        clearTimeout(timer);
        routedCoords = coords;
        break;
      } catch {
        if (attempt === 0 && !signal.aborted) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    if (routedCoords && routedCoords.length > 2) {
      const simplified = simplifyPath(routedCoords, 5);
      const shifted = applyRoadSide(simplified, o, { from, to });
      const updated: Cable = {
        ...cable,
        coords: shifted,
        lengthM: calcLength(shifted),
        routedByOSRM: true,
      };
      result.set(cable.id, updated);
      onCableRouted?.(updated);
    }

    done++;
    if (delay > 0 && !signal.aborted) await new Promise((r) => setTimeout(r, delay));
  }

  onProgress(toRoute.length, toRoute.length, '');
  return cables.map((c) => result.get(c.id) ?? c);
}

export type { RoadSidePreference };
