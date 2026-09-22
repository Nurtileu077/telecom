import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadErrors, saveErrors, noteError, ERROR_LIMIT,
  fmtBytes, problemReport, statusLine, type Diagnostics,
} from './diagnostics';

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

const D: Diagnostics = {
  version: '2026.07.1',
  online: false,
  agent: 'Chrome 130 Android',
  screen: '412×915',
  storage: { usedBytes: 4_500_000, quotaBytes: 50_000_000, share: 0.09 },
  pendingEntries: 3,
  pendingPhotos: 12,
  lastSyncAt: '2026-07-25T08:00:00.000Z',
  errors: [
    { at: '2026-07-25T09:00:00.000Z', message: 'Не удалось сохранить', where: 'app.js:42' },
  ],
};

describe('журнал ошибок', () => {
  it('записывает и переживает перезагрузку', () => {
    const list = noteError([], { at: '2026-07-25T09:00:00.000Z', message: 'Ошибка' });
    saveErrors(list);
    expect(loadErrors()).toHaveLength(1);
  });

  it('одна и та же ошибка подряд не копится', () => {
    const one = noteError([], { at: '1', message: 'Ошибка' });
    const two = noteError(one, { at: '2', message: 'Ошибка' });
    expect(two).toHaveLength(1);
  });

  it('разные ошибки копятся, но не бесконечно', () => {
    let list: ReturnType<typeof noteError> = [];
    for (let i = 0; i < ERROR_LIMIT + 10; i++) {
      list = noteError(list, { at: String(i), message: `Ошибка ${i}` });
    }
    expect(list).toHaveLength(ERROR_LIMIT);
  });

  it('мусор в хранилище не ломает список', () => {
    store.set('optiq-errors-v1', 'не json');
    expect(loadErrors()).toEqual([]);
  });
});

describe('fmtBytes', () => {
  it('переводит в понятные единицы', () => {
    expect(fmtBytes(512)).toBe('512 Б');
    expect(fmtBytes(2048)).toBe('2 КБ');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 МБ');
    expect(fmtBytes(undefined)).toBe('—');
  });
});

describe('problemReport', () => {
  it('добавляет к словам человека то, что система знает про себя', () => {
    const text = problemReport(D, 'Не сохраняется смена');
    expect(text).toContain('Не сохраняется смена');
    expect(text).toContain('Версия: 2026.07.1');
    expect(text).toContain('Связь: нет');
    expect(text).toContain('Не отправлено: записей 3, фотографий 12');
    expect(text).toContain('Не удалось сохранить');
  });

  it('пустое описание называется пустым, а не пропускается', () => {
    expect(problemReport(D, '   ')).toContain('описание не заполнено');
  });

  it('без ошибок раздела ошибок нет', () => {
    expect(problemReport({ ...D, errors: [] }, 'что-то')).not.toContain('Последние ошибки');
  });
});

describe('statusLine', () => {
  it('говорит главное одной строкой', () => {
    expect(statusLine(D)).toContain('связи нет');
    expect(statusLine(D)).toContain('не отправлено 3');
  });

  it('про переполненное хранилище предупреждает', () => {
    expect(statusLine({ ...D, storage: { share: 0.92 } })).toContain('92%');
  });

  it('всё в порядке — короткая строка', () => {
    expect(statusLine({
      ...D, online: true, pendingEntries: 0, errors: [], storage: {},
    })).toBe('связь есть');
  });
});
