'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { LAY_METHODS, LAY_METHOD_LABEL, type LayMethod, type DailyWorkEntry } from '@/types/construction';
import {
  guessHeaderRow, guessMapping, rowsToEntries, missingRequired,
  SHEET_FIELDS, SHEET_FIELD_LIST, type SheetMapping, type SheetField,
} from './sheetMap';

/**
 * Загрузка чужой таблицы.
 *
 * У каждого прораба своя книга, и переделывать её под нашу форму он не
 * станет — он ведёт её три года. Колонки угадываем, но показываем, что
 * угадали: перепутанная колонка — это не кривой импорт, а неверные
 * метры в акте.
 */

interface Props {
  file: File;
  oblast?: string;
  author?: string;
  onDone: (entries: DailyWorkEntry[]) => void;
  onClose: () => void;
}

type Sheet = { name: string; rows: unknown[][] };

export default function SheetImport({ file, oblast, author, onDone, onClose }: Props) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<SheetMapping>({});
  const [method, setMethod] = useState<LayMethod>('кабелеукладчик');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        const list = wb.SheetNames.map((name) => ({
          name,
          rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as unknown[][],
        })).filter((s) => s.rows.length > 1);
        if (!alive) return;
        if (list.length === 0) { setError('В книге нет заполненных листов'); return; }
        setSheets(list);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Не удалось прочитать книгу');
      }
    })();
    return () => { alive = false; };
  }, [file]);

  // Лист сменили — шапку и раскладку колонок ищем заново.
  useEffect(() => {
    const sheet = sheets?.[active];
    if (!sheet) return;
    const h = guessHeaderRow(sheet.rows);
    setHeaderRow(h);
    setMapping(guessMapping(sheet.rows[h] ?? []));
  }, [sheets, active]);

  const sheet = sheets?.[active];
  const headers = (sheet?.rows[headerRow] ?? []).map((v) => String(v ?? '').trim());

  const result = useMemo(() => {
    if (!sheet) return { entries: [], skipped: [] };
    return rowsToEntries(sheet.rows, headerRow, mapping, {
      defaultMethod: method, oblast, author,
    });
  }, [sheet, headerRow, mapping, method, oblast, author]);

  const missing = missingRequired(mapping);
  const byMethodMapped = LAY_METHODS.some((m) => mapping[m] !== undefined);

  function setField(field: SheetField, value: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (value === '') delete next[field];
      else {
        const col = Number(value);
        // Одна колонка — одно поле: иначе метры удвоятся.
        for (const k of Object.keys(next) as SheetField[]) {
          if (next[k] === col) delete next[k];
        }
        next[field] = col;
      }
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-stretch sm:items-center sm:justify-center sm:p-4">
      <div className="bg-[var(--bg-surface)] w-full sm:max-w-[760px] sm:rounded-xl
                      border border-[var(--border)] flex flex-col max-h-full sm:max-h-[90vh]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0"
             style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text)]">Загрузка таблицы</h3>
            <p className="text-[11px] text-[var(--text-muted)] truncate">{file.name}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon ml-auto" onClick={onClose}
                  aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--danger)]/40
                            bg-[var(--danger)]/10 text-[11.5px] text-[var(--danger)]">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />{error}
            </div>
          )}

          {!sheets && !error && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] py-8 justify-center">
              <Loader2 size={15} className="animate-spin" />Читаем книгу…
            </div>
          )}

          {sheets && (
            <>
              {sheets.length > 1 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                    Лист
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {sheets.map((s, i) => (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => setActive(i)}
                        className={`px-2 py-1 rounded text-[11.5px] border ${
                          i === active
                            ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                            : 'border-[var(--border)] text-[var(--text-muted)]'}`}
                      >
                        {s.name}
                        <span className="ml-1 text-[10px]">{s.rows.length}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <label htmlFor="header-row" className="text-[11.5px] text-[var(--text-muted)]">
                  Строка с названиями колонок
                </label>
                <input
                  id="header-row"
                  type="number"
                  min={1}
                  max={Math.min(30, sheet?.rows.length ?? 1)}
                  value={headerRow + 1}
                  onChange={(ev) => {
                    const next = Math.max(0, Number(ev.target.value) - 1);
                    setHeaderRow(next);
                    setMapping(guessMapping(sheet?.rows[next] ?? []));
                  }}
                  className="w-16 bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                             px-2 py-1 text-[12px] text-[var(--text)]"
                />
              </div>

              {/* Что угадали — и чем это поправить. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {SHEET_FIELD_LIST.map((field) => {
                  const spec = SHEET_FIELDS[field];
                  const value = mapping[field];
                  return (
                    <div key={field} className="flex items-center gap-2">
                      <label htmlFor={`map-${field}`}
                             className={`text-[11.5px] w-[130px] shrink-0 ${
                               spec.required ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                        {spec.label}{spec.required && ' *'}
                      </label>
                      <select
                        id={`map-${field}`}
                        value={value === undefined ? '' : String(value)}
                        onChange={(ev) => setField(field, ev.target.value)}
                        className="flex-1 min-w-0 bg-[var(--bg-canvas)] border border-[var(--border)]
                                   rounded px-1.5 py-1 text-[11.5px] text-[var(--text)]"
                      >
                        <option value="">— нет —</option>
                        {headers.map((h, i) => (
                          <option key={`${h}-${i}`} value={i}>
                            {h || `Колонка ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {mapping.meters !== undefined && !byMethodMapped && (
                <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
                  <span className="text-[var(--text-muted)]">
                    Общие метры записать способом
                  </span>
                  <select
                    value={method}
                    onChange={(ev) => setMethod(ev.target.value as LayMethod)}
                    className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                               px-1.5 py-1 text-[11.5px] text-[var(--text)]"
                  >
                    {LAY_METHODS.map((m) => (
                      <option key={m} value={m}>{LAY_METHOD_LABEL[m]}</option>
                    ))}
                  </select>
                  <span className="text-[var(--text-muted)]">
                    — разложить их по способам сама система не может.
                  </span>
                </div>
              )}

              {/* Первые строки так, как они станут записями. */}
              {result.entries.length > 0 && (
                <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
                  <table className="w-full text-left text-[11.5px]">
                    <thead className="text-[10px] uppercase text-[var(--text-muted)]">
                      <tr>
                        <th className="px-2 py-1 font-medium">Дата</th>
                        <th className="px-2 py-1 font-medium">Участок</th>
                        <th className="px-2 py-1 font-medium">Подрядчик</th>
                        <th className="px-2 py-1 font-medium text-right">Метры</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.entries.slice(0, 5).map((e) => (
                        <tr key={e.id} className="border-t border-[var(--border)]">
                          <td className="px-2 py-1 font-mono tabular-nums text-[var(--text-muted)]">
                            {new Date(`${e.date}T00:00:00Z`).toLocaleDateString('ru')}
                          </td>
                          <td className="px-2 py-1 text-[var(--text)]">{e.uchastok}</td>
                          <td className="px-2 py-1 text-[var(--text-muted)]">{e.contractor || '—'}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums text-[var(--text)]">
                            {Object.values(e.byMethod).reduce((s, v) => s + (v ?? 0), 0)
                              .toLocaleString('ru')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {missing.length > 0 && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--warn)]/40
                                bg-[var(--warn)]/10 text-[11.5px] text-[var(--warn)]">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  Укажите колонки: {missing.map((f) => SHEET_FIELDS[f].label).join(', ')}.
                </div>
              )}

              {result.skipped.length > 0 && (
                <div className="text-[11px] text-[var(--text-muted)]">
                  Пропустим {result.skipped.length} строк:{' '}
                  {[...new Set(result.skipped.map((s) => s.why))].join(', ')}.
                  {' '}Строки {result.skipped.slice(0, 8).map((s) => s.row).join(', ')}
                  {result.skipped.length > 8 ? ' и другие' : ''}.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)] shrink-0"
             style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={result.entries.length === 0 || missing.length > 0}
            onClick={() => onDone(result.entries)}
          >
            <Check size={15} />
            Загрузить {result.entries.length || ''} {result.entries.length ? 'строк' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
