import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeBackup, readBackup, restoreBackup, journalCounts, backupFileName,
  backupAge, restoreWarning, BACKUP_VERSION,
  loadImports, saveImports, noteImport, IMPORT_HISTORY_LIMIT,
} from './backup';
import { emptyJournal, addGroundEntry, type JournalState } from './journalStore';
import type { DailyWorkEntry } from '@/types/construction';

function withEntries(n: number): JournalState {
  let j = emptyJournal();
  for (let i = 0; i < n; i++) {
    j = addGroundEntry(j, {
      id: `e${i}`, kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
      oblast: 'Акмолинская область', uchastok: 'У1', kato: '1',
      byMethod: { 'бар': 100 }, materials: {}, createdAt: '', updatedAt: '',
    } as DailyWorkEntry);
  }
  return j;
}

function fakeWindow() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  };
  return store;
}

describe('journalCounts', () => {
  it('говорит, что внутри, не открывая файл', () => {
    expect(journalCounts(withEntries(3)).смены).toBe(3);
    expect(journalCounts(emptyJournal()).трассы).toBe(0);
  });
});

describe('копия туда и обратно', () => {
  it('разворачивается без потерь', () => {
    const j = withEntries(2);
    const file = makeBackup(j, 'Прораб');
    const check = readBackup(JSON.stringify(file));
    expect(check.ok).toBe(true);
    expect(restoreBackup(check.file!).ground).toHaveLength(2);
  });

  it('в копии видно, кто и когда её снял', () => {
    const file = makeBackup(emptyJournal(), 'Прораб');
    expect(file.author).toBe('Прораб');
    expect(file.version).toBe(BACKUP_VERSION);
    expect(new Date(file.at).getTime()).toBeGreaterThan(0);
  });

  it('недостающие поля добираются из пустого журнала', () => {
    // Копия, снятая версией без расценок.
    const old = {
      format: 'optiq-journal', version: 1, at: '2026-07-25T10:00:00.000Z',
      counts: {}, journal: { ground: [], areas: [] },
    };
    const check = readBackup(JSON.stringify(old));
    expect(check.ok).toBe(true);
    const restored = restoreBackup(check.file!);
    expect(restored.rates).toEqual([]);
    expect(restored.records).toEqual([]);
  });
});

describe('readBackup', () => {
  it('не JSON — не копия', () => {
    expect(readBackup('просто текст').problem).toContain('не JSON');
  });

  it('чужой файл виден сразу', () => {
    expect(readBackup(JSON.stringify({ format: 'other' })).problem).toContain('не от этой системы');
  });

  it('копия из будущего не разворачивается молча', () => {
    const check = readBackup(JSON.stringify({
      format: 'optiq-journal', version: BACKUP_VERSION + 1, journal: { ground: [] },
    }));
    expect(check.ok).toBe(false);
    expect(check.problem).toContain('новой версией');
  });

  it('файл без журнала отклоняется', () => {
    expect(readBackup(JSON.stringify({
      format: 'optiq-journal', version: 1,
    })).problem).toContain('нет журнала');
  });
});

describe('restoreWarning', () => {
  it('предупреждает, что копия беднее текущего журнала', () => {
    const warn = restoreWarning(withEntries(5), makeBackup(withEntries(2)));
    expect(warn).toContain('сейчас 5');
    expect(warn).toContain('заменит журнал целиком');
  });

  it('копия богаче — предупреждать не о чем', () => {
    expect(restoreWarning(withEntries(1), makeBackup(withEntries(4)))).toBeNull();
  });
});

describe('backupFileName и backupAge', () => {
  it('в имени файла видно, когда сняли', () => {
    expect(backupFileName(new Date('2026-07-25T10:30:00Z')))
      .toBe('optiq-журнал-2026-07-25_10-30.json');
  });

  it('возраст копии словами', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    expect(backupAge('2026-07-25T11:00:00Z', now)).toBe('1 ч назад');
    expect(backupAge('2026-07-20T12:00:00Z', now)).toBe('5 дн назад');
    expect(backupAge('2026-07-25T11:59:00Z', now)).toBe('меньше часа назад');
  });
});

describe('история импортов', () => {
  beforeEach(() => { fakeWindow(); });

  it('помнит, что и когда загружали', () => {
    const list = noteImport([], {
      id: 'i1', at: '2026-07-25T10:00:00.000Z', file: 'журнал.xlsx',
      counts: { смены: 120 },
    });
    saveImports(list);
    expect(loadImports()[0].file).toBe('журнал.xlsx');
  });

  it('список не растёт бесконечно', () => {
    let list: ReturnType<typeof noteImport> = [];
    for (let i = 0; i < IMPORT_HISTORY_LIMIT + 5; i++) {
      list = noteImport(list, { id: `i${i}`, at: '', file: `f${i}`, counts: {} });
    }
    expect(list).toHaveLength(IMPORT_HISTORY_LIMIT);
  });

  it('мусор в хранилище не ломает список', () => {
    (globalThis as { window?: { localStorage: { setItem(k: string, v: string): void } } })
      .window!.localStorage.setItem('optiq-imports-v1', 'не json');
    expect(loadImports()).toEqual([]);
  });
});

