import { describe, it, expect } from 'vitest';
import {
  incidentHours, openIncidents, nearbyIncidents, incidentContext,
  problemSpots, incidentStats, SAME_SPOT_M,
} from './incidents';
import type {
  Incident, DailyWorkEntry, Deviation, SiteObject,
} from '@/types/construction';

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
