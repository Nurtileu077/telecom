import { describe, it, expect } from 'vitest';
import { lastPlans, downtimeReasons, lastEquipment } from './dayPlan';
import type { DailyWorkEntry } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-09-17', smu: '',
    column: '1-колонна', oblast: 'Акмолинская область', rayon: 'Зерендинский',
    uchastok: 'Еленовка', kato: '191',
    byMethod: {}, materials: {}, createdAt: now, updatedAt: now, ...over,
  };
}

describe('план на завтра', () => {
  it('берёт планы последнего дня, в котором они были', () => {
    const plans = lastPlans([
      g({ date: '2026-09-16', tomorrow: 'старый план' }),
      g({ date: '2026-09-17', tomorrow: 'дойти до школы' }),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0].text).toBe('дойти до школы');
  });

  it('после выходных берёт пятницу, а не пустое вчера', () => {
    const plans = lastPlans([
      g({ date: '2026-09-11', tomorrow: 'пятничный план' }),
    ], '2026-09-14');
    expect(plans[0].date).toBe('2026-09-11');
  });

  it('несколько колонн — несколько планов', () => {
    const plans = lastPlans([
      g({ date: '2026-09-17', column: '2-колонна', tomorrow: 'б' }),
      g({ date: '2026-09-17', column: '1-колонна', tomorrow: 'а' }),
    ]);
    expect(plans.map((p) => p.crew)).toEqual(['1-колонна', '2-колонна']);
  });

  it('без планов ничего не выдумывает', () => {
    expect(lastPlans([g({ tomorrow: '   ' })])).toHaveLength(0);
    expect(lastPlans([])).toHaveLength(0);
  });
});

describe('причины простоя', () => {
  it('одинаковые складываются, разные остаются разными', () => {
    const rows = downtimeReasons([
      g({ date: '2026-09-15', downtime: 'Скальный грунт' }),
      g({ date: '2026-09-16', downtime: 'скальный грунт.', uchastok: 'Кусеп' }),
      g({ date: '2026-09-17', downtime: 'Ждали согласование' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].count).toBe(2);
    // Показываем последнюю формулировку человека, а не нормализованную.
    expect(rows[0].text).toBe('скальный грунт.');
    expect(rows[0].places).toEqual(['Еленовка', 'Кусеп']);
  });

  it('пустые причины не считаются', () => {
    expect(downtimeReasons([g({ downtime: '  ' }), g({})])).toHaveLength(0);
  });
});

describe('техника последней смены', () => {
  it('складывает единицы за последний день', () => {
    const rows = lastEquipment([
      g({ date: '2026-09-16', equipment: { 'Экскаватор 3/1': 5 } }),
      g({ date: '2026-09-17', equipment: { 'Кабелеукладчик': 1 } }),
      g({ date: '2026-09-17', equipment: { 'Кабелеукладчик': 1, 'Манипулятор': 1 } }),
    ]);
    expect(rows).toEqual([
      { name: 'Кабелеукладчик', count: 2 },
      { name: 'Манипулятор', count: 1 },
    ]);
  });

  it('без записей о технике — пусто', () => {
    expect(lastEquipment([g({})])).toHaveLength(0);
  });
});
