import { PlanRoute } from '@/types/construction';
import { ellipsoidM, type Metric } from '@/lib/geodesy';
import { pickMainRoute } from './routeMain';

/**
 * Где остановились вчера и где окажемся сегодня.
 *
 * Колонна идёт вдоль трассы, и её положение — это не отдельная запись, а
 * следствие метража: прошли за день четыре километра — значит сдвинулись
 * по линии на четыре километра. Система считает точку сама и спрашивает
 * «вы примерно тут?», а человек поправляет. Это быстрее, чем тыкать в
 * карту каждый вечер, и честнее, чем молча рисовать точку самому.
 */

export interface RoutePosition {
  lat: number;
  lon: number;
  /** Сколько метров пройдено от начала трассы. */
  doneM: number;
  /** Дошли до конца линии: дальше идти некуда. */
  atEnd: boolean;
}

/**
 * Длина одного звена, метры. Ею же меряют трассу по частям.
 *
 * По эллипсоиду WGS-84 (см. lib/geodesy). Мерку можно передать явно:
 * всё, что считает метры одного листа, должно мерить одним и тем же,
 * иначе отметки съедут относительно длины.
 */
export function segMeters(
  a: [number, number],
  b: [number, number],
  metric: Metric = ellipsoidM,
): number {
  return metric(a[0], a[1], b[0], b[1]);
}

/** Длина трассы по координатам, метры. */
export function routeLengthM(coords: [number, number][], metric: Metric = ellipsoidM): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += segMeters(coords[i - 1], coords[i], metric);
  return sum;
}

/**
 * Точка на трассе в стольких-то метрах от начала.
 *
 * Отрицательное расстояние — это начало трассы, а больше длины — её
 * конец. Выходить за линию нельзя: за её пределами координаты
 * означали бы место, о котором мы ничего не знаем.
 */
export function pointAtDistanceM(
  coords: [number, number][],
  meters: number,
  metric: Metric = ellipsoidM,
): RoutePosition | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) {
    return { lat: coords[0][0], lon: coords[0][1], doneM: 0, atEnd: true };
  }
  if (meters <= 0) {
    return { lat: coords[0][0], lon: coords[0][1], doneM: 0, atEnd: false };
  }

  let left = meters;
  for (let i = 1; i < coords.length; i++) {
    const seg = segMeters(coords[i - 1], coords[i], metric);
    if (seg <= 0) continue;
    if (left <= seg) {
      const t = left / seg;
      return {
        lat: coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        lon: coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
        doneM: meters,
        atEnd: false,
      };
    }
    left -= seg;
  }

  const last = coords[coords.length - 1];
  return { lat: last[0], lon: last[1], doneM: routeLengthM(coords, metric), atEnd: true };
}

/** Сколько всего прошли по участку за все дни. */
export interface SectionProgress {
  /** Трасса, вдоль которой считаем. */
  routeId: string;
  doneM: number;
  lat: number;
  lon: number;
  /** Дата последнего продвижения. */
  date: string;
  /** Правил человек, а не расчёт. */
  manual?: boolean;
  /**
   * Когда запись правили — не путать с датой продвижения.
   *
   * Разворот трассы переносит посчитанную точку, но продвижения в этот
   * день не было, и дату трогать нельзя. А обмен решал спор только по
   * дате и при равенстве оставлял свою запись: развёрнутая трасса
   * доходила до второго устройства, а точка колонны — нет, и устройства
   * перетягивали её каждое к себе.
   */
  updatedAt?: string;
}

/**
 * Куда сдвинется колонна, если сегодня прошли столько-то метров.
 *
 * Считаем от того, что уже пройдено: положение — это накопленный метраж,
 * а не расстояние от начала участка за один день.
 */
export function advanceAlong(
  route: PlanRoute,
  previousDoneM: number,
  addedM: number,
): RoutePosition | null {
  const total = Math.max(0, previousDoneM) + Math.max(0, addedM);
  return pointAtDistanceM(route.coords, total);
}

/**
 * Трасса участка: ту, вдоль которой идут, выбираем по названию.
 * Несколько подходящих — основную линию села (см. routeMain): ту, что
 * назначил человек, иначе самую длинную из не названных вариантом или
 * отводом. Альтернативный вариант бывает длиннее основной, и «самая
 * длинная» ставила смены на него.
 */
export function routeForSection(
  routes: PlanRoute[],
  match: (r: PlanRoute) => boolean,
): PlanRoute | null {
  return pickMainRoute(routes.filter(match));
}
