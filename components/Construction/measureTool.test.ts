import { describe, it, expect } from 'vitest';
import {
  haversineM, nearestOnRoute, snapToRoutes, measureLine, measureAlongRoute,
  polygonAreaM2, perimeterM, formatArea, rectCoords, circleCoords,
} from './measureTool';

/** Трасса углом: на восток, потом на север. Под Кокшетау. */
const ELBOW: [number, number][] = [[53, 69], [53, 69.1], [53.1, 69.1]];

describe('nearestOnRoute', () => {
  it('клик рядом с линией прилипает к ней', () => {
    // Чуть севернее середины первого звена.
    const hit = nearestOnRoute({ lat: 53.001, lon: 69.05 }, ELBOW);
    expect(hit).not.toBeNull();
    expect(hit!.lat).toBeCloseTo(53, 4);
    expect(hit!.lon).toBeCloseTo(69.05, 4);
    expect(hit!.deviationM).toBeGreaterThan(90);
    expect(hit!.deviationM).toBeLessThan(130);
    expect(hit!.index).toBe(0);
  });

  it('знает, сколько метров от начала', () => {
    const hit = nearestOnRoute({ lat: 53, lon: 69.05 }, ELBOW)!;
    const half = haversineM({ lat: 53, lon: 69 }, { lat: 53, lon: 69.1 }) / 2;
    expect(hit.atM).toBeCloseTo(half, 0);
  });

  it('за углом попадает на второе звено', () => {
    const hit = nearestOnRoute({ lat: 53.05, lon: 69.101 }, ELBOW)!;
    expect(hit.index).toBe(1);
  });

  it('из одной точки трассы не бывает', () => {
    expect(nearestOnRoute({ lat: 53, lon: 69 }, [[53, 69]])).toBeNull();
  });
});

describe('snapToRoutes', () => {
  const routes = [
    { id: 'a', coords: ELBOW },
    { id: 'b', coords: [[52, 69], [52, 69.1]] as [number, number][] },
  ];

  it('берёт ближайшую трассу', () => {
    const hit = snapToRoutes({ lat: 52.0005, lon: 69.05 }, routes, 500);
    expect(hit?.routeId).toBe('b');
  });

  it('мимо всех — не прилипает', () => {
    expect(snapToRoutes({ lat: 50, lon: 60 }, routes, 500)).toBeNull();
  });

  it('допуск задаёт карта: далеко — значит мимо', () => {
    const far = { lat: 53.01, lon: 69.05 };
    expect(snapToRoutes(far, routes, 100)).toBeNull();
    expect(snapToRoutes(far, routes, 2000)?.routeId).toBe('a');
  });
});

describe('measureLine', () => {
  it('считает звенья и сумму', () => {
    const m = measureLine(ELBOW);
    expect(m.legs).toHaveLength(2);
    expect(m.totalM).toBeCloseTo(m.legs[0] + m.legs[1], 6);
  });

  it('по прямой короче, чем по ломаной', () => {
    const m = measureLine(ELBOW);
    expect(m.straightM).toBeLessThan(m.totalM);
  });

  it('одна точка — мерить нечего', () => {
    const m = measureLine([[53, 69]]);
    expect(m.totalM).toBe(0);
    expect(m.straightM).toBe(0);
  });
});

describe('measureAlongRoute', () => {
  it('по трассе за углом длиннее, чем напрямик', () => {
    const a = nearestOnRoute({ lat: 53, lon: 69 }, ELBOW)!;
    const b = nearestOnRoute({ lat: 53.1, lon: 69.1 }, ELBOW)!;
    const m = measureAlongRoute(ELBOW, a, b);
    expect(m.alongM).toBeGreaterThan(m.straightM);
    expect(m.fromM).toBe(0);
  });

  it('порядок кликов не важен', () => {
    const a = nearestOnRoute({ lat: 53, lon: 69.02 }, ELBOW)!;
    const b = nearestOnRoute({ lat: 53, lon: 69.08 }, ELBOW)!;
    expect(measureAlongRoute(ELBOW, a, b).alongM)
      .toBeCloseTo(measureAlongRoute(ELBOW, b, a).alongM, 6);
  });
});

