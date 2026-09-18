import { describe, it, expect } from 'vitest';
import { dayMoves, playableDates } from './playback';
import { routeLengthM } from './routeProgress';
import type { DailyWorkEntry, PlanRoute } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';
const line: [number, number][] = [[51, 71], [51, 71.05], [51, 71.1]];

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'r1', name: 'Еленовка Школа', uchastok: 'Еленовка',
    coords: line, lengthM: routeLengthM(line),
    source: 'тест', createdAt: now, updatedAt: now, ...over,
  };
}

function ground(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 1000 }, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('вчерашний день в движении', () => {
  it('отрезок за день — от накопленного до накопленного плюс дневное', () => {
    const moves = dayMoves({
      planRoutes: [route()],
      ground: [
        ground({ date: '2026-09-09', byMethod: { 'кабелеукладчик': 500 } }),
        ground({ date: '2026-09-10', byMethod: { 'кабелеукладчик': 800 } }),
      ],
    }, '2026-09-10');
    expect(moves).toHaveLength(1);
    expect(moves[0].beforeM).toBe(500);
    expect(moves[0].meters).toBe(800);
    // Финиш дальше старта по долготе: линия идёт на восток.
    expect(moves[0].to.lon).toBeGreaterThan(moves[0].from.lon);
  });

  it('несколько записей за день складываются в одно движение', () => {
    const moves = dayMoves({
      planRoutes: [route()],
      ground: [
        ground({ byMethod: { 'кабелеукладчик': 300 } }),
        ground({ byMethod: { 'экскаватор': 200 } }),
      ],
    }, '2026-09-10');
    expect(moves).toHaveLength(1);
    expect(moves[0].meters).toBe(500);
  });

  it('участок без трассы пропускается — маршрут не выдумываем', () => {
    const moves = dayMoves({
      planRoutes: [],
      ground: [ground()],
    }, '2026-09-10');
    expect(moves).toHaveLength(0);
  });

  it('будущие дни в накопленное не попадают', () => {
    const moves = dayMoves({
      planRoutes: [route()],
      ground: [
        ground({ date: '2026-09-10', byMethod: { 'кабелеукладчик': 400 } }),
        ground({ date: '2026-09-12', byMethod: { 'кабелеукладчик': 900 } }),
      ],
    }, '2026-09-10');
    expect(moves[0].beforeM).toBe(0);
  });

  it('день без метров движения не даёт', () => {
    const moves = dayMoves({
      planRoutes: [route()],
      ground: [ground({ byMethod: {} })],
    }, '2026-09-10');
    expect(moves).toHaveLength(0);
  });

  it('первым идёт тот, кто прошёл больше', () => {
    const moves = dayMoves({
      planRoutes: [route(), route({ id: 'r2', uchastok: 'Убаган', name: 'Убаган Школа' })],
      ground: [
        ground({ kato: '191', uchastok: 'Еленовка', byMethod: { 'кабелеукладчик': 300 } }),
        ground({ kato: '392', uchastok: 'Убаган', byMethod: { 'кабелеукладчик': 1500 } }),
      ],
    }, '2026-09-10');
    expect(moves[0].uchastok).toBe('Убаган');
  });

  it('пустая дата ничего не показывает', () => {
    expect(dayMoves({ planRoutes: [route()], ground: [ground()] }, '')).toHaveLength(0);
  });
});

describe('дни для просмотра', () => {
  it('свежие сверху и без повторов', () => {
    const dates = playableDates({
      planRoutes: [],
      ground: [
        ground({ date: '2026-09-10' }),
        ground({ date: '2026-09-10' }),
        ground({ date: '2026-09-12' }),
      ],
    });
    expect(dates).toEqual(['2026-09-12', '2026-09-10']);
  });

  it('список ограничен — за год их триста', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      ground({ date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}` }));
    expect(playableDates({ planRoutes: [], ground: rows }, 10)).toHaveLength(10);
  });
});
