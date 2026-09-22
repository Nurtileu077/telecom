import { describe, it, expect, beforeEach } from 'vitest';
import { demoJournal, demoSummary, isDemoMode, setDemoMode } from './demoData';
import { entryMeters } from './entriesTable';

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

const NOW = new Date('2026-07-25T10:00:00Z');

describe('demoJournal', () => {
  it('при каждом запуске одинаковый: иначе его не обсудить', () => {
    const a = demoJournal(NOW);
    const b = demoJournal(NOW);
    expect(a.ground.length).toBe(b.ground.length);
    expect(a.ground.map(entryMeters)).toEqual(b.ground.map(entryMeters));
  });

  it('месяц смен, а не одна', () => {
    const j = demoJournal(NOW);
    expect(j.ground.length).toBeGreaterThan(30);
    const days = new Set(j.ground.map((e) => e.date));
    expect(days.size).toBeGreaterThan(15);
  });

  it('есть всё, ради чего его показывают', () => {
    const j = demoJournal(NOW);
    expect(j.crews.length).toBeGreaterThan(0);
    expect(j.planRoutes.length).toBeGreaterThan(0);
    expect(j.objects.length).toBeGreaterThan(0);
    expect(j.rates.length).toBeGreaterThan(0);
    expect(j.drills.length).toBeGreaterThan(0);
    expect(j.deviations.length).toBeGreaterThan(0);
  });

  it('видно и работу, и простой — иначе картинка неправдивая', () => {
    const j = demoJournal(NOW);
    expect(j.ground.some((e) => entryMeters(e) > 0)).toBe(true);
    expect(j.ground.some((e) => e.downtime)).toBe(true);
  });

  it('данные подписаны показательными: на них нельзя сослаться в отчёте', () => {
    const j = demoJournal(NOW);
    expect(j.ground.every((e) => e.author === 'Показательные данные')).toBe(true);
  });

  it('смены не выходят за последний месяц', () => {
    const j = demoJournal(NOW);
    const dates = j.ground.map((e) => e.date).sort();
    expect(dates[0] >= '2026-06-25').toBe(true);
    expect(dates[dates.length - 1] <= '2026-07-25').toBe(true);
  });
});

describe('demoSummary', () => {
  it('описывает, что внутри', () => {
    expect(demoSummary(demoJournal(NOW))).toContain('смен');
  });
});

describe('показательный режим', () => {
  beforeEach(() => { fakeWindow(); });

  it('включается и выключается', () => {
    expect(isDemoMode()).toBe(false);
    setDemoMode(true);
    expect(isDemoMode()).toBe(true);
    setDemoMode(false);
    expect(isDemoMode()).toBe(false);
  });
});
