import { describe, it, expect } from 'vitest';
import { toCsv, csvCell, csvSeparator } from './csv';

describe('csvSeparator', () => {
  it('русский Excel ждёт точку с запятой', () => {
    expect(csvSeparator('excel-ru')).toBe(';');
    expect(csvSeparator('plain')).toBe(',');
  });
});

describe('csvCell', () => {
  it('обычный текст не кавычим: лишние кавычки читают люди', () => {
    expect(csvCell('Зеренда', ';')).toBe('Зеренда');
  });

  it('разделитель внутри значения — кавычим', () => {
    expect(csvCell('Зеренда; Серафимовка', ';')).toBe('"Зеренда; Серафимовка"');
    expect(csvCell('Зеренда, Серафимовка', ',')).toBe('"Зеренда, Серафимовка"');
  });

  it('кавычки внутри удваиваются', () => {
    expect(csvCell('ТОО "Дозер"', ';')).toBe('"ТОО ""Дозер"""');
  });

  it('перенос строки не разрывает запись', () => {
    expect(csvCell('первая\nвторая', ';')).toBe('"первая\nвторая"');
  });

  it('дробная часть по-русски — через запятую', () => {
    expect(csvCell(1.5, ';', true)).toBe('1,5');
    expect(csvCell(1.5, ',', false)).toBe('1.5');
  });

  it('пусто и мусор — пустая ячейка, а не «undefined»', () => {
    expect(csvCell(undefined, ';')).toBe('');
    expect(csvCell(null, ';')).toBe('');
    expect(csvCell(NaN, ';')).toBe('');
  });
});

describe('toCsv', () => {
  it('шапка и строки через выбранный разделитель', () => {
    const csv = toCsv(['Дата', 'Участок', 'Метры'], [
      ['2026-07-25', 'Зеренда', 480],
    ]);
    expect(csv.split('\r\n')[0]).toBe('Дата;Участок;Метры');
    expect(csv.split('\r\n')[1]).toBe('2026-07-25;Зеренда;480');
  });

  it('для Google Таблиц — запятая и точка в дробях', () => {
    const csv = toCsv(['А', 'Б'], [['х', 1.5]], { dialect: 'plain' });
    expect(csv.split('\r\n')[1]).toBe('х,1.5');
  });

  it('пустая выгрузка — только шапка', () => {
    expect(toCsv(['А'], []).split('\r\n')).toHaveLength(1);
  });
});
