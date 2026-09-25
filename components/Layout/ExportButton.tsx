'use client';
import { useState } from 'react';
import { Download, Copy, Check } from 'lucide-react';
import { toCsv, csvBlob, type CsvDialect } from '@/lib/csv';
import { downloadBlob } from '@/lib/download';
import {
  tableRows, tableToTabs, footerRow, exportFileName,
  type ExportColumn, type FooterValues,
} from '@/lib/tableExport';

export type { ExportColumn };

/**
 * Выгрузить то, что на экране.
 *
 * Любую таблицу, какой её сейчас видно: с тем же отбором, той же
 * сортировкой, теми же колонками. Это важнее, чем «выгрузить всё»:
 * человек уже отобрал нужное глазами, и повторять этот отбор в Excel
 * он не станет — проще переписать руками.
 *
 * Два выхода, потому что путь у файла разный. Скачанный файл идёт в
 * почту заказчику. Скопированное уходит в чат бригады, где файл никто
 * не откроет.
 */

interface Props<T> {
  rows: T[];
  columns: ExportColumn<T>[];
  /** Имя файла без расширения. */
  name: string;
  /**
   * Строка итогов, если она есть на экране: в файле она тоже нужна.
   * Задаётся подписями колонок, а не порядком — промахнуться нечем.
   */
  footer?: FooterValues;
  dialect?: CsvDialect;
  onFlash?: (text: string) => void;
  compact?: boolean;
}

export default function ExportButton<T>({
  rows, columns, name, footer, dialect = 'excel-ru', onFlash, compact,
}: Props<T>) {
  const [copied, setCopied] = useState(false);
  const empty = rows.length === 0;

  function build(d: CsvDialect): string {
    const body = tableRows(rows, columns);
    if (footer) body.push(footerRow(columns, footer));
    return toCsv(columns.map((c) => c.header), body, { dialect: d });
  }

  function save() {
    downloadBlob(exportFileName(name), csvBlob(build(dialect), dialect));
    onFlash?.(`Выгружено строк: ${rows.length}`);
  }

  async function copy() {
    const text = tableToTabs(rows, columns, footer);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onFlash?.('Таблица скопирована');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Скопируйте таблицу вручную:', text);
    }
  }

  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        className={`btn btn-ghost ${compact ? 'btn-icon' : 'text-[11px]'}`}
        disabled={empty}
        onClick={save}
        title={empty ? 'Выгружать нечего' : `Выгрузить в файл: строк ${rows.length}`}
      >
        <Download size={13} />
        {compact ? null : 'В файл'}
      </button>
      <button
        type="button"
        className={`btn btn-ghost ${compact ? 'btn-icon' : 'text-[11px]'}`}
        disabled={empty}
        onClick={copy}
        title={empty ? 'Копировать нечего' : 'Скопировать, чтобы вставить в чат или таблицу'}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {compact ? null : copied ? 'Скопировано' : 'Скопировать'}
      </button>
    </span>
  );
}
