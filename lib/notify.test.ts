import { describe, it, expect, beforeEach } from 'vitest';
import {
  notifyState, alreadyNotified, markNotified, notifyOnce,
} from './notify';

function fakeWindow(withNotification: boolean, permission = 'granted') {
  const store = new Map<string, string>();
  const shown: { title: string; tag?: string }[] = [];
  const w: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  };
  if (withNotification) {
    const Ctor = function Notification(this: unknown, title: string, opts?: { tag?: string }) {
      shown.push({ title, tag: opts?.tag });
    } as unknown as { permission: string };
    Ctor.permission = permission;
    w.Notification = Ctor;
  }
  (globalThis as { window?: unknown }).window = w;
  (globalThis as { Notification?: unknown }).Notification = w.Notification;
  return { store, shown };
}

describe('notifyState', () => {
  it('без поддержки так и говорит', () => {
    fakeWindow(false);
    expect(notifyState()).toBe('unsupported');
  });

  it('с поддержкой возвращает разрешение браузера', () => {
    fakeWindow(true, 'denied');
    expect(notifyState()).toBe('denied');
  });
});

describe('одно напоминание в день', () => {
  beforeEach(() => { fakeWindow(true, 'granted'); });

  it('первый раз показываем, второй — нет', () => {
    expect(alreadyNotified('r1', '2026-07-25')).toBe(false);
    markNotified('r1', '2026-07-25');
    expect(alreadyNotified('r1', '2026-07-25')).toBe(true);
  });

  it('назавтра напоминаем снова', () => {
    markNotified('r1', '2026-07-25');
    expect(alreadyNotified('r1', '2026-07-26')).toBe(false);
  });

  it('старые отметки не копятся за сезон', () => {
    markNotified('r1', '2026-07-01');
    markNotified('r2', '2026-07-25');
    const raw = JSON.parse(
      (globalThis as { window: { localStorage: { getItem(k: string): string | null } } })
        .window.localStorage.getItem('optiq-notified-v1') ?? '{}',
    );
    expect(raw.r1).toBeUndefined();
    expect(raw.r2).toBe('2026-07-25');
  });
});

describe('notifyOnce', () => {
  it('показывает только то, о чём сегодня не говорили', () => {
    const { shown } = fakeWindow(true, 'granted');
    const items = [
      { id: 'a', title: 'Срок', body: 'Согласование истекает' },
      { id: 'b', title: 'Срок', body: 'Допуск истекает' },
    ];
    expect(notifyOnce(items, '2026-07-25')).toBe(2);
    expect(shown).toHaveLength(2);
    expect(notifyOnce(items, '2026-07-25')).toBe(0);
  });

  it('без разрешения молчит, а не падает', () => {
    fakeWindow(true, 'default');
    expect(notifyOnce([{ id: 'a', title: 'т', body: 'б' }], '2026-07-25')).toBe(0);
  });

  it('без поддержки молчит', () => {
    fakeWindow(false);
    expect(notifyOnce([{ id: 'a', title: 'т', body: 'б' }], '2026-07-25')).toBe(0);
  });

  it('пустой список — ноль, а не ошибка', () => {
    fakeWindow(true, 'granted');
    expect(notifyOnce([], '2026-07-25')).toBe(0);
  });
});
