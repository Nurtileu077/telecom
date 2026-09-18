import { PlanRoute, DailyWorkEntry } from '@/types/construction';
import { pointAtDistanceM, routeForSection } from './routeProgress';
import { normName } from './areaImport';

/**
 * Вчерашний день в движении.
 *
 * Руководству утром нужен не список метров, а картина: откуда куда дошли.
 * Хранить путь колонны по часам никто не будет — да и незачем: он выводится
 * из того, что уже записано. Метры за день вдоль трассы участка и есть
 * отрезок, который колонна прошла.
 *
 * Поэтому воспроизведение ничего не требует от бригады: она просто
 * закрывает день, как закрывала.
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
  /** Сколько было пройдено до этого дня. */
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

/** Трасса участка: та же логика, что и в форме закрытия дня. */
function routeOf(routes: PlanRoute[], uchastok: string): PlanRoute | null {
  const key = normName(uchastok);
  if (!key) return null;
  return routeForSection(routes, (r) => {
    const fields = [r.uchastok, r.folder, r.name].filter(Boolean) as string[];
    return fields.some((f) => normName(f) === key || normName(f).includes(key));
  });
}

export interface PlaybackContext {
  ground: DailyWorkEntry[];
  planRoutes: PlanRoute[];
}

/**
 * Что происходило в этот день.
 *
 * Для каждого участка берём метры, накопленные до этого дня, и метры за
 * сам день. Первое даёт точку старта, сумма — точку финиша. Участки без
 * трассы пропускаем: рисовать движение там, где нет линии, значит
 * выдумывать маршрут.
 */
export function dayMoves(ctx: PlaybackContext, date: string): DayMove[] {
  if (!date) return [];

  const before = new Map<string, number>();
  const today = new Map<string, DailyWorkEntry[]>();

  for (const e of ctx.ground) {
    if (!e.kato || !e.date) continue;
    const m = entryMeters(e);
    if (e.date < date) {
      before.set(e.kato, (before.get(e.kato) ?? 0) + m);
    } else if (e.date === date) {
      const list = today.get(e.kato) ?? [];
      list.push(e);
      today.set(e.kato, list);
    }
  }

  const out: DayMove[] = [];
  for (const [kato, entries] of today) {
    const meters = entries.reduce((s, e) => s + entryMeters(e), 0);
    if (meters <= 0) continue;
    const uchastok = entries[0].uchastok;
    const route = routeOf(ctx.planRoutes, uchastok);
    if (!route) continue;

    const beforeM = before.get(kato) ?? 0;
    const from = pointAtDistanceM(route.coords, beforeM);
    const to = pointAtDistanceM(route.coords, beforeM + meters);
    if (!from || !to) continue;

    out.push({
      kato,
      uchastok,
      routeId: route.id,
      from: { lat: from.lat, lon: from.lon },
      to: { lat: to.lat, lon: to.lon },
      meters,
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
