import { PlanRoute } from '@/types/construction';

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

const R = 6371000;

function segMeters(a: [number, number], b: [number, number]): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Длина трассы по координатам, метры. */
export function routeLengthM(coords: [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += segMeters(coords[i - 1], coords[i]);
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
    const seg = segMeters(coords[i - 1], coords[i]);
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
  return { lat: last[0], lon: last[1], doneM: routeLengthM(coords), atEnd: true };
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
 * Несколько подходящих — берём самую длинную: короткие обычно заезды и
 * альтернативные куски, а не основная линия.
 */
export function routeForSection(
  routes: PlanRoute[],
  match: (r: PlanRoute) => boolean,
): PlanRoute | null {
  const hits = routes.filter(match);
  if (hits.length === 0) return null;
  return hits.reduce((best, r) => (r.lengthM > best.lengthM ? r : best), hits[0]);
}
