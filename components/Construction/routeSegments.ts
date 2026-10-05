import {
  PlanRoute, DailyWorkEntry, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
} from '@/types/construction';
import { pointAtDistanceM, segMeters } from './routeProgress';
import { placeShifts, shiftIndex, type PlacedShift } from './shiftPlace';

/**
 * Трасса кусками: где шли баром, где кабелеукладчиком, где по колодцам.
 *
 * Отдельно эти куски никто не размечает и не будет — но они уже записаны.
 * В дневном отчёте метры разложены по способам, а где на линии лежит
 * смена, говорит отметка «остановились здесь» (см. shiftPlace): за
 * понедельник прошли четыре километра от отметки, за вторник — следующие
 * три. Отсюда и получаются отрезки. Смены, место которых не назвали,
 * отрезков не дают: рисовать их от начала линии значит рисовать выдумку.
 *
 * Внутри одного дня порядок способов неизвестен, поэтому они делят
 * дневной кусок по своим метрам в постоянном порядке. Это приближение, и
 * оно честно называется приближением: точнее знает только тот, кто там
 * был, и если он поправит — поправка сильнее расчёта.
 */

export interface RouteSegment {
  routeId: string;
  method: LayMethod;
  /** Метры от начала трассы. */
  fromM: number;
  toM: number;
  meters: number;
  coords: [number, number][];
  /** Дни, из которых сложился отрезок. */
  dates: string[];
}

/** Кусок ломаной между двумя расстояниями от начала. */
export function sliceByDistance(
  coords: [number, number][],
  fromM: number,
  toM: number,
): [number, number][] {
  if (coords.length < 2 || toM <= fromM) return [];
  const start = pointAtDistanceM(coords, Math.max(0, fromM));
  const end = pointAtDistanceM(coords, Math.max(0, toM));
  if (!start || !end) return [];

  const out: [number, number][] = [[start.lat, start.lon]];
  // Промежуточные вершины оставляем: без них кусок спрямился бы и перестал
  // совпадать с трассой там, где она поворачивает.
  //
  // Расстояние копим на ходу, а не пересчитываем от начала на каждой
  // вершине: на трассе из KML вершин тысячи, а кусков за ней — по куску
  // на каждый способ каждой смены. Пересчёт от начала превращал
  // перерисовку карты в секунды ожидания.
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += segMeters(coords[i - 1], coords[i]);
    if (acc <= fromM) continue;
    if (acc >= toM) break;
    out.push(coords[i]);
  }
  out.push([end.lat, end.lon]);
  return out;
}

/**
 * Отрезки по способам внутри смен с известным местом.
 *
 * Способ, не влезший в кусок смены, обрезается его концом: кусок у отметки
 * бывает короче метров смены, когда отметка ближе к началу линии, чем
 * метры смены, — и лишнего рисовать негде.
 */
function methodSegments(
  route: Pick<PlanRoute, 'id' | 'coords'>,
  placed: PlacedShift[],
): RouteSegment[] {
  const out: RouteSegment[] = [];
  for (const p of placed) {
    let cursor = p.fromM;
    for (const m of LAY_METHODS) {
      const v = p.byMethod[m] ?? 0;
      if (v <= 0) continue;
      const fromM = cursor;
      const toM = Math.min(p.toM, cursor + v);
      cursor = toM;

      // Соседний отрезок того же способа продолжаем, а не плодим:
      // иначе на длинном участке их окажутся сотни.
      const prev = out[out.length - 1];
      if (prev && prev.method === m && Math.abs(prev.toM - fromM) < 1) {
        prev.toM = toM;
        prev.meters += v;
        if (p.date && !prev.dates.includes(p.date)) prev.dates.push(p.date);
        continue;
      }

      out.push({
        routeId: route.id,
        method: m,
        fromM,
        toM,
        meters: v,
        coords: [],
        dates: p.date ? [p.date] : [],
      });
    }
  }

  // Геометрию режем в конце: так каждый отрезок нарезается один раз.
  for (const seg of out) seg.coords = sliceByDistance(route.coords, seg.fromM, seg.toM);
  return out.filter((s) => s.coords.length >= 2);
}

