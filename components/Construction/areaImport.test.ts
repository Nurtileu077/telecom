import { describe, it, expect } from 'vitest';
import { buildAreas, areaKindOf, normName } from './areaImport';
import type { SettlementOrder } from '@/types/construction';

const square: [number, number][] = [[51, 71], [51, 72], [52, 72], [52, 71], [51, 71]];

function poly(name: string, folderPath: string[] = [], coords = square) {
  return { coords, name, folder: folderPath[folderPath.length - 1] ?? '', folderPath };
}

const orders: SettlementOrder[] = [
  { kato: '191', oblast: 'Акмолинская область', rayon: 'Зерендинский', snp: 'Еленовка' },
  { kato: '392', oblast: 'Костанайская область', rayon: 'Алтынсаринский', snp: 'Еленовка' },
  { kato: '777', oblast: 'Акмолинская область', rayon: 'Бурабайский', snp: 'Катарколь' },
];

describe('что это за контур', () => {
  it('район узнаётся по слову', () => {
    expect(areaKindOf('Зерендинский район')).toBe('rayon');
    expect(areaKindOf('Бурабайский р-н')).toBe('rayon');
  });

  it('область тоже', () => {
    expect(areaKindOf('Акмолинская область')).toBe('oblast');
    expect(areaKindOf('Акмолинская обл.')).toBe('oblast');
  });

  it('остальное — населённый пункт', () => {
    expect(areaKindOf('с. Еленовка')).toBe('snp');
    expect(areaKindOf('Катарколь')).toBe('snp');
  });

  it('контур прямо в папке области — это район, даже если в названии нет слова', () => {
    expect(areaKindOf('Зеренда', ['Акмолинская область'])).toBe('rayon');
  });
});

describe('сравнение названий', () => {
  it('приставки и регистр не мешают', () => {
    expect(normName('с. ЕЛЕНОВКА')).toBe(normName('Еленовка'));
    expect(normName('село Катарколь')).toBe(normName('катарколь'));
  });

  it('ё и е — одна буква', () => {
    expect(normName('Посёлок')).toBe(normName('поселок'));
  });
});

describe('сборка контуров', () => {
  it('раскладывает по видам и считает их', () => {
    const r = buildAreas([
      poly('Акмолинская область'),
      poly('Зерендинский район', ['Акмолинская область']),
      poly('Еленовка', ['Акмолинская область', 'Зерендинский район']),
    ], orders, 'plan.kml');
    expect(r.byKind).toEqual({ oblast: 1, rayon: 1, snp: 1 });
  });

  it('село связывается с реестром по названию', () => {
    const r = buildAreas(
      [poly('с. Катарколь', ['Акмолинская область', 'Бурабайский район'])],
      orders, 'plan.kml',
    );
    expect(r.areas[0].kato).toBe('777');
    expect(r.matched).toBe(1);
  });

  it('одноимённые сёла разводятся по области из пути', () => {
    const r = buildAreas(
      [poly('Еленовка', ['Костанайская область', 'Алтынсаринский район'])],
      orders, 'plan.kml',
    );
    expect(r.areas[0].kato).toBe('392');
  });

  it('одноимённые без подсказки остаются без КАТО — неверная привязка хуже пустой', () => {
    const r = buildAreas([poly('Еленовка')], orders, 'plan.kml');
    expect(r.areas[0].kato).toBeUndefined();
    expect(r.matched).toBe(0);
  });

  it('область и район подтягиваются из пути папок', () => {
    const r = buildAreas(
      [poly('Еленовка', ['Акмолинская область', 'Зерендинский район'])],
      orders, 'plan.kml',
    );
    expect(r.areas[0].oblast).toBe('Акмолинская область');
    expect(r.areas[0].rayon).toBe('Зерендинский район');
  });

  it('вырожденный контур отбрасывается', () => {
    const r = buildAreas([poly('Кривой', [], [[51, 71], [51, 72]])], orders, 'plan.kml');
    expect(r.areas).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it('id детерминированный — повторная загрузка обновит, а не удвоит', () => {
    const a = buildAreas([poly('Еленовка')], orders, 'plan.kml').areas[0].id;
    const b = buildAreas([poly('Еленовка')], orders, 'plan.kml').areas[0].id;
    expect(a).toBe(b);
  });

  it('безымянный контур получает понятное имя, а не пустоту', () => {
    const r = buildAreas([poly('')], orders, 'plan.kml');
    expect(r.areas[0].name).toBe('Контур 1');
  });
});
