'use client';
import { useMemo, useState } from 'react';
import { Plus, Check, Pencil, Trash2, MapPin, CalendarDays } from 'lucide-react';
import type { DrillLogEntry } from '@/types/construction';
import { JournalState, fmtKm, plural, distinct } from './journalStore';
import { plannedDrills, drillSummary, isPlanned } from './drillPlan';

/**
 * Проколы: что взяли на сегодня, что на неделю, что уже сделано.
 *
 * Метки на карте рождаются отсюда. Пока прокол в плане, его на карте нет —
 * планы не строят под землёй. Закрыли с координатами — появился отрезок.
 */

type Tab = 'today' | 'week' | 'all' | 'done';

const TAB_LABEL: Record<Tab, string> = {
  today: 'На сегодня',
  week: 'На неделю',
  all: 'Весь план',
  done: 'Сделано',
};

interface Props {
  journal: JournalState;
  onAdd: () => void;
  onEdit: (d: DrillLogEntry) => void;
  onDelete: (id: string) => void;
  onMarkDone: (d: DrillLogEntry) => void;
}

export default function DrillsView({ journal, onAdd, onEdit, onDelete, onMarkDone }: Props) {
  const [tab, setTab] = useState<Tab>('today');
  const [oblast, setOblast] = useState('');

  const oblasti = useMemo(() => distinct(journal.drills, (d) => d.oblast), [journal.drills]);
  const summary = useMemo(() => drillSummary(journal.drills), [journal.drills]);

  const rows = useMemo(() => {
    if (tab === 'done') {
      return journal.drills
        .filter((d) => !isPlanned(d))
        .filter((d) => !oblast || d.oblast === oblast)
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .slice(0, 200);
    }
    return plannedDrills(journal.drills, {
      horizon: tab,
      oblast: oblast || undefined,
    });
  }, [journal.drills, tab, oblast]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-2.5 py-1 text-[11.5px] rounded ${
                tab === t ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {TAB_LABEL[t]}
              {t === 'today' && summary.plannedToday > 0 && (
                <span className="ml-1 text-[10px]">{summary.plannedToday}</span>
              )}
            </button>
          ))}
        </div>
        {oblasti.length > 1 && (
          <select value={oblast} onChange={(e) => setOblast(e.target.value)}
                  className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)] max-w-[190px]">
            <option value="">Все области</option>
            {oblasti.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        <button type="button" className="btn btn-primary text-[11px] ml-auto" onClick={onAdd}>
          <Plus size={14} />Прокол
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Kpi label="В плане" value={String(summary.planned)}
             unit={`на сегодня ${summary.plannedToday}`} accent={summary.plannedToday > 0} />
        <Kpi label="Сделано" value={String(summary.done)} unit="проколов" />
        <Kpi label="Пройдено" value={fmtKm(summary.doneMeters)} unit="км бестраншейно" />
        <Kpi label="Без координат" value={String(summary.doneWithoutCoords)}
             unit={summary.doneWithoutCoords ? 'не встанут на карту' : 'все на карте'}
             warn={summary.doneWithoutCoords > 0} />
      </div>

      {summary.byCrossing.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Что кололи</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {summary.byCrossing.map((c) => (
              <span key={c.kind} className="text-[11.5px] text-[var(--text-muted)]">
                {c.kind} <b className="text-[var(--text)] font-mono">{c.count}</b>
                {c.meters ? <span className="text-[var(--text-muted)]"> · {fmtKm(c.meters)} км</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)] py-3">
          {tab === 'done'
            ? 'Сделанных проколов нет.'
            : 'В плане пусто. Отметьте, что берёте на сегодня или на неделю — кнопка «Прокол».'}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((d) => {
            const planned = isPlanned(d);
            const color = d.drillKind === 'ГНП' ? '#fb923c' : '#f472b6';
            return (
              <div key={d.id}
                   className="rounded-lg border bg-[var(--bg-surface)] px-3 py-2 flex flex-col gap-1"
                   style={{ borderColor: planned ? 'var(--warn)' : 'var(--border)' }}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[11px] font-medium" style={{ color }}>{d.drillKind}</span>
                  <span className="text-[12.5px] text-[var(--text)] truncate">{d.uchastok || '—'}</span>
                  <span className="text-[10.5px] text-[var(--text-muted)] truncate">
                    {[d.oblast, d.rayon].filter(Boolean).join(', ')}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)] shrink-0">
                    {d.meters ? `${d.meters} м` : '—'}{d.count > 1 ? ` · ${d.count} шт` : ''}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap text-[10.5px] text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays size={11} />
                    {planned
                      ? (d.plannedFor
                        ? new Date(`${d.plannedFor}T00:00:00Z`).toLocaleDateString('ru')
                        : 'без даты')
                      : (d.date ? new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ru') : '—')}
                  </span>
                  {d.crossings?.length ? <span>{d.crossings.join(', ')}</span> : null}
                  {!planned && (
                    <span className="inline-flex items-center gap-1"
                          style={{ color: d.points.length >= 2 ? 'var(--text-muted)' : 'var(--warn)' }}>
                      <MapPin size={11} />
                      {d.points.length >= 2 ? 'вход и выход' : d.points.length === 1 ? 'одна точка' : 'без координат'}
                    </span>
                  )}
                  {d.note ? <span className="truncate">{d.note}</span> : null}

                  <span className="ml-auto flex items-center gap-0.5">
                    {planned && (
                      <button type="button" onClick={() => onMarkDone(d)}
                              title="Закрыть прокол: метраж и координаты"
                              className="btn btn-ghost text-[10.5px] text-[var(--accent)]">
                        <Check size={13} />Сделано
                      </button>
                    )}
                    <button type="button" onClick={() => onEdit(d)} title="Изменить"
                            className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--accent)]">
                      <Pencil size={13} />
                    </button>
                    <button type="button" onClick={() => onDelete(d.id)} title="Удалить"
                            className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--danger)]">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
          {tab === 'done' && rows.length >= 200 && (
            <p className="text-[10.5px] text-[var(--text-muted)] text-center py-1">
              Показаны последние 200.
            </p>
          )}
        </div>
      )}

      <p className="text-[10.5px] text-[var(--text-muted)] leading-relaxed">
        Прокол попадает на карту, когда закрыт: план под землёй не лежит.
        Сняли вход и выход — прокол рисуется отрезком, одну точку — меткой.
        {summary.doneWithoutCoords > 0 && (
          <> Сделанных без координат: {summary.doneWithoutCoords} —
          {' '}{plural(summary.doneWithoutCoords, 'он', 'они', 'они')} на карте не видны.</>
        )}
      </p>
    </div>
  );
}

function Kpi({ label, value, unit, accent, warn }: {
  label: string; value: string; unit?: string; accent?: boolean; warn?: boolean;
}) {
  const color = warn ? 'var(--warn)' : accent ? 'var(--accent)' : 'var(--text)';
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="text-[18px] font-semibold leading-tight" style={{ color }}>{value}</div>
      {unit && <div className="text-[10.5px] text-[var(--text-muted)]">{unit}</div>}
    </div>
  );
}
