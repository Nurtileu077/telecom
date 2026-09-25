import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser } from 'linkedom';
import { buildKml, type KmlDoc } from './kmlExport';
import { parseKmlTextChunked } from '@/components/Import/KmzImporter';

/**
 * Выгруженный KML должен читаться обратно.
 *
 * Файл приходит от проектировщика, правится на стройке и уходит к нему
 * обратно — а потом возвращается уже от него. Порядок координат в KML
 * обратный привычному (долгота, широта), и перепутать их значит уронить
 * трассу в другое полушарие. Проверка по отдельности этого не видит:
 * выгрузка сама по себе верна, разбор сам по себе верен, а вместе они
 * могут не сойтись.
 */

/**
 * Разбор KML идёт через DOMParser — в браузере он есть, в node нет.
 * Подкладываем настоящий разборщик XML: подделка тут бессмысленна, а
 * проверять надо именно то, что выполняется у людей.
 */
beforeAll(() => {
  (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
});

const ROUTE: [number, number][] = [
  [52.091435, 69.123456],
  [52.095000, 69.130000],
  [52.100000, 69.140000],
];

const DOC: KmlDoc = {
  name: 'Выгрузка Optiq',
  folders: [{
    name: 'Трассы',
    lines: [
      { name: 'Зеренда — Серафимовка', coords: ROUTE, color: '#2dd4bf' },
      // Кавычки и амперсанд в названии — обычное дело: «ТОО "Дозер" & К».
      { name: 'Участок «А» & «Б»', coords: ROUTE.slice(0, 2) },
    ],
    points: [
      { name: 'Муфта №1', lat: 52.0925, lon: 69.1260 },
      { name: 'ККС 12', lat: 52.0990, lon: 69.1390, description: 'глубина 1,2 м' },
    ],
  }],
};

describe('KML туда и обратно', () => {
  it('линии возвращаются в том же числе', async () => {
    const parsed = await parseKmlTextChunked(buildKml(DOC));
    expect(parsed.lines).toHaveLength(2);
  });

  it('координаты не переставлены местами', async () => {
    const parsed = await parseKmlTextChunked(buildKml(DOC));
    const line = parsed.lines.find((l) => l.name.includes('Зеренда'));
    expect(line).toBeTruthy();
    expect(line!.coords).toHaveLength(ROUTE.length);
    line!.coords.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(ROUTE[i][0], 6);
      expect(c[1]).toBeCloseTo(ROUTE[i][1], 6);
    });
  });

  it('точность не теряется: шесть знаков — это меньше метра', async () => {
    const parsed = await parseKmlTextChunked(buildKml(DOC));
    const line = parsed.lines.find((l) => l.name.includes('Зеренда'))!;
    expect(line.coords[0][0]).toBe(52.091435);
    expect(line.coords[0][1]).toBe(69.123456);
  });

  it('кавычки и амперсанд в названии переживают круг', async () => {
    const parsed = await parseKmlTextChunked(buildKml(DOC));
    expect(parsed.lines.map((l) => l.name)).toContain('Участок «А» & «Б»');
  });

  it('точки возвращаются со своими местами', async () => {
    const parsed = await parseKmlTextChunked(buildKml(DOC));
    const mufta = parsed.structuredPoints.find((p) => p.name === 'Муфта №1');
    expect(mufta).toBeTruthy();
    expect(mufta!.lat).toBeCloseTo(52.0925, 6);
    expect(mufta!.lon).toBeCloseTo(69.1260, 6);
    // В старой схеме абонентов у точки не имя, а описание.
    const same = parsed.subscribers.find((p) => p.desc === 'Муфта №1');
    expect(same?.lat).toBeCloseTo(52.0925, 6);
  });

  it('папка остаётся папкой: по ней потом раскладывают участки', async () => {
    const parsed = await parseKmlTextChunked(buildKml(DOC));
    expect(parsed.lines.every((l) => l.folder === 'Трассы')).toBe(true);
  });

  it('пустая выгрузка читается пустой, а не роняет разбор', async () => {
    const parsed = await parseKmlTextChunked(buildKml({ name: 'Пусто', folders: [] }));
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.stats.placemarks).toBe(0);
  });

  it('замкнутый контур возвращается площадью, а не ломаной', async () => {
    const area: KmlDoc = {
      name: 'Контуры',
      folders: [{
        name: 'Обводки',
        lines: [{ name: 'Площадка', coords: ROUTE, closed: true }],
      }],
    };
    const parsed = await parseKmlTextChunked(buildKml(area));
    expect(parsed.polygons).toHaveLength(1);
    expect(parsed.polygons[0].name).toBe('Площадка');
  });

  it('ничего не теряется по дороге: счётчик сходится', async () => {
    const parsed = await parseKmlTextChunked(buildKml(DOC));
    expect(parsed.stats.droppedCoords).toBe(0);
    expect(parsed.stats.placemarks).toBe(4);
  });
});

