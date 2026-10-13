import { describe, it, expect } from 'vitest';
import type { PlanRoute, SnpProgress, MapArea, DrillLogEntry, DailyWorkEntry } from '@/types/construction';
import { routeVillage, villageIndex, villageLabel, namesakeNote } from './routeVillage';
import { routeViews } from './routeStyle';
import { placeFinder, snpMapPoints } from './snpMap';
import { routeLengthM } from './routeProgress';
import { emptyJournal, bindRouteVillage, loadPlanRoutes } from './journalStore';
import { routeBinding, routeOfSectionAct } from './routeSection';

const now = '2026-10-01T00:00:00.000Z';

/** Два Акбулака в разных районах, километров сто друг от друга. */
const progress: SnpProgress[] = [
  { kato: '111', snp: 'Акбулак', oblast: 'Акмолинская', rayon: 'Зерендинский район', stages: {}, updatedAt: now },
  { kato: '222', snp: 'Акбулак', oblast: 'Акмолинская', rayon: 'Бурабайский район', stages: {}, updatedAt: now },
  { kato: '333', snp: 'Еленовка', oblast: 'Акмолинская', rayon: 'Зерендинский район', stages: {}, updatedAt: now },
];

const NEAR_ZERENDA: [number, number][] = [[52.0, 69.0], [52.0, 69.05]];
const NEAR_BURABAY: [number, number][] = [[53.0, 70.0], [53.0, 70.05]];

function route(id: string, coords: [number, number][], over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id, name: 'ОМ — Акбулак', coords, lengthM: routeLengthM(coords),
    source: 'трассы.kmz', createdAt: now, updatedAt: now, ...over,
  };
}

function square(lat: number, lon: number, d: number): [number, number][] {
  return [[lat - d, lon - d], [lat - d, lon + d], [lat + d, lon + d], [lat + d, lon - d]];
}

function area(over: Partial<MapArea>): MapArea {
  return {
    id: `a-${Math.random()}`, kind: 'snp', name: 'Акбулак', coords: [], source: 'тест',
    createdAt: now, updatedAt: now, ...over,
  };
}

const names = (r: PlanRoute) => ['Акбулак', r.uchastok, r.folder];

describe('чья трасса среди сёл-тёзок', () => {
  it('ни района, ни обводок — трасса ничья, и тёзки названы с районами', () => {
    const r = route('r1', NEAR_ZERENDA);
    const res = routeVillage(r, names(r), villageIndex({ progress }));
    expect(res.village).toBeUndefined();
    expect(res.namesakes?.map(villageLabel)).toEqual([
      'Акбулак (Зерендинский р-н)', 'Акбулак (Бурабайский р-н)',
    ]);
  });

  it('папка района в пути KML говорит, какой это Акбулак', () => {
    const r = route('r1', NEAR_ZERENDA, { path: ['Акмолинская область', 'Бурабайский район', 'Акбулак'] });
    const res = routeVillage(r, names(r), villageIndex({ progress }));
    expect(res).toMatchObject({ village: { kato: '222' }, how: 'rayon' });
  });

  it('само слово «Акбулак» в папке районом не считается', () => {
    const r = route('r1', NEAR_ZERENDA, { path: ['Акбулак'], folder: 'Акбулак' });
    expect(routeVillage(r, names(r), villageIndex({ progress })).village).toBeUndefined();
  });

  it('обводка села из KML, связанная с реестром, решает', () => {
    const areas = [area({ kato: '111', coords: square(52.0, 69.025, 0.05) })];
    const r = route('r1', NEAR_ZERENDA);
    expect(routeVillage(r, names(r), villageIndex({ progress, areas })))
      .toMatchObject({ village: { kato: '111' }, how: 'outline' });
  });

  it('обводка района решает, если села не обведены', () => {
    const areas = [area({ kind: 'rayon', name: 'Бурабайский район', coords: square(53.0, 70.0, 0.5) })];
    const r = route('r1', NEAR_BURABAY);
    expect(routeVillage(r, names(r), villageIndex({ progress, areas })))
      .toMatchObject({ village: { kato: '222' }, how: 'rayon' });
  });

  it('проколы тёзки, снятые с поля рядом с линией, решают', () => {
    const drills = [{
      kind: 'drill', id: 'd1', date: '2026-09-01', smu: '', oblast: '', uchastok: 'Акбулак',
      kato: '111', drillKind: 'ГНБ', meters: 40, count: 1,
      points: [{ lat: 52.0005, lon: 69.02 }], createdAt: now, updatedAt: now,
    }] as unknown as DrillLogEntry[];
    const r = route('r1', NEAR_ZERENDA);
    expect(routeVillage(r, names(r), villageIndex({ progress, drills })))
      .toMatchObject({ village: { kato: '111' }, how: 'drills' });
  });

  it('человек указал село — так и есть, а из чего выбирали, видно', () => {
    const r = route('r1', NEAR_ZERENDA, { kato: '222' });
    const res = routeVillage(r, names(r), villageIndex({ progress }));
    expect(res).toMatchObject({ village: { kato: '222' }, how: 'manual' });
    expect(res.choices).toHaveLength(2);
  });

  it('село с этим именем одно — по имени, как раньше', () => {
    const r = route('r1', NEAR_ZERENDA, { name: 'ОМ — Еленовка' });
    expect(routeVillage(r, ['Еленовка'], villageIndex({ progress })))
      .toMatchObject({ village: { kato: '333' }, how: 'name' });
  });
});

