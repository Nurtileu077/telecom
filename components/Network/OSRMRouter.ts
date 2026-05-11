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
      result.set(cable.id, {
        ...cable,
        coords: routedCoords,
        lengthM: calcLength(routedCoords),
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
