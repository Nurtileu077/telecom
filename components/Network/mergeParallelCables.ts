import { Cable, CABLE_FIBERS, CABLE_SIZES } from '@/types/network';

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcLength(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}

function selectCableForFibers(fibers: number): Cable['type'] {
  return CABLE_SIZES.find((t) => CABLE_FIBERS[t] >= fibers) ?? 'ОК-96';
}

// Snap a coordinate to a 0.0003° grid (~33 m) for fuzzy road-segment matching.
// OSRM's overview=full can return slightly different intermediate waypoints for
// routes of different lengths on the same physical road — the grid absorbs those
// variations while still distinguishing parallel streets (typically >30 m apart).
const GRID = 0.0003;
function coordKey(c: [number, number]): string {
  return `${Math.round(c[0] / GRID)},${Math.round(c[1] / GRID)}`;
}

// Length of the shared coordinate prefix between two routes (grid-snapped comparison)
function sharedPrefixLen(a: [number, number][], b: [number, number][]): number {
  let i = 0;
  while (i < a.length && i < b.length && coordKey(a[i]) === coordKey(b[i])) i++;
  return i;
}

let splitCounter = 0;
function newSplitId() {
  return `split-${++splitCounter}`;
}

/**
 * After OSRM routing, cables from the same transit box to different ORKs often
 * share the same initial road segments — resulting in two visually parallel
 * cables on the same road.
 *
 * This function detects those shared prefixes, collapses them into one trunk
 * cable with the combined fiber count, and emits individual branch cables from
 * the divergence point.  Splice closures (муфты) belong at each divergence
 * point — their coordinates are returned in `splitPoints`.
 *
 * Only OSRM-routed, non-drop (ОК-4) cables are candidates for merging.
 */
export function mergeParallelCables(cables: Cable[]): {
  cables: Cable[];
  splitPoints: [number, number][];
} {
  splitCounter = 0;
  const splitPoints: [number, number][] = [];

  // Separate candidates from cables that are never merged
  const fixed: Cable[] = [];
  const candidates: Cable[] = [];

  for (const c of cables) {
    if (c.type === 'ОК-4' || !c.routedByOSRM) {
      fixed.push(c);
    } else {
      candidates.push(c);
    }
  }

  // Group candidates by their logical source node
  const byFrom = new Map<string, Cable[]>();
  for (const c of candidates) {
    if (!byFrom.has(c.fromId)) byFrom.set(c.fromId, []);
    byFrom.get(c.fromId)!.push(c);
  }

  const result: Cable[] = [...fixed];

  for (const group of byFrom.values()) {
    if (group.length <= 1) {
      result.push(...group);
      continue;
    }

    // Partition the group into "direction clusters":
    // cables that share ≥2 coords with the first cable go into one cluster;
    // the rest are retried against the remaining cables, and so on.
    const unprocessed = [...group];
    while (unprocessed.length > 0) {
      const base = unprocessed.shift()!;
      const cluster: Cable[] = [base];
      const leftover: Cable[] = [];

      for (const other of unprocessed) {
        if (sharedPrefixLen(base.coords, other.coords) >= 2) {
          cluster.push(other);
        } else {
          leftover.push(other);
        }
      }
      unprocessed.length = 0;
      unprocessed.push(...leftover);

      if (cluster.length === 1) {
        result.push(base);
        continue;
      }

      // Find shortest common prefix across the whole cluster
      let commonLen = cluster[0].coords.length;
      for (let i = 1; i < cluster.length; i++) {
        commonLen = Math.min(commonLen, sharedPrefixLen(cluster[0].coords, cluster[i].coords));
      }

      if (commonLen < 2) {
        // No real road segment in common — emit as-is
        result.push(...cluster);
        continue;
      }

      // Check whether every cable in the cluster is fully covered by the trunk
      // (i.e. the ORK lies on the shared segment itself — degenerate case).
      const trunkCoords = cluster[0].coords.slice(0, commonLen);
      const splitCoord = trunkCoords[commonLen - 1];

      // Build trunk cable
      const totalFibers = cluster.reduce((sum, c) => sum + c.fibers, 0);
      const trunkType = selectCableForFibers(totalFibers);
      const splitId = newSplitId();

      result.push({
        id: `trunk-${cluster[0].fromId}-${splitId}`,
        type: trunkType,
        fibers: totalFibers,
        fromId: cluster[0].fromId,
        toId: splitId,
        coords: trunkCoords,
        lengthM: calcLength(trunkCoords),
        routedByOSRM: true,
      });

      splitPoints.push(splitCoord);

      // Build branch cables from the divergence point to each ORK
      for (const cable of cluster) {
        const branchCoords = cable.coords.slice(commonLen - 1); // include split coord
        if (branchCoords.length < 2) {
          // ORK sits at or before the split point — skip zero-length branch
          continue;
        }
        result.push({
          ...cable,
          id: `${cable.id}-br`,
          fromId: splitId,
          coords: branchCoords,
          lengthM: calcLength(branchCoords),
        });
      }
    }
  }

  return { cables: result, splitPoints };
}
