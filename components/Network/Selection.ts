// Geographic bounding-box selection — used by the "Export selection" flow
// so the user can outline a region on the map and only that subset is sent
// to KMZ/Excel/PDF/JSON exporters, instead of dumping the whole project.

import type { District, Cable, InlineJoint, Subscriber, ORK, TransitBox } from '@/types/network';

export type BBox = { latMin: number; lonMin: number; latMax: number; lonMax: number };

export function normalizeBBox(a: [number, number], b: [number, number]): BBox {
  return {
    latMin: Math.min(a[0], b[0]),
    latMax: Math.max(a[0], b[0]),
    lonMin: Math.min(a[1], b[1]),
    lonMax: Math.max(a[1], b[1]),
  };
}

export function pointInBBox(lat: number, lon: number, bb: BBox): boolean {
  return lat >= bb.latMin && lat <= bb.latMax && lon >= bb.lonMin && lon <= bb.lonMax;
}

// Произвольный многоугольник выделения (лассо). [lat, lon][].
export type Poly = [number, number][];

export function bboxOfPolygon(poly: Poly): BBox {
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const [la, lo] of poly) {
    if (la < latMin) latMin = la; if (la > latMax) latMax = la;
    if (lo < lonMin) lonMin = lo; if (lo > lonMax) lonMax = lo;
  }
  return { latMin, latMax, lonMin, lonMax };
}

// Ray-casting: точка внутри многоугольника.
export function pointInPolygon(lat: number, lon: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polylineTouchesPolygon(coords: [number, number][], poly: Poly): boolean {
  for (const [la, lo] of coords) if (pointInPolygon(la, lo, poly)) return true;
  return false;
}

// A polyline touches the bbox if any of its vertices is inside.  Good enough
// for the user's "select what to export" intent — strictly checking segment
// intersection is overkill and slow on dense paths.
export function polylineTouchesBBox(coords: [number, number][], bb: BBox): boolean {
  for (const [la, lo] of coords) if (pointInBBox(la, lo, bb)) return true;
  return false;
}

export interface FilteredNetwork {
  districts: District[];
  cables: Cable[];
  joints: InlineJoint[];
  counts: {
    olt: number; tb: number; ork: number; sub: number; cable: number; joint: number;
  };
}

// Return only the entities + cables + joints that fall inside the bbox.
// - OLT/TB/ORK kept if their own coord is inside (children pruned to those inside).
// - Subscribers kept if their coord is inside.
// - Cables kept if their polyline touches the bbox at any vertex.
// - Joints kept if their coord is inside.
// Empty branches (OLT with no remaining TBs/orks/subs) are kept anyway so the
// user can see the root node — better than silently dropping it.
export function filterByBBox(
  districts: District[],
  cables: Cable[],
  joints: InlineJoint[],
  bb: BBox,
  poly?: Poly | null,
): FilteredNetwork {
  let oltN = 0, tbN = 0, orkN = 0, subN = 0;

  // С полигоном тест точнее (лассо), иначе — прямоугольник.
  const inside = (la: number, lo: number): boolean =>
    poly && poly.length >= 3 ? pointInPolygon(la, lo, poly) : pointInBBox(la, lo, bb);
  const touches = (coords: [number, number][]): boolean =>
    poly && poly.length >= 3 ? polylineTouchesPolygon(coords, poly) : polylineTouchesBBox(coords, bb);

  const filteredDistricts: District[] = [];
  for (const d of districts) {
    const oltInside = inside(d.olt.lat, d.olt.lon);

    // Filter TBs by their own coord, ORKs by theirs, subs by theirs.
    const filteredTBs: TransitBox[] = [];
    for (const tb of d.olt.transitBoxes) {
      const tbInside = inside(tb.lat, tb.lon);
      const filteredOrks: ORK[] = [];
      for (const ork of tb.orks) {
        const orkInside = inside(ork.lat, ork.lon);
        const filteredSubs: Subscriber[] = ork.subscribers.filter((s) => inside(s.lat, s.lon));
        if (orkInside || filteredSubs.length > 0) {
          filteredOrks.push({ ...ork, subscribers: filteredSubs });
          if (orkInside) orkN++;
          subN += filteredSubs.length;
        }
      }
      if (tbInside || filteredOrks.length > 0) {
        filteredTBs.push({ ...tb, orks: filteredOrks });
        if (tbInside) tbN++;
      }
    }

    const filteredSubsTop: Subscriber[] = d.subscribers.filter((s) => inside(s.lat, s.lon));

    if (oltInside || filteredTBs.length > 0 || filteredSubsTop.length > 0) {
      filteredDistricts.push({
        ...d,
        olt: { ...d.olt, transitBoxes: filteredTBs },
        subscribers: filteredSubsTop,
      });
      if (oltInside) oltN++;
    }
  }

  const filteredCables = cables.filter((c) => touches(c.coords));
  const filteredJoints = joints.filter((j) => inside(j.lat, j.lon));

  return {
    districts: filteredDistricts,
    cables: filteredCables,
    joints: filteredJoints,
    counts: { olt: oltN, tb: tbN, ork: orkN, sub: subN, cable: filteredCables.length, joint: filteredJoints.length },
  };
}
