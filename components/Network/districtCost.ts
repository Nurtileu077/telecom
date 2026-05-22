import type { District, Cable, InlineJoint, PriceCatalog, ProjectSettings } from '@/types/network';
import { calculateMaterials } from '@/components/Network/MaterialCalc';
import { calculateCost } from '@/components/Network/CostCalc';

export interface DistrictCostRow {
  name: string;
  color: string;
  subscribers: number;
  cableKm: number;
  total: number;
}

function entityIdsForDistrict(d: District): Set<string> {
  const ids = new Set<string>([d.olt.id]);
  for (const tb of d.olt.transitBoxes) {
    ids.add(tb.id);
    for (const ork of tb.orks) {
      ids.add(ork.id);
      for (const s of ork.subscribers) ids.add(s.id);
    }
  }
  for (const s of d.subscribers) ids.add(s.id);
  return ids;
}

export function districtCostRows(
  districts: District[],
  cables: Cable[],
  joints: InlineJoint[],
  settings: ProjectSettings,
  prices: PriceCatalog,
): DistrictCostRow[] {
  return districts.map((d) => {
    const ids = entityIdsForDistrict(d);
    const districtCables = cables.filter((c) => ids.has(c.fromId) || ids.has(c.toId));
    const jointCount = joints.filter((j) => ids.has(j.parentId)).length;
    const mats = calculateMaterials([d], districtCables, settings, jointCount);
    const cost = calculateCost(mats, prices);
    const cableKm = districtCables.reduce((s, c) => s + c.lengthM, 0) / 1000;
    return {
      name: d.name,
      color: d.color,
      subscribers: d.subscribers.length,
      cableKm: Math.round(cableKm * 100) / 100,
      total: cost.grandTotal,
    };
  }).sort((a, b) => b.total - a.total);
}