export function routeSegments(
  route: PlanRoute,
  entries: DailyWorkEntry[],
): RouteSegment[] {
  return methodSegments(route, placeShifts(route, entries).placed);
}

/** Цвет способа — свой у каждого, чтобы отрезки читались без легенды. */
export const METHOD_COLOR: Record<LayMethod, string> = {
  'кабелеукладчик': '#fbbf24',
  'экскаватор': '#fb923c',
  'сущ_канализация': '#38bdf8',
  'бар': '#a78bfa',
  'вручную': '#f472b6',
};

export const METHOD_LABEL = LAY_METHOD_LABEL;

/** Сводка по способам вдоль трассы — для подписи и легенды. */
export function segmentTotals(
  segments: RouteSegment[],
): { method: LayMethod; meters: number; color: string }[] {
  const acc = new Map<LayMethod, number>();
  for (const s of segments) acc.set(s.method, (acc.get(s.method) ?? 0) + s.meters);
  return [...acc.entries()]
    .map(([method, meters]) => ({ method, meters, color: METHOD_COLOR[method] }))
    .sort((a, b) => b.meters - a.meters);
}

/**
 * Где кончается участок по колодцам.
 *
 * ККС — не конечная точка, а отметка: досюда тянут по существующей
 * канализации, дальше по земле. Берём конец последнего такого отрезка.
 */
export function kksPoints(segments: RouteSegment[]): { lat: number; lon: number; atM: number }[] {
  return segments
    .filter((s) => s.method === 'сущ_канализация' && s.coords.length >= 2)
    .map((s) => {
      const last = s.coords[s.coords.length - 1];
      return { lat: last[0], lon: last[1], atM: s.toM };
    });
}

/** Пройдено по трассе, а где — не названо. */
export interface RouteUnplaced {
  routeId: string;
  meters: number;
  byMethod: Partial<Record<LayMethod, number>>;
  /** Сколько таких смен. */
  shifts: number;
}

export interface RouteWork {
  /** Отрезки по способам — там, где копали. */
  segments: RouteSegment[];
  /** Метры без места: карта показывает их долей по всей линии. */
  unplaced: RouteUnplaced[];
}

/**
 * Работа по всем трассам: где копали и сколько ещё прошли неизвестно где.
 *
 * Трасса без привязки к селу берёт смены только по своим отметкам: метры
 * лежат по КАТО, и приписывать их линии, о которой мы не знаем, чьё это
 * село, значит рисовать выдумку. Но если на ней отмечали «остановились
 * здесь», село этих смен — её село: человек сам сказал, где шёл.
 */
export function routeWork(
  routes: PlanRoute[],
  katoByRouteId: Map<string, string>,
  ground: DailyWorkEntry[],
): RouteWork {
  const live = new Set(routes.map((r) => r.id));
  const onRoute = shiftIndex(ground, live);
  const katoByStop = new Map<string, string>();
  for (const e of ground) {
    const own = e.stop?.routeId;
    if (own && live.has(own) && e.kato) katoByStop.set(own, e.kato);
  }

  const segments: RouteSegment[] = [];
  const unplaced: RouteUnplaced[] = [];
  for (const r of routes) {
    const kato = katoByRouteId.get(r.id) ?? katoByStop.get(r.id);
    const shifts = onRoute(r.id, kato);
    if (shifts.length === 0) continue;
    const pl = placeShifts(r, shifts);
    segments.push(...methodSegments(r, pl.placed));
    if (pl.unplaced.length) {
      const byMethod: Partial<Record<LayMethod, number>> = {};
      for (const u of pl.unplaced) {
        for (const m of LAY_METHODS) {
          const v = u.byMethod[m] ?? 0;
          if (v > 0) byMethod[m] = (byMethod[m] ?? 0) + v;
        }
      }
      unplaced.push({
        routeId: r.id,
        meters: pl.unplaced.reduce((s, u) => s + u.meters, 0),
        byMethod,
        shifts: pl.unplaced.length,
      });
    }
  }
  return { segments, unplaced };
}