describe('тёзки на карте', () => {
  it('два Акбулака не сливаются в одну точку посередине между ними', () => {
    const routes = [route('r1', NEAR_ZERENDA), route('r2', NEAR_BURABAY)];
    const find = placeFinder({ planRoutes: routes, progress });
    // Чьи трассы — не сказано: точки не выдумываем ни одному.
    expect(find('111', 'Акбулак')).toBeNull();
    expect(find('222', 'Акбулак')).toBeNull();
  });

  it('привязанные к своим сёлам — каждый Акбулак у своей трассы', () => {
    const routes = [route('r1', NEAR_ZERENDA, { kato: '111' }), route('r2', NEAR_BURABAY, { kato: '222' })];
    const points = snpMapPoints(progress, { planRoutes: routes });
    const at = Object.fromEntries(points.map((p) => [p.kato, Math.round(p.lat)]));
    expect(at).toEqual({ 111: 52, 222: 53 });
  });

  it('ничья трасса тёзок этап не берёт и тёзок называет', () => {
    const views = routeViews([route('r1', NEAR_ZERENDA)], { progress });
    expect(views[0].kato).toBeUndefined();
    expect(views[0].namesakes).toHaveLength(2);
  });

  it('после загрузки сказано, какие трассы легли на тёзок и что делать', () => {
    const views = routeViews([route('r1', NEAR_ZERENDA)], { progress });
    const text = namesakeNote(views);
    expect(text).toContain('«ОМ — Акбулак» — Акбулак (Зерендинский р-н) или Акбулак (Бурабайский р-н)');
    expect(text).toContain('укажите село на карточке трассы');
    expect(namesakeNote([])).toBe('');
  });
});

describe('село трассы в журнале', () => {
  it('указанное село остаётся на трассе и видно в журнале изменений', () => {
    const j = { ...emptyJournal(), planRoutes: [route('r1', NEAR_ZERENDA)] };
    const next = bindRouteVillage(j, 'r1', '111', 'Инженер', 'Акбулак (Зерендинский р-н)');
    expect(next.planRoutes[0].kato).toBe('111');
    expect(next.changes[0]).toMatchObject({
      kind: 'route_village', routeId: 'r1', detail: 'трасса села «Акбулак (Зерендинский р-н)»',
    });
    // То же село второй раз — не правка.
    expect(bindRouteVillage(next, 'r1', '111', 'Инженер')).toBe(next);
  });

  it('повторная загрузка того же файла село трассы не забывает', () => {
    const j = { ...emptyJournal(), planRoutes: [route('r1', NEAR_ZERENDA, { kato: '111' })] };
    const again = loadPlanRoutes(j, [route('r1', NEAR_ZERENDA)]).state;
    expect(again.planRoutes[0].kato).toBe('111');
  });
});

describe('схема к акту среди тёзок', () => {
  const shift = (kato: string, uchastok = 'Акбулак'): DailyWorkEntry => ({
    kind: 'ground', id: `g${kato}${uchastok}`, date: '2026-09-01', smu: '',
    oblast: 'Акмолинская', uchastok, kato, byMethod: { 'кабелеукладчик': 500 }, materials: {},
    createdAt: now, updatedAt: now,
  });

  it('к акту Акбулака-2 не ложится основная линия Акбулака-1', () => {
    // У Акбулака-1 линию назначили основной — раньше её получали акты обоих.
    const routes = [
      route('r1', NEAR_ZERENDA, { kato: '111', main: true }),
      route('r2', NEAR_BURABAY, { kato: '222' }),
    ];
    const bind = routeBinding(routeViews(routes, { progress }));
    expect(routeOfSectionAct(routes, [shift('222')], 'Акбулак', bind)?.id).toBe('r2');
    expect(routeOfSectionAct(routes, [shift('111')], 'Акбулак', bind)?.id).toBe('r1');
  });

  it('своей трассы нет — акт без схемы, а не с линией тёзки', () => {
    const routes = [route('r1', NEAR_ZERENDA, { kato: '111' })];
    const bind = routeBinding(routeViews(routes, { progress }));
    expect(routeOfSectionAct(routes, [shift('222')], 'Акбулак', bind)).toBeNull();
  });

  it('ничья трасса тёзок к акту не прикладывается, пока не скажут, чья она', () => {
    const routes = [route('r1', NEAR_ZERENDA)];
    const bind = routeBinding(routeViews(routes, { progress }));
    expect(routeOfSectionAct(routes, [shift('111')], 'Акбулак', bind)).toBeNull();
  });

  it('село без тёзок — трасса по имени, как раньше', () => {
    const routes = [route('r3', NEAR_ZERENDA, { name: 'ОМ — Еленовка' })];
    const bind = routeBinding(routeViews(routes, { progress }));
    expect(routeOfSectionAct(routes, [shift('333', 'Еленовка')], 'Еленовка', bind)?.id).toBe('r3');
  });
});
