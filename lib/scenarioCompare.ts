import type { ScenarioSlotData, ProjectSettings } from '@/types/network';
import { calculateMaterials } from '@/components/Network/MaterialCalc';

export interface ScenarioMetrics {
  subscribers: number;
  cableKm: number;
  orks: number;
  tbs: number;
  oltCount: number;
}

export function metricsFromSlot(slot: ScenarioSlotData): ScenarioMetrics {
  let orks = 0;
  let tbs = 0;
  let subs = 0;
  for (const d of slot.districts) {
    for (const tb of d.olt.transitBoxes) {
      tbs++;
      for (const ork of tb.orks) {
        orks++;
        subs += ork.subscribers.length;
      }
    }
  }
  const cableKm = slot.cables.reduce((s, c) => s + c.lengthM, 0) / 1000;
  return {
    subscribers: subs || slot.districts.reduce((s, d) => s + d.subscribers.length, 0),
    cableKm: Math.round(cableKm * 100) / 100,
    orks,
    tbs,
    oltCount: slot.districts.length,
  };
}

export interface ScenarioCompareRow {
  label: string;
  a: string;
  b: string;
  delta: string;
}

export function compareScenarioMetrics(a: ScenarioMetrics, b: ScenarioMetrics): ScenarioCompareRow[] {
  const row = (label: string, va: number, vb: number, unit: string) => {
    const d = vb - va;
    const sign = d > 0 ? '+' : '';
    return {
      label,
      a: `${va.toLocaleString('ru')}${unit}`,
      b: `${vb.toLocaleString('ru')}${unit}`,
      delta: d === 0 ? '—' : `${sign}${d.toLocaleString('ru')}${unit}`,
    };
  };
  return [
    row('OLT', a.oltCount, b.oltCount, ''),
    row('Муфты', a.tbs, b.tbs, ''),
    row('ОРК', a.orks, b.orks, ''),
    row('Камеры', a.subscribers, b.subscribers, ''),
    row('Кабель', a.cableKm, b.cableKm, ' км'),
  ];
}

export function estimateCableMeters(slot: ScenarioSlotData, settings: ProjectSettings): number {
  const m = calculateMaterials(slot.districts, slot.cables, settings, (slot.joints ?? []).length);
  return Math.round(m.cables.total);
}
