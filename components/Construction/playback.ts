import { DailyWorkEntry } from '@/types/construction';
import { pointAtDistanceM } from './routeProgress';
import { placeShifts } from './shiftPlace';
import { shiftLines, type ShiftLinesContext } from './shiftLines';

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

export type PlaybackContext = ShiftLinesContext;

/**
 * Что происходило в этот день.
 *
 * Движение — это кусок линии, который смены этого дня закрасили на карте:
 * откуда колонна вышла утром и куда пришла вечером считаются тем же
 * правилом, что и закраска (см. shiftPlace), и на той же линии (см.
 * shiftLines). Раньше старт брали как сумму всех прошлых метров от начала
 * линии, и бригада с середины «ехала» по чужим километрам; линию искали по
 * имени участка, и тёзка ехал по линии другого села, а смена без КАТО на
 * магистрали не ехала вовсе. Участки без трассы пропускаем, и смены, место
 * которых не назвали, тоже: рисовать движение там, где его не было, значит
 * выдумывать маршрут.
 */
export function dayMoves(ctx: PlaybackContext, date: string): DayMove[] {
  if (!date) return [];
  const lines = shiftLines(ctx);

  const today = new Map<string, DailyWorkEntry[]>();
  for (const e of ctx.ground) {
    if (e.date !== date || entryMeters(e) <= 0) continue;
    const routeId = lines.lineOf(e);
    if (!routeId) continue;
    const list = today.get(routeId) ?? [];
    list.push(e);
    today.set(routeId, list);
  }

  const out: DayMove[] = [];
  for (const [routeId, entries] of today) {
    const route = lines.route(routeId);
    if (!route) continue;
    // Будущие дни в счёт не берём: «Верно», сказанное завтра, сегодняшнего
    // движения не рисует.
    const shifts = lines.shiftsOn(routeId).filter((e) => !!e.date && e.date <= date);
    const placed = placeShifts(route, shifts).placed.filter((p) => p.date === date);
    if (placed.length === 0) continue;

    // Каждая колонна — своим движением: две колонны на одном селе идут
    // каждая своим куском, и стрелка от начала одной к концу другой
    // нарисовала бы путь, которого не было.
    const byId = new Map(entries.map((e) => [e.id, e]));
    const crews = new Map<string, typeof placed>();
    for (const p of placed) {
      const list = crews.get(p.crew);
      if (list) list.push(p); else crews.set(p.crew, [p]);
    }
    for (const mine of crews.values()) {
      // Идущая к началу линии колонна выходит утром с дальнего края куска.
      const first = mine[0];
      const last = mine[mine.length - 1];
      const beforeM = first.back ? first.toM : first.fromM;
      const from = pointAtDistanceM(route.coords, beforeM);
      const to = pointAtDistanceM(route.coords, last.back ? last.fromM : last.toM);
      if (!from || !to) continue;
      const who = byId.get(first.entryId) ?? entries[0];

      out.push({
        kato: who.kato,
        uchastok: who.uchastok,
        routeId,
        from: { lat: from.lat, lon: from.lon },
        to: { lat: to.lat, lon: to.lon },
        meters: mine.reduce((s, p) => s + p.meters, 0),
        beforeM,
        column: who.column,
        contractor: who.contractor,
      });
    }
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
