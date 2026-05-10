import { Cable } from '@/types/network';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

export type ProgressCallback = (done: number, total: number, current: string) => void;

export async function getRoute(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): Promise<[number, number][]> {
  try {
    const url = `${OSRM_BASE}/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('OSRM error');
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route');
    const coords: [number, number][] = data.routes[0].geometry.coordinates.map(
      ([lon, lat]: [number, number]) => [lat, lon]
    );
    return coords;
  } catch {
    return [[lat1, lon1], [lat2, lon2]];
  }
}

export async function routeCables(
  cables: Cable[],
  delay: number,
  routeDrops: boolean,
  onProgress: ProgressCallback,
  signal: AbortSignal
): Promise<Cable[]> {
  const priority: Cable['type'][] = ['ОКБ-10', 'ОКСНН-8', 'ОКСНН-4', 'ОКА-2'];
  const toRoute = cables.filter((c) => {
    if (!routeDrops && c.type === 'ОКА-2') return false;
    return true;
  });
  toRoute.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));

  const result = new Map<string, Cable>(cables.map((c) => [c.id, c]));
  let done = 0;

  for (const cable of toRoute) {
    if (signal.aborted) break;
    const from = cable.coords[0];
    const to = cable.coords[cable.coords.length - 1];
    onProgress(done, toRoute.length, `${cable.type} ${cable.fromId}→${cable.toId}`);

    const routedCoords = await getRoute(from[0], from[1], to[0], to[1]);

    let lengthM = 0;
    for (let i = 1; i < routedCoords.length; i++) {
      const [lat1, lon1] = routedCoords[i - 1];
      const [lat2, lon2] = routedCoords[i];
      const R = 6371000;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      lengthM += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    result.set(cable.id, {
      ...cable,
      coords: routedCoords,
      lengthM,
      routedByOSRM: routedCoords.length > 2,
    });

    done++;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  onProgress(toRoute.length, toRoute.length, '');
  return cables.map((c) => result.get(c.id) || c);
}
