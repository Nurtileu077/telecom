import { describe, it, expect } from 'vitest';
import { methodRates, crewRates, shiftsLeft, totalShifts } from './crewRate';
import type { DailyWorkEntry } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-09-10', smu: '',
    column: '1-колонна', contractor: 'TERRA TECH',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod: {}, materials: {}, createdAt: now, updatedAt: now, ...over,
  };
}

describe('норматив выработки', () => {
  it('считает среднее, медиану и лучшую смену по способу', () => {
    const rows = methodRates([
      g({ date: '2026-09-10', byMethod: { 'кабелеукладчик': 1000 } }),
      g({ date: '2026-09-11', byMethod: { 'кабелеукладчик': 2000 } }),
      g({ date: '2026-09-12', byMethod: { 'кабелеукладчик': 6000 } }),
    ]);
    const r = rows.find((x) => x.method === 'кабелеукладчик')!;
    expect(r.shifts).toBe(3);
    expect(r.meters).toBe(9000);
    expect(r.perShift).toBe(3000);
    // Медиана устойчива к одной рекордной смене — в этом её смысл.
    expect(r.median).toBe(2000);
    expect(r.best).toBe(6000);
  });

  it('две записи за один день — одна смена, а не две', () => {
    const rows = methodRates([
      g({ date: '2026-09-10', uchastok: 'А', byMethod: { 'кабелеукладчик': 1000 } }),
      g({ date: '2026-09-10', uchastok: 'Б', byMethod: { 'кабелеукладчик': 1000 } }),
    ]);
    const r = rows.find((x) => x.method === 'кабелеукладчик')!;
    expect(r.shifts).toBe(1);
    expect(r.perShift).toBe(2000);
  });

  it('дни без этого способа в его норматив не входят', () => {
    const rows = methodRates([
      g({ date: '2026-09-10', byMethod: { 'кабелеукладчик': 2000 } }),
      g({ date: '2026-09-11', byMethod: { 'вручную': 300 } }),
    ]);
    expect(rows.find((x) => x.method === 'кабелеукладчик')!.shifts).toBe(1);
    expect(rows.find((x) => x.method === 'вручную')!.shifts).toBe(1);
  });

  it('способы не усредняются вместе', () => {
    const rows = methodRates([
      g({ byMethod: { 'кабелеукладчик': 4000, 'вручную': 200 } }),
    ]);
    expect(rows.find((x) => x.method === 'кабелеукладчик')!.perShift).toBe(4000);
    expect(rows.find((x) => x.method === 'вручную')!.perShift).toBe(200);
  });

  it('по бригадам считает отдельно', () => {
    const rows = crewRates([
      g({ date: '2026-09-10', column: '1-колонна', byMethod: { 'кабелеукладчик': 3000 } }),
      g({ date: '2026-09-10', column: '2-колонна', byMethod: { 'кабелеукладчик': 1000 } }),
      g({ date: '2026-09-11', column: '2-колонна', byMethod: { 'кабелеукладчик': 1200 } }),
    ]);
    expect(rows.find((r) => r.key === '1-колонна')!.perShift).toBe(3000);
    expect(rows.find((r) => r.key === '2-колонна')!.perShift).toBe(1100);
  });

  it('бригада без имени в разрез не попадает — приписывать некому', () => {
    const rows = crewRates([
      g({ column: undefined, contractor: undefined, smu: '', byMethod: { 'бар': 500 } }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('остаток в сменах считается по медиане', () => {
    const rates = methodRates([
      g({ date: '2026-09-10', byMethod: { 'кабелеукладчик': 1000 } }),
      g({ date: '2026-09-11', byMethod: { 'кабелеукладчик': 2000 } }),
      g({ date: '2026-09-12', byMethod: { 'кабелеукладчик': 9000 } }),
    ]);
    // Медиана 2000: 9000 м остатка — это пять смен, а не одна.
    expect(shiftsLeft(9000, rates, 'кабелеукладчик')).toBe(5);
  });

  it('без наработанного темпа срок не выдумывается', () => {
    expect(shiftsLeft(9000, [], 'кабелеукладчик')).toBeNull();
    expect(shiftsLeft(0, [])).toBe(0);
  });

  it('смена — это день с выработкой, а не любая запись', () => {
    expect(totalShifts([
      g({ date: '2026-09-10', byMethod: { 'бар': 100 } }),
      g({ date: '2026-09-10', byMethod: { 'бар': 200 } }),
      g({ date: '2026-09-11', byMethod: {} }),
    ])).toBe(1);
  });
});
