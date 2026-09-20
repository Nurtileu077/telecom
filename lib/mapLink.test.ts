import { describe, it, expect } from 'vitest';
import { buildMapHash, parseMapHash, mapLinkFor } from './mapLink';

describe('buildMapHash', () => {
  it('пишет зум, широту и долготу', () => {
    expect(buildMapHash({ lat: 52.0914, lon: 69.1234, zoom: 14 }))
      .toBe('#14/52.09140/69.12340');
  });

  it('на общем плане лишние знаки не хранит', () => {
    expect(buildMapHash({ lat: 52.0914356, lon: 69.1234567, zoom: 7 }))
      .toBe('#7/52.0914/69.1235');
  });

  it('зум держит в разумных пределах', () => {
    expect(buildMapHash({ lat: 52, lon: 69, zoom: 99 })).toMatch(/^#21\//);
    expect(buildMapHash({ lat: 52, lon: 69, zoom: -5 })).toMatch(/^#3\//);
  });

  it('может указать, что открыть', () => {
    expect(buildMapHash({ lat: 52, lon: 69, zoom: 14, focus: 'route-7' }))
      .toBe('#14/52.00000/69.00000/route-7');
  });
});

describe('parseMapHash', () => {
  it('читает то, что написал', () => {
    const v = parseMapHash('#14/52.09140/69.12340');
    expect(v).toEqual({ lat: 52.0914, lon: 69.1234, zoom: 14, focus: undefined });
  });

  it('решётка необязательна', () => {
    expect(parseMapHash('12/52/69')?.zoom).toBe(12);
  });

  it('возвращает то, что просили открыть', () => {
    expect(parseMapHash('#14/52/69/route-7')?.focus).toBe('route-7');
  });

  it('мусор — это не координаты', () => {
    expect(parseMapHash('')).toBeNull();
    expect(parseMapHash('#')).toBeNull();
    expect(parseMapHash('#14/52')).toBeNull();
    expect(parseMapHash('#abc/def/ghi')).toBeNull();
    expect(parseMapHash('#14/952/69')).toBeNull();
  });

  it('туда и обратно без потерь', () => {
    const v = { lat: 52.091436, lon: 69.123457, zoom: 18, focus: 'муфта 12' };
    expect(parseMapHash(buildMapHash(v))).toEqual(v);
  });
});

describe('mapLinkFor', () => {
  it('сохраняет параметры адреса', () => {
    const link = mapLinkFor('https://optiq.example/?ws=favorit#7/43/68', {
      lat: 52, lon: 69, zoom: 15,
    });
    expect(link).toBe('https://optiq.example/?ws=favorit#15/52.00000/69.00000');
  });

  it('адрес без решётки тоже годится', () => {
    expect(mapLinkFor('https://optiq.example/', { lat: 52, lon: 69, zoom: 10 }))
      .toBe('https://optiq.example/#10/52.0000/69.0000');
  });
});
