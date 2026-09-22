import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadBookmarks, saveBookmarks, toggleBookmark, isBookmarked,
  loadRecent, saveRecent, pushRecent, RECENT_LIMIT,
  loadFilters, saveFilters, upsertFilter, removeFilter, describeFilter,
  type Shortcut,
} from './shortcuts';

/** Тесты идут без браузера — хранилище подставляем своё. */
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

let store: Map<string, string>;
beforeEach(() => { store = fakeWindow(); });

function s(patch: Partial<Shortcut> = {}): Shortcut {
  return {
    kind: 'snp', id: '116240100', label: 'Серафимовка',
    at: '2026-07-25T10:00:00.000Z', ...patch,
  };
}

describe('закладки', () => {
  it('ставятся и снимаются одним действием', () => {
    const once = toggleBookmark([], s());
    expect(isBookmarked(once, { kind: 'snp', id: '116240100' })).toBe(true);
    expect(toggleBookmark(once, s())).toEqual([]);
  });

  it('разные виды с одним id не путаются', () => {
    const list = toggleBookmark([], s({ kind: 'snp', id: '1' }));
    expect(isBookmarked(list, { kind: 'route', id: '1' })).toBe(false);
  });

  it('переживают перезагрузку', () => {
    saveBookmarks([s()]);
    expect(loadBookmarks()).toHaveLength(1);
  });

  it('мусор в хранилище не ломает список', () => {
    store.set('optiq-bookmarks-v1', 'не json');
    expect(loadBookmarks()).toEqual([]);
  });
});

describe('недавнее', () => {
  it('повторный заход поднимает наверх, а не добавляет вторую строку', () => {
    const first = pushRecent([], s({ id: 'a', label: 'А' }));
    const second = pushRecent(first, s({ id: 'b', label: 'Б' }));
    const again = pushRecent(second, s({ id: 'a', label: 'А' }));
    expect(again.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('список не растёт бесконечно', () => {
    let list: Shortcut[] = [];
    for (let i = 0; i < RECENT_LIMIT + 5; i++) list = pushRecent(list, s({ id: `r${i}` }));
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].id).toBe(`r${RECENT_LIMIT + 4}`);
  });

  it('переживает перезагрузку', () => {
    saveRecent([s()]);
    expect(loadRecent()).toHaveLength(1);
  });
});

describe('сохранённые фильтры', () => {
  const f = {
    id: 'f1', name: 'Акмолинская, Дозер',
    value: { oblast: 'Акмолинская область', contractor: 'Дозер' },
    at: '2026-07-25T10:00:00.000Z',
  };

  it('добавляются и правятся по id', () => {
    const once = upsertFilter([], f);
    expect(once).toHaveLength(1);
    const renamed = upsertFilter(once, { ...f, name: 'Другое' });
    expect(renamed).toHaveLength(1);
    expect(renamed[0].name).toBe('Другое');
  });

  it('удаляются', () => {
    expect(removeFilter([f], 'f1')).toEqual([]);
  });

  it('имя по умолчанию описывает то, что видно', () => {
    expect(describeFilter({ oblast: 'Акмолинская область', contractor: 'Дозер' }))
      .toBe('Акмолинская область, Дозер');
    expect(describeFilter({ oblast: '', contractor: undefined })).toBe('Всё');
  });

  it('переживают перезагрузку', () => {
    saveFilters([f]);
    expect(loadFilters()[0].name).toBe('Акмолинская, Дозер');
  });
});
