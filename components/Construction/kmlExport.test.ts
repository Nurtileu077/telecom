import { describe, it, expect } from 'vitest';
import { buildKml, kmlColor, escapeXml, kmlFileName } from './kmlExport';

const DOC = {
  name: 'Зеренда — Серафимовка',
  folders: [{
    name: 'Трассы',
    lines: [{
      name: 'Зеренда → Серафимовка',
      coords: [[53.0, 69.0], [53.01, 69.02]] as [number, number][],
      color: '#3b82f6',
      description: 'проект',
    }],
    points: [{ name: 'ККС-1', lat: 53.0, lon: 69.0 }],
  }],
};

describe('kmlColor', () => {
  it('переворачивает байты и ставит прозрачность вперёд', () => {
    // #3b82f6 — rr=3b, gg=82, bb=f6 → aabbggrr
    expect(kmlColor('#3b82f6')).toBe('fff6823b');
  });

  it('без решётки тоже читает', () => {
    expect(kmlColor('3b82f6')).toBe('fff6823b');
  });

  it('прозрачность попадает в первый байт', () => {
    expect(kmlColor('#000000', 0.25)).toBe('40000000');
  });

  it('непонятный цвет — бирюзовый по умолчанию, а не поломанный файл', () => {
    expect(kmlColor('зелёный')).toBe('ff2dd4bf');
    expect(kmlColor(undefined)).toBe('ff2dd4bf');
  });
});

describe('escapeXml', () => {
  it('экранирует то, что ломает разметку', () => {
    expect(escapeXml('Школа №1 & «А» <b>')).toBe('Школа №1 &amp; «А» &lt;b&gt;');
  });
});

describe('buildKml', () => {
  const xml = buildKml(DOC);

  it('это разбираемый KML', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(xml.trimEnd().endsWith('</kml>')).toBe(true);
  });

  it('координаты идут долготой вперёд', () => {
    expect(xml).toContain('69.000000,53.000000,0 69.020000,53.010000,0');
  });

  it('название и папка на месте', () => {
    expect(xml).toContain('<name>Зеренда — Серафимовка</name>');
    expect(xml).toContain('<name>Трассы</name>');
    expect(xml).toContain('<name>ККС-1</name>');
  });

  it('на каждый цвет — свой стиль, и линия на него ссылается', () => {
    expect(xml).toContain('<Style id="s_fff6823b">');
    expect(xml).toContain('<styleUrl>#s_fff6823b</styleUrl>');
  });

  it('замкнутый контур выходит полигоном', () => {
    const poly = buildKml({
      name: 'Площадка',
      folders: [{
        name: 'Площади',
        lines: [{
          name: 'Рекультивация',
          closed: true,
          coords: [[53, 69], [53.01, 69], [53.01, 69.01]] as [number, number][],
        }],
      }],
    });
    expect(poly).toContain('<Polygon>');
    // Контур замыкается сам: первая точка повторяется последней.
    expect(poly).toContain('69.000000,53.000000,0 69.000000,53.010000,0'
      + ' 69.010000,53.010000,0 69.000000,53.000000,0');
  });

  it('пустые папки в файл не попадают', () => {
    const xml2 = buildKml({ name: 'Пусто', folders: [{ name: 'Ничего' }] });
    expect(xml2).not.toContain('Ничего');
  });
});

describe('kmlFileName', () => {
  it('дата в имени и без пробелов', () => {
    expect(kmlFileName('Зеренда Серафимовка', new Date('2026-07-25T10:00:00Z')))
      .toBe('Зеренда_Серафимовка_2026-07-25.kml');
  });

  it('выкидывает то, чего в имени файла быть не должно', () => {
    expect(kmlFileName('трасса/№1: «А»', new Date('2026-01-02T00:00:00Z')))
      .toBe('трасса1_А_2026-01-02.kml');
  });

  it('без названия — всё равно рабочее имя', () => {
    expect(kmlFileName('', new Date('2026-01-02T00:00:00Z'))).toBe('optiq_2026-01-02.kml');
  });
});
