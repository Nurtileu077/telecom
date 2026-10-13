import type {
  DailyWorkEntry, AerialWorkEntry, DrillLogEntry, PlanRoute, SnpProgress, MapArea,
  SettlementOrder,
} from '@/types/construction';
import { routeViews, type RouteView } from './routeStyle';
import { effectiveProgress } from './stageDerive';
import { lineIndex } from './routeMain';
import { placeShifts, shiftIndex, type RoutePlacement } from './shiftPlace';

/**
 * На какой линии лежит каждая смена — одним расчётом для карты, точки
 * колонны и вчерашнего дня в движении.
 *
 * Пока каждое место искало линию по-своему (закраска — по селу, точка
 * колонны — по селу, вчерашний день — по имени участка), они спорили:
 * смена красила одну линию, колонна стояла на другой, а смена без КАТО
 * не попадала никуда. Здесь линия смены одна: её отметка, иначе линия, где
 * её колонна в этом селе отметилась в последний раз, иначе основная
 * линия села (см. routeMain). Село трассы — по routeVillage, с тёзками.
 */

export interface ShiftLinesContext {
  ground: DailyWorkEntry[];
  planRoutes: PlanRoute[];
  progress?: SnpProgress[];
  areas?: MapArea[];
  drills?: DrillLogEntry[];
  aerial?: AerialWorkEntry[];
  /** Реестр — сёла из него узнаются в названиях трасс так же, как на карте. */
  orders?: SettlementOrder[];
}

export interface ShiftLines {
  /** Сёла журнала с выведенными из смен — по ним трассы узнают своё село. */
  progress: SnpProgress[];
  views: RouteView[];
  view(routeId: string): RouteView | undefined;
  route(routeId: string): PlanRoute | undefined;
  /** Линия смены; undefined — смена ни на какой линии не лежит. */
  lineOf(e: DailyWorkEntry): string | undefined;
  /** Смены, лежащие на линии. */
  shiftsOn(routeId: string): DailyWorkEntry[];
  /** Места смен на линии по всем сменам — посчитанные один раз. */
  placement(routeId: string): RoutePlacement | null;
  /** Основная линия села. */
  mainOf(kato: string): string | undefined;
}

export function shiftLines(ctx: ShiftLinesContext): ShiftLines {
  const routes = ctx.planRoutes;
  const progress = ctx.orders
    ? effectiveProgress(ctx.progress ?? [], {
      orders: ctx.orders, ground: ctx.ground, aerial: ctx.aerial ?? [], drills: ctx.drills ?? [],
    })
    : ctx.progress ?? [];
  const views = routeViews(routes, { progress, areas: ctx.areas, drills: ctx.drills });
  const viewById = new Map(views.map((v) => [v.id, v]));
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const katoByRouteId = new Map(views.filter((v) => v.kato).map((v) => [v.id, v.kato as string]));
  const lines = lineIndex(routes, katoByRouteId, ctx.ground);
  const onRoute = shiftIndex(ctx.ground, lines.live, lines.lineOf);
  const cache = new Map<string, RoutePlacement>();

  const shiftsOn = (routeId: string) => onRoute(routeId, katoByRouteId.get(routeId));

  return {
    progress,
    views,
    view: (id) => viewById.get(id),
    route: (id) => routeById.get(id),
    lineOf(e) {
      const own = e.stop?.routeId;
      if (own && lines.live.has(own)) return own;
      return lines.lineOf.get(e.id) ?? (e.kato ? lines.mainByKato.get(e.kato) : undefined);
    },
    shiftsOn,
    placement(routeId) {
      const r = routeById.get(routeId);
      if (!r || r.coords.length < 2) return null;
      let pl = cache.get(routeId);
      if (!pl) {
        pl = placeShifts(r, shiftsOn(routeId));
        cache.set(routeId, pl);
      }
      return pl;
    },
    mainOf: (kato) => lines.mainByKato.get(kato),
  };
}
