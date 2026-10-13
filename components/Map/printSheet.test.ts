import { describe, it, expect } from 'vitest';
import {
  sheetMm, pageCss, groundMetersPerPx, roundScaleUp, scaleText, perCmText,
  paperScaleBar, layoutSheet, coordGrid, edgeScaleText, snapshotBar, parsePrintOptions, sheetNotes,
  DEFAULT_PRINT, SHEET_MARGIN_MM, SHEET_RESERVED_MM, type MapView,
} from './printSheet';

/** Село под Астаной на 15-м зуме, экран ноутбука. */
const village: MapView = {
  lat: 51.17, zoom: 15,
  north: 51.19, south: 51.15, east: 71.47, west: 71.39,
  widthPx: 1200, heightPx: 700,
};

describe('лист', () => {
  it('A3 альбомный — 420 на 297', () => {
    expect(sheetMm('A3', 'landscape')).toEqual({ w: 420, h: 297 });
  });

  it('книжный — тот же лист, повёрнутый', () => {
    expect(sheetMm('A4', 'portrait')).toEqual({ w: 210, h: 297 });
  });

  it('правило страницы называет выбранный лист, а не всегда A4', () => {
    expect(pageCss({ paper: 'A3', orientation: 'portrait' })).toContain('size: A3 portrait');
  });

  it('запомненный выбор листа читает, а мусор заменяет на A4 альбомный с сеткой', () => {
    expect(parsePrintOptions({ paper: 'A3', orientation: 'portrait', grid: false }))
      .toEqual({ paper: 'A3', orientation: 'portrait', grid: false });
    expect(parsePrintOptions('A5')).toEqual(DEFAULT_PRINT);
    expect(parsePrintOptions({ paper: 'A0', grid: 'да' }))
      .toEqual({ paper: 'A4', orientation: 'landscape', grid: false });
  });
});

describe('метры в точке экрана', () => {
  it('на экваторе на нулевом зуме — длина экватора на 256 точек', () => {
    expect(groundMetersPerPx(0, 0)).toBeCloseTo((2 * Math.PI * 6378137) / 256, 3);
  });

  it('у Астаны на 0,2 % длиннее шаровой формулы — параллель на эллипсоиде длиннее', () => {
    const sphere = (156543.03392 * Math.cos((51.17 * Math.PI) / 180)) / 2 ** 15;
    const ratio = groundMetersPerPx(51.17, 15) / sphere;
    expect(ratio).toBeGreaterThan(1.001);
    expect(ratio).toBeLessThan(1.003);
  });
});

describe('масштаб', () => {
  it('округляет вверх до двух значащих цифр', () => {
    expect(roundScaleUp(23_417)).toBe(24_000);
    expect(roundScaleUp(24_000)).toBe(24_000);
    expect(roundScaleUp(10_001)).toBe(11_000);
    expect(roundScaleUp(987)).toBe(990);
  });

  it('пишет тысячи через неразрывный пробел', () => {
    expect(scaleText(24_000)).toBe('1:24 000');
  });

  it('говорит, сколько метров в сантиметре листа', () => {
    expect(perCmText(24_000)).toBe('в 1 см 240 м');
    expect(perCmText(150_000)).toBe('в 1 см 1,5 км');
  });
});

describe('раскладка карты на листе', () => {
  it('масштаб круглый, а карта не вылезает за лист', () => {
    const l = layoutSheet(village, { paper: 'A4', orientation: 'landscape' })!;
    expect(l.scale).toBe(roundScaleUp(l.scale));
    expect(l.mapWmm).toBeLessThanOrEqual(297 - 2 * SHEET_MARGIN_MM + 1e-9);
    expect(l.mapHmm).toBeLessThanOrEqual(210 - 2 * SHEET_MARGIN_MM - SHEET_RESERVED_MM + 1e-9);
  });

  it('миллиметр листа и метры местности сходятся с подписью 1:N', () => {
    const l = layoutSheet(village, { paper: 'A4', orientation: 'landscape' })!;
    const groundW = groundMetersPerPx(village.lat, village.zoom) * village.widthPx;
    expect((groundW / (l.mapWmm / 1000))).toBeCloseTo(l.scale, 6);
  });

  it('пропорции экрана сохраняются — карту не сплющивает', () => {
    const l = layoutSheet(village, { paper: 'A3', orientation: 'portrait' })!;
    expect(l.mapWmm / l.mapHmm).toBeCloseTo(1200 / 700, 9);
  });

  it('на A3 та же карта крупнее, чем на A4', () => {
    const a4 = layoutSheet(village, { paper: 'A4', orientation: 'landscape' })!;
    const a3 = layoutSheet(village, { paper: 'A3', orientation: 'landscape' })!;
    expect(a3.scale).toBeLessThan(a4.scale);
  });

  it('на селе разница масштабов по краям не стоит оговорки', () => {
    expect(layoutSheet(village, { paper: 'A4', orientation: 'landscape' })!.stretched).toBe(false);
  });

  it('на листе с областью целиком называет масштаб у краёв', () => {
    const oblast: MapView = {
      lat: 50, zoom: 7, north: 53, south: 47, east: 76, west: 66, widthPx: 1200, heightPx: 700,
    };
    const l = layoutSheet(oblast, { paper: 'A4', orientation: 'landscape' })!;
    expect(l.stretched).toBe(true);
    // К северу метр на карте короче — знаменатель меньше.
    expect(l.scaleTop).toBeLessThan(l.scale);
    expect(l.scaleBottom).toBeGreaterThan(l.scale);
  });

  it('пустую карту на лист не кладёт', () => {
    expect(layoutSheet({ ...village, widthPx: 0 }, { paper: 'A4', orientation: 'landscape' })).toBeNull();
  });

  it('масштаб края без лишних цифр', () => {
    expect(edgeScaleText(1_234_567)).toBe('1:1 200 000');
  });
});