/**
 * То, что приходит от проектировщика, а не то, что выгружаем сами.
 *
 * Google Earth пишет координаты с высотой, кладёт метки во вложенные
 * папки и не стесняется пробелов и переводов строк внутри координат.
 * Наша выгрузка так не делает — значит, кругом это не проверить, и
 * проверять надо отдельно.
 */
describe('KML так, как его пишет Google Earth', () => {
  const kml = (inner: string) => '<?xml version="1.0" encoding="UTF-8"?>'
    + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
    + `<name>Проект</name>${inner}</Document></kml>`;

  it('высота в координатах не сбивает разбор', async () => {
    const parsed = await parseKmlTextChunked(kml(
      '<Placemark><name>Трасса</name><LineString><coordinates>'
      + '69.123456,52.091435,0 69.130000,52.095000,412.5'
      + '</coordinates></LineString></Placemark>',
    ));
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].coords[0]).toEqual([52.091435, 69.123456]);
    expect(parsed.lines[0].coords[1][1]).toBeCloseTo(69.13, 6);
  });

  it('переводы строк и отступы внутри координат не мешают', async () => {
    const parsed = await parseKmlTextChunked(kml(
      '<Placemark><name>Трасса</name><LineString><coordinates>\n'
      + '          69.1,52.1,0\n          69.2,52.2,0\n        '
      + '</coordinates></LineString></Placemark>',
    ));
    expect(parsed.lines[0].coords).toHaveLength(2);
  });

  it('вложенные папки не теряют метки', async () => {
    const parsed = await parseKmlTextChunked(kml(
      '<Folder><name>Акмолинская</name><Folder><name>Зеренда</name>'
      + '<Placemark><name>Трасса</name><LineString><coordinates>'
      + '69.1,52.1 69.2,52.2</coordinates></LineString></Placemark>'
      + '</Folder></Folder>',
    ));
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].folder).toBe('Зеренда');
  });

  it('южное и западное полушария не переворачиваются', async () => {
    const parsed = await parseKmlTextChunked(kml(
      '<Placemark><name>Юг</name><LineString><coordinates>'
      + '-18.425,-33.925,0 -18.430,-33.930,0'
      + '</coordinates></LineString></Placemark>',
    ));
    expect(parsed.lines[0].coords[0][0]).toBeCloseTo(-33.925, 6);
    expect(parsed.lines[0].coords[0][1]).toBeCloseTo(-18.425, 6);
  });

  it('битая координата считается, а не рушит файл', async () => {
    const parsed = await parseKmlTextChunked(kml(
      '<Placemark><name>Трасса</name><LineString><coordinates>'
      + '69.1,52.1 неизвестно 69.2,52.2'
      + '</coordinates></LineString></Placemark>',
    ));
    expect(parsed.lines[0].coords).toHaveLength(2);
    expect(parsed.stats.droppedCoords).toBeGreaterThan(0);
  });

  it('тысячи меток читаются порциями и не теряются', async () => {
    const many = Array.from({ length: 1200 }, (_, i) =>
      `<Placemark><name>Точка ${i}</name><Point><coordinates>`
      + `${69 + i / 10000},${52 + i / 10000},0</coordinates></Point></Placemark>`).join('');
    const seen: number[] = [];
    const parsed = await parseKmlTextChunked(kml(many), {}, (n) => seen.push(n));
    // Точка нарочно попадает в оба списка: это два взгляда на одно — для
    // старой схемы абонентов и для разбора по типам. Считаем порознь.
    expect(parsed.subscribers).toHaveLength(1200);
    expect(parsed.structuredPoints).toHaveLength(1200);
    expect(parsed.stats.placemarks).toBe(1200);
    // Порциями, а не разом: иначе вкладка на большом файле подвисает.
    expect(seen.length).toBeGreaterThan(1);
  });

  it('пустой файл — это пустой файл, а не ошибка', async () => {
    const parsed = await parseKmlTextChunked(kml(''));
    expect(parsed.stats.placemarks).toBe(0);
    expect(parsed.lines).toHaveLength(0);
  });
});
