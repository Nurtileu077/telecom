/**
 * Координаты с устройства.
 *
 * В поле это правильнее ввода руками: инженер стоит прямо на отклонении,
 * и одно нажатие даёт точку с известной погрешностью. Ошибки разбираются
 * по причине — человеку надо сказать, что именно случилось: запретил
 * доступ, нет сигнала или устройство не умеет.
 */

export interface FixedPosition {
  lat: number;
  lon: number;
  /** Погрешность, метры. */
  accuracyM: number;
}

export type PositionError =
  | { kind: 'unsupported'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'timeout'; message: string };

export function getCurrentPosition(timeoutMs = 15000): Promise<FixedPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject({ kind: 'unsupported', message: 'Устройство не умеет определять координаты' } as PositionError);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyM: Math.round(pos.coords.accuracy),
      }),
      (err) => {
        const map: Record<number, PositionError> = {
          1: { kind: 'denied', message: 'Доступ к геопозиции запрещён — разрешите его в настройках браузера' },
          2: { kind: 'unavailable', message: 'Не удалось определить координаты: нет сигнала' },
          3: { kind: 'timeout', message: 'Определение координат заняло слишком долго' },
        };
        reject(map[err.code] ?? { kind: 'unavailable', message: err.message } as PositionError);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export function positionErrorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as PositionError).message);
  return 'Не удалось определить координаты';
}
