import { describe, it, expect } from 'vitest';
import {
  groundTotals, metersBy, metersByDay, lastWorkDate, matchesFilter,
  mergeJournal, drillMapPoints, shiftDays, fmtKm, fmtMeters,
  emptyJournal, addGroundEntry, removeEntry, type JournalState,
  submitCorrection, approveCorrection, rejectCorrection, pendingCorrections,
  hasPendingCorrection, diffEntries, suggestContractor, DEFAULT_CONTRACTORS,
  addDeviation, removeDeviation, openDeviations, isDeviationClosed, needsProtocol,
} from './journalStore';
import type { DailyWorkEntry, DrillLogEntry, Deviation } from '@/types/construction';

const now = '2026-09-17T00:00:00.000Z';

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-06-01', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'У-1', kato: '111',
    byMethod: { 'кабелеукладчик': 1000 }, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

function d(over: Partial<DrillLogEntry> = {}): DrillLogEntry {
  return {
    kind: 'drill', id: `d${Math.random()}`, date: '2026-06-02', smu: '',
    oblast: 'Мангистауская область', uchastok: 'Ш-Т', kato: '471',
    drillKind: 'ГНБ', meters: 72, count: 1,
    points: [{ lat: 44.48, lon: 52.09, meters: 72 }],
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('сводка по выработке', () => {
  it('складывает метры по всем способам', () => {
    const t = groundTotals([
      g({ byMethod: { 'кабелеукладчик': 1000, 'экскаватор': 500 } }),
      g({ byMethod: { 'вручную': 250 } }),
    ]);
    expect(t.meters).toBe(1750);
    expect(t.byMethod['кабелеукладчик']).toBe(1000);
    expect(t.byMethod['вручную']).toBe(250);
    expect(t.entries).toBe(2);
  });

  it('складывает материалы и переходы отдельно от метража трассы', () => {
    const t = groundTotals([
      g({ materials: { 'МКТ': 1800, 'Муфта': 3 }, drillM: 72, drillCount: 2, openCrossings: 1 }),
      g({ materials: { 'МКТ': 200, 'Муфта': 1 }, drillM: 28, drillCount: 1 }),
    ]);
    expect(t.byMaterial['МКТ']).toBe(2000);
    expect(t.byMaterial['Муфта']).toBe(4);
    expect(t.drillM).toBe(100);
    expect(t.drillCount).toBe(3);
    expect(t.openCrossings).toBe(1);
    // Проколы не должны попадать в метраж трассы — это разные показатели.
    expect(t.meters).toBe(2000);
  });

  it('пустой список даёт нули, а не ошибку', () => {
    const t = groundTotals([]);
    expect(t.meters).toBe(0);
    expect(t.entries).toBe(0);
  });
});

describe('разрезы', () => {
  it('группирует по области и сортирует по убыванию метров', () => {
    const rows = metersBy([
      g({ oblast: 'А', byMethod: { 'вручную': 100 } }),
      g({ oblast: 'Б', byMethod: { 'вручную': 900 } }),
      g({ oblast: 'А', byMethod: { 'вручную': 200 } }),
    ], (e) => e.oblast);
    expect(rows[0]).toEqual({ name: 'Б', meters: 900, entries: 1 });
    expect(rows[1]).toEqual({ name: 'А', meters: 300, entries: 2 });
  });

  it('пустой ключ показывает как «Не указано», а не теряет запись', () => {
    const rows = metersBy([g({ smu: '' })], (e) => e.smu);
    expect(rows[0].name).toBe('Не указано');
  });

  it('суммирует по дням в хронологическом порядке', () => {
    const days = metersByDay([
      g({ date: '2026-06-03', byMethod: { 'вручную': 300 } }),
      g({ date: '2026-06-01', byMethod: { 'вручную': 100 } }),
      g({ date: '2026-06-01', byMethod: { 'вручную': 50 } }),
    ]);
    expect(days).toEqual([
      { date: '2026-06-01', meters: 150 },
      { date: '2026-06-03', meters: 300 },
    ]);
  });

  it('находит последний рабочий день', () => {
    expect(lastWorkDate([g({ date: '2026-06-01' }), g({ date: '2026-09-16' })])).toBe('2026-09-16');
    expect(lastWorkDate([])).toBe('');
  });
});

describe('фильтр', () => {
  const e = g({ date: '2026-06-10', oblast: 'А', smu: 'СМУ-2', kato: '777' });

  it('отбирает по диапазону дат включительно', () => {
    expect(matchesFilter(e, { from: '2026-06-10', to: '2026-06-10' })).toBe(true);
    expect(matchesFilter(e, { from: '2026-06-11' })).toBe(false);
    expect(matchesFilter(e, { to: '2026-06-09' })).toBe(false);
  });

  it('отбирает по области, СМУ и КАТО', () => {
    expect(matchesFilter(e, { oblast: 'А' })).toBe(true);
    expect(matchesFilter(e, { oblast: 'Б' })).toBe(false);
    expect(matchesFilter(e, { smu: 'СМУ-2' })).toBe(true);
    expect(matchesFilter(e, { kato: '778' })).toBe(false);
  });

  it('пустой фильтр пропускает всё', () => {
    expect(matchesFilter(e, {})).toBe(true);
  });
});

describe('слияние журналов', () => {
  it('заменяет записи с тем же id и добавляет новые', () => {
    const base: JournalState = { ...emptyJournal(), ground: [g({ id: 'x', uchastok: 'старый' })] };
    const merged = mergeJournal(base, { ground: [g({ id: 'x', uchastok: 'новый' }), g({ id: 'y' })] });
    expect(merged.ground).toHaveLength(2);
    expect(merged.ground.find((e) => e.id === 'x')?.uchastok).toBe('новый');
  });

  it('реестр СНП сливается по КАТО — повторный импорт не плодит дубли', () => {
    const base: JournalState = {
      ...emptyJournal(),
      orders: [{ kato: '111', oblast: 'А', snp: 'Еленовка' }],
    };
    const merged = mergeJournal(base, { orders: [{ kato: '111', oblast: 'А', snp: 'Еленовка', guCount: 4 }] });
    expect(merged.orders).toHaveLength(1);
    expect(merged.orders[0].guCount).toBe(4);
  });
});

describe('точки для карты', () => {
  it('разворачивает проколы в плоский список', () => {
    const state: JournalState = {
      ...emptyJournal(),
      drills: [d({ id: 'd1', points: [{ lat: 44.48, lon: 52.09, meters: 72 }, { lat: 44.49, lon: 52.10 }] })],
    };
    const pts = drillMapPoints(state);
    expect(pts).toHaveLength(2);
    expect(pts[0].id).toBe('d1#0');
    expect(pts[0].meters).toBe(72);
    expect(pts[1].meters).toBeUndefined();
    expect(pts[0].drillKind).toBe('ГНБ');
  });

  it('записи без координат не дают точек', () => {
    const state: JournalState = { ...emptyJournal(), drills: [d({ points: [] })] };
    expect(drillMapPoints(state)).toHaveLength(0);
  });
});

describe('операции над журналом', () => {
  it('добавляет и удаляет запись', () => {
    const entry = g({ id: 'new' });
    const withEntry = addGroundEntry(emptyJournal(), entry);
    expect(withEntry.ground).toHaveLength(1);
    expect(removeEntry(withEntry, 'new').ground).toHaveLength(0);
  });
});

describe('исправление отчёта', () => {
  const entry = g({ id: 'e1', uchastok: 'Исаковка', byMethod: { 'кабелеукладчик': 11000 } });
  const base: JournalState = { ...emptyJournal(), ground: [entry] };
  const proposed = { ...entry, byMethod: { 'кабелеукладчик': 10000 } };

  it('заявка не меняет запись сразу — сводка остаётся прежней', () => {
    const s = submitCorrection(base, { entry, proposed, reason: 'ошиблись', author: 'Иван' });
    expect(s.ground[0].byMethod['кабелеукладчик']).toBe(11000);
    expect(pendingCorrections(s)).toHaveLength(1);
    expect(groundTotals(s.ground).meters).toBe(11000);
  });

  it('подтверждение применяет правку', () => {
    const s = submitCorrection(base, { entry, proposed, reason: 'ошиблись', author: 'Иван' });
    const id = s.corrections[0].id;
    const a = approveCorrection(s, id, 'Отчётность');
    expect(a.ground[0].byMethod['кабелеукладчик']).toBe(10000);
    expect(a.corrections[0].status).toBe('approved');
    expect(a.corrections[0].decidedBy).toBe('Отчётность');
    expect(pendingCorrections(a)).toHaveLength(0);
  });

  it('отказ оставляет запись прежней и сохраняет причину', () => {
    const s = submitCorrection(base, { entry, proposed, reason: 'ошиблись', author: 'Иван' });
    const r = rejectCorrection(s, s.corrections[0].id, 'Отчётность', 'нет подтверждения');
    expect(r.ground[0].byMethod['кабелеукладчик']).toBe(11000);
    expect(r.corrections[0].status).toBe('rejected');
    expect(r.corrections[0].decisionNote).toBe('нет подтверждения');
  });

  it('повторное решение по закрытой заявке ничего не меняет', () => {
    const s = submitCorrection(base, { entry, proposed, reason: 'x', author: 'И' });
    const id = s.corrections[0].id;
    const once = approveCorrection(s, id, 'Отчётность');
    const twice = approveCorrection(once, id, 'Кто-то другой');
    expect(twice.corrections[0].decidedBy).toBe('Отчётность');
    expect(twice.ground[0].byMethod['кабелеукладчик']).toBe(10000);
  });

  it('видно, что по записи уже есть незакрытая заявка', () => {
    const s = submitCorrection(base, { entry, proposed, reason: 'x', author: 'И' });
    expect(hasPendingCorrection(s, 'e1')).toBe(true);
    expect(hasPendingCorrection(approveCorrection(s, s.corrections[0].id, 'О'), 'e1')).toBe(false);
  });

  it('заявка сохраняет id исправляемой записи, даже если в правке он другой', () => {
    const wrongId = { ...proposed, id: 'подменённый' };
    const s = submitCorrection(base, { entry, proposed: wrongId, reason: 'x', author: 'И' });
    expect(s.corrections[0].proposed.id).toBe('e1');
  });

  it('импорт файла не затирает поданные заявки', () => {
    const s = submitCorrection(base, { entry, proposed, reason: 'x', author: 'И' });
    const merged = mergeJournal(s, { ground: [g({ id: 'new' })] });
    expect(pendingCorrections(merged)).toHaveLength(1);
  });
});

describe('разница между версиями записи', () => {
  it('показывает только изменившиеся поля', () => {
    const a = g({ uchastok: 'Исаковка', byMethod: { 'кабелеукладчик': 11000 }, materials: { 'МКТ': 11000 } });
    const b = { ...a, byMethod: { 'кабелеукладчик': 10000 }, materials: { 'МКТ': 11000 } };
    const diff = diffEntries(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0].before).toBe('11000');
    expect(diff[0].after).toBe('10000');
  });

  it('пустое значение показывает как «—»', () => {
    const a = g({ note: undefined });
    const diff = diffEntries(a, { ...a, note: 'закончили' });
    expect(diff[0]).toEqual({ label: 'Примечание', before: '—', after: 'закончили' });
  });

  it('одинаковые записи дают пустую разницу', () => {
    const a = g();
    expect(diffEntries(a, { ...a })).toHaveLength(0);
  });
});

describe('подрядчики', () => {
  it('подсказывает подрядчика по области и району', () => {
    const c = suggestContractor(DEFAULT_CONTRACTORS, 'Акмолинская область', 'Зерендинский');
    expect(c?.name).toBe('TERRA TECH');
  });

  it('различает районы одной области', () => {
    const c = suggestContractor(DEFAULT_CONTRACTORS, 'Акмолинская область', 'Бурабайский');
    expect(c?.name).toBe('Модуль Строй');
  });

  it('не выдумывает подрядчика для незнакомого района', () => {
    expect(suggestContractor(DEFAULT_CONTRACTORS, 'Атырауская область', 'Индерский')).toBeUndefined();
    expect(suggestContractor(DEFAULT_CONTRACTORS, '', '')).toBeUndefined();
  });
});

describe('отклонения и протокол мобильной группы', () => {
  const dev = (over: Partial<Deviation> = {}): Deviation => ({
    id: `d${Math.random()}`, kind: 'depth', date: '2026-09-05',
    oblast: 'Акмолинская область', rayon: 'Зерендинский',
    uchastok: 'от муфты №4 ОК-714 до школы с. Акадыр', kato: '191',
    lengthM: 250, designDepthM: 1.2, actualDepthM: 1.2,
    reason: 'Скальный грунт', author: 'Инженер',
    createdAt: now, updatedAt: now, ...over,
  });

  it('глубина по проекту — протокол не нужен', () => {
    const d = dev({ actualDepthM: 1.2 });
    expect(needsProtocol(d)).toBe(false);
    expect(isDeviationClosed(d)).toBe(true);
  });

  it('глубина 0,5 при проектных 1,2 — протокол обязателен', () => {
    const d = dev({ actualDepthM: 0.5 });
    expect(needsProtocol(d)).toBe(true);
    expect(isDeviationClosed(d)).toBe(false);
  });

  it('с оформленным протоколом отклонение закрыто', () => {
    const d = dev({ actualDepthM: 0.5, protocol: { number: '14', date: '2026-09-06' } });
    expect(isDeviationClosed(d)).toBe(true);
  });

  it('пустой номер протокола не закрывает отклонение', () => {
    const d = dev({ actualDepthM: 0.5, protocol: { number: '   ', date: '2026-09-06' } });
    expect(isDeviationClosed(d)).toBe(false);
  });

  it('глубже проекта — это не отклонение', () => {
    expect(needsProtocol(dev({ actualDepthM: 1.5 }))).toBe(false);
  });

  it('разница в полсантиметра не плодит протоколы', () => {
    // 1.195 против 1.2 — округление замера, а не отклонение.
    expect(needsProtocol(dev({ actualDepthM: 1.195 }))).toBe(false);
  });

  it('изменение трассы требует протокола независимо от глубины', () => {
    const d = dev({ kind: 'route', designDepthM: undefined, actualDepthM: undefined });
    expect(needsProtocol(d)).toBe(true);
    expect(isDeviationClosed(d)).toBe(false);
  });

  it('пока глубина не замерена, протокол не требуем', () => {
    expect(needsProtocol(dev({ actualDepthM: undefined }))).toBe(false);
  });

  it('список незакрытых собирает только те, где протокола нет', () => {
    const s: JournalState = {
      ...emptyJournal(),
      deviations: [
        dev({ id: 'a', actualDepthM: 0.5 }),
        dev({ id: 'b', actualDepthM: 0.5, protocol: { number: '7', date: '2026-09-06' } }),
        dev({ id: 'c', actualDepthM: 1.2 }),
      ],
    };
    expect(openDeviations(s).map((d) => d.id)).toEqual(['a']);
  });

  it('отклонения переживают импорт файла', () => {
    const s = addDeviation(emptyJournal(), dev({ id: 'keep', actualDepthM: 0.5 }));
    const merged = mergeJournal(s, { ground: [g()] });
    expect(merged.deviations).toHaveLength(1);
  });

  it('удаление убирает отклонение', () => {
    const s = addDeviation(emptyJournal(), dev({ id: 'x' }));
    expect(removeDeviation(s, 'x').deviations).toHaveLength(0);
  });
});

describe('вспомогательное', () => {
  it('сдвигает дату через границу месяца', () => {
    expect(shiftDays('2026-06-01', -1)).toBe('2026-05-31');
    expect(shiftDays('2026-09-16', -29)).toBe('2026-08-18');
  });

  it('форматирует метры и километры', () => {
    // toLocaleString('ru') разделяет разряды неразрывным пробелом —
    // сравниваем по нормализованной строке, а не по конкретному символу.
    const norm = (s: string) => s.replace(/\s/g, ' ');
    expect(norm(fmtKm(2035700))).toBe('2 035,7');
    expect(norm(fmtMeters(500))).toBe('500 м');
    expect(norm(fmtMeters(1500))).toBe('1,5 км');
  });
});
