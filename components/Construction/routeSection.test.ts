import { describe, it, expect } from 'vitest';
import type { PlanRoute } from '@/types/construction';
import { sectionMatchesRoute, routeOfSection, sectionForRoute } from './routeSection';

const now = '2026-09-18T00:00:00.000Z';

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'r1', name: 'ОМ — Акбеит',
    coords: [[0, 0], [0, 0.01]], lengthM: 1113,
    source: 'plan.kml', createdAt: now, updatedAt: now, ...over,
  };
}

describe('участок и трасса', () => {
  it('трасса без папки «ОМ — Акбеит» — это участок «Акбеит»', () => {
    expect(sectionMatchesRoute('Акбеит', route())).toBe(true);
  });

  it('и участок, как его пишут в сменах, — «сущ. ОМ - Акбеит»', () => {
    expect(sectionMatchesRoute('сущ. ОМ - Акбеит', route())).toBe(true);
    expect(sectionMatchesRoute('сущ. ОМ - Акбеит', route({ name: 'Трасса 3', folder: 'Акбеит', uchastok: 'Акбеит' })))
      .toBe(true);
  });

  it('«с.», регистр и «ё» не мешают', () => {
    expect(sectionMatchesRoute('с. АКБЕИТ', route())).toBe(true);
    expect(sectionMatchesRoute('Сёлок', route({ name: 'ОМ — Селок' }))).toBe(true);
  });

  it('похожее имя соседнего села — не тот участок', () => {
    // Подстрокой «Аксу» сидит внутри «Аксуат» — это и путало форму смены.
    expect(sectionMatchesRoute('Аксу', route({ name: 'ОМ — Аксуат' }))).toBe(false);
    expect(sectionMatchesRoute('Акбеиттау', route())).toBe(false);
  });

  it('одни цифры и служебные слова участка не называют', () => {
    expect(sectionMatchesRoute('СМУ 3', route({ name: 'Трасса 3' }))).toBe(false);
    expect(sectionMatchesRoute('Участок', route())).toBe(false);
    expect(sectionMatchesRoute('ОМ', route())).toBe(false);
    expect(sectionMatchesRoute('', route())).toBe(false);
    expect(sectionMatchesRoute(undefined, route())).toBe(false);
  });

  it('дефис внутри названия — часть имени: «Кызыл-Жар» не равен «Жар»', () => {
    expect(sectionMatchesRoute('Кызыл-Жар', route({ name: 'ОМ — Кызыл-Жар' }))).toBe(true);
    expect(sectionMatchesRoute('Жар', route({ name: 'ОМ — Кызыл-Жар' }))).toBe(false);
  });
});

describe('трасса участка', () => {
  it('подходит несколько — берётся самая длинная, как в форме смены', () => {
    const main = route({ id: 'main', lengthM: 5200 });
    const branch = route({ id: 'branch', name: 'Акбеит школа', lengthM: 400 });
    expect(routeOfSection([branch, main], 'Акбеит')?.id).toBe('main');
  });

  it('участок «сущ. ОМ - Акбеит» находит трассу без папки', () => {
    expect(routeOfSection([route()], 'сущ. ОМ - Акбеит')?.id).toBe('r1');
  });

  it('нет подходящей — нет и трассы, а не первая попавшаяся', () => {
    expect(routeOfSection([route()], 'Кенжеколь')).toBeNull();
    expect(routeOfSection([route()], '')).toBeNull();
  });
});

describe('какой участок назвать объекту без участка', () => {
  it('тот, под которым по трассе чаще всего пишут смены', () => {
    const sections = ['сущ. ОМ - Акбеит', 'Кенжеколь', 'сущ. ОМ - Акбеит', 'Акбеит'];
    expect(sectionForRoute(route(), sections)).toBe('сущ. ОМ - Акбеит');
  });

  it('смен нет — участок или папка трассы', () => {
    expect(sectionForRoute(route({ uchastok: 'Акбеит' }), [])).toBe('Акбеит');
    expect(sectionForRoute(route({ folder: 'Зеренда' }), ['Кенжеколь'])).toBe('Зеренда');
  });

  it('ни смен, ни папки — имя трассы: с ним объект тоже попадёт в схему', () => {
    const r = route();
    const s = sectionForRoute(r, []);
    expect(s).toBe('ОМ — Акбеит');
    expect(sectionMatchesRoute(s, r)).toBe(true);
  });
});