/**
 * В списке должно быть перечислено всё, что копия переносит. Пропущенная
 * коллекция не просто не видна: по этим же числам предупреждают, что
 * восстановление сотрёт, — и о пропущенном оно промолчит.
 */
describe('в описи копии ничего не потеряно', () => {
  it('считает каждую коллекцию журнала', () => {
    const j = emptyJournal();
    // Все коллекции-массивы журнала должны быть представлены в описи.
    const lists = (Object.keys(j) as (keyof typeof j)[])
      .filter((k) => Array.isArray(j[k]))
      // Корзина и надгробия — служебное: их в описи не показывают.
      .filter((k) => k !== 'trash' && k !== 'deleted' && k !== 'changes');
    const counts = journalCounts(j);
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(lists.length);
  });

  it('предупреждает о том, что сотрёт восстановление', () => {
    const now = { ...emptyJournal(), drums: [{ id: 'b1' }] as never[] };
    const warn = restoreWarning(now, makeBackup(emptyJournal()));
    expect(warn).toContain('барабаны');
  });

  it('поставки и сварки в описи есть', () => {
    const counts = journalCounts(emptyJournal());
    for (const key of ['поставки', 'сварки', 'реестр СНП', 'заявки на исправление']) {
      expect(Object.keys(counts)).toContain(key);
    }
  });
});

/**
 * Опись в файле могли снять до того, как в ней появились новые виды
 * записей. Считать отсутствие ключа за ноль значит пугать потерей всего,
 * чего прежняя опись не знала, — и человек отменяет разворачивание
 * хорошей копии.
 */
describe('старая копия с неполной описью', () => {
  function oldBackup(j: JournalState) {
    const full = makeBackup(j);
    // Прежняя версия не знала про поставки, барабаны и сварки.
    const counts = { ...full.counts };
    for (const k of ['поставки', 'барабаны', 'сварки', 'реестр СНП']) delete counts[k];
    return { ...full, counts };
  }

  it('не пугает потерей того, что в копии на самом деле есть', () => {
    const j: JournalState = {
      ...emptyJournal(),
      deliveries: [{ id: 'd1' }, { id: 'd2' }] as never[],
      drums: [{ id: 'b1' }] as never[],
    };
    expect(restoreWarning(j, oldBackup(j))).toBeNull();
  });

  it('но о настоящей потере говорит', () => {
    const inFile: JournalState = { ...emptyJournal(), deliveries: [{ id: 'd1' }] as never[] };
    const now: JournalState = {
      ...emptyJournal(),
      deliveries: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] as never[],
    };
    const warn = restoreWarning(now, oldBackup(inFile));
    expect(warn).toContain('поставки: сейчас 3, в копии 1');
  });

  it('ключ, который в описи есть, берётся из описи', () => {
    const j: JournalState = { ...emptyJournal(), ground: [{ id: 'a' }] as never[] };
    const file = makeBackup(j);
    expect(restoreWarning(j, file)).toBeNull();
  });
});

/**
 * Копию могли снять версией, которая половины списков не знала, или
 * подсунуть обрезанный файл. Спрашивать длину отсутствующего списка
 * нельзя: разворачивание падает молча, и человек видит просто не
 * открывшийся файл.
 */
describe('опись не падает на чужом файле', () => {
  it('журнал без половины списков считается, а не роняет', () => {
    const half = { ground: [{ id: 'a' }], updatedAt: '' } as unknown as JournalState;
    expect(() => journalCounts(half)).not.toThrow();
    expect(journalCounts(half).смены).toBe(1);
    expect(journalCounts(half).поставки).toBe(0);
  });

  it('не список на месте списка — ноль, а не падение', () => {
    const weird = { ground: 'не список', orders: null } as unknown as JournalState;
    expect(journalCounts(weird).смены).toBe(0);
    expect(journalCounts(weird)['реестр СНП']).toBe(0);
  });

  it('предупреждение о развороте пустого файла не падает', () => {
    const empty = { format: 'optiq-journal', version: 1, at: '' } as never;
    expect(() => restoreWarning(emptyJournal(), empty)).not.toThrow();
  });

  it('цены и продвижение по участкам в описи есть: их развороткой тоже стирает', () => {
    const j: JournalState = {
      ...emptyJournal(),
      prices: { 'МКТ': 420 },
      sectionProgress: { 'Зеренда': { meters: 100 } as never },
    };
    const c = journalCounts(j);
    expect(c['цены материалов']).toBe(1);
    expect(c['продвижение по участкам']).toBe(1);
  });

  it('и о их потере предупреждает', () => {
    const now: JournalState = { ...emptyJournal(), prices: { 'МКТ': 420, 'ПЭТ': 310 } };
    const warn = restoreWarning(now, makeBackup(emptyJournal()));
    expect(warn).toContain('цены материалов');
  });
});
