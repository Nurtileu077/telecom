import { describe, it, expect } from 'vitest';
import { mergeJournalStates } from './journalSync';
import { emptyJournal, type JournalState } from './journalStore';
import type { DailyWorkEntry, Crew, CorrectionRequest } from '@/types/construction';

const T = (iso: string) => `2026-09-${iso}T00:00:00.000Z`;

function g(id: string, updatedAt: string, over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id, date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', uchastok: 'Исаковка', kato: '191',
    byMethod: { 'кабелеукладчик': 1000 }, materials: {},
    createdAt: T('01'), updatedAt, ...over,
  };
}

function state(over: Partial<JournalState> = {}): JournalState {
  return { ...emptyJournal(), ...over };
}

describe('слияние журналов', () => {
  it('забирает с сервера то, чего нет локально', () => {
    const { merged, stats } = mergeJournalStates(
      state({ ground: [g('a', T('10'))] }),
      state({ ground: [g('b', T('10'))] }),
    );
    expect(merged.ground.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(stats.pulled).toBe(1);
    expect(stats.pushed).toBe(1);
  });

  it('при правке с обеих сторон побеждает более поздняя', () => {
    const { merged, stats } = mergeJournalStates(
      state({ ground: [g('a', T('10'), { uchastok: 'старое' })] }),
      state({ ground: [g('a', T('12'), { uchastok: 'новое' })] }),
    );
    expect(merged.ground[0].uchastok).toBe('новое');
    expect(stats.conflicts).toBe(1);
  });

  it('своя более поздняя правка не затирается сервером', () => {
    const { merged } = mergeJournalStates(
      state({ ground: [g('a', T('14'), { uchastok: 'моё свежее' })] }),
      state({ ground: [g('a', T('12'), { uchastok: 'серверное' })] }),
    );
    expect(merged.ground[0].uchastok).toBe('моё свежее');
  });

  it('одинаковые версии конфликтом не считаются', () => {
    const { stats } = mergeJournalStates(
      state({ ground: [g('a', T('10'))] }),
      state({ ground: [g('a', T('10'))] }),
    );
    expect(stats.conflicts).toBe(0);
  });
});

describe('удаления переживают синхронизацию', () => {
  it('удалённая локально запись не возвращается с сервера', () => {
    const { merged, stats } = mergeJournalStates(
      state({ ground: [], deleted: [{ id: 'a', at: T('12') }] }),
      state({ ground: [g('a', T('10'))] }),
    );
    expect(merged.ground).toHaveLength(0);
    expect(stats.removed).toBe(1);
  });

  it('чужое удаление убирает запись и у нас', () => {
    const { merged } = mergeJournalStates(
      state({ ground: [g('a', T('10'))] }),
      state({ ground: [], deleted: [{ id: 'a', at: T('12') }] }),
    );
    expect(merged.ground).toHaveLength(0);
  });

  it('правка после удаления воскрешает запись', () => {
    // Бригада поправила отчёт уже после того, как его кто-то удалил —
    // свежая работа важнее давнего удаления.
    const { merged } = mergeJournalStates(
      state({ ground: [g('a', T('15'), { uchastok: 'переписали' })] }),
      state({ ground: [], deleted: [{ id: 'a', at: T('12') }] }),
    );
    expect(merged.ground).toHaveLength(1);
    expect(merged.ground[0].uchastok).toBe('переписали');
  });

  it('надгробие сохраняется в результате, чтобы дойти до остальных', () => {
    const { merged } = mergeJournalStates(
      state({ deleted: [{ id: 'a', at: T('12') }] }),
      state({ ground: [g('a', T('10'))] }),
    );
    expect(merged.deleted.some((d) => d.id === 'a')).toBe(true);
  });

  it('из двух удалений берётся более позднее', () => {
    const { merged } = mergeJournalStates(
      state({ deleted: [{ id: 'a', at: T('10') }] }),
      state({ deleted: [{ id: 'a', at: T('14') }] }),
    );
    expect(merged.deleted.find((d) => d.id === 'a')?.at).toBe(T('14'));
  });

  it('старые надгробия не копятся вечно', () => {
    const old = '2025-01-01T00:00:00.000Z';
    const { merged } = mergeJournalStates(
      state({ deleted: [{ id: 'old', at: old }, { id: 'fresh', at: T('10') }] }),
      state(),
      new Date('2026-09-17T00:00:00.000Z'),
    );
    expect(merged.deleted.map((d) => d.id)).toEqual(['fresh']);
  });
});

describe('слияние колонн и отклонений', () => {
  const crew = (id: string, updatedAt: string, over: Partial<Crew> = {}): Crew => ({
    id, kind: 'mkt', name: '1-колонна', status: 'working',
    members: [], equipment: {}, updatedAt, ...over,
  });

  it('перемещение колонны с сервера доезжает', () => {
    const { merged } = mergeJournalStates(
      state({ crews: [crew('c1', T('10'), { lat: 52, lon: 69 })] }),
      state({ crews: [crew('c1', T('12'), { lat: 53, lon: 70 })] }),
    );
    expect(merged.crews[0].lat).toBe(53);
  });

  it('удалённая колонна не возвращается', () => {
    const { merged } = mergeJournalStates(
      state({ crews: [], deleted: [{ id: 'c1', at: T('12') }] }),
      state({ crews: [crew('c1', T('10'))] }),
    );
    expect(merged.crews).toHaveLength(0);
  });
});

describe('заявки на исправление', () => {
  const req = (id: string, over: Partial<CorrectionRequest> = {}): CorrectionRequest => ({
    id, entryId: 'e1', before: g('e1', T('10')), proposed: g('e1', T('11')),
    reason: 'ошиблись', author: 'Бригадир', createdAt: T('10'),
    status: 'pending', ...over,
  });

  it('решение отчётности сильнее ожидающей заявки', () => {
    const { merged } = mergeJournalStates(
      state({ corrections: [req('r1')] }),
      state({ corrections: [req('r1', { status: 'approved', decidedBy: 'Офис', decidedAt: T('12') })] }),
    );
    expect(merged.corrections[0].status).toBe('approved');
  });

  it('уже принятое решение не откатывается ожидающей копией', () => {
    const { merged } = mergeJournalStates(
      state({ corrections: [req('r1', { status: 'rejected', decidedAt: T('12') })] }),
      state({ corrections: [req('r1')] }),
    );
    expect(merged.corrections[0].status).toBe('rejected');
  });

  it('из двух решений берётся более позднее', () => {
    const { merged } = mergeJournalStates(
      state({ corrections: [req('r1', { status: 'approved', decidedAt: T('12') })] }),
      state({ corrections: [req('r1', { status: 'rejected', decidedAt: T('14') })] }),
    );
    expect(merged.corrections[0].status).toBe('rejected');
  });
});

describe('реестр и справочники', () => {
  it('реестр СНП сливается по КАТО без дублей', () => {
    const { merged } = mergeJournalStates(
      state({ orders: [{ kato: '191', oblast: 'А', snp: 'Еленовка' }] }),
      state({ orders: [{ kato: '191', oblast: 'А', snp: 'Еленовка', guCount: 4 },
                       { kato: '192', oblast: 'А', snp: 'Кирковка' }] }),
    );
    expect(merged.orders).toHaveLength(2);
  });

  it('справочник подрядчиков объединяется по имени', () => {
    const { merged } = mergeJournalStates(
      state({ contractors: [{ id: 'a', name: 'TERRA TECH', note: 'моё' }] }),
      state({ contractors: [{ id: 'b', name: 'Новый подряд' }] }),
    );
    const names = merged.contractors.map((c) => c.name);
    expect(names).toContain('TERRA TECH');
    expect(names).toContain('Новый подряд');
  });
});

describe('первая синхронизация', () => {
  it('пустой сервер просто принимает всё локальное', () => {
    const { merged, stats } = mergeJournalStates(
      state({ ground: [g('a', T('10')), g('b', T('10'))] }),
      emptyJournal(),
    );
    expect(merged.ground).toHaveLength(2);
    expect(stats.pushed).toBe(2);
    expect(stats.pulled).toBe(0);
  });

  it('пустой локальный журнал забирает всё с сервера', () => {
    const { merged, stats } = mergeJournalStates(
      emptyJournal(),
      state({ ground: [g('a', T('10'))] }),
    );
    expect(merged.ground).toHaveLength(1);
    expect(stats.pulled).toBe(1);
  });
});
