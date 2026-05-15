// Client-side tool executor.  Maps Claude's tool_use blocks to operations on
// the useNetwork hook + the map fly-to ref.  Returns a string the model can
// read back.

import type { District, Cable } from '@/types/network';
import type { AITool } from './tools';

// Minimal interface — we type only what we actually use rather than coupling
// to the full return type of useNetwork().
export interface NetForExecutor {
  districts: District[];
  cables: Cable[];
  addSubscriberAt: (lat: number, lon: number, district: string, desc: string) => Promise<void> | void;
  addOLTAt: (lat: number, lon: number, districtName: string) => void;
  addTBAt: (lat: number, lon: number, oltId?: string) => void;
  addORKAt: (lat: number, lon: number, tbId?: string) => void;
  addCableBetween: (fromId: string, toId: string, type?: Cable['type']) => Promise<void> | void;
  reconsolidate: () => Promise<void> | void;
  deleteSubscriber: (id: string) => void;
}

export type FlyToFn = (lat: number, lon: number, zoom?: number) => void;

export async function executeTool(
  tool: AITool,
  net: NetForExecutor,
  flyTo: FlyToFn | null,
): Promise<string> {
  try {
    switch (tool.name) {
      case 'add_subscriber': {
        const { lat, lon, desc } = tool.input;
        // Pick a default district from the current map (the user's right-click
        // flow does the same).  The incremental addSubscriberAt then re-picks
        // the nearest ORK and reassigns district internally.
        const district = net.districts[0]?.name ?? 'Без района';
        await net.addSubscriberAt(lat, lon, district, desc ?? `Або. (AI)`);
        return `Добавил абонента на ${lat.toFixed(5)}, ${lon.toFixed(5)} — привязал к ближайшему ОРК.`;
      }
      case 'add_olt': {
        const { lat, lon, district } = tool.input;
        net.addOLTAt(lat, lon, district);
        return `Поставил OLT в районе «${district}» на ${lat.toFixed(5)}, ${lon.toFixed(5)}.`;
      }
      case 'add_tb': {
        const { lat, lon } = tool.input;
        if (net.districts.length === 0) return 'Ошибка: сначала нужен хотя бы один OLT.';
        net.addTBAt(lat, lon);
        return `Поставил Муфту на ${lat.toFixed(5)}, ${lon.toFixed(5)}.`;
      }
      case 'add_ork': {
        const { lat, lon } = tool.input;
        const hasTB = net.districts.some((d) => d.olt.transitBoxes.length > 0);
        if (!hasTB) return 'Ошибка: сначала нужна Муфта-TB.';
        net.addORKAt(lat, lon);
        return `Поставил ОРК на ${lat.toFixed(5)}, ${lon.toFixed(5)}.`;
      }
      case 'connect_cable': {
        const { from_id, to_id, type } = tool.input;
        const exists = (id: string) =>
          net.districts.some(
            (d) =>
              d.olt.id === id ||
              d.olt.transitBoxes.some(
                (t) =>
                  t.id === id ||
                  t.orks.some(
                    (o) => o.id === id || o.subscribers.some((s) => s.id === id),
                  ),
              ),
          );
        if (!exists(from_id)) return `Ошибка: не нашёл сущность с id "${from_id}".`;
        if (!exists(to_id)) return `Ошибка: не нашёл сущность с id "${to_id}".`;
        await net.addCableBetween(from_id, to_id, type);
        return `Протянул кабель ${from_id} → ${to_id}${type ? ` (${type})` : ''} по дорогам через OSRM.`;
      }
      case 'reconsolidate': {
        await net.reconsolidate();
        return 'Запустил консолидацию кабелей на общих дорогах.';
      }
      case 'fly_to': {
        const { lat, lon, zoom } = tool.input;
        if (flyTo) flyTo(lat, lon, zoom);
        return `Перевожу карту на ${lat.toFixed(5)}, ${lon.toFixed(5)}.`;
      }
      case 'list_entities': {
        const { kind, limit = 50 } = tool.input;
        const items: Array<{ id: string; lat: number; lon: number; desc?: string; district?: string }> = [];
        for (const d of net.districts) {
          if (kind === 'olt') {
            items.push({ id: d.olt.id, lat: d.olt.lat, lon: d.olt.lon, district: d.name });
          } else {
            for (const tb of d.olt.transitBoxes) {
              if (kind === 'tb') items.push({ id: tb.id, lat: tb.lat, lon: tb.lon, district: d.name });
              if (kind === 'ork' || kind === 'sub') {
                for (const ork of tb.orks) {
                  if (kind === 'ork') items.push({ id: ork.id, lat: ork.lat, lon: ork.lon, district: d.name });
                  if (kind === 'sub') {
                    for (const s of ork.subscribers) {
                      items.push({ id: s.id, lat: s.lat, lon: s.lon, desc: s.desc, district: d.name });
                    }
                  }
                }
              }
            }
          }
        }
        const trimmed = items.slice(0, limit);
        return JSON.stringify({ kind, total: items.length, returned: trimmed.length, items: trimmed });
      }
      case 'find_entity': {
        const q = tool.input.query.toLowerCase();
        const hits: Array<{ id: string; kind: string; lat: number; lon: number; desc?: string }> = [];
        for (const d of net.districts) {
          if (d.olt.id.toLowerCase().includes(q)) hits.push({ id: d.olt.id, kind: 'olt', lat: d.olt.lat, lon: d.olt.lon });
          for (const tb of d.olt.transitBoxes) {
            if (tb.id.toLowerCase().includes(q)) hits.push({ id: tb.id, kind: 'tb', lat: tb.lat, lon: tb.lon });
            for (const ork of tb.orks) {
              if (ork.id.toLowerCase().includes(q)) hits.push({ id: ork.id, kind: 'ork', lat: ork.lat, lon: ork.lon });
              for (const s of ork.subscribers) {
                if (
                  s.id.toLowerCase().includes(q) ||
                  (s.desc ?? '').toLowerCase().includes(q)
                ) {
                  hits.push({ id: s.id, kind: 'sub', lat: s.lat, lon: s.lon, desc: s.desc });
                }
              }
            }
          }
        }
        return JSON.stringify({ query: q, count: hits.length, hits: hits.slice(0, 30) });
      }
      case 'delete_entity': {
        const { id } = tool.input;
        if (!id.startsWith('sub')) return `Удаление "${id}" пока не поддерживается — только абоненты (sub-*).`;
        net.deleteSubscriber(id);
        return `Удалил ${id}.`;
      }
      default:
        return `Неизвестный инструмент: ${(tool as { name: string }).name}`;
    }
  } catch (e: any) {
    return `Ошибка выполнения: ${e?.message ?? e}`;
  }
}

export function networkSummary(districts: District[], cables: Cable[]): string {
  const totalSubs = districts.reduce((s, d) => s + d.subscribers.length, 0);
  const totalTbs = districts.reduce((s, d) => s + d.olt.transitBoxes.length, 0);
  const totalOrks = districts.reduce(
    (s, d) => s + d.olt.transitBoxes.reduce((t, tb) => t + tb.orks.length, 0),
    0,
  );
  const distrLines = districts
    .slice(0, 20)
    .map(
      (d) =>
        `  • ${d.name}: OLT ${d.olt.id} @ ${d.olt.lat.toFixed(4)},${d.olt.lon.toFixed(4)} — ${d.olt.transitBoxes.length} муфт / ${d.subscribers.length} або.`,
    )
    .join('\n');
  return `Районов: ${districts.length}, OLT: ${districts.length}, Муфт: ${totalTbs}, ОРК: ${totalOrks}, Абонентов: ${totalSubs}, Кабелей: ${cables.length}.\n${distrLines}${districts.length > 20 ? '\n  …' : ''}`;
}
