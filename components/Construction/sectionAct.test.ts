import { describe, it, expect } from 'vitest';
import {
  computeSectionAct, entriesOfSection, deviationsOfSection, actKm,
} from './sectionAct';
import type { DailyWorkEntry, Deviation } from '@/types/construction';

const now = '2026-09-17T00:00:00.000Z';

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-09-04',
    smu: '', oblast: 'Акмолинская область', rayon: 'Зерендинский',
    uchastok: 'от муфты №4 ОК-714 до школы с. Акадыр', kato: '191',
    byMethod: {}, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

function dev(over: Partial<Deviation> = {}): Deviation {
  return {
    id: `d${Math.random()}`, kind: 'depth', date: '2026-09-05',
    oblast: 'Акмолинская область', uchastok: 'от муфты №4 ОК-714 до школы с. Акадыр',
    kato: '191', lengthM: 250, designDepthM: 1.2, actualDepthM: 1.2,
    reason: 'Скальный грунт', author: 'Инженер',
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('свод по участку для АСР/ОСР', () => {
  it('складывает объём по способам прокладки, как в строках акта', () => {
    const t = computeSectionAct([
      g({ byMethod: { 'кабелеукладчик': 6000 } }),
      g({ byMethod: { 'кабелеукладчик': 5100 } }),
    ]);
    expect(t.totalM).toBe(11100);
    expect(t.byMethod['кабелеукладчик']).toBe(11100);
    expect(t.byMethod['вручную']).toBe(0);
    expect(t.byMethod['бар']).toBe(0);
  });

  it('берёт комплекты сращивания из материала КОД', () => {
    const t = computeSectionAct([
      g({ materials: { 'КОД': 4 } }),
      g({ materials: { 'КОД': 2 } }),
    ]);
    expect(t.splicingKits).toBe(6);
  });

  it('берёт ленту из материалов — строка «на глубине ½ от МКТ»', () => {
    const t = computeSectionAct([g({ materials: { 'Лента': 11100 } })]);
    expect(t.tapeM).toBe(11100);
  });

  it('считает переходы: бестраншейные плюс открытые', () => {
    const t = computeSectionAct([
      g({ drillM: 72, drillCount: 2, openCrossings: 1 }),
      g({ drillM: 28, drillCount: 1 }),
    ]);
    expect(t.drillM).toBe(100);
    expect(t.crossingsTotal).toBe(4);
  });

  it('без отклонений фактическая глубина равна проектной', () => {
    const t = computeSectionAct([g({ byMethod: { 'кабелеукладчик': 100 } })]);
    expect(t.designDepthM).toBe(1.2);
    expect(t.actualDepthM).toBe(1.2);
  });

  it('в акт идёт наименьшая фактическая глубина по участку', () => {
    const t = computeSectionAct(
      [g()],
      [dev({ actualDepthM: 0.9 }), dev({ actualDepthM: 0.5 }), dev({ actualDepthM: 1.2 })],
    );
    expect(t.actualDepthM).toBe(0.5);
  });

  it('отклонение без протокола попадает в список, мешающий закрыть акт', () => {
    const t = computeSectionAct([g()], [
      dev({ actualDepthM: 0.5 }),
      dev({ actualDepthM: 0.6, protocol: { number: '14', date: '2026-09-06' } }),
    ]);
    expect(t.openDeviations).toHaveLength(1);
    expect(t.openDeviations[0].actualDepthM).toBe(0.5);
  });

  it('отклонение по трассе без протокола тоже блокирует', () => {
    const t = computeSectionAct([g()], [
      dev({ kind: 'route', designDepthM: undefined, actualDepthM: undefined }),
    ]);
    expect(t.openDeviations).toHaveLength(1);
  });

  it('определяет период работ и фактических исполнителей', () => {
    const t = computeSectionAct([
      g({ date: '2026-09-04', contractor: 'TERRA TECH' }),
      g({ date: '2026-09-08', contractor: 'TERRA TECH' }),
      g({ date: '2026-09-06', contractor: 'Дозер' }),
    ]);
    expect(t.dateFrom).toBe('2026-09-04');
    expect(t.dateTo).toBe('2026-09-08');
    // Порядок зависит от сопоставления латиницы и кириллицы в локали,
    // поэтому проверяем состав, а не последовательность.
    expect(t.performers).toHaveLength(2);
    expect(t.performers).toContain('TERRA TECH');
    expect(t.performers).toContain('Дозер');
    expect(t.entriesCount).toBe(3);
  });

  it('пустой участок даёт нули, а не ошибку', () => {
    const t = computeSectionAct([]);
    expect(t.totalM).toBe(0);
    expect(t.crossingsTotal).toBe(0);
    expect(t.dateFrom).toBe('');
  });
});

describe('отбор по участку', () => {
  const rows = [
    g({ uchastok: 'от муфты №4 ОК-714 до школы с. Акадыр' }),
    g({ uchastok: '  ОТ МУФТЫ №4 ОК-714 ДО ШКОЛЫ С. АКАДЫР  ' }),
    g({ uchastok: 'Шетпе - Тиген' }),
  ];

  it('не зависит от регистра и лишних пробелов', () => {
    expect(entriesOfSection(rows, 'от муфты №4 ОК-714 до школы с. Акадыр')).toHaveLength(2);
  });

  it('пустое имя участка ничего не отбирает', () => {
    expect(entriesOfSection(rows, '   ')).toHaveLength(0);
  });

  it('так же отбирает отклонения', () => {
    expect(deviationsOfSection([dev(), dev({ uchastok: 'другой' })],
      'от муфты №4 ОК-714 до школы с. Акадыр')).toHaveLength(1);
  });
});

describe('формат объёмов для акта', () => {
  it('пишет километры с тремя знаками и запятой, как в документе', () => {
    expect(actKm(11100)).toBe('11,100');
    expect(actKm(0)).toBe('0,000');
    expect(actKm(250)).toBe('0,250');
  });
});
