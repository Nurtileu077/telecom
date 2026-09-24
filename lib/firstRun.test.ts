import { describe, it, expect, beforeEach } from 'vitest';
import {
  STEPS, introSeen, markIntroSeen, resetIntro, shouldShowIntro, nextStep, stepLabel,
} from './firstRun';

/** В node нет window: подкладываем ровно то, чем пользуется модуль. */
function fakeWindow(): Map<string, string> {
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

describe('подсказки при первом входе', () => {
  it('три шага, а не десять: длинную инструкцию пролистывают не читая', () => {
    expect(STEPS).toHaveLength(3);
  });

  it('порядок тот, в котором систему и заводят', () => {
    expect(STEPS.map((s) => s.goto)).toEqual(['map', 'today', 'docs']);
  });

  it('у каждого шага есть и что сделать, и куда нажать', () => {
    for (const s of STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(20);
      expect(s.action).toBeTruthy();
    }
  });
});

describe('показывали или нет', () => {
  it('в первый раз — не показывали', () => {
    expect(introSeen()).toBe(false);
  });

  it('после показа больше не возвращается', () => {
    markIntroSeen();
    expect(introSeen()).toBe(true);
  });

  it('сброс возвращает: «а покажи, как это было»', () => {
    markIntroSeen();
    resetIntro();
    expect(introSeen()).toBe(false);
  });

  it('в приватном окне считаем, что показывали', () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => { throw new Error('заблокировано'); },
        setItem: () => { throw new Error('заблокировано'); },
        removeItem: () => { throw new Error('заблокировано'); },
      },
    };
    expect(introSeen()).toBe(true);
    expect(() => markIntroSeen()).not.toThrow();
    expect(() => resetIntro()).not.toThrow();
  });
});

describe('shouldShowIntro', () => {
  it('пустому журналу — показываем', () => {
    expect(shouldShowIntro({ routes: 0, entries: 0 }, false)).toBe(true);
  });

  it('тому, у кого уже есть трассы, — нет', () => {
    expect(shouldShowIntro({ routes: 12, entries: 0 }, false)).toBe(false);
  });

  it('и тому, у кого есть смены, — тоже нет', () => {
    expect(shouldShowIntro({ routes: 0, entries: 4 }, false)).toBe(false);
  });

  it('уже видевшему не показываем даже с пустым журналом', () => {
    expect(shouldShowIntro({ routes: 0, entries: 0 }, true)).toBe(false);
  });

  it('читает отметку сама, если её не передали', () => {
    expect(shouldShowIntro({ routes: 0, entries: 0 })).toBe(true);
    markIntroSeen();
    expect(shouldShowIntro({ routes: 0, entries: 0 })).toBe(false);
  });
});

describe('переход по шагам', () => {
  it('идёт по порядку и кончается', () => {
    expect(nextStep(0)).toBe(1);
    expect(nextStep(1)).toBe(2);
    expect(nextStep(2)).toBeNull();
  });

  it('человеку видно, сколько осталось', () => {
    expect(stepLabel(0)).toBe('Шаг 1 из 3');
    expect(stepLabel(2)).toBe('Шаг 3 из 3');
  });
});
