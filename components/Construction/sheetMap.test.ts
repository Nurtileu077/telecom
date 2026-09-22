import { describe, it, expect } from 'vitest';
import {
  guessHeaderRow, guessMapping, rowsToEntries, missingRequired, SHEET_FIELDS,
} from './sheetMap';

const BOOK: unknown[][] = [
  ['Журнал производства работ', '', '', ''],
  [],
  ['Дата', 'Участок', 'Подрядчик', 'Проложено, м', 'ГНБ, м'],
  ['25.07.2026', 'Зеренда — Серафимовка', 'Дозер', 480, 72],
  ['26.07.2026', 'Зеренда — Серафимовка', 'Дозер', 1200, ''],
  ['', '', '', '', ''],
  ['27.07.2026', '', 'Дозер', 300, ''],
];

describe('guessHeaderRow', () => {
  it('находит шапку под названием объекта', () => {
    expect(guessHeaderRow(BOOK)).toBe(2);
  });

  it('строка из одних чисел шапкой не считается', () => {
    expect(guessHeaderRow([[1, 2, 3, 4, 5], ['Дата', 'Участок', 'Метры']])).toBe(1);
  });

  it('пустая книга — нулевая строка, а не падение', () => {
    expect(guessHeaderRow([])).toBe(0);
  });
});

describe('guessMapping', () => {
  it('узнаёт колонки по названиям', () => {
    const m = guessMapping(BOOK[2]);
    expect(m.date).toBe(0);
    expect(m.uchastok).toBe(1);
    expect(m.contractor).toBe(2);
    expect(m.meters).toBe(3);
    expect(m.drillM).toBe(4);
  });

  it('одна колонка не достаётся двум полям', () => {
    const m = guessMapping(['Дата', 'Объект', 'Бар, м', 'Итого, м']);
    expect(m['бар']).toBe(2);
    expect(m.meters).toBe(3);
  });

  it('понимает чужие слова: «число», «объект», «выполнение»', () => {
    const m = guessMapping(['Число', 'Объект', 'Выполнено, м']);
    expect(m.date).toBe(0);
    expect(m.uchastok).toBe(1);
    expect(m.meters).toBe(2);
  });

  it('чего нет — того нет, выдумывать не станем', () => {
    const m = guessMapping(['Колонка А', 'Колонка Б']);
    expect(m.date).toBeUndefined();
    expect(m.uchastok).toBeUndefined();
  });
});

describe('rowsToEntries', () => {
  const mapping = guessMapping(BOOK[2]);

  it('превращает строки в записи', () => {
    const res = rowsToEntries(BOOK, 2, mapping);
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0].date).toBe('2026-07-25');
    expect(res.entries[0].uchastok).toBe('Зеренда — Серафимовка');
    expect(res.entries[0].drillM).toBe(72);
  });

  it('общие метры кладёт в выбранный способ', () => {
    const res = rowsToEntries(BOOK, 2, mapping, { defaultMethod: 'бар' });
    expect(res.entries[0].byMethod['бар']).toBe(480);
  });

  it('колонки по способам важнее общей', () => {
    const rows: unknown[][] = [
      ['Дата', 'Участок', 'Бар, м', 'Итого, м'],
      ['25.07.2026', 'У1', 300, 300],
    ];
    const res = rowsToEntries(rows, 0, guessMapping(rows[0]));
    expect(res.entries[0].byMethod['бар']).toBe(300);
    expect(res.entries[0].byMethod['кабелеукладчик']).toBeUndefined();
  });

  it('пропущенные строки называет поимённо', () => {
    const res = rowsToEntries(BOOK, 2, mapping);
    expect(res.skipped).toEqual([{ row: 7, why: 'нет участка' }]);
  });

  it('строку без метров не считает сменой', () => {
    const rows: unknown[][] = [
      ['Дата', 'Участок', 'Метры'],
      ['25.07.2026', 'У1', 0],
    ];
    const res = rowsToEntries(rows, 0, guessMapping(rows[0]));
    expect(res.entries).toHaveLength(0);
    expect(res.skipped[0].why).toBe('нет метров');
  });

  it('читает дату и числом Excel, и текстом', () => {
    const rows: unknown[][] = [
      ['Дата', 'Участок', 'Метры'],
      [46228, 'У1', 100],           // 25.07.2026 в счислении Excel
      [new Date('2026-07-26T00:00:00Z'), 'У1', 100],
    ];
    const res = rowsToEntries(rows, 0, guessMapping(rows[0]));
    expect(res.entries[0].date).toBe('2026-07-25');
    expect(res.entries[1].date).toBe('2026-07-26');
  });

  it('«1,2 км» в чужой таблице — это 1200 м', () => {
    const rows: unknown[][] = [
      ['Дата', 'Участок', 'Метры'],
      ['25.07.2026', 'У1', '1,2 км'],
    ];
    const res = rowsToEntries(rows, 0, guessMapping(rows[0]));
    expect(res.entries[0].byMethod['кабелеукладчик']).toBe(1200);
  });
});

describe('missingRequired', () => {
  it('говорит, чего не хватает', () => {
    expect(missingRequired({})).toEqual(['date', 'uchastok']);
    expect(missingRequired(guessMapping(BOOK[2]))).toEqual([]);
  });

  it('обязательных полей ровно два — остальное необязательно', () => {
    const required = Object.entries(SHEET_FIELDS)
      .filter(([, spec]) => spec.required).map(([k]) => k);
    expect(required).toEqual(['date', 'uchastok']);
  });
});
