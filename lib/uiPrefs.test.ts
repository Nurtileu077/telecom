import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadUiPrefs, saveUiPrefs, clampScale, isDaylight, effectiveTheme,
  DEFAULT_UI_PREFS, MIN_SCALE, MAX_SCALE,
} from './uiPrefs';

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

describe('настройки вида', () => {
  it('что сохранили, то и прочитали', () => {
    saveUiPrefs({ theme: 'light', density: 'compact', scale: 1.2, byClock: true });
    expect(loadUiPrefs()).toEqual({
      theme: 'light', density: 'compact', scale: 1.2, byClock: true,
    });
  });

  it('пусто — значения по умолчанию', () => {
    expect(loadUiPrefs()).toEqual(DEFAULT_UI_PREFS);
  });

  it('мусор в хранилище не ломает приложение', () => {
    store.set('optiq-ui-prefs-v1', '{не json');
    expect(loadUiPrefs()).toEqual(DEFAULT_UI_PREFS);
  });

  it('чужие значения приводятся к допустимым', () => {
    store.set('optiq-ui-prefs-v1', JSON.stringify({ theme: 'розовая', density: 'x', scale: 99 }));
    const p = loadUiPrefs();
    expect(p.theme).toBe('dark');
    expect(p.density).toBe('comfortable');
    expect(p.scale).toBe(MAX_SCALE);
  });
});

describe('clampScale', () => {
  it('держит масштаб в разумных пределах', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(9)).toBe(MAX_SCALE);
    expect(clampScale(NaN)).toBe(1);
  });

  it('округляет до пяти сотых — ползунок не должен давать 1,0333', () => {
    expect(clampScale(1.0333)).toBe(1.05);
  });
});

describe('isDaylight', () => {
  it('днём светло, ночью нет', () => {
    expect(isDaylight(new Date('2026-07-25T12:00:00'))).toBe(true);
    expect(isDaylight(new Date('2026-07-25T22:00:00'))).toBe(false);
    expect(isDaylight(new Date('2026-07-25T06:00:00'))).toBe(false);
  });
});

describe('effectiveTheme', () => {
  const base = { ...DEFAULT_UI_PREFS };

  it('явный выбор важнее всего', () => {
    expect(effectiveTheme({ ...base, theme: 'light' })).toBe('light');
    expect(effectiveTheme({ ...base, theme: 'dark' }, { systemDark: false })).toBe('dark');
  });

  it('«как в системе» слушает систему', () => {
    expect(effectiveTheme({ ...base, theme: 'auto' }, { systemDark: false })).toBe('light');
    expect(effectiveTheme({ ...base, theme: 'auto' }, { systemDark: true })).toBe('dark');
  });

  it('по часам важнее и выбора, и системы', () => {
    const prefs = { ...base, theme: 'dark' as const, byClock: true };
    expect(effectiveTheme(prefs, { now: new Date('2026-07-25T12:00:00') })).toBe('light');
    expect(effectiveTheme(prefs, { now: new Date('2026-07-25T23:00:00') })).toBe('dark');
  });

  it('система молчит — остаёмся тёмными', () => {
    expect(effectiveTheme({ ...base, theme: 'auto' })).toBe('dark');
  });
});
