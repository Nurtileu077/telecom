/**
 * Плавный переход карты.
 *
 * Когда карта перескакивает с одной области на другую мгновенно, человек
 * теряет, куда его перенесло: только что была Акмолинская, теперь
 * Жамбылская, а между ними ничего. Пролёт показывает направление и
 * расстояние — и вопрос «а это вообще где» не возникает.
 *
 * Но не всегда: ближний переход лучше мгновенного, а долгий пролёт через
 * полстраны ради соседнего села — это ожидание на ровном месте. Поэтому
 * длительность считаем по расстоянию.
 */

/** Ниже этого пролетать нечего: соседнее село — это один экран. */
export const NEAR_KM = 5;
/** Дальше этого пролёт дольше не делаем: ждать надоедает раньше. */
export const MAX_SECONDS = 1.6;

/**
 * Хочет ли человек движения.
 *
 * «Уменьшить движение» в системе включают не из вкуса: от анимации
 * укачивает и болит голова. Карта, которая всё равно летает, —
 * единственное, что остаётся отключить вместе с браузером.
 */
export function wantsMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

/**
 * Сколько секунд лететь.
 *
 * Ноль — значит не лететь вовсе: перенести сразу. Так отвечаем и на
 * ближний переход, и на выключенное движение.
 */
export function flyDuration(distanceKm: number, motion = true): number {
  if (!motion) return 0;
  if (!Number.isFinite(distanceKm) || distanceKm <= NEAR_KM) return 0;
  // Корень, а не прямая: между пятью и пятьюдесятью километрами разница
  // ощутимая, между пятьюстами и тысячей — уже нет.
  const s = 0.25 * Math.sqrt(distanceKm - NEAR_KM);
  return Math.min(MAX_SECONDS, Math.round(s * 100) / 100);
}

const R = 6371;

/** Расстояние между двумя точками, километры. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Середина рамки — по ней и считаем, далеко ли лететь. */
export function boundsCenter(pts: [number, number][]): { lat: number; lon: number } | null {
  if (pts.length === 0) return null;
  let minLat = Infinity; let maxLat = -Infinity;
  let minLon = Infinity; let maxLon = -Infinity;
  for (const [la, lo] of pts) {
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
  }
  if (!Number.isFinite(minLat)) return null;
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

/**
 * Настройки перехода к рамке.
 *
 * Отдельно от самой карты, чтобы решение «лететь или перенести» можно
 * было проверить, не поднимая Leaflet.
 */
export interface MoveChoice {
  animate: boolean;
  duration?: number;
}

export function moveToBounds(
  from: { lat: number; lon: number } | null,
  pts: [number, number][],
  motion = wantsMotion(),
): MoveChoice {
  const to = boundsCenter(pts);
  if (!from || !to) return { animate: false };
  const seconds = flyDuration(distanceKm(from, to), motion);
  return seconds > 0 ? { animate: true, duration: seconds } : { animate: false };
}
