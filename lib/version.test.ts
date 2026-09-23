import { describe, it, expect, beforeEach } from 'vitest';
import {
  APP_VERSION, WHATS_NEW, hasNews, lastSeenVersion, markVersionSeen,
} from './version';

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

beforeEach(() => { fakeWindow(); });

describe('версия', () => {
  it('у версии есть номер и короткий список изменений', () => {
    expect(APP_VERSION).toMatch(/^\d{4}\.\d{2}$/);
    expect(WHATS_NEW.length).toBeGreaterThan(3);
    expect(WHATS_NEW.length).toBeLessThan(20);
  });

  it('первый заход — не новость, а начало', () => {
    expect(hasNews(null)).toBe(false);
  });

  it('версия сменилась — есть что показать', () => {
    expect(hasNews('2026.01')).toBe(true);
    expect(hasNews(APP_VERSION)).toBe(false);
  });

  it('отметка запоминается', () => {
    expect(lastSeenVersion()).toBeNull();
    markVersionSeen();
    expect(lastSeenVersion()).toBe(APP_VERSION);
  });
});
