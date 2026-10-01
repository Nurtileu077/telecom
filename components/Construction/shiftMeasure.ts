import type { PlanRoute } from '@/types/construction';
import { haversineM, nearestOnRoute, type LatLon } from './measureTool';

/**
 * Метры смены, снятые с карты.
 *
 * Раньше форма смены брала прямую между двумя кликами. Трасса так не
 * ходит: на повороте под прямым углом прямая короче пути на 29 %, и эти
 * метры уходили в смену, в расчёт с подрядчиком и в АСР. Поэтому клики
 * прикладываем к трассе и считаем вдоль неё; если трассы под ними нет —
 * считаем по точкам, которые человек поставил, и говорим об этом прямо.
 */

/**
 * Насколько клик может промахнуться мимо линии.
 *
 * В форму попадают с телефона, пальцем по карте: на 15-м приближении
 * палец шириной в двадцать пикселей — это полсотни метров. Сто метров
 * прощают промах пальца, но не дают прилипнуть к соседней трассе в
 * другом конце села.
 */
export const SHIFT_SNAP_M = 100;

export interface ShiftMeasure {
  /** Что предлагаем вписать. */
  meters: number;
  /** Как посчитано: вдоль трассы или по поставленным точкам. */
  mode: 'route' | 'points';
  /** По точкам: прямая для двух кликов, ломаная для нескольких. */
  pointsM: number;
  /** Вдоль трассы — если все клики легли на одну линию. */
  route?: {
    id: string;
    name: string;
    meters: number;
    /** Самый большой промах клика мимо линии. */
    missM: number;
  };
  /** Почему не по трассе — человеку, словами. */
  why?: string;
  /** Сколько точек поставлено. */
  count: number;
}

export interface ShiftMeasureOptions {
  /** Трасса участка: если клики на ней, берём её, даже если рядом есть другая. */
  preferRouteId?: string | null;
  snapM?: number;
}

/** Ломаная через клики — то, что раньше было единственным ответом. */
export function polylineM(points: LatLon[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) sum += haversineM(points[i - 1], points[i]);
  return sum;
}

interface Candidate { route: PlanRoute; meters: number; missM: number }

/**
 * Длина по трассе через все клики по порядку.
 *
 * Промежуточные клики ничего не портят: «от сих до сих через вот это
 * место» по одной линии — всё та же разница отметок. А если человек
 * нарочно пошёл обратно, разницы складываются, как и шагали.
 */
function alongRoute(route: PlanRoute, points: LatLon[], snapM: number): Candidate | null {
  if (route.coords.length < 2) return null;
  let missM = 0;
  let meters = 0;
  let prevAt: number | null = null;
  for (const p of points) {
    const hit = nearestOnRoute(p, route.coords);
    if (!hit || hit.deviationM > snapM) return null;
    missM = Math.max(missM, hit.deviationM);
    if (prevAt !== null) meters += Math.abs(hit.atM - prevAt);
    prevAt = hit.atM;
  }
  return { route, meters, missM };
}

export function measureShift(
  points: LatLon[],
  routes: PlanRoute[],
  opts: ShiftMeasureOptions = {},
): ShiftMeasure | null {
  if (points.length < 2) return null;
  const snapM = opts.snapM ?? SHIFT_SNAP_M;
  const pointsM = polylineM(points);

  const candidates = routes
    .map((r) => alongRoute(r, points, snapM))
    .filter((c): c is Candidate => !!c);

  // Трасса участка важнее ближайшей: в селе рядом идут основная линия и
  // отвод к школе, и промах на двадцать метров не должен переводить
  // замер на чужую.
  const preferred = opts.preferRouteId
    ? candidates.find((c) => c.route.id === opts.preferRouteId)
    : undefined;
  const best = preferred
    ?? candidates.reduce<Candidate | null>((b, c) => (!b || c.missM < b.missM ? c : b), null);

  if (best) {
    return {
      meters: best.meters,
      mode: 'route',
      pointsM,
      route: {
        id: best.route.id,
        name: best.route.name || best.route.uchastok || 'трасса',
        meters: best.meters,
        missM: best.missM,
      },
      count: points.length,
    };
  }

  return {
    meters: pointsM,
    mode: 'points',
    pointsM,
    why: routes.some((r) => r.coords.length >= 2)
      ? `точки не легли на одну трассу ближе ${snapM} м`
      : 'трасс на карте нет',
    count: points.length,
  };
}

const m = (v: number) => `${Math.round(v).toLocaleString('ru')} м`;

/**
 * Подпись под замером.
 *
 * Название трассы пишем всегда: метры по чужой линии выглядят так же
 * правдоподобно, как по своей, и отличить их можно только по имени.
 * Прямую рядом показываем, чтобы было видно, сколько съедал старый замер.
 */
export function describeShiftMeasure(s: ShiftMeasure, use: 'route' | 'points' = s.mode): string {
  if (use === 'route' && s.route) {
    const straight = s.count === 2 ? 'напрямую' : 'по точкам';
    const differs = Math.abs(s.route.meters - s.pointsM) >= 1;
    return `по трассе «${s.route.name}»${differs ? ` · ${straight} было бы ${m(s.pointsM)}` : ''}`;
  }
  const how = s.count === 2 ? 'по прямой' : `по ломаной из ${s.count} точек`;
  if (s.route) return `${how} — вы выбрали не по трассе`;
  return `${how}: ${s.why ?? 'трасса не найдена'}`;
}
