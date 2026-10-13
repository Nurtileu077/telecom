import { describe, it, expect } from 'vitest';
import {
  incidentHours, openIncidents, nearbyIncidents, incidentContext,
  problemSpots, incidentStats, SAME_SPOT_M,
} from './incidents';
import type {
  Incident, DailyWorkEntry, Deviation, SiteObject, PlanRoute,
} from '@/types/construction';
import { routeLengthM } from './routeProgress';

const now = '2026-09-18T00:00:00.000Z';

function inc(over: Partial<Incident> = {}): Incident {
  return {
    id: `i${Math.random()}`, reportedAt: '2026-09-17T08:00:00.000Z',
    lat: 51.5, lon: 71.5, damage: 'ОК-24, 2 волокна',
    uchastok: 'Еленовка', kato: '191',
    createdAt: now, updatedAt: now, ...over,
  };
}

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-06-01', smu: '',
    contractor: 'TERRA TECH',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 4000 }, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

const ctx = (over: Partial<Parameters<typeof incidentContext>[1]> = {}) =>
  ({ ground: [], deviations: [], objects: [], ...over });

describe('авария', () => {
  it('часы считаются по времени, если их не проставили', () => {
    expect(incidentHours(inc({
      reportedAt: '2026-09-17T08:00:00.000Z',
      fixedAt: '2026-09-17T12:30:00.000Z',
    }))).toBe(4.5);
  });

  it('проставленным часам верим больше, чем разнице времён', () => {
    expect(incidentHours(inc({
      reportedAt: '2026-09-17T08:00:00.000Z',
      fixedAt: '2026-09-18T08:00:00.000Z',
      hours: 3,
    }))).toBe(3);
  });

  it('открытая авария часов не имеет', () => {
    expect(incidentHours(inc())).toBeNull();
    expect(openIncidents([inc(), inc({ fixedAt: now })])).toHaveLength(1);
  });

  it('история по месту берёт то, что рядом, а не всё подряд', () => {
    const here = inc({ id: 'a', lat: 51.5, lon: 71.5 });
    const alsoHere = inc({ id: 'b', lat: 51.5008, lon: 71.5 });
    const farAway = inc({ id: 'c', lat: 52.5, lon: 71.5 });
    const near = nearbyIncidents([here, alsoHere, farAway], 51.5, 71.5, SAME_SPOT_M, 'a');
    expect(near.map((i) => i.id)).toEqual(['b']);
  });
});

describe('что известно про это место по журналу', () => {
  it('глубина из отклонения вернее проектной', () => {
    const dev: Deviation = {
      id: 'd1', kind: 'depth', date: '2026-06-02',
      oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
      lengthM: 50, designDepthM: 1.2, actualDepthM: 0.5, reason: 'Скальный грунт',
      author: 'Ербол', coords: [{ lat: 51.5, lon: 71.5 }],
      createdAt: now, updatedAt: now,
    };
    const c = incidentContext(inc(), ctx({ ground: [g()], deviations: [dev] }));
    expect(c.depthM).toBe(0.5);
    expect(c.depthFrom).toBe('отклонение');
    expect(c.deviation).toBe('Скальный грунт');
  });

  it('без отклонения глубина проектная и подписана как проектная', () => {
    const c = incidentContext(inc(), ctx({ ground: [g()] }));
    expect(c.depthM).toBe(1.2);
    expect(c.depthFrom).toBe('проект');
  });

  it('про пустое место не выдумываем ничего', () => {
    const c = incidentContext(inc({ kato: 'нет', uchastok: 'нет' }), ctx());
    expect(c.depthM).toBeUndefined();
    expect(c.method).toBeUndefined();
    expect(c.contractor).toBeUndefined();
  });

  it('называет способ и подрядчика, которые тут работали', () => {
    const c = incidentContext(inc(), ctx({ ground: [g()] }));
    expect(c.method).toContain('Кабелеукладчиком');
    expect(c.contractor).toBe('TERRA TECH');
    expect(c.builtAt).toBe('2026-06-01');
  });

  it('глубина из карточки муфты, если отклонения не было', () => {
    const o: SiteObject = {
      id: 'm1', kind: 'mufta', lat: 51.5, lon: 71.5, depthM: 0.9,
      createdAt: now, updatedAt: now,
    };
    const c = incidentContext(inc(), ctx({ objects: [o] }));
    expect(c.depthM).toBe(0.9);
    expect(c.depthFrom).toBe('объект');
    expect(c.object?.id).toBe('m1');
  });
});

