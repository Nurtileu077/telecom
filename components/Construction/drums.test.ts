import { describe, it, expect } from 'vitest';
import { drumStates, drumTotals, unknownDrums, drumUsage } from './drums';
import type { CableDrum, DailyWorkEntry } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function drum(over: Partial<CableDrum> = {}): CableDrum {
  return {
    id: 'dr1', number: '4003', cable: 'ОК-24', lengthM: 4000,
    oblast: 'Акмолинская область', createdAt: now, updatedAt: now, ...over,
  };
}

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod: {}, materials: {}, createdAt: now, updatedAt: now, ...over,
  };
}

const ctx = (ground: DailyWorkEntry[] = []) => ({ ground, aerial: [] });

describe('остаток барабана', () => {
  it('считается из меток, а не вводится', () => {
    const [s] = drumStates([drum()], ctx([
      g({ date: '2026-09-10', drumMarks: [{ coil: '4003', meters: 1500 }] }),
      g({ date: '2026-09-11', drumMarks: [{ coil: '4003', meters: 1000 }] }),
    ]));
    expect(s.usedM).toBe(2500);
    expect(s.leftM).toBe(1500);
    expect(s.days).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('номер сравнивается без регистра и лишних пробелов', () => {
    const [s] = drumStates([drum({ number: ' 4003 ' })], ctx([
      g({ drumMarks: [{ coil: '4003', meters: 1000 }] }),
    ]));
    expect(s.usedM).toBe(1000);
  });

  it('пустой барабан — ноль, а не минус', () => {
    const [s] = drumStates([drum({ lengthM: 1000 })], ctx([
      g({ drumMarks: [{ coil: '4003', meters: 1400 }] }),
    ]));
    expect(s.leftM).toBe(0);
    // Перерасход называем перерасходом: это повод проверить метки,
    // а не отрицательный остаток кабеля.
    expect(s.overrun).toBe(400);
  });

  it('барабан без меток остаётся целым', () => {
    const [s] = drumStates([drum()], ctx());
    expect(s.usedM).toBe(0);
    expect(s.leftM).toBe(4000);
    expect(s.share).toBe(0);
  });

  it('метки на незаведённый барабан не теряются', () => {
    const lost = unknownDrums([drum()], ctx([
      g({ drumMarks: [{ coil: '4003', meters: 100 }, { coil: '9999', meters: 700 }] }),
    ]));
    expect(lost).toEqual([{ number: '9999', usedM: 700 }]);
  });

  it('нулевые и пустые метки в расход не идут', () => {
    const usage = drumUsage(ctx([
      g({ drumMarks: [{ coil: '', meters: 500 }, { coil: '4003', meters: 0 }] }),
    ]));
    expect(usage.size).toBe(0);
  });

  it('сводка по складу кабеля', () => {
    const states = drumStates([drum(), drum({ id: 'dr2', number: '4004', lengthM: 2000 })], ctx([
      g({ drumMarks: [{ coil: '4004', meters: 2000 }] }),
    ]));
    const t = drumTotals(states);
    expect(t.count).toBe(2);
    expect(t.totalM).toBe(6000);
    expect(t.usedM).toBe(2000);
    expect(t.leftM).toBe(4000);
    expect(t.empty).toBe(1);
  });
});
