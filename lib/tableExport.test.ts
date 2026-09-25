import { describe, it, expect } from 'vitest';
import {
  tableRows, tableToTabs, footerRow, strayFooterKeys, exportFileName,
  type ExportColumn, type FooterValues,
} from './tableExport';
import { toCsv } from './csv';

interface Row { name: string; meters: number; note?: string }

const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Участок', value: (r) => r.name },
  { header: 'Метры', value: (r) => r.meters },
  { header: 'Примечание', value: (r) => r.note },
];

const ROWS: Row[] = [
  { name: 'Зеренда — Серафимовка', meters: 1240 },
  { name: 'Исаковка', meters: 860, note: 'скальный грунт' },
];

describe('tableRows', () => {
  it('раскладывает строки по колонкам в том же порядке', () => {
    expect(tableRows(ROWS, COLUMNS)).toEqual([
      ['Зеренда — Серафимовка', 1240, undefined],
      ['Исаковка', 860, 'скальный грунт'],
    ]);
  });

  it('метры остаются числом — по ним в Excel считают', () => {
    const [first] = tableRows(ROWS, COLUMNS);
    expect(typeof first[1]).toBe('number');
  });

  it('пустая таблица даёт пустой список, а не строку из пустот', () => {
    expect(tableRows([], COLUMNS)).toEqual([]);
  });
});

describe('выгрузка целиком', () => {
  const build = (rows: Row[], footer?: FooterValues) => {
    const body = tableRows(rows, COLUMNS);
    if (footer) body.push(footerRow(COLUMNS, footer));
    return toCsv(COLUMNS.map((c) => c.header), body);
  };

  it('в первой строке — заголовки, как на экране', () => {
    expect(build(ROWS).split('\r\n')[0]).toBe('Участок;Метры;Примечание');
  });

  it('тире в названии не ломает разметку', () => {
    expect(build(ROWS)).toContain('Зеренда — Серафимовка');
  });

  it('итог из подвала тоже попадает в файл', () => {
    const lines = build(ROWS, { 'Участок': 'Итого', 'Метры': 2100 }).split('\r\n');
    expect(lines[lines.length - 1]).toBe('Итого;2100;');
  });

  it('точка с запятой в тексте не расползается по колонкам', () => {
    const tricky: Row[] = [{ name: 'Аксу; Карабулак', meters: 100 }];
    const line = build(tricky).split('\r\n')[1];
    expect(line).toBe('"Аксу; Карабулак";100;');
  });

  it('в каждой строке столько же колонок, сколько в заголовке', () => {
    const lines = build(ROWS, { 'Участок': 'Итого', 'Метры': 2100 }).split('\r\n');
    for (const l of lines) {
      // Разделители внутри кавычек не считаем.
      const outside = l.replace(/"[^"]*"/g, '');
      expect(outside.split(';').length).toBe(COLUMNS.length);
    }
  });
});

describe('tableToTabs', () => {
  it('колонки разделены табуляцией — так их принимают таблицы', () => {
    expect(tableToTabs(ROWS, COLUMNS).split('\n')[0]).toBe('Участок\tМетры\tПримечание');
  });

  it('пустая ячейка остаётся пустой, а не «undefined»', () => {
    expect(tableToTabs(ROWS, COLUMNS)).not.toContain('undefined');
  });

  it('итог из подвала попадает и в буфер', () => {
    const lines = tableToTabs(ROWS, COLUMNS, { 'Участок': 'Итого', 'Метры': 2100 }).split('\n');
    expect(lines[lines.length - 1]).toBe('Итого\t2100\t');
  });
});

describe('exportFileName', () => {
  it('в имени видно, что выгрузили и на какое число', () => {
    expect(exportFileName('Табель', '2026-07-31')).toBe('Табель 2026-07-31.csv');
  });

  it('убирает то, чего файловая система не примет', () => {
    const name = exportFileName('Расчёт: TERRA/TECH', '2026-07-31');
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toContain('TERRA');
  });

  it('безымянная таблица всё равно получает имя', () => {
    expect(exportFileName('   ', '2026-07-31')).toBe('Таблица 2026-07-31.csv');
  });
});

/**
 * Позиционным массивом итог задавать нельзя: колонок семь, в массиве
 * шесть — и «смен» встаёт в «подрядчика», а «метры» в «дни». Ошибка
 * невидима на экране и видна только в файле, который уже ушёл в
 * бухгалтерию.
 */
describe('строка итогов по подписям колонок', () => {
  it('значение встаёт под свою колонку, а не по счёту', () => {
    expect(footerRow(COLUMNS, { 'Метры': 2100 })).toEqual([undefined, 2100, undefined]);
  });

  it('порядок ключей в итоге ничего не решает', () => {
    const a = footerRow(COLUMNS, { 'Метры': 2100, 'Участок': 'Итого' });
    const b = footerRow(COLUMNS, { 'Участок': 'Итого', 'Метры': 2100 });
    expect(a).toEqual(b);
    expect(a).toEqual(['Итого', 2100, undefined]);
  });

  it('пустой итог даёт пустую строку, а не ломает длину', () => {
    expect(footerRow(COLUMNS, {})).toHaveLength(COLUMNS.length);
  });

  it('длина строки итогов всегда равна числу колонок', () => {
    for (const f of [{}, { 'Метры': 1 }, { 'Участок': 'а', 'Метры': 1, 'Примечание': 'б' }]) {
      expect(footerRow(COLUMNS, f)).toHaveLength(COLUMNS.length);
    }
  });

  it('опечатка в подписи видна, а не проглатывается', () => {
    expect(strayFooterKeys(COLUMNS, { 'Метры': 1, 'Метраж': 2 })).toEqual(['Метраж']);
    expect(strayFooterKeys(COLUMNS, { 'Метры': 1 })).toEqual([]);
  });
});