describe('polygonAreaM2', () => {
  it('градусный квадрат у экватора — около 12 300 км²', () => {
    const km2 = polygonAreaM2([[0, 0], [0, 1], [1, 1], [1, 0]]) / 1e6;
    expect(km2).toBeGreaterThan(12_000);
    expect(km2).toBeLessThan(12_600);
  });

  it('направление обхода не меняет площадь', () => {
    const cw = polygonAreaM2([[53, 69], [53.01, 69], [53.01, 69.01], [53, 69.01]]);
    const ccw = polygonAreaM2([[53, 69.01], [53.01, 69.01], [53.01, 69], [53, 69]]);
    expect(cw).toBeCloseTo(ccw, 3);
  });

  it('замкнут контур или нет — площадь одна', () => {
    const open: [number, number][] = [[53, 69], [53.01, 69], [53.01, 69.01]];
    expect(polygonAreaM2(open)).toBeCloseTo(polygonAreaM2([...open, [53, 69]]), 3);
  });

  it('из двух точек площади нет', () => {
    expect(polygonAreaM2([[53, 69], [53, 69.1]])).toBe(0);
  });
});

describe('perimeterM', () => {
  it('замыкает контур', () => {
    const square: [number, number][] = [[53, 69], [53.01, 69], [53.01, 69.01], [53, 69.01]];
    const open = measureLine(square).totalM;
    expect(perimeterM(square)).toBeGreaterThan(open);
  });
});

describe('rectCoords', () => {
  it('из двух углов получаются четыре', () => {
    const r = rectCoords([53, 69], [53.01, 69.02]);
    expect(r).toEqual([[53, 69], [53, 69.02], [53.01, 69.02], [53.01, 69]]);
  });

  it('угол сам с собой — не прямоугольник', () => {
    expect(rectCoords([53, 69], [53, 69])).toEqual([]);
  });

  it('обход по порядку, без самопересечения', () => {
    const r = rectCoords([53.01, 69.02], [53, 69]);
    expect(polygonAreaM2(r)).toBeGreaterThan(0);
  });
});

describe('circleCoords', () => {
  it('площадь круга совпадает с πr² с точностью многоугольника', () => {
    const center: [number, number] = [53, 69];
    // Точка примерно в километре к северу.
    const edge: [number, number] = [53 + 1000 / 111_320, 69];
    const r = haversineM({ lat: center[0], lon: center[1] }, { lat: edge[0], lon: edge[1] });
    const area = polygonAreaM2(circleCoords(center, edge));
    expect(area).toBeGreaterThan(Math.PI * r * r * 0.99);
    expect(area).toBeLessThan(Math.PI * r * r * 1.001);
  });

  it('на широте Казахстана круг остаётся круглым, а не овальным', () => {
    const center: [number, number] = [53, 69];
    const ring = circleCoords(center, [53 + 1000 / 111_320, 69]);
    const dists = ring.map((p) => haversineM(
      { lat: center[0], lon: center[1] }, { lat: p[0], lon: p[1] },
    ));
    const min = Math.min(...dists);
    const max = Math.max(...dists);
    expect(max - min).toBeLessThan(5);
  });

  it('нулевой радиус — это не круг', () => {
    expect(circleCoords([53, 69], [53, 69])).toEqual([]);
  });
});

describe('formatArea', () => {
  it('маленькое — в метрах', () => {
    expect(formatArea(840)).toBe('840 м²');
  });

  it('участок — в гектарах', () => {
    expect(formatArea(32_000)).toBe('3,20 га');
  });

  it('большое — в километрах', () => {
    expect(formatArea(18_500_000)).toBe('18,50 км²');
  });
});
