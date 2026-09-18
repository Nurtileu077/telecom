import { describe, it, expect } from 'vitest';
import { warpWaypoint, collapseWaypoint } from './cableWaypoints';
import type { LatLon } from './cableWaypoints';

/** Трасса, обогнувшая препятствие: пять вершин, выраженный изгиб. */
const bend: LatLon[] = [
  [51.00, 71.00],
  [51.01, 71.02],
  [51.03, 71.02], // изгиб
  [51.04, 71.04],
  [51.05, 71.06],
];

describe('перетаскивание вершины сохраняет форму', () => {
  it('промежуточные вершины остаются, а не выбрасываются', () => {
    const out = warpWaypoint(bend, 0, 2, 4, 51.035, 71.025);
    expect(out).toHaveLength(bend.length);
  });

  it('старое поведение трассу спрямляло — теперь нет', () => {
    const collapsed = collapseWaypoint(bend, 0, 4, 51.035, 71.025);
    expect(collapsed).toHaveLength(3);
    expect(warpWaypoint(bend, 0, 2, 4, 51.035, 71.025).length).toBeGreaterThan(collapsed.length);
  });

  it('взятая вершина встаёт ровно туда, куда её привели', () => {
    const out = warpWaypoint(bend, 0, 2, 4, 51.035, 71.025);
    expect(out[2]).toEqual([51.035, 71.025]);
  });

  it('соседние ручки не двигаются — смещение к ним сходит на нет', () => {
    const out = warpWaypoint(bend, 0, 2, 4, 51.035, 71.025);
    expect(out[0]).toEqual(bend[0]);
    expect(out[4]).toEqual(bend[4]);
  });

  it('вершины между ручками смещаются, но меньше взятой', () => {
    const out = warpWaypoint(bend, 0, 2, 4, 51.13, 71.02);
    const moved = Math.abs(out[1][0] - bend[1][0]);
    const taken = Math.abs(out[2][0] - bend[2][0]);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(taken);
  });

  it('движение на нулевое расстояние ничего не портит', () => {
    const out = warpWaypoint(bend, 0, 2, 4, bend[2][0], bend[2][1]);
    expect(out).toEqual(bend);
  });

  it('крайняя ручка без соседа слева не ломает расчёт', () => {
    const out = warpWaypoint(bend, null, 0, 2, 50.99, 70.99);
    expect(out[0]).toEqual([50.99, 70.99]);
    expect(out[4]).toEqual(bend[4]);
    expect(out).toHaveLength(bend.length);
  });

  it('несуществующий индекс возвращает трассу как была', () => {
    expect(warpWaypoint(bend, 0, 99, null, 51.5, 71.5)).toEqual(bend);
  });

  it('совпадающие точки не дают деления на ноль', () => {
    const flat: LatLon[] = [[51, 71], [51, 71], [51, 71]];
    const out = warpWaypoint(flat, 0, 1, 2, 51.01, 71.01);
    expect(out[1]).toEqual([51.01, 71.01]);
    expect(out.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))).toBe(true);
  });
});
