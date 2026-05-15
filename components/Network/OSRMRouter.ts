import { Cable } from '@/types/network';

// Public OSRM demo. Free but rate-limited; from Vercel egress IPs we
// commonly see 429s and timeouts. Mirrors are checked in order on
// failure so one bad node doesn't break the whole pass.
const OSRM_MIRRORS = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
];

export type ProgressCallback = (done: number, total: number, current: string) => void;

export interface RoutingStats {
  total: number;
  routed: number;
  failed: number;
  lastError?: string;
}

async function fetchRoute(
  base: string,
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  signal: AbortSignal,
  timeoutMs = 15000,
): Promise<[number, number][]> {
  const url = `${base}/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error(`OSRM ${data.code || 'no-route'}`);
    return data.routes[0].geometry.coordinates.map(
      ([lon, lat]: [number, number]) => [lat, lon] as [number, number],
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onOuterAbort);
  }
}

export async function getRoute(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): Promise<[number, number][]> {
  const ctrl = new AbortController();
  for (const base of OSRM_MIRRORS) {
    try {
      return await fetchRoute(base, lat1, lon1, lat2, lon2, ctrl.signal);
    } catch { /* try next mirror */ }
  }
  return [[lat1, lon1], [lat2, lon2]];
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

// Try each mirror in order. On HTTP 429 (rate limit), back off exponentially
// and retry the same mirror once before moving on. Returns null if all attempts
// fail. lastError is captured for surface-level diagnostics.
async function routeOne(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  signal: AbortSignal,
): Promise<{ coords: [number, number][] | null; error?: string }> {
  let lastError: string | undefined;
  for (const base of OSRM_MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) return { coords: null, error: 'aborted' };
      try {
        const coords = await fetchRoute(base, lat1, lon1, lat2, lon2, signal);
        return { coords };
      } catch (e: any) {
        const msg = e?.message || 'unknown';
        lastError = `${new URL(base).hostname}: ${msg}`;
        // Exponential backoff on 429 / 5xx
        if (/HTTP (429|5\d\d)/.test(msg) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        break; // try next mirror
      }
    }
  }
  return { coords: null, error: lastError };
}

export async function routeCables(
  cables: Cable[],
  delay: number,
  routeDrops: boolean,
  onProgress: ProgressCallback,
  signal: AbortSignal,
): Promise<Cable[]> {
  const priority: Cable['type'][] = ['ОК-96', 'ОК-48', 'ОК-32', 'ОК-24', 'ОК-16', 'ОК-12', 'ОК-8', 'ОК-4'];
  const toRoute = cables
    .filter((c) => routeDrops || c.type !== 'ОК-4')
    .sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));

  const result = new Map<string, Cable>(cables.map((c) => [c.id, c]));
  let done = 0;
  let routed = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (const cable of toRoute) {
    if (signal.aborted) break;

    const from = cable.coords[0];
    const to = cable.coords[cable.coords.length - 1];
    onProgress(done, toRoute.length, `${cable.type}: ${cable.fromId} → ${cable.toId}`);

    const { coords: routedCoords, error } = await routeOne(from[0], from[1], to[0], to[1], signal);

    if (routedCoords && routedCoords.length > 2) {
      result.set(cable.id, {
        ...cable,
        coords: routedCoords,
        lengthM: calcLength(routedCoords),
        routedByOSRM: true,
      });
      routed++;
    } else {
      failed++;
      if (!firstError && error) firstError = error;
    }

    done++;
    if (delay > 0 && !signal.aborted) await new Promise((r) => setTimeout(r, delay));
  }

  onProgress(toRoute.length, toRoute.length, '');

  // Summary log for the user. If everything failed, this is the actionable
  // signal — surface the first error so they can diagnose (rate-limit, CORS,
  // network block) instead of staring at straight lines wondering why.
  if (toRoute.length > 0) {
    if (failed === toRoute.length) {
      console.error(`[OSRM] ALL ${toRoute.length} routes failed. First error: ${firstError ?? 'unknown'}`);
    } else if (failed > 0) {
      console.warn(`[OSRM] ${routed}/${toRoute.length} routed, ${failed} failed. First error: ${firstError ?? 'unknown'}`);
    } else {
      console.log(`[OSRM] ${routed}/${toRoute.length} routed successfully`);
    }
  }

  // Stash stats on the result so callers can surface errors to UI without
  // changing the function signature.
  const out = cables.map((c) => result.get(c.id) ?? c) as Cable[] & { __stats?: RoutingStats };
  out.__stats = { total: toRoute.length, routed, failed, lastError: firstError };
  return out;
}
