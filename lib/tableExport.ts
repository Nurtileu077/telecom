/**
 * Выгрузить то, что на экране.
 *
 * Любую таблицу, какой её сейчас видно: с тем же отбором, той же
 * сортировкой, теми же колонками. Это важнее, чем «выгрузить всё»:
 * человек уже отобрал нужное глазами, и повторять этот отбор в Excel он
 * не станет — проще переписать руками.
 *
 * Здесь только раскладка по колонкам, без кнопок: её и проверяют.
 */

export interface ExportColumn<T> {
  header: string;
  /** Что положить в ячейку. Число остаётся числом: в Excel по нему считают. */
  value: (row: T) => string | number | undefined;
}

export function tableRows<T>(rows: T[], columns: ExportColumn<T>[]): unknown[][] {
  return rows.map((r) => columns.map((c) => c.value(r)));
}

/**
 * Для буфера обмена — табуляцией.
 *
 * Так строки ложатся по колонкам и в Excel, и в Google Таблицах, куда
 * их чаще всего и вставляют, и остаются читаемыми в чате, где таблицы
 * нет вовсе.
 */
/**
 * Строка итогов по подписям колонок.
 *
 * Позиционным массивом её задавать нельзя: колонок семь, в массиве
 * шесть, и «смен» встаёт в «подрядчика», а «метры» — в «дни». Ошибка
 * невидима на экране и видна только в файле, который уже ушёл в
 * бухгалтерию.
 *
 * Поэтому итог задаётся тем же словом, что стоит в шапке: промахнуться
 * нечем, а лишний ключ виден сразу.
 */
export type FooterValues = Record<string, string | number | undefined>;

export function footerRow<T>(
  columns: ExportColumn<T>[],
  footer: FooterValues,
): (string | number | undefined)[] {
  return columns.map((c) => footer[c.header]);
}

/** Подписи из итога, которых нет среди колонок: опечатка, а не итог. */
export function strayFooterKeys<T>(
  columns: ExportColumn<T>[],
  footer: FooterValues,
): string[] {
  const known = new Set(columns.map((c) => c.header));
  return Object.keys(footer).filter((k) => !known.has(k));
}

export function tableToTabs<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  footer?: FooterValues,
): string {
  const body = tableRows(rows, columns);
  if (footer) body.push(footerRow(columns, footer));
  return [columns.map((c) => c.header), ...body]
    .map((line) => line.map((v) => (v === undefined ? '' : String(v))).join('\t'))
    .join('\n');
}

/** Имя файла: что выгрузили и на какое число. */
export function exportFileName(name: string, date = new Date().toISOString().slice(0, 10)): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Таблица';
  return `${safe} ${date}.csv`;
}
