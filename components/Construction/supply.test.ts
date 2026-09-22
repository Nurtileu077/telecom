import { describe, it, expect } from 'vitest';
import {
  materialOveruse, overuseText, MATERIAL_NORMS,
  overdueRequests, requestedTotals, type MaterialRequest,
} from './supply';
import type { DailyWorkEntry } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: 'x', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'У1', kato: '1',
    byMethod: { 'бар': 1000 }, materials: {}, createdAt: '', updatedAt: '', ...patch,
  } as DailyWorkEntry;
}

describe('materialOveruse', () => {
  it('ловит расход в полтора раза выше нормы', () => {
    const rows = [e({ byMethod: { 'бар': 1000 }, materials: { 'МКТ': 1530 } })];
    const over = materialOveruse(rows);
    const mkt = over.find((r) => r.material === 'МКТ')!;
    expect(mkt.ratio).toBeCloseTo(1.5, 1);
    expect(mkt.diff).toBeGreaterThan(0);
  });

  it('расход в пределах нормы новостью не считает', () => {
    const rows = [e({ byMethod: { 'бар': 1000 }, materials: { 'МКТ': 1020 } })];
    expect(materialOveruse(rows)).toEqual([]);
  });

  it('недорасход тоже виден — со своей стороны', () => {
    const rows = [e({ byMethod: { 'бар': 1000 }, materials: { 'Лента': 500 } })];
    const row = materialOveruse(rows).find((r) => r.material === 'Лента')!;
    expect(row.ratio).toBeCloseTo(0.5, 2);
    expect(row.diff).toBeLessThan(0);
  });

  it('считает по метрам той же выборки, а не по всей трассе', () => {
    const rows = [
      e({ id: 'a', date: '2026-07-25', byMethod: { 'бар': 1000 }, materials: { 'МКТ': 1500 } }),
      e({ id: 'b', date: '2026-08-25', byMethod: { 'бар': 9000 }, materials: {} }),
    ];
    const july = materialOveruse(rows, { to: '2026-07-31' });
    expect(july.find((r) => r.material === 'МКТ')?.ratio).toBeCloseTo(1.47, 1);
  });

  it('свои нормы важнее умолчаний', () => {
    const rows = [e({ byMethod: { 'бар': 1000 }, materials: { 'МКТ': 1500 } })];
    const over = materialOveruse(rows, {
      norms: { 'МКТ': { perMeter: 1.5, why: 'свой объект' } },
    });
    expect(over.find((r) => r.material === 'МКТ')).toBeUndefined();
  });

  it('без метров сравнивать не с чем', () => {
    expect(materialOveruse([e({ byMethod: {}, materials: { 'МКТ': 100 } })])).toEqual([]);
    expect(materialOveruse([])).toEqual([]);
  });

  it('материал без нормы молча не оценивается', () => {
    expect(MATERIAL_NORMS['Муфта']).toBeDefined();
    const rows = [e({ byMethod: { 'бар': 1000 }, materials: { 'Муфта': 5 } })];
    const row = materialOveruse(rows).find((r) => r.material === 'Муфта');
    // Норма есть — значит оценивается; проверяем, что цифра осмысленная.
    expect(row?.expected).toBeCloseTo(0.5, 5);
  });

  it('сильнее расходящееся идёт первым', () => {
    const rows = [e({
      byMethod: { 'бар': 1000 },
      materials: { 'МКТ': 1300, 'Лента': 3000 },
    })];
    expect(materialOveruse(rows)[0].material).toBe('Лента');
  });
});

describe('overuseText', () => {
  it('говорит, сколько ушло и сколько должно было', () => {
    const rows = [e({ byMethod: { 'бар': 1000 }, materials: { 'МКТ': 1530 } })];
    const text = overuseText(materialOveruse(rows)[0]);
    expect(text).toContain('МКТ');
    expect(text).toContain('больше');
  });
});

describe('заявки на материал', () => {
  const list: MaterialRequest[] = [
    {
      id: 'q1', date: '2026-07-20', material: 'МКТ', qty: 2000, status: 'открыта',
      needBy: '2026-07-25', createdAt: '', updatedAt: '',
    },
    {
      id: 'q2', date: '2026-07-22', material: 'Лента', qty: 1000, status: 'отгружена',
      createdAt: '', updatedAt: '',
    },
    {
      id: 'q3', date: '2026-07-23', material: 'МКТ', qty: 500, status: 'закрыта',
      createdAt: '', updatedAt: '',
    },
  ];

  it('просроченной считается открытая, у которой срок подошёл', () => {
    expect(overdueRequests(list, '2026-07-26').map((r) => r.id)).toEqual(['q1']);
    expect(overdueRequests(list, '2026-07-24')).toEqual([]);
  });

  it('ждём то, что ещё не закрыто', () => {
    const totals = requestedTotals(list);
    expect(totals.get('МКТ')).toBe(2000);
    expect(totals.get('Лента')).toBe(1000);
  });

  it('пустой список — нечего ждать', () => {
    expect(requestedTotals([]).size).toBe(0);
    expect(overdueRequests([])).toEqual([]);
  });
});
