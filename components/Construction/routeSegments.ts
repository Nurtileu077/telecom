import {
  PlanRoute, DailyWorkEntry, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
} from '@/types/construction';
import { pointAtDistanceM, routeLengthM } from './routeProgress';

/**
 * Трасса кусками: где шли баром, где кабелеукладчиком, где по колодцам.
 *
 * Отдельно эти куски никто не размечает и не будет — но они уже записаны.
 * В дневном отчёте метры разложены по способам, а порядок дней даёт
 * порядок вдоль линии: за понедельник прошли первые четыре километра,
 * за вторник — следующие три. Отсюда и получаются отрезки.
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
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc = routeLengthM(coords.slice(0, i + 1));
    if (acc <= fromM) continue;
    if (acc >= toM) break;
    out.push(coords[i]);
  }
  out.push([end.lat, end.lon]);
  return out;
}

function entryMeters(e: DailyWorkEntry): number {
  let m = 0;
  for (const v of Object.values(e.byMethod)) m += v ?? 0;
  return m;
}

export function routeSegments(
  route: PlanRoute,
  entries: DailyWorkEntry[],
): RouteSegment[] {
  const days = [...entries]
    .filter((e) => entryMeters(e) > 0)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  if (days.length === 0) return [];

  const out: RouteSegment[] = [];
  let cursor = 0;

  for (const e of days) {
    for (const m of LAY_METHODS) {
      const v = e.byMethod[m] ?? 0;
      if (v <= 0) continue;
      const fromM = cursor;
      const toM = cursor + v;
      cursor = toM;

      // Соседний отрезок того же способа продолжаем, а не плодим:
      // иначе на длинном участке их окажутся сотни.
      const prev = out[out.length - 1];
      if (prev && prev.method === m && Math.abs(prev.toM - fromM) < 1) {
        prev.toM = toM;
        prev.meters += v;
        if (e.date && !prev.dates.includes(e.date)) prev.dates.push(e.date);
        continue;
      }

      out.push({
        routeId: route.id,
        method: m,
        fromM,
        toM,
        meters: v,
        coords: [],
        dates: e.date ? [e.date] : [],
      });
    }
  }

  // Геометрию режем в конце: так каждый отрезок нарезается один раз.
  for (const seg of out) seg.coords = sliceByDistance(route.coords, seg.fromM, seg.toM);
  return out.filter((s) => s.coords.length >= 2);
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

/**
 * Отрезки по всем трассам, у которых есть привязка к селу.
 *
 * Без привязки считать нечего: метры лежат по КАТО, и приписывать их
 * линии, о которой мы не знаем, чьё это село, значит рисовать выдумку.
 */
export function allRouteSegments(
  routes: PlanRoute[],
  katoByRouteId: Map<string, string>,
  ground: DailyWorkEntry[],
): RouteSegment[] {
  const byKato = new Map<string, DailyWorkEntry[]>();
  for (const e of ground) {
    if (!e.kato) continue;
    const list = byKato.get(e.kato) ?? [];
    list.push(e);
    byKato.set(e.kato, list);
  }

  const out: RouteSegment[] = [];
  for (const r of routes) {
    const kato = katoByRouteId.get(r.id);
    if (!kato) continue;
    const entries = byKato.get(kato);
    if (!entries?.length) continue;
    out.push(...routeSegments(r, entries));
  }
  return out;
}
