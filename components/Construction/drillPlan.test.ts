import { describe, it, expect } from 'vitest';
import {
  isPlanned, isDone, drillLengthM, plannedDrills, drillSummary, drillHistory,
} from './drillPlan';
import type { DrillLogEntry } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';
const TODAY = '2026-09-18';

function drill(over: Partial<DrillLogEntry> = {}): DrillLogEntry {
  return {
    kind: 'drill', id: `d${Math.random()}`, date: TODAY, smu: '',
    oblast: 'Акмолинская область', rayon: 'Зерендинский', uchastok: 'Еленовка',
    kato: '191', drillKind: 'ГНБ', meters: 72, count: 1, points: [],
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('план и факт', () => {
  it('без статуса запись считается сделанной — так пришёл весь старый журнал', () => {
    expect(isDone(drill())).toBe(true);
    expect(isPlanned(drill())).toBe(false);
  });

  it('запланированный не путается со сделанным', () => {
    const d = drill({ status: 'planned' });
    expect(isPlanned(d)).toBe(true);
    expect(isDone(d)).toBe(false);
  });
});

describe('длина по координатам', () => {
  it('считает расстояние между входом и выходом', () => {
    const m = drillLengthM([{ lat: 51.0, lon: 71.0 }, { lat: 51.0, lon: 71.001 }]);
    // Тысячная доля градуса долготы на этой широте — около семидесяти метров.
    expect(m).toBeGreaterThan(60);
    expect(m).toBeLessThan(80);
  });

  it('одна точка длины не даёт', () => {
    expect(drillLengthM([{ lat: 51, lon: 71 }])).toBe(0);
    expect(drillLengthM([])).toBe(0);
  });

  it('ломаная складывается по отрезкам', () => {
    const two = drillLengthM([
      { lat: 51, lon: 71 }, { lat: 51, lon: 71.001 }, { lat: 51, lon: 71.002 },
    ]);
    const one = drillLengthM([{ lat: 51, lon: 71 }, { lat: 51, lon: 71.001 }]);
    expect(two).toBeGreaterThan(one * 1.9);
  });
});

describe('план проколов', () => {
  const rows = [
    drill({ id: 'p1', status: 'planned', plannedFor: TODAY }),
    drill({ id: 'p2', status: 'planned', plannedFor: '2026-09-22' }),
    drill({ id: 'p3', status: 'planned', plannedFor: '2026-11-01' }),
    drill({ id: 'p4', status: 'planned' }),
    drill({ id: 'd1' }),
  ];

  it('на сегодня — только сегодняшние и просроченные', () => {
    const ids = plannedDrills(rows, { horizon: 'today', today: TODAY }).map((d) => d.id);
    expect(ids).toEqual(['p1']);
  });

  it('на неделю — всё в ближайшие семь дней', () => {
    const ids = plannedDrills(rows, { horizon: 'week', today: TODAY }).map((d) => d.id);
    expect(ids).toEqual(['p1', 'p2']);
  });

  it('весь план включает и то, что без даты', () => {
    const ids = plannedDrills(rows, { horizon: 'all', today: TODAY }).map((d) => d.id);
    expect(ids).toHaveLength(4);
    expect(ids).toContain('p4');
  });

  it('прокол без даты в сегодняшний список не лезет', () => {
    const ids = plannedDrills(rows, { horizon: 'today', today: TODAY }).map((d) => d.id);
    expect(ids).not.toContain('p4');
  });

  it('просроченный план остаётся на сегодня, а не исчезает', () => {
    const late = plannedDrills(
      [drill({ id: 'late', status: 'planned', plannedFor: '2026-09-01' })],
      { horizon: 'today', today: TODAY },
    );
    expect(late.map((d) => d.id)).toEqual(['late']);
  });

  it('фильтр по области отсекает чужие', () => {
    const ids = plannedDrills(
      [...rows, drill({ id: 'x', status: 'planned', plannedFor: TODAY, oblast: 'Другая' })],
      { horizon: 'today', today: TODAY, oblast: 'Акмолинская область' },
    ).map((d) => d.id);
    expect(ids).toEqual(['p1']);
  });

  it('сделанные в план не попадают', () => {
    expect(plannedDrills(rows).some((d) => d.id === 'd1')).toBe(false);
  });
});

describe('сводка по проколам', () => {
  it('считает план, факт и метры', () => {
    const s = drillSummary([
      drill({ status: 'planned', plannedFor: TODAY }),
      drill({ meters: 100, points: [{ lat: 51, lon: 71 }, { lat: 51, lon: 71.001 }] }),
      drill({ meters: 50, points: [] }),
    ], TODAY);
    expect(s.planned).toBe(1);
    expect(s.plannedToday).toBe(1);
    expect(s.done).toBe(2);
    expect(s.doneMeters).toBe(150);
  });

  it('сделанные без координат считаются отдельно — их не поставить на карту', () => {
    const s = drillSummary([drill({ meters: 50, points: [] })], TODAY);
    expect(s.doneWithoutCoords).toBe(1);
  });

  it('группирует по тому, что кололи', () => {
    const s = drillSummary([
      drill({ crossings: ['автодорога'], meters: 40 }),
      drill({ crossings: ['автодорога'], meters: 60 }),
      drill({ crossings: ['река'], meters: 30 }),
    ], TODAY);
    expect(s.byCrossing[0]).toEqual({ kind: 'автодорога', count: 2, meters: 100 });
    expect(s.byCrossing[1].kind).toBe('река');
  });
});

describe('история по месту', () => {
  it('свежие сверху и только сделанные', () => {
    const rows = [
      drill({ id: 'a', date: '2026-05-01' }),
      drill({ id: 'b', date: '2026-09-01' }),
      drill({ id: 'c', date: '2026-09-10', status: 'planned' }),
      drill({ id: 'd', date: '2026-09-05', kato: '999' }),
    ];
    expect(drillHistory(rows, '191').map((d) => d.id)).toEqual(['b', 'a']);
  });
});
