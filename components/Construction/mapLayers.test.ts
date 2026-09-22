import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadHiddenSources, saveHiddenSources, toggleHiddenSource, sourceVisible,
  loadLayerOpacity, saveLayerOpacity, MIN_LAYER_OPACITY,
  orderedSources, moveSource, bySourceOrder,
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

describe('прозрачность слоёв', () => {
  it('за пределы допустимого не выходит', () => {
    saveLayerOpacity(5);
    expect(loadLayerOpacity()).toBe(1);
    saveLayerOpacity(0);
    expect(loadLayerOpacity()).toBe(MIN_LAYER_OPACITY);
  });

  it('мусор в хранилище — значит непрозрачно', () => {
    window.localStorage.setItem('optiq-layer-opacity-v1', 'ерунда');
    expect(loadLayerOpacity()).toBe(1);
  });
});

describe('порядок слоёв', () => {
  const all = ['проект.kml', 'правки.kml', 'нарисовано на карте'];

  it('неизвестные слои дописываются в конец, а не всплывают наверх', () => {
    expect(orderedSources(['правки.kml'], all))
      .toEqual(['правки.kml', 'проект.kml', 'нарисовано на карте']);
  });

  it('сдвиг меняет соседей местами', () => {
    expect(moveSource(all, all, 'правки.kml', -1))
      .toEqual(['правки.kml', 'проект.kml', 'нарисовано на карте']);
  });

  it('с краю двигать некуда', () => {
    expect(moveSource(all, all, 'проект.kml', -1)).toEqual(all);
    expect(moveSource(all, all, 'нарисовано на карте', 1)).toEqual(all);
  });

  it('исчезнувшие файлы из порядка выпадают', () => {
    expect(orderedSources(['удалённый.kml', 'правки.kml'], all))
      .toEqual(['правки.kml', 'проект.kml', 'нарисовано на карте']);
  });

  it('раскладывает по порядку что угодно с источником', () => {
    const rows = [
      { id: 1, source: 'проект.kml' },
      { id: 2, source: 'правки.kml' },
    ];
    expect(bySourceOrder(rows, ['правки.kml']).map((r) => r.id)).toEqual([2, 1]);
  });
});
