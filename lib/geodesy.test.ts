import { describe, it, expect } from 'vitest';
import { ellipsoidM, sphereM, metricOf, WGS84_A } from './geodesy';

/** Градусы, минуты, секунды — как в эталонных примерах. */
const dms = (d: number, m: number, s: number) => Math.sign(d) * (Math.abs(d) + m / 60 + s / 3600);

/** Сколько градусов долготы на широте φ дают примерно столько метров. */
const lonFor = (meters: number, lat: number) => meters / (111_320 * Math.cos((lat * Math.PI) / 180));

describe('длина по эллипсоиду', () => {
  it('сходится с эталоном Винсенти до миллиметра', () => {
    // Flinders Peak — Buninyong: 54 972,271 м.
    const m = ellipsoidM(
      dms(-37, 57, 3.7203), dms(144, 25, 29.5244),
      dms(-37, 39, 10.1561), dms(143, 55, 35.3839),
    );
    expect(m).toBeCloseTo(54972.271, 3);
  });

  it('трасса в 12 км с запада на восток у Астаны по шару выходила на 38 м короче', () => {
    const lat = 51.13;
    const lon2 = 71.43 + lonFor(12_000, lat);
    const diff = ellipsoidM(lat, 71.43, lat, lon2) - sphereM(lat, 71.43, lat, lon2);
    expect(Math.round(diff)).toBe(38);
  });

  it('магистраль в 200 км — на 630 м', () => {
    const lat = 51.13;
    const lon2 = 71.43 + lonFor(200_000, lat);
    const diff = ellipsoidM(lat, 71.43, lat, lon2) - sphereM(lat, 71.43, lat, lon2);
    expect(Math.round(diff / 10) * 10).toBe(630);
  });

  it('градус долготы на экваторе — большая полуось на π/180', () => {
    expect(ellipsoidM(0, 0, 0, 1)).toBeCloseTo((WGS84_A * Math.PI) / 180, 3);
  });

  it('одна и та же точка — ноль, а не NaN', () => {
    expect(ellipsoidM(51.1, 71.4, 51.1, 71.4)).toBe(0);
  });

  it('звено в сантиметры не теряется и не скачет', () => {
    const m = ellipsoidM(51, 71, 51, 71 + 1e-7);
    expect(m).toBeGreaterThan(0.006);
    expect(m).toBeLessThan(0.008);
  });

  it('почти противоположные точки не дают NaN — длина трассы не ломается', () => {
    const m = ellipsoidM(0, 0, 0.5, 179.7);
    expect(Number.isFinite(m)).toBe(true);
    expect(m).toBeGreaterThan(19_000_000);
  });

  it('шар остаётся для листов до перехода — по названию мерки', () => {
    expect(metricOf('sphere')).toBe(sphereM);
    expect(metricOf('ellipsoid')).toBe(ellipsoidM);
    expect(metricOf(undefined)).toBe(ellipsoidM);
  });
});
