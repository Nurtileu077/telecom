import { describe, it, expect } from 'vitest';
import type { Deviation } from '@/types/construction';
import { deviationEnds, deviationCoordsToSave, parseCoord, type LatLon } from './deviationCoords';
import { placeDeviations } from './schemeDeviations';
import { routeLengthM } from './routeProgress';

/**
 * Обход болота нарисовали на карте, потом открыли карточку и вписали
 * протокол МГ. Карточка брала концом вторую точку линии и сохраняла
 * две — обход терял точку возврата на трассу.
 */

/** Трасса у Астаны на восток: 0,001° долготы ≈ 70 м. */
const ROUTE: [number, number][] = [[51.13, 71.43], [51.13, 71.45]];

/** Обход: уходим на север на 0,002° (≈ 220 м), идём на восток и возвращаемся. */
const DRAWN: LatLon[] = [
  { lat: 51.13, lon: 71.433 },
  { lat: 51.132, lon: 71.433 },
  { lat: 51.132, lon: 71.436 },
  { lat: 51.132, lon: 71.44 },
  { lat: 51.13, lon: 71.44 },
];

/** Поля карточки так, как форма их заполняет из сохранённого. */
function fieldsOf(coords: LatLon[]) {
  const { a, b } = deviationEnds(coords);
  return {
    latA: a ? String(a.lat) : '', lonA: a ? String(a.lon) : '',
    latB: b ? String(b.lat) : '', lonB: b ? String(b.lon) : '',
  };
}

const now = '2026-09-12T00:00:00.000Z';
function dev(coords: LatLon[] | undefined): Deviation {
  return {
    id: 'd1', kind: 'route', date: '2026-09-10', oblast: '', uchastok: 'Косшы', kato: '',
    lengthM: 900, coords, reason: 'Обход болота',
    protocol: { number: '14', date: '2026-09-12' },
    author: 'Ербол', createdAt: now, updatedAt: now,
  };
}

describe('карточка нарисованного отклонения', () => {
  it('конец в карточке — последняя точка обхода, а не вторая', () => {
    const ends = deviationEnds(DRAWN);
    expect(ends.a).toEqual(DRAWN[0]);
    expect(ends.b).toEqual(DRAWN[4]);
    expect(ends.between).toBe(3);
  });

  it('карточка с протоколом не укорачивает нарисованный обход', () => {
    const saved = deviationCoordsToSave(DRAWN, fieldsOf(DRAWN));
    expect(saved).toEqual(DRAWN);
  });

  it('обход после карточки ложится на схему так же, как нарисованный', () => {
    const before = placeDeviations(ROUTE, [dev(DRAWN)], 120);
    const after = placeDeviations(ROUTE, [dev(deviationCoordsToSave(DRAWN, fieldsOf(DRAWN)))], 120);
    expect(before.placed).toHaveLength(1);
    expect(after.unplaced).toEqual([]);
    expect(after.placed[0].projectM).toBeCloseTo(before.placed[0].projectM, 6);
    // Заменён кусок проекта от 71,433 до 71,44, а не несколько метров.
    expect(after.placed[0].projectM).toBeCloseTo(routeLengthM([[51.13, 71.433], [51.13, 71.44]]), 3);
  });

  it('поправленное начало меняет первую точку, а дорога обхода остаётся', () => {
    const f = { ...fieldsOf(DRAWN), latA: '51,130001', lonA: '71.4331' };
    const saved = deviationCoordsToSave(DRAWN, f)!;
    expect(saved).toHaveLength(5);
    expect(saved[0]).toEqual({ lat: 51.130001, lon: 71.4331 });
    expect(saved.slice(1, -1)).toEqual(DRAWN.slice(1, -1));
    expect(saved[4]).toEqual(DRAWN[4]);
  });

  it('поправленный конец меняет последнюю точку, а не вторую', () => {
    const f = { ...fieldsOf(DRAWN), latB: '51.1301', lonB: '71.4402' };
    const saved = deviationCoordsToSave(DRAWN, f)!;
    expect(saved).toHaveLength(5);
    expect(saved[1]).toEqual(DRAWN[1]);
    expect(saved[4]).toEqual({ lat: 51.1301, lon: 71.4402 });
  });

  it('две точки, вписанные руками, сохраняются как две', () => {
    const saved = deviationCoordsToSave(undefined, {
      latA: '51.13', lonA: '71.433', latB: '51.13', lonB: '71.44',
    });
    expect(saved).toEqual([{ lat: 51.13, lon: 71.433 }, { lat: 51.13, lon: 71.44 }]);
  });

  it('стёртый конец оставляет одну точку — где вернулись, неизвестно', () => {
    const f = { ...fieldsOf(DRAWN), latB: '', lonB: '' };
    expect(deviationCoordsToSave(DRAWN, f)).toEqual([DRAWN[0]]);
  });

  it('перепутанные широта и долгота точкой не становятся', () => {
    expect(deviationCoordsToSave(undefined, { latA: '71.43', lonA: '51.13', latB: '', lonB: '' }))
      .toBeUndefined();
  });

  it('пустое поле — не ноль, а отсутствие координаты', () => {
    expect(Number.isNaN(parseCoord(''))).toBe(true);
    expect(parseCoord('44,480565')).toBeCloseTo(44.480565, 9);
  });
});
