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

  it('берёт комплекты сращивания из фитингов — так в документах Казахтелекома', () => {
    const t = computeSectionAct([
      g({ materials: { 'ФИТИНГ': 4, 'КОД': 99 } }),
      g({ materials: { 'ФИТИНГ': 2 } }),
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

  it('без отклонений участок закрывается одним актом по проекту', () => {
    const t = computeSectionAct([g({ byMethod: { 'кабелеукладчик': 11100 } })]);
    expect(t.designDepthM).toBe(1.2);
    expect(t.variants).toHaveLength(1);
    expect(t.variants[0].isMain).toBe(true);
    expect(t.variants[0].actualDepthM).toBe(1.2);
    expect(t.variants[0].lengthM).toBe(11100);
  });

  it('участок с отклонением даёт два акта: основной и на отклонение', () => {
    // 11 100 м уложены по 1,2 м, из них 50 м прошли по 0,5 м.
    const t = computeSectionAct(
      [g({ byMethod: { 'кабелеукладчик': 11100 } })],
      [dev({ actualDepthM: 0.5, lengthM: 50, protocol: { number: '14', date: '2026-09-06' } })],
    );
    expect(t.variants).toHaveLength(2);

    const main = t.variants.find((v) => v.isMain)!;
    expect(main.actualDepthM).toBe(1.2);
    expect(main.lengthM).toBe(11050);

    const deviated = t.variants.find((v) => !v.isMain)!;
    expect(deviated.actualDepthM).toBe(0.5);
    expect(deviated.lengthM).toBe(50);
    expect(deviated.protocols[0].number).toBe('14');
    expect(deviated.blocked).toBe(false);
  });

  it('куски с одинаковой глубиной закрываются одним актом', () => {
    const t = computeSectionAct(
      [g({ byMethod: { 'кабелеукладчик': 1000 } })],
      [dev({ actualDepthM: 0.5, lengthM: 50 }), dev({ actualDepthM: 0.5, lengthM: 30 })],
    );
    const deviated = t.variants.filter((v) => !v.isMain);
    expect(deviated).toHaveLength(1);
    expect(deviated[0].lengthM).toBe(80);
    expect(t.variants.find((v) => v.isMain)!.lengthM).toBe(920);
  });

  it('разные глубины дают разные акты', () => {
    const t = computeSectionAct(
      [g({ byMethod: { 'кабелеукладчик': 1000 } })],
      [dev({ actualDepthM: 0.5, lengthM: 50 }), dev({ actualDepthM: 0.9, lengthM: 20 })],
    );
    const depths = t.variants.map((v) => v.actualDepthM);
    expect(depths).toEqual([1.2, 0.9, 0.5]);
  });

  it('отклонение без протокола помечает свой акт как незакрываемый', () => {
    const t = computeSectionAct(
      [g({ byMethod: { 'кабелеукладчик': 1000 } })],
      [dev({ actualDepthM: 0.5, lengthM: 50 })],
    );
    expect(t.variants.find((v) => !v.isMain)!.blocked).toBe(true);
    expect(t.variants.find((v) => v.isMain)!.blocked).toBe(false);
  });

  it('уложились в проект — отдельного акта не появляется', () => {
    const t = computeSectionAct(
      [g({ byMethod: { 'кабелеукладчик': 1000 } })],
      [dev({ actualDepthM: 1.2, lengthM: 50 })],
    );
    expect(t.variants).toHaveLength(1);
    expect(t.variants[0].isMain).toBe(true);
    expect(t.variants[0].lengthM).toBe(1000);
  });

  it('когда отклонение покрывает весь участок, основного акта нет', () => {
    const t = computeSectionAct(
      [g({ byMethod: { 'кабелеукладчик': 50 } })],
      [dev({ actualDepthM: 0.5, lengthM: 50 })],
    );
    expect(t.variants).toHaveLength(1);
    expect(t.variants[0].isMain).toBe(false);
    expect(t.variants[0].actualDepthM).toBe(0.5);
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
