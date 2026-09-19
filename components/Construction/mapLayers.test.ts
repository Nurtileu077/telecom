import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadHiddenSources, saveHiddenSources, toggleHiddenSource, sourceVisible,
} from './mapLayers';

/**
 * Тесты идут без браузера, поэтому хранилище подставляем своё: проверяем
 * поведение кода, а не наличие window.
 */
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

describe('слои по источникам', () => {
  let store: Map<string, string>;
  beforeEach(() => { store = fakeWindow(); });

  it('спрятанным считается только погашенный явно', () => {
    expect(sourceVisible([], 'plan.kml')).toBe(true);
    expect(sourceVisible(['plan.kml'], 'plan.kml')).toBe(false);
    // Новый файл появляется видимым: иначе его просто не заметят.
    expect(sourceVisible(['другой.kml'], 'plan.kml')).toBe(true);
  });

  it('переключение гасит и возвращает', () => {
    const once = toggleHiddenSource([], 'plan.kml');
    expect(once).toEqual(['plan.kml']);
    expect(toggleHiddenSource(once, 'plan.kml')).toEqual([]);
  });

  it('выбор переживает перезагрузку', () => {
    saveHiddenSources(['plan.kml', 'контуры.kml']);
    expect(loadHiddenSources()).toEqual(['plan.kml', 'контуры.kml']);
  });

  it('мусор в хранилище не роняет карту', () => {
    store.set('optiq-hidden-sources-v1', '{не json');
    expect(loadHiddenSources()).toEqual([]);
  });

  it('чужой формат в хранилище тоже не роняет', () => {
    store.set('optiq-hidden-sources-v1', '{"a":1}');
    expect(loadHiddenSources()).toEqual([]);
  });
});
