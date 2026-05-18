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
): FilteredNetwork {
  let oltN = 0, tbN = 0, orkN = 0, subN = 0;

  const filteredDistricts: District[] = [];
  for (const d of districts) {
    const oltInside = pointInBBox(d.olt.lat, d.olt.lon, bb);

    // Filter TBs by their own coord, ORKs by theirs, subs by theirs.
    const filteredTBs: TransitBox[] = [];
    for (const tb of d.olt.transitBoxes) {
      const tbInside = pointInBBox(tb.lat, tb.lon, bb);
      const filteredOrks: ORK[] = [];
      for (const ork of tb.orks) {
        const orkInside = pointInBBox(ork.lat, ork.lon, bb);
        const filteredSubs: Subscriber[] = ork.subscribers.filter((s) => pointInBBox(s.lat, s.lon, bb));
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

    const filteredSubsTop: Subscriber[] = d.subscribers.filter((s) => pointInBBox(s.lat, s.lon, bb));

    if (oltInside || filteredTBs.length > 0 || filteredSubsTop.length > 0) {
      filteredDistricts.push({
        ...d,
        olt: { ...d.olt, transitBoxes: filteredTBs },
        subscribers: filteredSubsTop,
      });
      if (oltInside) oltN++;
    }
  }

  const filteredCables = cables.filter((c) => polylineTouchesBBox(c.coords, bb));
  const filteredJoints = joints.filter((j) => pointInBBox(j.lat, j.lon, bb));

  return {
    districts: filteredDistricts,
    cables: filteredCables,
    joints: filteredJoints,
    counts: { olt: oltN, tb: tbN, ork: orkN, sub: subN, cable: filteredCables.length, joint: filteredJoints.length },
  };
}
