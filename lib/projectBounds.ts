import type { District, Cable, MapAnnotation } from '@/types/network';
import type { BBox } from '@/components/Network/Selection';

export function bboxFromProject(
  districts: District[],
  cables: Cable[],
  annotations: MapAnnotation[] = [],
  padding = 0.004,
): BBox | null {
  const pts: [number, number][] = [];
  for (const d of districts) {
    pts.push([d.olt.lat, d.olt.lon]);
    for (const s of d.subscribers) pts.push([s.lat, s.lon]);
    for (const tb of d.olt.transitBoxes) {
      pts.push([tb.lat, tb.lon]);
      for (const ork of tb.orks) {
        pts.push([ork.lat, ork.lon]);
        for (const sub of ork.subscribers) pts.push([sub.lat, sub.lon]);
      }
    }
  }
  for (const c of cables) {
    for (const coord of c.coords) pts.push(coord);
  }
  for (const a of annotations) {
    for (const coord of a.coords) pts.push(coord);
  }
  if (pts.length === 0) return null;
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const [la, lo] of pts) {
    if (la < latMin) latMin = la;
    if (la > latMax) latMax = la;
    if (lo < lonMin) lonMin = lo;
    if (lo > lonMax) lonMax = lo;
  }
  return {
    latMin: latMin - padding,
    latMax: latMax + padding,
    lonMin: lonMin - padding,
    lonMax: lonMax + padding,
  };
}
