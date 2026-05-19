// Bulk network repair operations exposed to the AI as one tool.
// Conservative — only does things that are safe to do without user judgement:
//   1. Delete phantom cables (oversized for type, cross-district shorts).
//   2. Connect orphan subscribers to the nearest ORK in their district.
// Architectural decisions (relocating TBs, creating new ORKs for overloads,
// reassigning subscribers) are intentionally left out — those need the user
// to weigh trade-offs.

import type { District, Cable, Subscriber } from '@/types/network';
import { CABLE_FIBERS } from '@/types/network';
import { haversineM } from './KMeans';
import { getRoute, OsrmRouteOptions } from './OSRMRouter';

// GPON-realistic length caps per cable type — anything longer is almost
// always the result of an id collision after consolidation.
const MAX_LEN_BY_TYPE: Record<string, number> = {
  'ОК-4': 500,
  'ОК-8': 3000,
  'ОК-12': 3000,
  'ОК-16': 5000,
  'ОК-24': 8000,
  'ОК-32': 10000,
  'ОК-48': 10000,
  'ОК-96': 12000,
};

const SHORT_CABLE_TYPES = new Set(['ОК-4', 'ОК-8', 'ОК-12']);

const MAX_DROP_M = 500;

export interface RepairReport {
  deletedCables: Array<{ id: string; reason: string; fromId: string; toId: string; lengthM: number }>;
  addedCables: Array<{ fromId: string; toId: string; lengthM: number }>;
  orphansWithoutOrk: Array<{ id: string; lat: number; lon: number; district: string }>;
  warnings: string[];
}

export interface RepairPlan {
  toDelete: string[];                                          // cable ids
  toConnect: Array<{ sub: Subscriber; orkId: string; orkLat: number; orkLon: number }>;
  report: RepairReport;
}

// Build a (read-only) plan: what cables to delete and which subscribers to
// connect.  Caller applies the mutations.
export function planRepair(districts: District[], cables: Cable[]): RepairPlan {
  const report: RepairReport = {
    deletedCables: [],
    addedCables: [],
    orphansWithoutOrk: [],
    warnings: [],
  };

  // Entity → district lookup.
  const entityDistrict = new Map<string, string>();
  for (const d of districts) {
    entityDistrict.set(d.olt.id, d.name);
    for (const tb of d.olt.transitBoxes) {
      entityDistrict.set(tb.id, d.name);
      for (const ork of tb.orks) {
        entityDistrict.set(ork.id, d.name);
        for (const s of ork.subscribers) entityDistrict.set(s.id, d.name);
      }
    }
  }

  // === 1. Identify phantom cables to delete ===
  const toDelete = new Set<string>();
  for (const c of cables) {
    const cap = MAX_LEN_BY_TYPE[c.type];
    if (cap && c.lengthM > cap) {
      toDelete.add(c.id);
      report.deletedCables.push({
        id: c.id,
        reason: `длина ${(c.lengthM / 1000).toFixed(2)} км > потолок ${cap / 1000} км для ${c.type}`,
        fromId: c.fromId, toId: c.toId, lengthM: c.lengthM,
      });
      continue;
    }
    if (SHORT_CABLE_TYPES.has(c.type)) {
      const fD = entityDistrict.get(c.fromId);
      const tD = entityDistrict.get(c.toId);
      if (fD && tD && fD !== tD) {
        toDelete.add(c.id);
        report.deletedCables.push({
          id: c.id,
          reason: `межрайонный ${c.type}: ${fD} → ${tD}`,
          fromId: c.fromId, toId: c.toId, lengthM: c.lengthM,
        });
      }
    }
  }

  // === 2. Find orphan subscribers (no cable) and pair with nearest in-district ORK ===
  const survivingCables = cables.filter((c) => !toDelete.has(c.id));
  const connected = new Set<string>();
  for (const c of survivingCables) {
    connected.add(c.fromId);
    connected.add(c.toId);
  }

  const toConnect: RepairPlan['toConnect'] = [];
  for (const d of districts) {
    for (const s of d.subscribers) {
      if (connected.has(s.id)) continue;
      let bestOrk: { id: string; lat: number; lon: number } | null = null;
      let bestDist = Infinity;
      for (const tb of d.olt.transitBoxes) {
        for (const ork of tb.orks) {
          const dist = haversineM(s.lat, s.lon, ork.lat, ork.lon);
          if (dist < bestDist) {
            bestDist = dist;
            bestOrk = { id: ork.id, lat: ork.lat, lon: ork.lon };
          }
        }
      }
      if (bestOrk && bestDist <= MAX_DROP_M) {
        toConnect.push({ sub: s, orkId: bestOrk.id, orkLat: bestOrk.lat, orkLon: bestOrk.lon });
      } else {
        report.orphansWithoutOrk.push({ id: s.id, lat: s.lat, lon: s.lon, district: d.name });
        if (bestOrk) {
          report.warnings.push(
            `${s.id}: ближайший ОРК ${bestOrk.id} в ${Math.round(bestDist)} м (> ${MAX_DROP_M}). Нужен новый ОРК или ручное решение.`,
          );
        } else {
          report.warnings.push(`${s.id}: в районе «${d.name}» вообще нет ОРК.`);
        }
      }
    }
  }

  return { toDelete: Array.from(toDelete), toConnect, report };
}

// Build the drop cable for a freshly-paired subscriber.  OSRM-routes if enabled.
export async function buildDropCable(
  sub: Subscriber,
  orkId: string,
  orkLat: number,
  orkLon: number,
  useOSRM: boolean,
  osrmOpts?: OsrmRouteOptions,
): Promise<Cable> {
  let coords: [number, number][] = [[orkLat, orkLon], [sub.lat, sub.lon]];
  let routed = false;
  let lengthM = haversineM(orkLat, orkLon, sub.lat, sub.lon);
  if (useOSRM) {
    try {
      const r = await getRoute(orkLat, orkLon, sub.lat, sub.lon, osrmOpts);
      if (r && r.length > 2) {
        coords = r;
        routed = true;
        lengthM = 0;
        for (let i = 1; i < r.length; i++) {
          lengthM += haversineM(r[i - 1][0], r[i - 1][1], r[i][0], r[i][1]);
        }
      }
    } catch { /* keep straight */ }
  }
  return {
    id: `cable-fix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'ОК-4',
    fibers: CABLE_FIBERS['ОК-4'],
    fromId: orkId,
    toId: sub.id,
    coords,
    lengthM,
    routedByOSRM: routed,
  };
}
