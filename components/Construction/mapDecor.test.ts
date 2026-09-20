import { describe, it, expect } from 'vitest';
import {
  bearingDeg, locateOnRoute, arrowsAlong, formatMeters, lengthLabels,
  progressSplit, mapLegend, scaleBar, METHOD_DASH,
} from './mapDecor';
import { routeLengthM } from './routeProgress';
import { DEFAULT_CONSTRUCTION_LAYERS } from './mapLayers';

/** Прямая на восток: полградуса долготы под Кокшетау — примерно 34 км. */
const EAST: [number, number][] = [[53, 69], [53, 69.5]];

describe('bearingDeg', () => {
  it('на восток — девяносто', () => {
    expect(bearingDeg([53, 69], [53, 69.5])).toBeCloseTo(90, 0);
  });

  it('на север — ноль', () => {
    expect(bearingDeg([53, 69], [53.5, 69])).toBeCloseTo(0, 5);
  });

  it('на запад — двести семьдесят', () => {
    expect(bearingDeg([53, 69.5], [53, 69])).toBeCloseTo(270, 0);
  });
});

describe('locateOnRoute', () => {
  it('знает и точку, и направление', () => {
    const total = routeLengthM(EAST);
    const mid = locateOnRoute(EAST, total / 2);
    expect(mid).not.toBeNull();
    expect(mid!.lon).toBeCloseTo(69.25, 3);
    expect(mid!.deg).toBeCloseTo(90, 0);
  });

  it('за концом трассы останавливается на конце', () => {
    const p = locateOnRoute(EAST, 999_999);
    expect(p!.lon).toBeCloseTo(69.5, 6);
  });

  it('из одной точки направления не бывает', () => {
    expect(locateOnRoute([[53, 69]], 10)).toBeNull();
  });
});

describe('arrowsAlong', () => {
  it('ставит стрелки с шагом и не у самого начала', () => {
    const total = routeLengthM(EAST);
    const arrows = arrowsAlong(EAST, { everyM: 10_000 });
    expect(arrows.length).toBe(Math.ceil((total - 5000) / 10_000));
    expect(arrows[0].atM).toBe(5000);
    arrows.forEach((a) => expect(a.deg).toBeCloseTo(90, 0));
  });

  it('на короткой трассе стрелок нет: шаг не помещается', () => {
    expect(arrowsAlong(EAST, { everyM: 100_000 })).toEqual([]);
  });

  it('длинную трассу не заливает стрелками', () => {
    const arrows = arrowsAlong(EAST, { everyM: 100, max: 5 });
    expect(arrows.length).toBe(5);
  });
});

describe('formatMeters', () => {
  it('до километра — метры целиком', () => {
    expect(formatMeters(430)).toBe('430 м');
    expect(formatMeters(0)).toBe('0 м');
  });

  it('дальше — километры с запятой', () => {
    expect(formatMeters(1240)).toBe('1,24 км');
    expect(formatMeters(34_000)).toBe('34,0 км');
  });
});

describe('lengthLabels', () => {
  const ZIGZAG: [number, number][] = [
    [53, 69], [53, 69.4],   // длинный перегон
    [53.0005, 69.4005],     // поворот, метры
    [53.0005, 69.6],        // ещё длинный
  ];

  it('подписывает перегоны и пропускает повороты', () => {
    const labels = lengthLabels(ZIGZAG, { minMeters: 500 });
    expect(labels).toHaveLength(2);
    expect(labels[0].text).toMatch(/км$/);
  });

  it('подпись ложится на середину отрезка', () => {
    const labels = lengthLabels(EAST, { minMeters: 100 });
    expect(labels[0].lon).toBeCloseTo(69.25, 3);
  });

  it('не больше заданного числа подписей — и по порядку трассы', () => {
    const many: [number, number][] = [];
    for (let i = 0; i < 20; i++) many.push([53, 69 + i * 0.05]);
    const labels = lengthLabels(many, { minMeters: 10, max: 4 });
    expect(labels).toHaveLength(4);
    const lons = labels.map((l) => l.lon);
    expect([...lons].sort((a, b) => a - b)).toEqual(lons);
  });

  it('из одной точки подписывать нечего', () => {
    expect(lengthLabels([[53, 69]], { minMeters: 1 })).toEqual([]);
  });
});

describe('progressSplit', () => {
  it('делит линию на пройденное и остаток', () => {
    const total = routeLengthM(EAST);
    const split = progressSplit(EAST, total / 4);
    expect(split.share).toBeCloseTo(0.25, 3);
    expect(split.done.length).toBeGreaterThanOrEqual(2);
    expect(split.left.length).toBeGreaterThanOrEqual(2);
    // Конец пройденного и начало остатка — одна и та же точка.
    expect(split.done[split.done.length - 1][1]).toBeCloseTo(split.left[0][1], 6);
  });

  it('ничего не прошли — закрашивать нечего', () => {
    const split = progressSplit(EAST, 0);
    expect(split.done).toEqual([]);
    expect(split.share).toBe(0);
  });

  it('прошли больше длины — это всё равно сто процентов', () => {
    const split = progressSplit(EAST, 10_000_000);
    expect(split.share).toBe(1);
    expect(split.left).toEqual([]);
  });
});

describe('mapLegend', () => {
  it('объясняет только включённые слои', () => {
    const groups = mapLegend({ ...DEFAULT_CONSTRUCTION_LAYERS, incidents: false }, 'stage');
    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain('Проект');
    expect(labels).toContain('Кабель задут');
    expect(labels).not.toContain('Авария');
  });

  it('по способу — другие строки и штрихи', () => {
    const groups = mapLegend(DEFAULT_CONSTRUCTION_LAYERS, 'method');
    const line = groups[0].items.find((i) => i.label === 'Баром');
    expect(line?.dash).toBe(METHOD_DASH['бар']);
    expect(groups[0].items.some((i) => i.label === 'Сдано')).toBe(false);
  });

  it('трассу выключили — и легенда молчит про трассу', () => {
    const groups = mapLegend({ ...DEFAULT_CONSTRUCTION_LAYERS, plan: false }, 'stage');
    expect(groups.some((g) => g.title.startsWith('Трасса'))).toBe(false);
  });
});

describe('scaleBar', () => {
  it('выбирает круглое число, которое влезает', () => {
    // 100 м на пиксель, 80 пикселей — это 8 км, значит показываем 5 км.
    const bar = scaleBar(100, 80);
    expect(bar.meters).toBe(5000);
    expect(bar.px).toBe(50);
    expect(bar.label).toBe('5,00 км');
  });

  it('на крупном масштабе спускается к метрам', () => {
    const bar = scaleBar(0.6, 100);
    expect(bar.meters).toBe(50);
    expect(bar.label).toBe('50 м');
  });

  it('линейка никогда не длиннее отведённого места', () => {
    for (const mpp of [0.3, 1, 7, 42, 300, 5000]) {
      const bar = scaleBar(mpp, 90);
      expect(bar.px).toBeLessThanOrEqual(90);
      expect(bar.px).toBeGreaterThan(0);
    }
  });
});
