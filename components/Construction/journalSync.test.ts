import { describe, it, expect } from 'vitest';
import { mergeJournalStates } from './journalSync';
import {
  emptyJournal, splitPlanRoute, joinPlanRoutes, deleteRoute, removePlanSource,
  removeRate, setMaterialPrice, removeEntry, restoreFromTrash,
  type JournalState,
} from './journalStore';
import type {
  DailyWorkEntry, Crew, CorrectionRequest, PlanRoute, WorkRate,
} from '@/types/construction';
import { withDefaults, type Requisites } from './requisites';

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

/**
 * Удаление должно пережить обмен.
 *
 * Иначе разрезанная трасса возвращается целой и ложится поверх обеих
 * половин, выброшенный KML-файл всплывает весь, а сброшенная цена
 * материала снова считает деньги по старой.
 */
describe('удалённое не воскресает', () => {
  function route(id: string, updatedAt: string, source = 'plan.kml'): PlanRoute {
    return {
      id, name: id, coords: [[52, 71], [52, 71.01]], lengthM: 685,
      source, createdAt: T('01'), updatedAt,
    };
  }

  it('разрезанная трасса не возвращается с сервера', () => {
    const local = splitPlanRoute(
      state({ planRoutes: [route('r1', T('10'))] }), 'r1', 300, 'Иванов',
    );
    const { merged } = mergeJournalStates(local, state({ planRoutes: [route('r1', T('10'))] }));
    expect(merged.planRoutes.map((r) => r.id).sort()).toEqual(['r1-a', 'r1-b']);
  });

  it('склеенная половина не возвращается отдельной линией', () => {
    const base = state({
      planRoutes: [
        { ...route('a', T('10')), coords: [[52, 71], [52, 71.01]] },
        { ...route('b', T('10')), coords: [[52, 71.01], [52, 71.02]] },
      ],
    });
    const local = joinPlanRoutes(base, 'a', 'b', 'Иванов');
    expect(local.planRoutes).toHaveLength(1);
    const { merged } = mergeJournalStates(local, base);
    expect(merged.planRoutes).toHaveLength(1);
  });

  it('удалённая трасса не возвращается', () => {
    const base = state({ planRoutes: [route('r1', T('10'))] });
    const { merged } = mergeJournalStates(deleteRoute(base, 'r1', 'Иванов'), base);
    expect(merged.planRoutes).toHaveLength(0);
  });

  it('выброшенный файл плана не всплывает целиком', () => {
    const base = state({
      planRoutes: [route('r1', T('10')), route('r2', T('10')), route('r3', T('10'), 'другой.kml')],
    });
    const { merged } = mergeJournalStates(removePlanSource(base, 'plan.kml'), base);
    expect(merged.planRoutes.map((r) => r.id)).toEqual(['r3']);
  });

  it('удалённая расценка не перебивает исправленную цену', () => {
    const rate: WorkRate = {
      id: 'rt1', work: 'бар', price: 300, unit: 'м', from: '2026-01-01', updatedAt: T('10'),
    };
    const base = state({ rates: [rate] });
    const { merged } = mergeJournalStates(removeRate(base, 'rt1'), base);
    expect(merged.rates).toHaveLength(0);
  });

  it('сброшенная цена материала не возвращается с сервера', () => {
    const base = state({ prices: { 'МКТ': 420, 'ПЭТ': 310 } });
    const local = setMaterialPrice(base, 'МКТ', undefined);
    const { merged } = mergeJournalStates(local, base);
    expect(merged.prices['МКТ']).toBeUndefined();
    expect(merged.prices['ПЭТ']).toBe(310);
  });

  it('заново назначенная цена надгробие снимает', () => {
    const base = state({ prices: { 'МКТ': 420 } });
    const cleared = setMaterialPrice(base, 'МКТ', undefined);
    const again = setMaterialPrice(cleared, 'МКТ', 500);
    const { merged } = mergeJournalStates(again, base);
    expect(merged.prices['МКТ']).toBe(500);
  });

  it('чужую цену, которой нет у меня, по-прежнему добираю', () => {
    const { merged } = mergeJournalStates(
      state({ prices: {} }),
      state({ prices: { 'ПЭТ': 310 } }),
    );
    expect(merged.prices['ПЭТ']).toBe(310);
  });
});

/**
 * Пока смена лежала в корзине, она могла вернуться обменом с другого
 * устройства. Второй раз дописывать её нельзя: метры задвоятся, а по
 * ним считают и акт, и деньги.
 */
describe('возврат из корзины', () => {
  it('не задваивает смену, которая уже вернулась обменом', () => {
    const base = state({ ground: [g('a', T('10'))] });
    const trashed = removeEntry(base, 'a', 'Иванов');
    expect(trashed.ground).toHaveLength(0);
    // Обмен вернул ту же запись — так бывает, если её удалили у себя, а
    // на сервере она ещё живая.
    const withBack = { ...trashed, ground: [g('a', T('11'))] };
    const restored = restoreFromTrash(withBack, 'a');
    expect(restored.ground).toHaveLength(1);
  });

  it('возврат снимает надгробие', () => {
    const base = state({ ground: [g('a', T('10'))] });
    const restored = restoreFromTrash(removeEntry(base, 'a', 'Иванов'), 'a');
    expect(restored.deleted.some((d) => d.id === 'a')).toBe(false);
    expect(restored.ground).toHaveLength(1);
  });
});

/**
 * Реквизиты правит один человек в конторе, а читают их все. «Моё
 * главнее» здесь значило бы, что старый договор у кого-то в поле
 * переживает новый.
 */
describe('реквизиты в обмене', () => {
  const party = (name: string, at: string): Requisites => ({
    contractor: { name: 'ТОО «СК Фаворит Инжиниринг»' },
    customer: { name },
    updatedAt: at,
  });

  it('берёт ту запись, что свежее', () => {
    const { merged } = mergeJournalStates(
      state({ requisites: party('Старый заказчик', T('10')) }),
      state({ requisites: party('Новый заказчик', T('12')) }),
    );
    expect(merged.requisites?.customer.name).toBe('Новый заказчик');
  });

  it('свою свежую правку чужая давняя не перебивает', () => {
    const { merged } = mergeJournalStates(
      state({ requisites: party('Мой заказчик', T('12')) }),
      state({ requisites: party('Чужой заказчик', T('10')) }),
    );
    expect(merged.requisites?.customer.name).toBe('Мой заказчик');
  });

  it('если реквизитов нет у одной стороны, берёт их у другой', () => {
    const { merged } = mergeJournalStates(
      state({}),
      state({ requisites: party('Заказчик', T('10')) }),
    );
    expect(merged.requisites?.customer.name).toBe('Заказчик');
  });

  it('когда их нет нигде, документы печатаются по умолчанию', () => {
    const { merged } = mergeJournalStates(state({}), state({}));
    expect(merged.requisites).toBeUndefined();
    expect(withDefaults(merged.requisites).customer.name).toBeTruthy();
  });
});