describe('линейка на бумаге', () => {
  it('длина круглая, а миллиметры точные', () => {
    const b = paperScaleBar(24_000, 60)!;
    // 60 мм при 1:24 000 — 1 440 м, самое крупное круглое — 1 км.
    expect(b.meters).toBe(1000);
    expect(b.mm).toBeCloseTo(1000 / 24, 9);
    expect(b.label).toBe('1,00 км');
  });

  it('двойку делит на четыре части, остальное — на пять', () => {
    expect(paperScaleBar(4_000, 60)!.ticks).toHaveLength(5);
    expect(paperScaleBar(10_000, 60)!.ticks).toHaveLength(6);
  });

  it('без масштаба линейку не рисует', () => {
    expect(paperScaleBar(0)).toBeNull();
  });
});

describe('сетка координат', () => {
  it('на селе шаг в сотые градуса, подписи с запятой', () => {
    const g = coordGrid(village)!;
    expect(g.step).toBe(0.01);
    expect(g.lines.filter((l) => l.kind === 'lon').map((l) => l.label))
      .toEqual(['71,40°', '71,41°', '71,42°', '71,43°', '71,44°', '71,45°', '71,46°']);
  });

  it('параллели ставит по проекции карты, а не делит высоту поровну', () => {
    const g = coordGrid({ north: 53, south: 47, east: 76, west: 66 }, 8)!;
    const lat50 = g.lines.find((l) => l.kind === 'lat' && l.value === 50)!;
    // 50° — ровно посредине по градусам, но на карте ниже середины.
    expect(lat50.pos).toBeGreaterThan(0.5);
  });

  it('линии не ложатся на самый край листа', () => {
    const g = coordGrid({ north: 51.2, south: 51.1, east: 71.5, west: 71.4 })!;
    for (const l of g.lines) {
      expect(l.pos).toBeGreaterThan(0);
      expect(l.pos).toBeLessThan(1);
    }
  });

  it('вывернутую рамку сеткой не покрывает', () => {
    expect(coordGrid({ north: 50, south: 51, east: 70, west: 71 })).toBeNull();
  });
});

describe('оговорки под картой', () => {
  it('говорит, при какой печати верна цифра 1:N', () => {
    const l = layoutSheet(village, { paper: 'A4', orientation: 'landscape' })!;
    const notes = sheetNotes(l, null);
    expect(notes[0]).toContain(scaleText(l.scale));
    expect(notes[0]).toContain('100 %');
    expect(notes.some((n) => n.includes('Сетка'))).toBe(false);
  });

  it('называет шаг сетки и систему координат', () => {
    const l = layoutSheet(village, { paper: 'A4', orientation: 'landscape' })!;
    expect(sheetNotes(l, coordGrid(village)).join(' ')).toContain('WGS-84, шаг 0,01°');
  });

  it('без данных о карте масштаб не выдумывает', () => {
    const notes = sheetNotes(null, null);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('не определён');
  });
});

describe('линейка на снимке', () => {
  it('на экране с двойной плотностью отрезок вдвое длиннее в точках файла', () => {
    const one = snapshotBar(village, 1)!;
    const two = snapshotBar(village, 2)!;
    expect(two.label).toBe(one.label);
    expect(two.px).toBeCloseTo(one.px * 2, 6);
  });
});
