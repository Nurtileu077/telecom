'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import {
  addMonths, monthName, monthRange, monthOf, checkRange, rangeText, startDayLabel,
  MAX_START_DAY, type MoneyPeriod, type DateRange,
} from './moneyPeriod';

/**
 * Период расчётов, табеля и документов.
 *
 * Стоит на тех экранах, которые закрывают месяцем, вместо «7 дней / 30
 * дней» сводки. Раньше они брали период сводки, а переключателя у них не
 * было: в расчёт за сентябрь молча шёл хвост августа. Теперь даты видно
 * всегда, и выбирают их здесь.
 */

interface Props {
  period: MoneyPeriod;
  /** Даты, за которые на самом деле считается: идущий месяц — по сегодня. */
  range: DateRange;
  startDay: number;
  months: string[];
  onChange: (p: MoneyPeriod) => void;
  /** Нет — менять отчётный период нельзя (у субподрядчика нет реквизитов). */
  onStartDay?: (day: number) => void;
}

const sel = 'bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)]';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function MoneyPeriodBar({
  period, range, startDay, months, onChange, onStartDay,
}: Props) {
  // Свои даты набирают по одной: пока вторая не выбрана, расчёт не должен
  // прыгать на полдороги — держим черновик и применяем только целое.
  const [draft, setDraft] = useState<DateRange>(() => (
    period.kind === 'range' ? { from: period.from, to: period.to } : range
  ));
  useEffect(() => {
    if (period.kind === 'range') setDraft({ from: period.from, to: period.to });
  }, [period]);
  const draftError = period.kind === 'range' ? checkRange(draft.from, draft.to) : null;

  function setDraftSide(side: 'from' | 'to', value: string) {
    const next = { ...draft, [side]: value };
    setDraft(next);
    if (!checkRange(next.from, next.to)) onChange({ kind: 'range', from: next.from, to: next.to });
  }

  function switchTo(kind: MoneyPeriod['kind']) {
    if (kind === period.kind) return;
    if (kind === 'all') { onChange({ kind: 'all' }); return; }
    if (kind === 'month') {
      // Из своих дат — в тот месяц, которым они кончаются: человек
      // смотрел на него, и прыгать на другой незачем.
      onChange({ kind: 'month', month: (range.to && monthOf(range.to, startDay)) || months[0] || '' });
      return;
    }
    // Свои даты начинаются с того, что было на экране: чаще всего их
    // выбирают, чтобы чуть сдвинуть месяц, а не набрать с нуля.
    const here = range.from && range.to ? range : months[0] ? monthRange(months[0], startDay) : null;
    if (here) onChange({ kind: 'range', from: here.from, to: here.to });
  }

  const choices = period.kind === 'month' && !months.includes(period.month)
    ? [period.month, ...months].sort((a, b) => b.localeCompare(a))
    : months;
  const full = period.kind === 'month' ? monthRange(period.month, startDay) : null;
  const cut = full && range.to && range.to < full.to;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md">
        {([
          ['month', 'Месяц'], ['range', 'Даты'], ['all', 'Всё время'],
        ] as const).map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            onClick={() => switchTo(kind)}
            className={`px-2 py-1 text-[11px] rounded transition-colors ${
              period.kind === kind
                ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {period.kind === 'month' && (
        <>
          <button type="button" className="btn btn-ghost btn-icon" title="Месяц раньше"
                  onClick={() => onChange({ kind: 'month', month: addMonths(period.month, -1) })}>
            <ChevronLeft size={14} />
          </button>
          <select value={period.month} className={sel} title="Отчётный месяц"
                  onChange={(e) => onChange({ kind: 'month', month: e.target.value })}>
            {choices.map((m) => <option key={m} value={m}>{cap(monthName(m))}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-icon" title="Месяц позже"
                  onClick={() => onChange({ kind: 'month', month: addMonths(period.month, 1) })}>
            <ChevronRight size={14} />
          </button>
        </>
      )}

      {period.kind === 'range' && (
        <>
          <input type="date" value={draft.from} aria-label="С какого дня"
                 onChange={(e) => setDraftSide('from', e.target.value)}
                 className={`${sel} ${draftError ? 'border-[var(--danger)]' : ''}`} />
          <span className="text-[11px] text-[var(--text-muted)]">—</span>
          <input type="date" value={draft.to} aria-label="По какой день"
                 onChange={(e) => setDraftSide('to', e.target.value)}
                 className={`${sel} ${draftError ? 'border-[var(--danger)]' : ''}`} />
          {draftError && <span className="text-[11px] text-[var(--danger)]">{draftError}</span>}
        </>
      )}

      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]"
            title="За эти даты считаются расчёт, табель и документы">
        <CalendarRange size={12} />
        {rangeText(range)}
        {cut && ' · месяц ещё идёт'}
      </span>

      {period.kind === 'month' && (
        <select
          value={startDay}
          disabled={!onStartDay}
          className={sel}
          title={onStartDay
            ? 'С какого числа закрываете месяц. Общее для проекта: уходит на обмен вместе с реквизитами'
            : 'Отчётный период задаёт генподрядчик'}
          onChange={(e) => onStartDay?.(Number(e.target.value))}
        >
          {Array.from({ length: MAX_START_DAY }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{cap(startDayLabel(d))}</option>
          ))}
        </select>
      )}
    </div>
  );
}
