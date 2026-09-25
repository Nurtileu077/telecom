import { describe, it, expect } from 'vitest';
import { searchNetwork, parseDeepLinkOpen, buildPassportUrl } from './entitySearch';
import type { District, Cable, InlineJoint } from '@/types/network';

/**
 * Поиск по сети.
 *
 * Его открывают, когда на карте тысяча точек и надо найти одну. Не
 * нашлось — человек листает карту глазами, и это единственное, что
 * поиск может испортить.
 */

const district = (over: Partial<District> = {}): District => ({
  id: 'd1',
  name: 'Зерендинский район',
  olt: {
    id: 'OLT-Зеренда',
    lat: 52.9, lon: 69.1,
    transitBoxes: [{
      id: 'МТОК-4',
      lat: 52.91, lon: 69.11,
      muftaType: 'МТОК-96',
      orks: [{
        id: 'ОРК-8',
        lat: 52.92, lon: 69.12,
        subscribers: [{ id: 'АБ-101', lat: 52.93, lon: 69.13, desc: 'Школа' }],
      }],
    }],
  },
  subscribers: [{ id: 'АБ-101', lat: 52.93, lon: 69.13, desc: 'Школа' }],
  ...over,
} as District);

const JOINTS: InlineJoint[] = [
  { id: 'Муфта-12', lat: 52.95, lon: 69.15 } as InlineJoint,
];

const find = (q: string) => searchNetwork(q, [district()], [] as Cable[], JOINTS);

describe('searchNetwork', () => {
  it('находит узел по его имени', () => {
    expect(find('OLT-Зеренда').map((h) => h.kind)).toContain('olt');
  });

  it('и по названию района — его помнят лучше, чем код узла', () => {
    expect(find('Зерендинский').map((h) => h.kind)).toContain('olt');
  });

  it('находит транзитную муфту, ОРК и врезную муфту', () => {
    expect(find('МТОК').map((h) => h.kind)).toContain('tb');
    expect(find('ОРК-8').map((h) => h.kind)).toContain('ork');
    expect(find('Муфта-12').map((h) => h.kind)).toContain('joint');
  });

  it('регистр не важен: в поле набирают как придётся', () => {
    expect(find('орк-8')).toHaveLength(find('ОРК-8').length);
    expect(find('мток')).toHaveLength(find('МТОК').length);
  });

  it('лишние пробелы не мешают', () => {
    expect(find('  ОРК-8  ').length).toBeGreaterThan(0);
  });

  it('часть имени тоже находит: целиком его никто не набирает', () => {
    expect(find('Зеренд').length).toBeGreaterThan(0);
  });

  it('одна буква — это не запрос, а случайное нажатие', () => {
    expect(find('О')).toEqual([]);
    expect(find('')).toEqual([]);
    expect(find('   ')).toEqual([]);
  });

  it('у находки есть место на карте — иначе её некуда показать', () => {
    for (const h of find('Зеренд')) {
      expect(Number.isFinite(h.lat)).toBe(true);
      expect(Number.isFinite(h.lon)).toBe(true);
      expect(h.label.length).toBeGreaterThan(0);
    }
  });

  it('находок не больше, чем просили', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      ({ id: `Муфта-${i}`, lat: 52, lon: 69 } as InlineJoint));
    expect(searchNetwork('Муфта', [], [], many, 10)).toHaveLength(10);
  });

  it('чего нет — того нет, и это не ошибка', () => {
    expect(find('Караганда')).toEqual([]);
  });
});

describe('ссылка на паспорт', () => {
  it('разбирается обратно', () => {
    expect(parseDeepLinkOpen('ork:ОРК-8')).toEqual({ kind: 'ork', id: 'ОРК-8' });
    expect(parseDeepLinkOpen('OLT:x')).toEqual({ kind: 'olt', id: 'x' });
  });

  it('двоеточие внутри имени не обрезает его', () => {
    expect(parseDeepLinkOpen('ork:ОРК-8: запас')?.id).toBe('ОРК-8: запас');
  });

  it('чужой или пустой параметр — не ссылка', () => {
    for (const p of [null, '', 'ork', 'что-то:8', 'ork:']) {
      expect(parseDeepLinkOpen(p)).toBeNull();
    }
  });

  it('круг через адресную строку не теряет кириллицу и пробелы', () => {
    const id = 'ОРК 8 (запас)';
    const url = buildPassportUrl('ork', id);
    const param = new URLSearchParams(url.split('?')[1]).get('open');
    expect(parseDeepLinkOpen(param)).toEqual({ kind: 'ork', id });
  });
});

/**
 * Район приходит из файла проекта, а файл могли сделать версией, где
 * половины полей не было. Одного такого района хватало, чтобы поиск
 * перестал работать целиком — а он единственное, чем на карте с тысячей
 * точек вообще можно что-то найти.
 */
describe('поиск не падает на неполном проекте', () => {
  it('район без списка абонентов ищется дальше', () => {
    const broken = { name: 'Старый район', olt: { id: 'OLT-1', lat: 52, lon: 69, transitBoxes: [] } };
    expect(() => searchNetwork('OLT', [broken as never], [], [])).not.toThrow();
    expect(searchNetwork('OLT', [broken as never], [], [])).toHaveLength(1);
  });

  it('и соседний целый район при этом не теряется', () => {
    const broken = { name: 'Старый', olt: { id: 'OLT-старый', lat: 52, lon: 69, transitBoxes: [] } };
    const hits = searchNetwork('OLT', [broken as never, district()], [], []);
    expect(hits.map((h) => h.id)).toContain('OLT-Зеренда');
  });

  it('абонент находится по описанию, а не только по коду', () => {
    expect(searchNetwork('Школа', [district()], [], []).map((h) => h.kind)).toContain('sub');
  });
});
