import { describe, it, expect } from 'vitest';
import {
  bearingDeg, locateOnRoute, arrowsAlong, formatMeters, lengthLabels,
  mapLegend, scaleBar, METHOD_DASH, clusterPoints, routePaint, hatchDash,
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

describe('закраска там, где копали', () => {
  const total = routeLengthM(EAST);

  it('куски, стоящие встык, красятся одной линией', () => {
    const p = routePaint(EAST, [{ fromM: 1000, toM: 2000 }, { fromM: 2000, toM: 3500 }], 0);
    expect(p.done).toHaveLength(1);
    expect(p.doneM).toBeCloseTo(2500, 3);
    expect(p.hatch).toBeNull();
  });

  it('кусок с середины начинается там, где копали, а не у начала линии', () => {
    const p = routePaint(EAST, [{ fromM: 6000, toM: 9000 }], 0);
    const lonAt = (m: number) => 69 + (m / total) * 0.5;
    expect(p.done[0][0][1]).toBeCloseTo(lonAt(6000), 4);
    expect(p.done[0].at(-1)![1]).toBeCloseTo(lonAt(9000), 4);
  });

  it('метры без места — штрихом по линии, и чем их больше, тем гуще штрих', () => {
    const few = routePaint(EAST, [], total * 0.1);
    const many = routePaint(EAST, [], total * 0.7);
    expect(few.done).toEqual([]);
    expect(few.hatch).not.toBeNull();
    const dash = (h: string | null) => Number(h!.split(',')[0]);
    expect(dash(many.hatch)).toBeGreaterThan(dash(few.hatch));
  });

  it('доля без места считается от незакрашенного: закрашенное второй раз не штрихуем', () => {
    const p = routePaint(EAST, [{ fromM: 0, toM: total / 2 }], total);
    // Без места не может быть больше, чем осталось незакрашенным.
    expect(p.unplacedM).toBeCloseTo(total / 2, 3);
    expect(p.full).toBe(true);
  });

  it('пройдено всё — линия красится целиком: где именно, уже неважно', () => {
    const p = routePaint(EAST, [], total);
    expect(p.full).toBe(true);
    expect(p.hatch).toBeNull();
  });

  it('куски за концом линии обрезаются ею: больше длины — это всё равно вся линия', () => {
    const p = routePaint(EAST, [{ fromM: 0, toM: 10_000_000 }], 0);
    expect(p.doneM).toBeCloseTo(total, 3);
    expect(p.full).toBe(true);
  });

  it('работ не было — ни закраски, ни штриха', () => {
    const p = routePaint(EAST, [], 0);
    expect(p.done).toEqual([]);
    expect(p.hatch).toBeNull();
    expect(p.full).toBe(false);
  });

  it('штрих не бывает ни пустым, ни сплошным: сплошной прочли бы как «здесь»', () => {
    expect(hatchDash(0)).toBe('2,12');
    expect(hatchDash(1)).toBe('12,2');
  });
});

describe('mapLegend', () => {
  it('объясняет штрих «место не указано», иначе его прочтут как способ', () => {
    for (const mode of ['stage', 'method'] as const) {
      const item = mapLegend(DEFAULT_CONSTRUCTION_LAYERS, mode)[0].items
        .find((i) => i.label === 'Пройдено, место не указано');
      expect(item?.dash).toBeTruthy();
    }
  });

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

describe('clusterPoints', () => {
  const near = [
    { lat: 53.0000, lon: 69.0000 },
    { lat: 53.0001, lon: 69.0001 },
    { lat: 53.0002, lon: 69.0002 },
  ];
  const far = { lat: 53.5, lon: 69.5 };

  it('близкие собирает в одну кучу', () => {
    // 100 м на пиксель, ячейка 60 пикселей — это 6 км.
    const c = clusterPoints([...near, far], 60, 100);
    expect(c).toHaveLength(2);
    expect(c.find((x) => x.items.length === 3)).toBeTruthy();
  });

  it('вблизи ничего не скучивает', () => {
    // Полметра на пиксель: ячейка 30 м, точки в десятках метров друг от друга.
    const c = clusterPoints(near, 60, 0.5);
    expect(c.length).toBeGreaterThan(1);
  });

  it('значок стоит в середине группы, а не в углу ячейки', () => {
    const c = clusterPoints(near, 60, 100);
    const big = c.find((x) => x.items.length === 3)!;
    expect(big.lat).toBeCloseTo(53.0001, 5);
    expect(big.lon).toBeCloseTo(69.0001, 5);
  });

  it('ни одна точка не теряется', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ lat: 53 + i * 0.01, lon: 69 }));
    const total = clusterPoints(many, 40, 50).reduce((s, c) => s + c.items.length, 0);
    expect(total).toBe(50);
  });

  it('битые координаты выкидываем, а не роняем карту', () => {
    const c = clusterPoints(
      [{ lat: NaN, lon: 69 }, { lat: 53, lon: 69 }] as { lat: number; lon: number }[],
      60, 100,
    );
    expect(c).toHaveLength(1);
  });

  it('пустой список — пустой ответ', () => {
    expect(clusterPoints([], 60, 100)).toEqual([]);
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