describe('карта проблемных мест', () => {
  it('одна авария — событие, а не закономерность', () => {
    expect(problemSpots([inc()])).toHaveLength(0);
  });

  it('две аварии рядом становятся местом с причиной', () => {
    const spots = problemSpots([
      inc({ lat: 51.5, lon: 71.5, cause: 'экскаватор', reportedAt: '2026-05-01T00:00:00.000Z' }),
      inc({ lat: 51.5009, lon: 71.5, cause: 'экскаватор', reportedAt: '2026-07-01T00:00:00.000Z' }),
      inc({ lat: 53.0, lon: 71.5 }),
    ]);
    expect(spots).toHaveLength(1);
    expect(spots[0].count).toBe(2);
    expect(spots[0].topCause).toBe('экскаватор');
    expect(spots[0].lastAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('сводка считает открытые, среднее время и причины', () => {
    const s = incidentStats([
      inc({ cause: 'экскаватор', fixedAt: '2026-09-17T12:00:00.000Z' }),
      inc({ cause: 'экскаватор' }),
      inc({ cause: 'грызуны', fixedAt: '2026-09-17T10:00:00.000Z' }),
    ]);
    expect(s.total).toBe(3);
    expect(s.open).toBe(1);
    expect(s.avgHours).toBe(3);
    expect(s.byCause[0]).toEqual({ cause: 'экскаватор', count: 2 });
  });
});

/**
 * Обрыв на 3-м км, а карточка называла «кабелеукладчик, подрядчик такой-то,
 * 12.08» — последнюю смену села, хотя 3-й км в июле копали вручную другие.
 */
describe('авария находит свою смену', () => {
  const LINE: [number, number][] = [[51.5, 71.5], [51.5, 71.7]];
  const TOTAL = routeLengthM(LINE);
  const lonAt = (m: number) => 71.5 + (m / TOTAL) * 0.2;
  const route: PlanRoute = {
    id: 'r1', name: 'ОМ — Еленовка', uchastok: 'Еленовка', coords: LINE, lengthM: TOTAL,
    source: 'тест', createdAt: now, updatedAt: now,
  };
  const progress = [{ kato: '191', snp: 'Еленовка', stages: {}, updatedAt: now }];
  const july = g({
    id: 'july', date: '2026-07-10', contractor: 'Дозер', column: '2-колонна',
    byMethod: { 'вручную': 1500 },
    stop: { routeId: 'r1', lat: 51.5, lon: lonAt(3500), manual: true },
  });
  const august = g({
    id: 'aug', date: '2026-08-12', contractor: 'TERRA TECH', column: '1-колонна',
    byMethod: { 'кабелеукладчик': 2000 },
    stop: { routeId: 'r1', lat: 51.5, lon: lonAt(9000), manual: true },
  });

  it('обрыв на 3-м км берёт смену, закрасившую 3-й км, а не последнюю смену села', () => {
    const c = incidentContext(inc({ lat: 51.5003, lon: lonAt(3000) }), ctx({
      ground: [july, august], planRoutes: [route], progress,
    }));
    expect(c.builtFrom).toBe('place');
    expect(c.method).toBe('Ручным способом');
    expect(c.contractor).toBe('Дозер');
    expect(c.column).toBe('2-колонна');
    expect(c.builtAt).toBe('2026-07-10');
    expect(c.routeName).toBe('ОМ — Еленовка');
    expect(c.atM).toBeGreaterThan(2900);
    expect(c.atM).toBeLessThan(3100);
  });

  it('место смен на линии не названо — последнюю смену села за копавшую здесь не выдаём', () => {
    const c = incidentContext(inc({ lat: 51.5, lon: lonAt(3000) }), ctx({
      ground: [{ ...july, stop: undefined }, { ...august, stop: undefined }],
      planRoutes: [route], progress,
    }));
    expect(c.builtFrom).toBe('village');
    expect(c.method).toBeUndefined();
    expect(c.contractor).toBeUndefined();
    expect(c.crews).toEqual(['2-колонна (Дозер), 10.07.2026', '1-колонна (TERRA TECH), 12.08.2026']);
    expect(c.builtAt).toBe('2026-07-10');
    expect(c.builtTo).toBe('2026-08-12');
  });

  it('в смене два способа — оба названы, а где какой — не выдумываем', () => {
    const mixed = { ...july, byMethod: { 'вручную': 700, 'бар': 800 } };
    const c = incidentContext(inc({ lat: 51.5, lon: lonAt(3000) }), ctx({
      ground: [mixed], planRoutes: [route], progress,
    }));
    expect(c.method).toBe('Бар / Ручным способом');
    expect(c.methodMixed).toBe(true);
  });

  it('авария в стороне от линий — линию не выдумываем, сведения по селу', () => {
    const c = incidentContext(inc({ lat: 51.6, lon: lonAt(3000) }), ctx({
      ground: [july], planRoutes: [route], progress,
    }));
    expect(c.routeName).toBeUndefined();
    expect(c.builtFrom).toBe('village');
    expect(c.contractor).toBe('Дозер');
  });
});
