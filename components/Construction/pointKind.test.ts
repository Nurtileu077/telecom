import { describe, it, expect } from 'vitest';
import {
  classifyPoint, endpointKindOf, groupPoints, POINT_GROUPS,
} from './pointKind';

const pt = (name: string) => ({ lat: 51.5, lon: 71.5, name });

describe('что за точка пришла из KML', () => {
  it('конец пути узнаётся по подписи', () => {
    for (const n of ['АТС', 'НРП', 'ФАП', 'Школа', 'школа №2', 'Аким аппарат',
      'акимат', 'детский сад', 'Клуб', 'Почта', 'амбулатория']) {
      expect(classifyPoint(n)).toBe('endpoint');
    }
  });

  it('ККС — это ККС, даже если рядом написана дорога', () => {
    expect(classifyPoint('ККС 339')).toBe('kks');
    expect(classifyPoint('колодец')).toBe('kks');
    // Иначе «ККС у а/дороги» уехало бы в пересечения и пропало.
    expect(classifyPoint('ККС у а/дороги')).toBe('kks');
  });

  it('пересечения и проколы — отдельно, их не берём', () => {
    for (const n of ['прокол через а/дорогу', 'ГНБ', 'переход водопровода',
      'грейдерная дорога', 'река', 'арык', 'жд', 'ТТС', 'газопровод']) {
      expect(classifyPoint(n)).toBe('crossing');
    }
    expect(POINT_GROUPS.crossing.byDefault).toBe(false);
    expect(POINT_GROUPS.crossing.objectKind).toBeUndefined();
  });

  it('муфты и столбы узнаются, но по умолчанию не грузятся', () => {
    expect(classifyPoint('муфта №3')).toBe('mufta');
    expect(classifyPoint('опора 12')).toBe('stolb');
    expect(POINT_GROUPS.mufta.byDefault).toBe(false);
  });

  it('непонятная подпись так и называется', () => {
    expect(classifyPoint('точка 17')).toBe('other');
    expect(classifyPoint('')).toBe('other');
  });

  it('конечные точки и ККС берутся по умолчанию — их и просили', () => {
    expect(POINT_GROUPS.endpoint.byDefault).toBe(true);
    expect(POINT_GROUPS.kks.byDefault).toBe(true);
  });

  it('вид конечной точки идёт в карточку', () => {
    expect(endpointKindOf('Школа №2')).toBe('Школа');
    expect(endpointKindOf('ФАП с. Еленовка')).toBe('ФАП');
    expect(endpointKindOf('АТС')).toBe('АТС');
    expect(endpointKindOf('река')).toBeUndefined();
  });

  it('точки раскладываются по смыслу, пустые группы не показываются', () => {
    const buckets = groupPoints([
      pt('Школа'), pt('ККС 12'), pt('прокол а/д'), pt('прокол реки'), pt('ФАП'),
    ]);
    expect(buckets.map((b) => [b.group, b.points.length])).toEqual([
      ['endpoint', 2], ['kks', 1], ['crossing', 2],
    ]);
  });
});
