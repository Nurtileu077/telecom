/**
 * CSV — то, что читают все остальные программы.
 *
 * Бухгалтерия работает в 1С, руководитель смотрит в Google Таблицах, а
 * заказчик просит «выгрузите в эксель». Писать интеграцию с каждым —
 * это годы; отдать таблицу, которую они и так умеют читать, — один
 * файл.
 *
 * Тонкостей ровно две: разделитель и кодировка. Русский Excel ждёт
 * точку с запятой и BOM, Google Таблицы — запятую и UTF-8. Ошибиться
 * здесь значит получить всё в одной колонке.
 */

export type CsvDialect = 'excel-ru' | 'plain';

export interface CsvOptions {
  dialect?: CsvDialect;
  /** Разделитель дробной части: в русском Excel это запятая. */
  decimalComma?: boolean;
}

export function csvSeparator(dialect: CsvDialect): string {
  return dialect === 'excel-ru' ? ';' : ',';
}

/**
 * Одна ячейка.
 *
 * Кавычим только тогда, когда без этого строка распадётся: лишние
 * кавычки читаются людьми и мешают не меньше, чем сломанная разметка.
 */
export function csvCell(
  value: unknown,
  separator: string,
  decimalComma = false,
): string {
  if (value === undefined || value === null) return '';

  let s: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    s = String(value);
    if (decimalComma) s = s.replace('.', ',');
  } else {
    s = String(value);
  }

  if (s.includes('"')) s = s.replace(/"/g, '""');
  const needsQuotes = s.includes(separator) || s.includes('\n') || s.includes('\r')
    || s.includes('"') || s.startsWith(' ') || s.endsWith(' ');
  return needsQuotes ? `"${s}"` : s;
}

export function toCsv(
  headers: string[],
  rows: unknown[][],
  opts: CsvOptions = {},
): string {
  const dialect = opts.dialect ?? 'excel-ru';
  const sep = csvSeparator(dialect);
  const decimalComma = opts.decimalComma ?? dialect === 'excel-ru';

  const line = (cells: unknown[]) => cells
    .map((c) => csvCell(c, sep, decimalComma))
    .join(sep);

  // Перевод строки — CRLF: так его понимают и Excel, и всё остальное.
  return [line(headers), ...rows.map(line)].join('\r\n');
}

/**
 * BOM нужен русскому Excel: без него кириллица открывается кракозябрами,
 * и первое, что делает человек, — закрывает файл.
 */
export function csvBlob(text: string, dialect: CsvDialect = 'excel-ru'): Blob {
  const parts = dialect === 'excel-ru' ? ['﻿', text] : [text];
  return new Blob(parts, { type: 'text/csv;charset=utf-8' });
}
