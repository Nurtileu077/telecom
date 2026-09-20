import { describe, it, expect } from 'vitest';
import { searchJournal, matchRank } from './journalSearch';
import type { RouteView } from './routeStyle';

import type { SiteObject } from '@/types/construction';

const SNP = [
  {
    kato: '116240100', snp: 'Серафимовка', oblast: 'Акмолинская область',
    rayon: 'Зерендинский район', lat: 53.0, lon: 69.0,
  },
  {
    kato: '116240200', snp: 'Новосерафимовский', oblast: 'Акмолинская область',
    rayon: 'Зерендинский район', lat: 53.2, lon: 69.2,
  },
];

const ROUTES: RouteView[] = [{
  id: 'r1', name: 'Зеренда Серафимовка', coords: [[53, 69], [53.1, 69.1]],
  lengthM: 12_400, source: 'plan.kml', from: 'Зеренда', to: 'Серафимовка',
  stage: null, color: '#3b82f6', dashed: true,
}];

const OBJECTS: SiteObject[] = [{
  id: 'o1', kind: 'kks', name: 'ККС 12', lat: 53.05, lon: 69.05,
  createdAt: '', updatedAt: '',
}];

describe('matchRank', () => {
  it('совпадение с начала важнее совпадения в середине', () => {
    expect(matchRank('Серафимовка', 'сера')).toBe(0);
    expect(matchRank('Новосерафимовский', 'сера')).toBe(2);
  });

  it('начало слова — посередине', () => {
    expect(matchRank('Зеренда Серафимовка', 'сера')).toBe(1);
    expect(matchRank('Зеренда-Серафимовка', 'сера')).toBe(1);
  });

  it('ё и Е — одна буква', () => {
    expect(matchRank('Зерендинский', 'зерен')).toBe(0);
    expect(matchRank('Щучье', 'щучье')).toBe(0);
  });

  it('не нашлось — значит null', () => {
    expect(matchRank('Серафимовка', 'кокшетау')).toBeNull();
    expect(matchRank('', 'сера')).toBeNull();
  });
});

describe('searchJournal', () => {
  const src = { snpPoints: SNP, routes: ROUTES, objects: OBJECTS };

  it('по одной букве не ищем: вывалится всё подряд', () => {
    expect(searchJournal('с', src)).toEqual([]);
    expect(searchJournal('', src)).toEqual([]);
  });

  it('находит по началу названия и ставит его первым', () => {
    const hits = searchJournal('сера', src);
    expect(hits[0].label).toBe('Серафимовка');
    expect(hits[0].kind).toBe('snp');
  });

  it('ищет сразу по всему — сёла, трассы, объекты', () => {
    const kinds = new Set(searchJournal('сера', src).map((h) => h.kind));
    expect(kinds.has('snp')).toBe(true);
    expect(kinds.has('route')).toBe(true);
  });

  it('трасса приносит с собой рамку по всей линии', () => {
    const hit = searchJournal('зеренда', src).find((h) => h.kind === 'route');
    expect(hit?.bounds).toHaveLength(2);
  });

  it('объект открывается вплотную, село — издали', () => {
    const kks = searchJournal('ккс', src)[0];
    const snp = searchJournal('серафимовка', src)[0];
    expect(kks.zoom).toBeGreaterThan(snp.zoom);
  });

  it('ищет и по КАТО: в заказе сёла названы номером', () => {
    expect(searchJournal('116240100', src)[0].label).toBe('Серафимовка');
  });

  it('пустые источники — пустой ответ, а не падение', () => {
    expect(searchJournal('сера', {})).toEqual([]);
  });

  it('больше запрошенного не отдаёт', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...OBJECTS[0], id: `o${i}`, name: `ККС ${i}`,
    }));
    expect(searchJournal('ккс', { objects: many }, 5)).toHaveLength(5);
  });
});
