import { describe, it, expect } from 'vitest';
import {
  equipmentUse, idleShare, fuelNeed, fuelTotal, drillQueue, FUEL_NORMS, settleIdleEquipment,
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

/**
 * Очередь на ГНБ ждут с последнего прокола, а не с последней работы.
 * Наоборот получалось так: чем активнее на участке работают, тем
 * «свежее» он выглядел и тем ниже уходил в очереди — а это ровно тот
 * случай, когда установка нужна.
 */
describe('очередь на ГНБ', () => {
  const today = '2026-07-30';
  const w = e;
  const d = (patch: Partial<DrillLogEntry>): DrillLogEntry => ({
    id: 'd', kind: 'drill', drillKind: 'ГНБ', date: '2026-07-20',
    smu: 'СМУ-1', oblast: 'Акмолинская область', uchastok: 'Зеренда', kato: '1',
    meters: 72, count: 2, points: [], createdAt: '', updatedAt: '', ...patch,
  });

  it('участок с давним проколом и свежими работами — первый в очереди', () => {
    const q = drillQueue(
      [d({ uchastok: 'Исаковка', date: '2026-07-01' })],
      [
        w({ id: 'a', uchastok: 'Исаковка', date: '2026-07-29' }),
        w({ id: 'b', uchastok: 'Зеренда', date: '2026-07-29' }),
      ],
      today,
    );
    expect(q.waiting[0].uchastok).toBe('Исаковка');
    expect(q.waiting[0].days).toBe(29);
    expect(q.waiting[0].sinceDate).toBe('2026-07-01');
  });

  it('где прокола не было вовсе, ждут с первой смены', () => {
    const q = drillQueue([], [
      w({ id: 'a', uchastok: 'Зеренда', date: '2026-07-10' }),
      w({ id: 'b', uchastok: 'Зеренда', date: '2026-07-29' }),
    ], today);
    expect(q.waiting[0].sinceDate).toBe('2026-07-10');
    expect(q.waiting[0].days).toBe(20);
  });

  it('свежий прокол снимает участок с верха очереди', () => {
    const q = drillQueue(
      [d({ uchastok: 'Исаковка', date: '2026-07-29' })],
      [
        w({ id: 'a', uchastok: 'Исаковка', date: '2026-07-01' }),
        w({ id: 'a2', uchastok: 'Исаковка', date: '2026-07-29' }),
        w({ id: 'b', uchastok: 'Зеренда', date: '2026-07-05' }),
        w({ id: 'b2', uchastok: 'Зеренда', date: '2026-07-29' }),
      ],
      today,
    );
    // Зеренда ждёт с пятого июля, Исаковку прокололи вчера.
    expect(q.waiting[0].uchastok).toBe('Зеренда');
    expect(q.waiting[1].uchastok).toBe('Исаковка');
    expect(q.waiting[1].days).toBe(1);
  });

  it('участок, где месяц не работают, установку не ждёт', () => {
    const q = drillQueue([], [w({ id: 'a', uchastok: 'Старый', date: '2026-05-01' })], today);
    expect(q.waiting).toHaveLength(0);
  });
});

/**
 * Техника вчерашней смены переносится в форму сама. До №294 смену без
 * метров сохранить было нельзя, а теперь день дождя сохраняется — и
 * кабелеукладчик из вчерашней смены попадал в него как «выходил».
 */
describe('техника в день простоя', () => {
  const rain = (id: string, date: string, patch: Partial<DailyWorkEntry> = {}) => e({
    id, date, byMethod: {}, downtime: 'дождь',
    equipment: { 'Кабелеукладчик': 1 }, ...patch,
  });
  const rows = [
    e({ id: 'w', date: '2026-07-20', equipment: { 'Кабелеукладчик': 1 } }),
    rain('r1', '2026-07-21'),
    rain('r2', '2026-07-22'),
    rain('r3', '2026-07-23'),
  ];

  it('день дождя не добавляет технике смен и топлива', () => {
    const ku = equipmentUse(rows).find((u) => u.name === 'Кабелеукладчик')!;
    expect(ku.shifts).toBe(1);
    const fuel = fuelNeed(equipmentUse(rows)).find((l) => l.name === 'Кабелеукладчик')!;
    expect(fuel.expectedL).toBe(FUEL_NORMS['Кабелеукладчик'].perShift);
  });

  it('простоявшую технику доля простоя видит, с причиной простоя', () => {
    const ku = equipmentUse(rows).find((u) => u.name === 'Кабелеукладчик')!;
    expect(ku.offShifts).toBe(3);
    expect(ku.offReasons).toEqual(['дождь']);
    expect(idleShare(ku)).toBeCloseTo(0.75, 5);
  });

  it('в смене простоя техника уходит в невышедшую, своя причина не перетирается', () => {
    const settled = settleIdleEquipment(rain('r', '2026-07-21', {
      equipment: { 'Кабелеукладчик': 1, 'Манипулятор': 1 },
      equipmentOff: { 'Манипулятор': 'в ремонте' },
    }));
    expect(settled.equipment).toBeUndefined();
    expect(settled.equipmentOff).toEqual({ 'Кабелеукладчик': 'дождь', 'Манипулятор': 'в ремонте' });
  });

  it('смену с работой не трогает, даже если причина простоя записана', () => {
    // Полдня дождь, полдня копали: техника работала.
    const half = e({ id: 'h', downtime: 'дождь до обеда', equipment: { 'Кабелеукладчик': 1 } });
    expect(settleIdleEquipment(half)).toBe(half);
  });
});
