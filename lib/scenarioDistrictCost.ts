import type { ScenarioSlotData, PriceCatalog, ProjectSettings } from '@/types/network';
import { districtCostRows } from '@/components/Network/districtCost';
import { formatMoney } from '@/components/Network/CostCalc';

export interface DistrictCostCompareRow {
  name: string;
  color: string;
  totalA: number;
  totalB: number;
  delta: number;
}

export function compareScenarioDistrictCosts(
  a: ScenarioSlotData,
  b: ScenarioSlotData,
  settings: ProjectSettings,
  prices: PriceCatalog,
): DistrictCostCompareRow[] {
  const rowsA = districtCostRows(a.districts, a.cables, a.joints ?? [], settings, prices);
  const rowsB = districtCostRows(b.districts, b.cables, b.joints ?? [], settings, prices);
  const mapA = new Map(rowsA.map((r) => [r.name, r]));
  const mapB = new Map(rowsB.map((r) => [r.name, r]));
  const names = new Set([...mapA.keys(), ...mapB.keys()]);

  return [...names].map((name) => {
    const ra = mapA.get(name);
    const rb = mapB.get(name);
    const totalA = ra?.total ?? 0;
    const totalB = rb?.total ?? 0;
    return {
      name,
      color: ra?.color ?? rb?.color ?? '#94a3b8',
      totalA,
      totalB,
      delta: totalB - totalA,
    };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

export function formatCostDelta(n: number, currency: string): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatMoney(n, currency)}`;
}
