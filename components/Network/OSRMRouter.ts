import { Cable } from '@/types/network';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

export type ProgressCallback = (done: number, total: number, current: string) => void;

async function fetchRoute(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  signal: AbortSignal,
): Promise<[number, number][]> {
  const url = `${OSRM_BASE}/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
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

export async function getRoute(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): Promise<[number, number][]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    return await fetchRoute(lat1, lon1, lat2, lon2, ctrl.signal);
  } catch {
    return [[lat1, lon1], [lat2, lon2]];
  } finally {
    clearTimeout(timer);
  }
}

// Snap a point to the nearest road via OSRM `nearest`. Returns null when
// no road is within maxDistM (likely off-grid e.g. middle of a field) — the
// caller should fall back to the original point in that case.
export async function snapToRoad(
  lat: number, lon: number,
  maxDistM = 60,
): Promise<[number, number] | null> {
  try {
    const url = `https://router.project-osrm.org/nearest/v1/driving/${lon},${lat}?number=1`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok' || !data.waypoints?.[0]) return null;
    const [snLon, snLat] = data.waypoints[0].location;
    // Bail if the snap is suspiciously far — preserve original placement.
    const R = 6371000;
    const dLat = ((snLat - lat) * Math.PI) / 180;
    const dLon = ((snLon - lon) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) * Math.cos((snLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (dist > maxDistM) return null;
    return [snLat, snLon];
  } catch {
    return null;
  }
}

// Snap many points in parallel with a small concurrency limit so we don't
// overwhelm the public OSRM demo. Returns a Map keyed by `${lat},${lon}`.
// Deduplicates points first — multiple cables hitting the same entity coord
// only spend one request.
export async function snapBatch(
  pts: { lat: number; lon: number }[],
  maxDistM = 60,
  concurrency = 4,
): Promise<Map<string, [number, number]>> {
  const seen = new Map<string, { lat: number; lon: number }>();
  for (const p of pts) seen.set(`${p.lat},${p.lon}`, p);
  const queue = Array.from(seen.values());
  const result = new Map<string, [number, number]>();
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const p = queue[idx];
      const key = `${p.lat},${p.lon}`;
      const snapped = await snapToRoad(p.lat, p.lon, maxDistM);
      if (snapped) result.set(key, snapped);
      // jitter to dodge per-IP rate limits on the public OSRM demo
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return result;
}

// Douglas-Peucker line simplification — kills the ~8m densification artefacts
// that OSRM leaves on straight roads. Tolerance is perpendicular distance
// in metres; keep ≤5m so real road turns survive but colinear noise is gone.
export function simplifyPath(coords: [number, number][], toleranceM = 5): [number, number][] {
  if (coords.length <= 2) return coords;
  // Stack-based implementation to avoid recursion overflow on long paths.
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
      // approximate metres using equirectangular projection at the mid-latitude
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
): Promise<Cable[]> {
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

    // Try up to 2 times
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) break;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        // combine with outer signal manually
        signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        const coords = await fetchRoute(from[0], from[1], to[0], to[1], ctrl.signal);
        clearTimeout(timer);
        routedCoords = coords;
        break;
      } catch {
        if (attempt === 0 && !signal.aborted) {
          // small pause before retry
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    if (routedCoords && routedCoords.length > 2) {
      // Collapse OSRM's ~8m densification into just real road turns.
      // 5m perpendicular tolerance keeps every real bend, removes colinear noise.
      const simplified = simplifyPath(routedCoords, 5);
      // Preserve the exact endpoints (entity coords) regardless of simplification:
      // OSRM may snap the first/last point to a node a few metres away.
      simplified[0] = from;
      simplified[simplified.length - 1] = to;
      result.set(cable.id, {
        ...cable,
        coords: simplified,
        lengthM: calcLength(simplified),
        routedByOSRM: true,
      });
    }
    // else: keep original straight-line coords

    done++;
    if (delay > 0 && !signal.aborted) await new Promise((r) => setTimeout(r, delay));
  }

  onProgress(toRoute.length, toRoute.length, '');
  return cables.map((c) => result.get(c.id) ?? c);
}
