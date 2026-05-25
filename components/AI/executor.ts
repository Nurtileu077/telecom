// Client-side tool executor.  Maps Claude's tool_use blocks to operations on
// the useNetwork hook + the map fly-to ref.  Returns a string the model can
// read back.

import type { District, Cable, ValidationIssue } from '@/types/network';
import { bandwidthReport } from '@/components/Network/Bandwidth';
import type { AITool } from './tools';

// Minimal interface — we type only what we actually use rather than coupling
// to the full return type of useNetwork().
export interface NetForExecutor {
  districts: District[];
  cables: Cable[];
  validationIssues?: ValidationIssue[];
  addSubscriberAt: (lat: number, lon: number, district: string, desc: string) => Promise<void> | void;
  addOLTAt: (lat: number, lon: number, districtName: string) => void;
  addTBAt: (lat: number, lon: number, oltId?: string) => void;
  addORKAt: (lat: number, lon: number, tbId?: string) => void;
  addCableBetween: (fromId: string, toId: string, type?: Cable['type']) => Promise<void> | void;
  reconsolidate: (bbox?: { latMin: number; lonMin: number; latMax: number; lonMax: number } | null) => Promise<void> | void;
  deleteSubscriber: (id: string) => void;
  deleteCable: (id: string) => void;
  rebuildFromCurrent: () => Promise<void> | void;
  // Active selection rectangle, if the user drew one.  Tools surface this
  // to the AI so it can scope operations without the user re-specifying.
  selectionBBox?: { latMin: number; lonMin: number; latMax: number; lonMax: number } | null;
  autoRepair: (bbox?: { latMin: number; lonMin: number; latMax: number; lonMax: number } | null) => Promise<{
    deletedCables: Array<{ id: string; reason: string; fromId: string; toId: string; lengthM: number }>;
    addedCables: Array<{ fromId: string; toId: string; lengthM: number }>;
    orphansWithoutOrk: Array<{ id: string; lat: number; lon: number; district: string }>;
    warnings: string[];
  }>;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function minDistanceToPolyline(lat: number, lon: number, coords: [number, number][]): number {
  if (coords.length === 0) return Infinity;
  if (coords.length === 1) return haversineM(lat, lon, coords[0][0], coords[0][1]);
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const [la, lo] = coords[i - 1];
    const [lb, lob] = coords[i];
    // Approximate metres in local plane
    const cosLat = Math.cos(((la + lb) / 2) * Math.PI / 180);
    const ax = lo * 111320 * cosLat, ay = la * 111320;
    const bx = lob * 111320 * cosLat, by = lb * 111320;
    const px = lon * 111320 * cosLat, py = lat * 111320;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
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
        await net.reconsolidate(net.selectionBBox);
        return net.selectionBBox
          ? 'Запустил консолидацию ТОЛЬКО в выделенной области (остальная сеть не тронута).'
          : 'Запустил консолидацию кабелей на общих дорогах.';
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
      case 'inspect_cable': {
        const { id } = tool.input;
        const c = net.cables.find((x) => x.id === id);
        if (!c) return `Кабель "${id}" не найден.`;
        // Trim very long coord arrays — only show endpoints + every ~8th vertex.
        const stride = Math.max(1, Math.floor(c.coords.length / 30));
        const sampledCoords: [number, number][] = [];
        for (let i = 0; i < c.coords.length; i += stride) sampledCoords.push(c.coords[i]);
        if (sampledCoords[sampledCoords.length - 1] !== c.coords[c.coords.length - 1]) {
          sampledCoords.push(c.coords[c.coords.length - 1]);
        }
        return JSON.stringify({
          id: c.id,
          type: c.type,
          fibers: c.fibers,
          fromId: c.fromId,
          toId: c.toId,
          lengthM: Math.round(c.lengthM),
          routedByOSRM: c.routedByOSRM,
          vertexCount: c.coords.length,
          coordsSample: sampledCoords,
        });
      }
      case 'cables_near': {
        const { lat, lon, radius_m = 50, limit = 20 } = tool.input;
        const hits: Array<{ id: string; type: string; lengthM: number; fromId: string; toId: string; routedByOSRM: boolean; minDistM: number }> = [];
        for (const c of net.cables) {
          const d = minDistanceToPolyline(lat, lon, c.coords);
          if (d <= radius_m) hits.push({ id: c.id, type: c.type, lengthM: Math.round(c.lengthM), fromId: c.fromId, toId: c.toId, routedByOSRM: c.routedByOSRM, minDistM: Math.round(d) });
        }
        hits.sort((a, b) => a.minDistM - b.minDistM);
        return JSON.stringify({ lat, lon, radius_m, count: hits.length, hits: hits.slice(0, limit) });
      }
      case 'routing_analysis': {
        const byType = new Map<string, { total: number; routed: number; totalLengthM: number; longestStraight: number; longestStraightId: string | null }>();
        for (const c of net.cables) {
          const cur = byType.get(c.type) ?? { total: 0, routed: 0, totalLengthM: 0, longestStraight: 0, longestStraightId: null };
          cur.total++;
          if (c.routedByOSRM) cur.routed++;
          cur.totalLengthM += c.lengthM;
          if (!c.routedByOSRM && c.lengthM > cur.longestStraight) {
            cur.longestStraight = c.lengthM;
            cur.longestStraightId = c.id;
          }
          byType.set(c.type, cur);
        }
        const summary = Array.from(byType.entries()).map(([type, s]) => ({
          type,
          total: s.total,
          osrmRoutedPct: s.total ? Math.round((s.routed / s.total) * 100) : 0,
          totalKm: +(s.totalLengthM / 1000).toFixed(2),
          longestStraightM: Math.round(s.longestStraight),
          longestStraightId: s.longestStraightId,
        }));
        const totalCount = net.cables.length;
        const totalRouted = net.cables.filter((c) => c.routedByOSRM).length;
        return JSON.stringify({
          totalCables: totalCount,
          osrmRoutedOverallPct: totalCount ? Math.round((totalRouted / totalCount) * 100) : 0,
          byType: summary,
        });
      }
      case 'get_validation_issues': {
        const issues = net.validationIssues ?? [];
        if (issues.length === 0) return JSON.stringify({ count: 0, issues: [] });
        // Group identical messages so the model doesn't drown in duplicates.
        const grouped = new Map<string, { type: string; message: string; count: number; examples: string[] }>();
        for (const i of issues) {
          const key = `${i.type}::${i.message}`;
          const g = grouped.get(key) ?? { type: i.type, message: i.message, count: 0, examples: [] };
          g.count++;
          if (i.entityId && g.examples.length < 3) g.examples.push(i.entityId);
          grouped.set(key, g);
        }
        return JSON.stringify({ count: issues.length, issues: Array.from(grouped.values()) });
      }
      case 'inspect_entity': {
        const { id } = tool.input;
        for (const d of net.districts) {
          if (d.olt.id === id) {
            return JSON.stringify({
              kind: 'olt',
              id: d.olt.id,
              lat: d.olt.lat,
              lon: d.olt.lon,
              district: d.name,
              model: d.olt.model,
              transitBoxes: d.olt.transitBoxes.map((tb) => ({ id: tb.id, orks: tb.orks.length })),
              subscribers: d.subscribers.length,
            });
          }
          for (const tb of d.olt.transitBoxes) {
            if (tb.id === id) {
              return JSON.stringify({
                kind: 'tb', id: tb.id, lat: tb.lat, lon: tb.lon, district: d.name,
                oltId: tb.oltId, muftaType: tb.muftaType, inCable: tb.inCable, outCable: tb.outCable,
                orks: tb.orks.map((o) => ({ id: o.id, subscribers: o.subscribers.length })),
              });
            }
            for (const ork of tb.orks) {
              if (ork.id === id) {
                return JSON.stringify({
                  kind: 'ork', id: ork.id, lat: ork.lat, lon: ork.lon, district: d.name,
                  tbId: ork.tbId, splitter: ork.splitter, boxType: ork.boxType,
                  subscribers: ork.subscribers.map((s) => ({ id: s.id, desc: s.desc })),
                });
              }
              for (const s of ork.subscribers) {
                if (s.id === id) {
                  return JSON.stringify({
                    kind: 'sub', id: s.id, lat: s.lat, lon: s.lon,
                    desc: s.desc, district: s.district, orkId: s.orkId,
                  });
                }
              }
            }
          }
        }
        return `Сущность "${id}" не найдена.`;
      }
      case 'delete_cable': {
        const { id } = tool.input;
        const c = net.cables.find((x) => x.id === id);
        if (!c) return `Кабель "${id}" не найден.`;
        net.deleteCable(id);
        return `Удалил кабель ${id} (${c.type}, ${Math.round(c.lengthM)} м, ${c.fromId} → ${c.toId}).`;
      }
      case 'rebuild_network': {
        await net.rebuildFromCurrent();
        return 'Пересобрал сеть из текущих абонентов + OLT-координат. Ручные правки кабелей могли быть утеряны — это ожидаемо.';
      }
      case 'bandwidth_report': {
        const r = bandwidthReport(net.districts, 512);
        return JSON.stringify({
          totals: r.totals,
          olts: r.olts.map((o) => ({
            id: o.id, district: o.district,
            cameras: o.cameras, byKind: o.load, bySide: o.bySide,
            totalBwMbps: o.totalBwMbps,
            utilisation: Math.round((o.cameras / o.maxCamerasPerOlt) * 100),
            overcapacity: o.overcapacity,
          })),
          orks: r.orks.map((o) => ({
            id: o.id, district: o.district,
            splitter: o.splitter,
            cameras: o.cameras,
            capacityMbps: Math.round(o.capacityMbps),
            maxCamBwMbps: o.maxCamBwMbps,
            utilisation: o.utilisation,
            overloaded: o.overloaded,
          })),
        });
      }
      case 'auto_repair': {
        const r = await net.autoRepair(net.selectionBBox);
        return JSON.stringify({
          scope: net.selectionBBox ? 'selection' : 'whole-network',
          deletedCount: r.deletedCables.length,
          addedCount: r.addedCables.length,
          orphansLeft: r.orphansWithoutOrk.length,
          warningCount: r.warnings.length,
          // Trim verbose arrays so the model doesn't burn tokens on listing
          // 400 deletions one by one.  Sample the first 10 of each.
          deletedSample: r.deletedCables.slice(0, 10),
          addedSample: r.addedCables.slice(0, 10),
          orphansSample: r.orphansWithoutOrk.slice(0, 10),
          warningsSample: r.warnings.slice(0, 10),
        });
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
