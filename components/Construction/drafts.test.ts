import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDraft, loadDraft, clearDraft, draftAge, draftWorthKeeping, DRAFT_TTL_HOURS,
} from './drafts';

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

let store: Map<string, string>;
beforeEach(() => { store = fakeWindow(); });

describe('черновики', () => {
  it('сохранённое возвращается как было', () => {
    saveDraft('day', { uchastok: 'Зеренда — Серафимовка', meters: 480 });
    expect(loadDraft<{ uchastok: string; meters: number }>('day')?.data)
      .toEqual({ uchastok: 'Зеренда — Серафимовка', meters: 480 });
  });

  it('пусто — значит нечего продолжать', () => {
    expect(loadDraft('нет')).toBeNull();
  });

  it('мусор в хранилище не роняет форму', () => {
    store.set('optiq-draft-day', '{не json');
    expect(loadDraft('day')).toBeNull();
  });

  it('старый черновик не предлагаем и стираем', () => {
    saveDraft('day', { a: 1 });
    const later = new Date(Date.now() + (DRAFT_TTL_HOURS + 1) * 3600 * 1000);
    expect(loadDraft('day', later)).toBeNull();
    // И его больше нет — второй раз спрашивать не о чем.
    expect(store.get('optiq-draft-day')).toBeUndefined();
  });

  it('стереть можно и руками', () => {
    saveDraft('day', { a: 1 });
    clearDraft('day');
    expect(loadDraft('day')).toBeNull();
  });
});

describe('draftAge', () => {
  it('говорит словами, а не отметкой времени', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    expect(draftAge('2026-07-25T11:58:00Z', now)).toBe('2 мин назад');
    expect(draftAge('2026-07-25T09:00:00Z', now)).toBe('3 ч назад');
    expect(draftAge('2026-07-23T12:00:00Z', now)).toBe('2 дн назад');
  });

  it('только что — это только что', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    expect(draftAge('2026-07-25T12:00:00Z', now)).toBe('только что');
    expect(draftAge('ерунда', now)).toBe('только что');
  });
});

describe('draftWorthKeeping', () => {
  it('три заполненных поля — уже работа', () => {
    expect(draftWorthKeeping({
      date: '2026-07-25', smu: 'СМУ-1', uchastok: 'У1', byMethod: { 'бар': 100 },
    })).toBe(true);
  });

  it('открыли и закрыли — предлагать нечего', () => {
    expect(draftWorthKeeping({ date: '2026-07-25', oblast: 'Акмолинская область' })).toBe(false);
    expect(draftWorthKeeping({})).toBe(false);
  });

  it('пустые объекты за заполненное не считаются', () => {
    expect(draftWorthKeeping({
      smu: 'СМУ-1', byMethod: {}, materials: {}, note: '',
    })).toBe(false);
  });
});
