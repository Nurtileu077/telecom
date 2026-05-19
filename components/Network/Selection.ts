// Geographic selection — polygon or legacy bbox for export / scoped tools.

import type { District, Cable, InlineJoint, Subscriber, ORK, TransitBox } from '@/types/network';

/** [lat, lon] vertices; first edge closes to last automatically. */
export type SelectionPolygon = [number, number][];

export type BBox = { latMin: number; lonMin: number; latMax: number; lonMax: number };

export function normalizeBBox(a: [number, number], b: [number, number]): BBox {
  return {
    latMin: Math.min(a[0], b[0]),
    latMax: Math.max(a[0], b[0]),
    lonMin: Math.min(a[1], b[1]),
    lonMax: Math.max(a[1], b[1]),
  };
}

export function polygonToBBox(poly: SelectionPolygon): BBox {
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const [lat, lon] of poly) {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
  }
  return { latMin, latMax, lonMin, lonMax };
}

/** Ray-casting point-in-polygon (lat/lon treated as y/x). */
export function pointInPolygon(lat: number, lon: number, poly: SelectionPolygon): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function segIntersect(
  a1: number, a2: number, b1: number, b2: number,
  c1: number, c2: number, d1: number, d2: number,
): boolean {
  const det = (a2 - a1) * (d2 - c2) - (b2 - b1) * (d1 - c1);
  if (Math.abs(det) < 1e-15) return false;
  const t = ((c1 - a1) * (d2 - c2) - (c2 - a2) * (d1 - c1)) / det;
  const u = ((c1 - a1) * (b2 - b1) - (c2 - a2) * (a2 - a1)) / det;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function polylineTouchesPolygon(coords: [number, number][], poly: SelectionPolygon): boolean {
  if (poly.length < 3) return false;
  for (const [la, lo] of coords) {
    if (pointInPolygon(la, lo, poly)) return true;
  }
  const n = poly.length;
  for (let i = 1; i < coords.length; i++) {
    const [aLat, aLon] = coords[i - 1];
    const [bLat, bLon] = coords[i];
    for (let j = 0; j < n; j++) {
      const [cLat, cLon] = poly[j];
      const [dLat, dLon] = poly[(j + 1) % n];
      if (segIntersect(aLat, aLon, bLat, bLon, cLat, cLon, dLat, dLon)) return true;
    }
  }
  return false;
}

export function pointInBBox(lat: number, lon: number, bb: BBox): boolean {
  return lat >= bb.latMin && lat <= bb.latMax && lon >= bb.lonMin && lon <= bb.lonMax;
}

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

function filterDistrictsByPoint(
  districts: District[],
  inside: (lat: number, lon: number) => boolean,
): { districts: District[]; oltN: number; tbN: number; orkN: number; subN: number } {
  let oltN = 0, tbN = 0, orkN = 0, subN = 0;
  const filteredDistricts: District[] = [];

  for (const d of districts) {
    const oltInside = inside(d.olt.lat, d.olt.lon);
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
  return { districts: filteredDistricts, oltN, tbN, orkN, subN };
}

export function filterByPolygon(
  districts: District[],
  cables: Cable[],
  joints: InlineJoint[],
  poly: SelectionPolygon,
): FilteredNetwork {
  const inside = (lat: number, lon: number) => pointInPolygon(lat, lon, poly);
  const { districts: filteredDistricts, oltN, tbN, orkN, subN } = filterDistrictsByPoint(districts, inside);
  const filteredCables = cables.filter((c) => polylineTouchesPolygon(c.coords, poly));
  const filteredJoints = joints.filter((j) => inside(j.lat, j.lon));
  return {
    districts: filteredDistricts,
    cables: filteredCables,
    joints: filteredJoints,
    counts: {
      olt: oltN, tb: tbN, ork: orkN, sub: subN,
      cable: filteredCables.length,
      joint: filteredJoints.length,
    },
  };
}

export function filterByBBox(
  districts: District[],
  cables: Cable[],
  joints: InlineJoint[],
  bb: BBox,
): FilteredNetwork {
  const inside = (lat: number, lon: number) => pointInBBox(lat, lon, bb);
  const { districts: filteredDistricts, oltN, tbN, orkN, subN } = filterDistrictsByPoint(districts, inside);
  const filteredCables = cables.filter((c) => polylineTouchesBBox(c.coords, bb));
  const filteredJoints = joints.filter((j) => inside(j.lat, j.lon));
  return {
    districts: filteredDistricts,
    cables: filteredCables,
    joints: filteredJoints,
    counts: {
      olt: oltN, tb: tbN, ork: orkN, sub: subN,
      cable: filteredCables.length,
      joint: filteredJoints.length,
    },
  };
}
