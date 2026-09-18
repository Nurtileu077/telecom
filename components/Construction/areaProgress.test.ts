import { describe, it, expect } from 'vitest';
import { areaMapItems, areaColor } from './areaProgress';
import type { MapArea, SnpProgress } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';
const square: [number, number][] = [[51, 71], [51, 72], [52, 72], [52, 71], [51, 71]];

function area(over: Partial<MapArea> = {}): MapArea {
  return {
    id: 'a1', kind: 'snp', name: 'Еленовка', coords: square,
    source: 'plan.kml', createdAt: now, updatedAt: now, ...over,
  };
}

function snp(over: Partial<SnpProgress> = {}): SnpProgress {
  return {
    kato: '191', snp: 'Еленовка', oblast: 'Акмолинская область',
    rayon: 'Зерендинский район', stages: {}, updatedAt: now, ...over,
  };
}

const done = { status: 'done' as const, doneAt: now };
const allDone = { mkt: done, gnb: done, zaduvka: done, podves: done, svarka: done, sdacha: done };

describe('село на карте', () => {
  it('закрашивается по доле пройденных этапов', () => {
    const [it0] = areaMapItems(
      [area({ kato: '191' })],
      [snp({ stages: { mkt: done, gnb: done, zaduvka: done } })],
    );
    expect(it0.completion).toBe(0.5);
    expect(it0.stage).toBe('podves');
  });

  it('село, которого нет в журнале, остаётся без данных, а не с нулём', () => {
    const [it0] = areaMapItems([area({ name: 'Безымянное' })], [snp()]);
    expect(it0.completion).toBeNull();
  });

  it('закрытое село отмечено полностью', () => {
    const [it0] = areaMapItems([area({ kato: '191' })], [snp({ stages: allDone })]);
    expect(it0.completion).toBe(1);
    expect(it0.stage).toBeNull();
    expect(it0.doneSnp).toBe(1);
  });
});

describe('район и область', () => {
  const rayon = area({ id: 'r1', kind: 'rayon', name: 'Зерендинский район' });

  it('считает сёла внутри по названию района', () => {
    const [it0] = areaMapItems([rayon], [
      snp({ kato: '1', stages: allDone }),
      snp({ kato: '2', stages: { mkt: { status: 'in_progress' } } }),
      snp({ kato: '3' }),
    ]);
    expect(it0.totalSnp).toBe(3);
    expect(it0.doneSnp).toBe(1);
    expect(it0.activeSnp).toBe(1);
  });

  it('усредняет прохождение по сёлам', () => {
    const [it0] = areaMapItems([rayon], [
      snp({ kato: '1', stages: allDone }),
      snp({ kato: '2' }),
    ]);
    expect(it0.completion).toBe(0.5);
  });

  it('простой в селе виден на районе', () => {
    const [it0] = areaMapItems([rayon], [
      snp({ kato: '1', stages: { mkt: { status: 'blocked', blockReason: 'Нет трубы' } } }),
    ]);
    expect(it0.blockedSnp).toBe(1);
  });

  it('район без сёл в журнале — данных нет', () => {
    const [it0] = areaMapItems([rayon], [snp({ rayon: 'Другой район' })]);
    expect(it0.completion).toBeNull();
    expect(it0.totalSnp).toBe(0);
  });

  it('название района сверяется без учёта написания', () => {
    const [it0] = areaMapItems(
      [area({ kind: 'rayon', name: 'ЗЕРЕНДИНСКИЙ РАЙОН' })],
      [snp({ rayon: 'Зерендинский район' })],
    );
    expect(it0.totalSnp).toBe(1);
  });

  it('в KML «Зерендинский район», в журнале «Зерендинский» — это один район', () => {
    const [it0] = areaMapItems(
      [area({ kind: 'rayon', name: 'Зерендинский район' })],
      [snp({ rayon: 'Зерендинский' })],
    );
    expect(it0.totalSnp).toBe(1);
  });

  it('разные районы не склеиваются', () => {
    const [it0] = areaMapItems(
      [area({ kind: 'rayon', name: 'Зерендинский район' })],
      [snp({ rayon: 'Бурабайский район' })],
    );
    expect(it0.totalSnp).toBe(0);
  });

  it('область собирает свои сёла', () => {
    const [it0] = areaMapItems(
      [area({ kind: 'oblast', name: 'Акмолинская область' })],
      [snp({ kato: '1' }), snp({ kato: '2', oblast: 'Костанайская область' })],
    );
    expect(it0.totalSnp).toBe(1);
  });
});

describe('цвет заливки', () => {
  it('нет данных — серый, а не зелёный', () => {
    expect(areaColor(null)).toBe('#64748b');
  });

  it('простой перекрывает любую долю', () => {
    expect(areaColor(1, true)).toBe('#f87171');
  });

  it('закрытое отличается от начатого и от нетронутого', () => {
    expect(areaColor(1)).not.toBe(areaColor(0.5));
    expect(areaColor(0.5)).not.toBe(areaColor(0));
  });
});

describe('село без КАТО', () => {
  it('находится по названию, если оно в журнале одно', () => {
    const [it0] = areaMapItems(
      [area({ name: 'с. Еленовка' })],
      [snp({ stages: allDone })],
    );
    expect(it0.completion).toBe(1);
  });

  it('одноимённые сёла не склеиваются — контур остаётся без данных', () => {
    const [it0] = areaMapItems(
      [area({ name: 'Еленовка' })],
      [snp({ kato: '1' }), snp({ kato: '2', rayon: 'Другой район' })],
    );
    expect(it0.completion).toBeNull();
  });
});
