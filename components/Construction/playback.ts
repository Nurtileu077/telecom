import { PlanRoute, DailyWorkEntry } from '@/types/construction';
import { pointAtDistanceM } from './routeProgress';
import { routeOfSection } from './routeSection';
import { placeShifts, shiftsOnRoute } from './shiftPlace';

/**
 * Вчерашний день в движении.
 *
 * Руководству утром нужен не список метров, а картина: откуда куда дошли.
 * Хранить путь колонны по часам никто не будет — да и незачем: он выводится
 * из того, что уже записано. Метры за день вдоль трассы участка и есть
 * отрезок, который колонна прошла.
 *
 * Поэтому воспроизведение ничего не требует от бригады сверх того, что
 * она и так делает: закрывает день и отвечает, где остановилась.
 */

export interface DayMove {
  kato: string;
  uchastok: string;
  routeId: string;
  /** Где были утром. */
  from: { lat: number; lon: number };
  /** Где оказались вечером. */
  to: { lat: number; lon: number };
  /** Сколько прошли за этот день, метры. */
  meters: number;
  /** Где на линии начали день, метры от её начала. */
  beforeM: number;
  /** Колонна и подрядчик — чтобы подписать, кто шёл. */
  column?: string;
  contractor?: string;
}

function entryMeters(e: DailyWorkEntry): number {
  let m = 0;
  for (const v of Object.values(e.byMethod)) m += v ?? 0;
  return m;
}

export interface PlaybackContext {
  ground: DailyWorkEntry[];
  planRoutes: PlanRoute[];
}

/**
 * Что происходило в этот день.
 *
 * Движение — это кусок линии, который смены этого дня закрасили на карте:
 * откуда колонна вышла утром и куда пришла вечером считаются тем же
 * правилом, что и закраска (см. shiftPlace). Раньше старт брали как сумму
 * всех прошлых метров от начала линии, и бригада с середины «ехала» по
 * чужим километрам. Участки без трассы пропускаем, и смены, место которых
 * не назвали, тоже: рисовать движение там, где его не было, значит
 * выдумывать маршрут.
 */
export function dayMoves(ctx: PlaybackContext, date: string): DayMove[] {
  if (!date) return [];

  const today = new Map<string, DailyWorkEntry[]>();
  for (const e of ctx.ground) {
    if (!e.kato || e.date !== date) continue;
    const list = today.get(e.kato) ?? [];
    list.push(e);
    today.set(e.kato, list);
  }

  const live = new Set(ctx.planRoutes.map((r) => r.id));
  const out: DayMove[] = [];
  for (const [kato, entries] of today) {
    if (entries.every((e) => entryMeters(e) <= 0)) continue;
    const uchastok = entries[0].uchastok;
    // Та же трасса, на которой форма смены ставит «остановились здесь».
    const route = routeOfSection(ctx.planRoutes, uchastok);
    if (!route) continue;

    const shifts = shiftsOnRoute(route.id, kato, ctx.ground, live)
      .filter((e) => !!e.date && e.date <= date);
    const mine = placeShifts(route, shifts).placed.filter((p) => p.date === date);
    if (mine.length === 0) continue;

    const beforeM = mine[0].fromM;
    const from = pointAtDistanceM(route.coords, beforeM);
    const to = pointAtDistanceM(route.coords, mine[mine.length - 1].toM);
    if (!from || !to) continue;

    out.push({
      kato,
      uchastok,
      routeId: route.id,
      from: { lat: from.lat, lon: from.lon },
      to: { lat: to.lat, lon: to.lon },
      meters: mine.reduce((s, p) => s + p.meters, 0),
      beforeM,
      column: entries[0].column,
      contractor: entries[0].contractor,
    });
  }

  // Больше прошли — выше в списке: на карте это самое заметное движение.
  return out.sort((a, b) => b.meters - a.meters);
}

/** Дни, по которым есть что показать — для выбора даты. */
export function playableDates(ctx: PlaybackContext, limit = 30): string[] {
  const dates = new Set<string>();
  for (const e of ctx.ground) if (e.date) dates.add(e.date);
  return [...dates].sort((a, b) => b.localeCompare(a)).slice(0, limit);
}
