import { describe, it, expect } from 'vitest';
import type { DailyWorkEntry, PlanRoute, SnpProgress } from '@/types/construction';
import { kmlRouteLines } from './kmlRoutes';
import { routeViews, PLAN_LINE_COLOR, STAGE_LINE_COLOR } from './routeStyle';
import { routeWork } from './routeSegments';
import { routeLengthM } from './routeProgress';
import { buildKml } from './kmlExport';

const now = '2026-10-01T00:00:00.000Z';

function line(id: string, name: string, coords: [number, number][]): PlanRoute {
  return {
    id, name, uchastok: 'Еленовка', coords, lengthM: routeLengthM(coords),
    source: 'тест', createdAt: now, updatedAt: now,
  };
}

const MAIN = line('main', 'ОМ — Еленовка', [[51, 71], [51, 71.1]]);
const ALT = line('alt', 'Еленовка альтернативный вариант', [[51, 71], [51.07, 71.1]]);
const SCHOOL = line('school', 'Еленовка отвод к школе', [[51, 71.05], [51.02, 71.05]]);
const progress: SnpProgress[] = [{
  kato: '191', snp: 'Еленовка', stages: { mkt: { status: 'in_progress' } }, updatedAt: now,
}];

function shift(date: string, meters: number, over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `s-${date}`, date, smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    contractor: 'Дозер', column: '1-колонна',
    byMethod: { 'кабелеукладчик': meters }, materials: {},
    createdAt: `${date}T10:00:00.000Z`, updatedAt: now, ...over,
  };
}

function exported(ground: DailyWorkEntry[]) {
  const routes = [MAIN, ALT, SCHOOL];
  const views = routeViews(routes, { progress });
  const work = routeWork(routes, new Map(views.filter((v) => v.kato).map((v) => [v.id, v.kato as string])), ground);
  return kmlRouteLines(routes, views, work);
}

describe('трассы в выгрузке KML', () => {
  it('вариант и отвод без работ уходят проектом, а не построенными', () => {
    const { lines } = exported([shift('2026-10-01', 800, { stop: { routeId: 'main', lat: 51, lon: 71 } })]);
    const byName = Object.fromEntries(lines.map((l) => [l.description?.split(' · ')[0], l]));
    for (const side of [ALT.name, SCHOOL.name]) {
      expect(byName[side].color).toBe(PLAN_LINE_COLOR);
      expect(byName[side].description).toContain('не основная линия села — работ по ней не отмечено');
      expect(byName[side].description).not.toContain('МКТ');
    }
  });

  it('основная пройдена частью — сама линия проектом, а сделанное — куском цветом этапа там, где копали', () => {
    const { lines, done } = exported([shift('2026-10-01', 800, { stop: { routeId: 'main', lat: 51, lon: 71 } })]);
    const main = lines.find((l) => l.description?.startsWith(MAIN.name));
    expect(main?.color).toBe(PLAN_LINE_COLOR);
    expect(main?.description).toContain('закрашено 800 м');
    expect(done).toHaveLength(1);
    expect(done[0].color).toBe(STAGE_LINE_COLOR.mkt);
    // Кусок лежит у начала линии, а не во всю её длину.
    const lastLon = done[0].coords[done[0].coords.length - 1][1];
    expect(lastLon).toBeLessThan(71.02);
  });

  it('отвод, на котором отметили работу, красится как на карте', () => {
    const onSchool = shift('2026-10-02', 300, { stop: { routeId: 'school', lat: 51.004, lon: 71.05, manual: true } });
    const { lines } = exported([onSchool]);
    const school = lines.find((l) => l.description?.startsWith(SCHOOL.name));
    expect(school?.description).not.toContain('не основная линия');
  });

  it('сделанное — отдельной папкой файла', () => {
    const { lines, done } = exported([shift('2026-10-01', 800, { stop: { routeId: 'main', lat: 51, lon: 71 } })]);
    const xml = buildKml({ name: 'тест', folders: [{ name: 'Трассы', lines }, { name: 'Сделано', lines: done }] });
    expect(xml).toContain('<name>Сделано</name>');
  });
});
