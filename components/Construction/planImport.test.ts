import { describe, it, expect } from 'vitest';
import { polylineLengthM } from './planImport';
import {
  emptyJournal, addPlanRoutes, removePlanSource, planSources, type JournalState,
} from './journalStore';
import type { PlanRoute } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'plan-1', name: 'Трасса 1', coords: [[52.0, 69.0], [52.01, 69.0]],
    lengthM: 1112, source: 'plan.kml', createdAt: now, updatedAt: now, ...over,
  };
}

describe('длина ломаной', () => {
  it('считает по земной поверхности', () => {
    // 0.01° широты ≈ 1112 м.
    const m = polylineLengthM([[52.0, 69.0], [52.01, 69.0]]);
    expect(m).toBeGreaterThan(1080);
    expect(m).toBeLessThan(1140);
  });

  it('складывает звенья', () => {
    const one = polylineLengthM([[52.0, 69.0], [52.01, 69.0]]);
    const two = polylineLengthM([[52.0, 69.0], [52.01, 69.0], [52.02, 69.0]]);
    expect(two).toBeGreaterThan(one * 1.9);
  });

  it('вырожденная линия даёт ноль', () => {
    expect(polylineLengthM([])).toBe(0);
    expect(polylineLengthM([[52, 69]])).toBe(0);
  });
});

describe('плановые трассы в журнале', () => {
  it('добавляются и заменяются по id — повторная загрузка не удваивает', () => {
    const s1 = addPlanRoutes(emptyJournal(), [route()]);
    expect(s1.planRoutes).toHaveLength(1);
    const s2 = addPlanRoutes(s1, [route({ name: 'Переименована' })]);
    expect(s2.planRoutes).toHaveLength(1);
    expect(s2.planRoutes[0].name).toBe('Переименована');
  });

  it('трассы из разных файлов живут рядом', () => {
    const s = addPlanRoutes(
      addPlanRoutes(emptyJournal(), [route({ id: 'a', source: 'один.kml' })]),
      [route({ id: 'b', source: 'два.kml' })],
    );
    expect(s.planRoutes).toHaveLength(2);
    expect(planSources(s)).toHaveLength(2);
  });

  it('файл убирается целиком', () => {
    const s = addPlanRoutes(emptyJournal(), [
      route({ id: 'a', source: 'один.kml' }),
      route({ id: 'b', source: 'один.kml' }),
      route({ id: 'c', source: 'два.kml' }),
    ]);
    const after = removePlanSource(s, 'один.kml');
    expect(after.planRoutes.map((r) => r.id)).toEqual(['c']);
  });

  it('сводка по файлам считает трассы и километры', () => {
    const s = addPlanRoutes(emptyJournal(), [
      route({ id: 'a', source: 'один.kml', lengthM: 1000 }),
      route({ id: 'b', source: 'один.kml', lengthM: 500 }),
    ]);
    expect(planSources(s)[0]).toEqual({ source: 'один.kml', routes: 2, lengthM: 1500 });
  });

  it('план не трогается импортом журнала', () => {
    const s: JournalState = addPlanRoutes(emptyJournal(), [route()]);
    expect(s.planRoutes).toHaveLength(1);
  });
});
