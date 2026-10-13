import { SNP_STAGE_SPECS, type PlanRoute } from '@/types/construction';
import {
  lineLook, routeTitle, PLAN_LINE_COLOR, STAGE_LINE_COLOR, type RouteView,
} from './routeStyle';
import { routePaint, formatMeters } from './mapDecor';
import type { RouteWork } from './routeSegments';
import type { KmlLine } from './kmlExport';

/**
 * Трассы для выгрузки в KML — тем же расчётом, что и карта.
 *
 * Выгрузка красила каждую линию цветом этапа села и подписывала её этапом.
 * Альтернативный вариант и отвод к школе уходили проектировщику в Google
 * Earth как построенные — ровно то, от чего карта уже ушла (№268), только
 * в файле, который отправляют наружу. Теперь цвет и подпись — как на
 * карте: не основная линия без работ — синяя проектная, «работ не
 * отмечено»; пройденная частью — синяя, а сделанные куски лежат отдельной
 * папкой цветом этапа там, где копали.
 */

export interface KmlRoutes {
  /** Сами трассы — по одной линии на трассу. */
  lines: KmlLine[];
  /** Где копали: закрашенные куски, отдельной папкой. */
  done: KmlLine[];
}

export function kmlRouteLines(
  routes: PlanRoute[],
  views: RouteView[],
  work: Pick<RouteWork, 'segments' | 'unplaced'>,
): KmlRoutes {
  const byId = new Map(views.map((v) => [v.id, v]));
  const pieces = new Map<string, { fromM: number; toM: number }[]>();
  for (const sg of work.segments) {
    const list = pieces.get(sg.routeId);
    if (list) list.push(sg); else pieces.set(sg.routeId, [sg]);
  }
  const unplaced = new Map(work.unplaced.map((u) => [u.routeId, u]));
  const workedIds = new Set<string>();
  for (const [id, list] of pieces) if (list.some((p) => p.toM - p.fromM > 0.5)) workedIds.add(id);
  for (const [id, u] of unplaced) {
    if (u.meters > 0 || (u.pastEnd?.endM ?? 0) + (u.pastEnd?.startM ?? 0) > 0) workedIds.add(id);
  }

  const lines: KmlLine[] = [];
  const done: KmlLine[] = [];
  for (const r of routes) {
    const v = byId.get(r.id);
    const name = v ? routeTitle(v) : (r.name || 'Трасса');
    const lengthText = `${(r.lengthM / 1000).toFixed(3)} км`;
    if (!v || r.coords.length < 2) {
      lines.push({
        name, coords: r.coords, color: v?.color ?? PLAN_LINE_COLOR,
        description: [r.name, lengthText, 'работ не было', r.source].filter(Boolean).join(' · '),
      });
      continue;
    }
    const u = unplaced.get(r.id);
    const paint = routePaint(r.coords, pieces.get(r.id) ?? [], u?.meters ?? 0);
    const beyondM = (u?.pastEnd?.endM ?? 0) + (u?.pastEnd?.startM ?? 0);
    const worked = workedIds.has(r.id);
    const look = lineLook(v, (id) => workedIds.has(id));
    const workColor = v.stage ? v.color : STAGE_LINE_COLOR.mkt;
    // Пройдена частью — линия остаётся проектом, а сделанное ложится
    // поверх отдельными кусками: сплошная цветная во всю длину обещала бы
    // готовность, которой нет.
    const partial = worked && !paint.full;
    const color = look.planOnly || partial ? PLAN_LINE_COLOR : worked ? workColor : v.color;
    const status = look.idleLabel ?? (v.stage ? SNP_STAGE_SPECS[v.stage].label : 'работ не было');
    const extra = [
      partial && paint.doneM > 0.5 ? `закрашено ${formatMeters(paint.doneM)} из ${formatMeters(paint.totalM)}` : '',
      paint.unplacedM > 0 ? `ещё ${formatMeters(u?.meters ?? paint.unplacedM)} — место не указано` : '',
      beyondM > 0 ? `${formatMeters(beyondM)} за концом линии` : '',
    ].filter(Boolean);
    lines.push({
      name,
      coords: r.coords,
      color,
      description: [r.name, lengthText, status, ...extra, r.source].filter(Boolean).join(' · '),
    });
    if (partial) {
      for (const coords of paint.done) {
        done.push({ name: `${name} — сделано`, coords, color: workColor, description: status });
      }
    }
  }
  return { lines, done };
}
