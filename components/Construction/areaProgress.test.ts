import { describe, it, expect } from 'vitest';
import { areaMapItems, areaColor, sameSnpName } from './areaProgress';
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

describe('обводка, подписанная двумя сёлами', () => {
  const zerendi: SnpProgress = {
    kato: '191', snp: 'Зеренди', oblast: 'Акмолинская область', rayon: 'Зерендинский',
    stages: { mkt: { status: 'done' } }, updatedAt: now,
  };
  const serafimovka: SnpProgress = {
    kato: '192', snp: 'Серафимовка', oblast: 'Акмолинская область', rayon: 'Зерендинский',
    stages: {}, updatedAt: now,
  };

  it('перегон считается по тому, куда он ведёт', () => {
    const [item] = areaMapItems(
      [area({ id: 'a1', kind: 'snp', name: 'зеренди серафимовка', kato: undefined })],
      [zerendi, serafimovka],
    );
    // Дошли до Серафимовки — по ней и считаем, как у трасс.
    expect(item.via).toEqual(['Зеренди', 'Серафимовка']);
    expect(item.completion).toBe(0);
    expect(item.name).toBe('зеренди серафимовка');
  });

  it('одно узнанное село — по нему, и без пометки о перегоне', () => {
    const [item] = areaMapItems(
      [area({ id: 'a1', kind: 'snp', name: 'путь до серафимовки', kato: undefined })],
      [serafimovka],
    );
    expect(item.completion).not.toBeNull();
    expect(item.via).toBeUndefined();
  });

  it('название целиком сильнее разбора по словам', () => {
    const krasny: SnpProgress = {
      kato: '193', snp: 'Красный Аул', oblast: 'А', stages: { mkt: { status: 'done' } }, updatedAt: now,
    };
    const aul: SnpProgress = {
      kato: '194', snp: 'Аул', oblast: 'А', stages: {}, updatedAt: now,
    };
    const [item] = areaMapItems(
      [area({ id: 'a1', kind: 'snp', name: 'Красный Аул', kato: undefined })],
      [krasny, aul],
    );
    // Иначе «Красный Аул» посчитался бы по селу «Аул».
    expect(item.completion).toBeGreaterThan(0);
    expect(item.via).toBeUndefined();
  });

  it('ничего не узнали — контур остаётся серым, а не выдуманным', () => {
    const [item] = areaMapItems(
      [area({ id: 'a1', kind: 'snp', name: 'кузнецовка ивановка', kato: undefined })],
      [zerendi],
    );
    expect(item.completion).toBeNull();
  });

  it('предлоги и сокращения за сёла не принимаются', () => {
    const po: SnpProgress = { kato: '195', snp: 'До', oblast: 'А', stages: {}, updatedAt: now };
    const [item] = areaMapItems(
      [area({ id: 'a1', kind: 'snp', name: 'путь до школы', kato: undefined })],
      [po],
    );
    expect(item.completion).toBeNull();
  });
});

describe('падежи в названиях', () => {
  it('«Серафимовки» и «Серафимовка» — одно село', () => {
    expect(sameSnpName('серафимовки', 'серафимовка')).toBe(true);
    expect(sameSnpName('еленовку', 'еленовка')).toBe(true);
  });

  it('«Ивановка» и «Ивановский» — разные', () => {
    expect(sameSnpName('ивановка', 'ивановский')).toBe(false);
  });

  it('короткие названия по началу не склеиваются', () => {
    expect(sameSnpName('акан', 'акша')).toBe(false);
    expect(sameSnpName('кос', 'косколь')).toBe(false);
  });

  it('под правило подошли двое — значит, не знаем, кто', () => {
    const a: SnpProgress = { kato: '1', snp: 'Николаевка', oblast: 'А', stages: { mkt: done }, updatedAt: now };
    const b: SnpProgress = { kato: '2', snp: 'Николаевки', oblast: 'А', stages: {}, updatedAt: now };
    const [item] = areaMapItems(
      [area({ id: 'x', kind: 'snp', name: 'путь до николаевке', kato: undefined })],
      [a, b],
    );
    expect(item.completion).toBeNull();
  });
});
