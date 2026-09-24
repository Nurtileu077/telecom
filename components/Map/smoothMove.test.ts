import { describe, it, expect, afterEach } from 'vitest';
import {
  wantsMotion, flyDuration, distanceKm, boundsCenter, moveToBounds,
  NEAR_KM, MAX_SECONDS,
} from './smoothMove';

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

function fakeMedia(reduce: boolean) {
  (globalThis as { window?: unknown }).window = {
    matchMedia: (q: string) => ({ matches: reduce && q.includes('reduce') }),
  };
}

describe('wantsMotion', () => {
  it('без системного запрета движение разрешено', () => {
    fakeMedia(false);
    expect(wantsMotion()).toBe(true);
  });

  it('«уменьшить движение» в системе выключает пролёты', () => {
    fakeMedia(true);
    expect(wantsMotion()).toBe(false);
  });

  it('там, где спросить не у кого, движение разрешаем', () => {
    expect(wantsMotion()).toBe(true);
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => { throw new Error('не поддерживается'); },
    };
    expect(wantsMotion()).toBe(true);
  });
});

describe('flyDuration', () => {
  it('соседнее село — переносим сразу, без пролёта', () => {
    expect(flyDuration(0)).toBe(0);
    expect(flyDuration(NEAR_KM)).toBe(0);
    expect(flyDuration(NEAR_KM - 0.1)).toBe(0);
  });

  it('дальше — летим, и тем дольше, чем дальше', () => {
    const near = flyDuration(20);
    const far = flyDuration(300);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('но не дольше предела: ждать надоедает раньше', () => {
    expect(flyDuration(5000)).toBeLessThanOrEqual(MAX_SECONDS);
    expect(flyDuration(100_000)).toBeLessThanOrEqual(MAX_SECONDS);
  });

  it('выключенное движение отменяет пролёт на любом расстоянии', () => {
    expect(flyDuration(500, false)).toBe(0);
  });

  it('испорченное расстояние не даёт NaN в длительности', () => {
    expect(flyDuration(NaN)).toBe(0);
    expect(flyDuration(-100)).toBe(0);
  });
});

describe('distanceKm', () => {
  it('меряет по земле, а не по градусам', () => {
    // Градус широты — примерно 111 км в любом месте.
    expect(distanceKm({ lat: 52, lon: 71 }, { lat: 53, lon: 71 })).toBeCloseTo(111, 0);
  });

  it('одна и та же точка — ноль', () => {
    expect(distanceKm({ lat: 52, lon: 71 }, { lat: 52, lon: 71 })).toBe(0);
  });

  it('Акмолинская и Жамбылская — это далеко', () => {
    expect(distanceKm({ lat: 51.2, lon: 71.4 }, { lat: 42.9, lon: 71.4 }))
      .toBeGreaterThan(800);
  });
});

describe('boundsCenter', () => {
  it('середина рамки, а не первая точка', () => {
    expect(boundsCenter([[52, 71], [54, 73]])).toEqual({ lat: 53, lon: 72 });
  });

  it('битые координаты пропускает', () => {
    expect(boundsCenter([[NaN, 71], [52, 71], [54, 73]])).toEqual({ lat: 53, lon: 72 });
  });

  it('пустая рамка — нет середины', () => {
    expect(boundsCenter([])).toBeNull();
    expect(boundsCenter([[NaN, NaN]])).toBeNull();
  });
});

describe('moveToBounds', () => {
  const here = { lat: 51.2, lon: 71.4 };

  it('далёкая область — летим', () => {
    const m = moveToBounds(here, [[42.9, 71.3], [43.1, 71.5]], true);
    expect(m.animate).toBe(true);
    expect(m.duration).toBeGreaterThan(0);
  });

  it('соседний участок — переносим сразу', () => {
    const m = moveToBounds(here, [[51.21, 71.41], [51.22, 71.42]], true);
    expect(m.animate).toBe(false);
  });

  it('при выключенном движении не летим никогда', () => {
    expect(moveToBounds(here, [[42.9, 71.3]], false).animate).toBe(false);
  });

  it('без исходного положения переносим сразу — лететь неоткуда', () => {
    expect(moveToBounds(null, [[42.9, 71.3]], true).animate).toBe(false);
  });

  it('пустая рамка ничего не ломает', () => {
    expect(moveToBounds(here, [], true)).toEqual({ animate: false });
  });
});
