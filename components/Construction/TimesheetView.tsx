'use client';
import { useMemo, useState } from 'react';
import { Copy, AlertTriangle } from 'lucide-react';
import type { DailyWorkEntry, Crew } from '@/types/construction';
import ExportButton, { type ExportColumn } from '@/components/Layout/ExportButton';
import {
  timesheet, crewsWithoutMembers, shiftsWithoutCrew, timesheetTotals, timesheetToText,
  type TimesheetRow,
} from './timesheet';

/**
 * Табель.
 *
 * Расчёт с бригадами идёт по сменам, а смены записаны по колоннам — не
 * по людям. В конце месяца табель сводят вручную: открывают журнал,
 * считают строки, вспоминают, кто в какой колонне был. Половина споров о
 * деньгах начинается именно здесь.
 *
 * Состав берётся сегодняшний — и об этом сказано прямо: кто был в
 * колонне в июле, журнал не помнит, и выдумывать это нельзя.
 */

interface Props {
  rows: DailyWorkEntry[];
  crews: Crew[];
  from?: string;
  to?: string;
  onCopied?: (n: number) => void;
}

/** Колонки табеля — те же, что на экране: выгружается то, что видно. */
const TIMESHEET_COLUMNS: ExportColumn<TimesheetRow>[] = [
  { header: 'Фамилия', value: (r) => r.name },
  { header: 'Должность', value: (r) => r.role ?? '' },
  { header: 'Колонна', value: (r) => r.crew },
  { header: 'Подрядчик', value: (r) => r.contractor ?? '' },
  { header: 'Смен', value: (r) => r.shifts },
  { header: 'Дней', value: (r) => r.days },
  { header: 'Метры колонны', value: (r) => Math.round(r.crewMeters) },
];

export default function TimesheetView({ rows, crews, from, to, onCopied }: Props) {
  const [copied, setCopied] = useState(false);

  const table = useMemo(() => timesheet(rows, crews, { from, to }), [rows, crews, from, to]);
  const missing = useMemo(
    () => crewsWithoutMembers(rows, crews, { from, to }),
    [rows, crews, from, to],
  );
  const totals = useMemo(() => timesheetTotals(table), [table]);
  const noCrew = useMemo(
    () => shiftsWithoutCrew(rows, crews, { from, to }),
    [rows, crews, from, to],
  );

  async function copy() {
    const text = timesheetToText(table);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.(table.length);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Скопируйте табель вручную:', text);
    }
  }

  if (table.length === 0 && missing.length === 0 && noCrew.shifts === 0) {
    return (
      <div className="p-6 text-center text-[13px] text-[var(--text-muted)]">
        За выбранный период смен по колоннам нет.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[13px] text-[var(--text)]">
          {totals.people} человек · {totals.shifts} человеко-смен ·{' '}
          <span className="font-mono tabular-nums">
            {Math.round(totals.meters).toLocaleString('ru')} м
          </span>
        </span>
        <span className="ml-auto inline-flex gap-1">
          <button type="button" onClick={copy} className="btn btn-ghost text-[11px]">
            <Copy size={13} />{copied ? 'Скопировано' : 'Табель в чат'}
          </button>
          <ExportButton
            name="Табель"
            rows={table}
            columns={TIMESHEET_COLUMNS}
            footer={{
              'Фамилия': 'Итого',
              'Смен': totals.shifts,
              'Метры колонны': Math.round(totals.meters),
            }}
          />
        </span>
      </div>

      {noCrew.shifts > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/40
                        bg-[var(--warn)]/10 px-3 py-2 text-[11.5px] text-[var(--warn)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Не попали в табель: смен {noCrew.shifts} ·{' '}
            <span className="font-mono tabular-nums">
              {Math.round(noCrew.meters).toLocaleString('ru')} м
            </span>
            {/* Причины разные, и исправляются они по-разному. */}
            {noCrew.reasons.map((r) => (
              <span key={r.why} className="block text-[var(--text-muted)]">
                {r.why} — смен {r.shifts}
                {r.columns.length > 0 ? ` (${r.columns.slice(0, 3).join(', ')})` : ''}
              </span>
            ))}
            {noCrew.dates.length > 0 && (
              <span className="block text-[var(--text-muted)]">
                Даты: {noCrew.dates.slice(0, 5).map((d) => new Date(`${d}T00:00:00Z`)
                  .toLocaleDateString('ru')).join(', ')}
                {noCrew.dates.length > 5 ? ' и другие' : ''}.
              </span>
            )}
          </span>
        </div>
      )}

      {missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/40
                        bg-[var(--warn)]/10 px-3 py-2 text-[11.5px] text-[var(--warn)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            В табель не попали: {missing.join(', ')} — у этих колонн не заведён состав.
            <span className="block text-[var(--text-muted)]">
              Добавьте людей в карточке колонны, и смены разложатся сами.
            </span>
          </span>
        </div>
      )}

      {table.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-2 py-1.5 font-medium">ФИО</th>
                <th className="px-2 py-1.5 font-medium hidden sm:table-cell">Должность</th>
                <th className="px-2 py-1.5 font-medium">Колонна</th>
                <th className="px-2 py-1.5 font-medium text-right w-[64px]">Смен</th>
                <th className="px-2 py-1.5 font-medium text-right w-[64px]">Дней</th>
                <th className="px-2 py-1.5 font-medium text-right w-[110px] hidden md:table-cell">
                  Метры колонны
                </th>
              </tr>
            </thead>
            <tbody>
              {table.map((r) => (
                <tr key={`${r.crew}|${r.name}`} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1.5 text-[12.5px] text-[var(--text)]">{r.name}</td>
                  <td className="px-2 py-1.5 text-[11.5px] text-[var(--text-muted)] hidden sm:table-cell">
                    {r.role || '—'}
                  </td>
                  <td className="px-2 py-1.5 text-[11.5px] text-[var(--text-muted)]">
                    {r.crew}
                    {r.contractor && <span className="block text-[10px]">{r.contractor}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[12.5px] text-[var(--text)]">
                    {r.shifts}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[12.5px] text-[var(--text-muted)]">
                    {r.days}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[12px] text-[var(--text-muted)] hidden md:table-cell">
                    {Math.round(r.crewMeters).toLocaleString('ru')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10.5px] text-[var(--text-muted)] leading-snug">
        Состав колонн берётся сегодняшний: кто был в колонне в прошлом месяце,
        журнал не помнит. Метры колонны на людей не делятся — колонна даёт их
        вместе, а как делить, решает расчёт.
      </p>
    </div>
  );
}
