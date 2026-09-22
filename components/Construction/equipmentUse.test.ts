import { describe, it, expect } from 'vitest';
import {
  equipmentUse, idleShare, fuelNeed, fuelTotal, drillQueue, FUEL_NORMS,
} from './equipmentUse';
import type { DailyWorkEntry, DrillLogEntry } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: 'x', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'У1', kato: '1',
    byMethod: { 'бар': 400 }, materials: {}, createdAt: '', updatedAt: '',
    contractor: 'Дозер', ...patch,
  } as DailyWorkEntry;
}

const ROWS = [
  e({
    id: 'a', date: '2026-07-25', uchastok: 'Зеренда',
    equipment: { 'Кабелеукладчик': 1, 'Самосвал': 2 },
  }),
  e({
    id: 'b', date: '2026-07-27', uchastok: 'Щучинск', byMethod: { 'бар': 900 },
    equipment: { 'Кабелеукладчик': 1 },
    equipmentOff: { 'Самосвал': 'в ремонте' },
  }),
];

describe('equipmentUse', () => {
  it('считает смены и метры, в которых техника участвовала', () => {
    const use = equipmentUse(ROWS);
    const ku = use.find((u) => u.name === 'Кабелеукладчик')!;
    expect(ku.shifts).toBe(2);
    expect(ku.meters).toBe(1300);
  });

  it('невыход считает отдельно и запоминает причину', () => {
    const truck = equipmentUse(ROWS).find((u) => u.name === 'Самосвал')!;
    expect(truck.shifts).toBe(1);
    expect(truck.offShifts).toBe(1);
    expect(truck.offReasons).toEqual(['в ремонте']);
  });

  it('помнит, где техника была последний раз', () => {
    const ku = equipmentUse(ROWS).find((u) => u.name === 'Кабелеукладчик')!;
    expect(ku.lastUchastok).toBe('Щучинск');
    expect(ku.lastDate).toBe('2026-07-27');
  });

  it('период сужает выборку', () => {
    const use = equipmentUse(ROWS, { to: '2026-07-26' });
    expect(use.find((u) => u.name === 'Кабелеукладчик')?.shifts).toBe(1);
  });

  it('техники нет — и считать нечего', () => {
    expect(equipmentUse([e({ equipment: {} })])).toEqual([]);
  });
});

describe('idleShare', () => {
  it('доля простоя считается от всех смен, где технику упоминали', () => {
    const truck = equipmentUse(ROWS).find((u) => u.name === 'Самосвал')!;
    expect(idleShare(truck)).toBeCloseTo(0.5, 5);
  });

  it('без упоминаний доли нет, а не деление на ноль', () => {
    expect(idleShare({
      name: 'X', shifts: 0, offShifts: 0, offReasons: [], meters: 0, contractors: [],
    })).toBe(0);
  });
});

describe('fuelNeed', () => {
  it('считает потребность по сменам и норме', () => {
    const lines = fuelNeed(equipmentUse(ROWS));
    const ku = lines.find((l) => l.name === 'Кабелеукладчик')!;
    expect(ku.expectedL).toBe(FUEL_NORMS['Кабелеукладчик'].perShift * 2);
  });

  it('узнаёт технику по началу названия: «ГНБ-2» это ГНБ', () => {
    const lines = fuelNeed([{
      name: 'ГНБ-2 Вермеер', shifts: 3, offShifts: 0, offReasons: [],
      meters: 0, contractors: [],
    }]);
    expect(lines[0].expectedL).toBe(FUEL_NORMS['ГНБ'].perShift * 3);
  });

  it('незнакомая техника считается нулём, а не выдуманной нормой', () => {
    const lines = fuelNeed([{
      name: 'Чудо-машина', shifts: 5, offShifts: 0, offReasons: [],
      meters: 0, contractors: [],
    }]);
    expect(lines[0].expectedL).toBe(0);
    expect(lines[0].norm).toBeUndefined();
  });

  it('итог складывает всё, что посчиталось', () => {
    expect(fuelTotal(fuelNeed(equipmentUse(ROWS)))).toBeGreaterThan(0);
    expect(fuelTotal([])).toBe(0);
  });
});

describe('drillQueue', () => {
  const drills: DrillLogEntry[] = [
    {
      id: 'd1', kind: 'drill', drillKind: 'ГНБ', date: '2026-07-20',
      smu: 'СМУ-1', oblast: 'Акмолинская область', uchastok: 'Зеренда', kato: '1',
      meters: 72, count: 2, points: [], createdAt: '', updatedAt: '',
    },
  ];

  it('сделанное показывает от свежего', () => {
    const q = drillQueue(drills, ROWS, '2026-08-01');
    expect(q.done[0].uchastok).toBe('Зеренда');
    expect(q.done[0].meters).toBe(72);
  });

  it('участок, где работы идут, а проколов нет, попадает в ожидание', () => {
    const q = drillQueue(drills, ROWS, '2026-08-01');
    const shchuchinsk = q.waiting.find((w) => w.uchastok === 'Щучинск');
    expect(shchuchinsk).toBeTruthy();
    expect(shchuchinsk!.days).toBe(5);
  });

  it('дольше всех ждущие — первыми', () => {
    const q = drillQueue(drills, ROWS, '2026-08-01');
    expect(q.waiting[0].days).toBeGreaterThanOrEqual(q.waiting[1]?.days ?? 0);
  });

  it('пусто — пустая очередь, а не падение', () => {
    expect(drillQueue([], [], '2026-08-01')).toEqual({ done: [], waiting: [] });
  });
});
