'use client';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { X, Upload, Loader2, AlertTriangle, MapPin, Wrench, Boxes } from 'lucide-react';
import { importJournal, type JournalImportResult } from './JournalImport';
import {
  JournalState, JournalFilter, emptyJournal, loadJournal, saveJournal, mergeJournal,
  matchesFilter, groundTotals, metersBy, metersByDay, lastWorkDate, distinct,
  fmtKm, fmtMeters, shiftDays, MATERIAL_LABEL,
} from './journalStore';
import { LAY_METHOD_LABEL, MATERIAL_UNIT, type LayMethod, type MaterialKind } from '@/types/construction';

type Period = 'day' | 'week' | 'month' | 'all';

const PERIOD_LABEL: Record<Period, string> = {
  day: 'Последний день', week: '7 дней', month: '30 дней', all: 'Всё время',
};

interface Props { onClose: () => void }

export default function ConstructionPanel({ onClose }: Props) {
  const [journal, setJournal] = useState<JournalState>(emptyJournal);
  const [period, setPeriod] = useState<Period>('month');
  const [oblast, setOblast] = useState('');
  const [smu, setSmu] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<JournalImportResult['stats'] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setJournal(loadJournal()); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true); setError(''); setReport(null);
    try {
      const res = await importJournal(file);
      const next = mergeJournal(loadJournal(), res);
      setJournal(next);
      setReport(res.stats);
      if (!saveJournal(next)) {
        setError('Журнал показан, но не сохранён: переполнено хранилище браузера. Выгрузите и удалите старые проекты.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось прочитать файл');
    } finally { setBusy(false); }
  }, []);

  // ── Период считаем от последнего рабочего дня, а не от сегодня:
  //    в журнал пишут задним числом, «вчера» от календаря чаще всего пусто.
  const anchor = useMemo(() => lastWorkDate(journal.ground), [journal.ground]);
  const filter: JournalFilter = useMemo(() => {
    const f: JournalFilter = { oblast: oblast || undefined, smu: smu || undefined };
    if (period !== 'all' && anchor) {
      f.to = anchor;
      f.from = period === 'day' ? anchor : shiftDays(anchor, period === 'week' ? -6 : -29);
    }
    return f;
  }, [period, oblast, smu, anchor]);

  const ground = useMemo(() => journal.ground.filter((e) => matchesFilter(e, filter)), [journal.ground, filter]);
  const drills = useMemo(() => journal.drills.filter((e) => matchesFilter(e, filter)), [journal.drills, filter]);
  const totals = useMemo(() => groundTotals(ground), [ground]);
  const allTotals = useMemo(() => groundTotals(journal.ground), [journal.ground]);
  const byOblast = useMemo(() => metersBy(ground, (e) => e.oblast), [ground]);
  const bySmu = useMemo(() => metersBy(ground, (e) => e.smu), [ground]);
  const days = useMemo(() => metersByDay(ground).slice(-30), [ground]);
  const mappedPoints = useMemo(() => drills.reduce((s, d) => s + d.points.length, 0), [drills]);

  const oblasts = useMemo(() => distinct(journal.ground, (e) => e.oblast), [journal.ground]);
  const smus = useMemo(() => distinct(journal.ground, (e) => e.smu), [journal.ground]);
  const empty = journal.ground.length === 0 && journal.orders.length === 0;

  return (
    <div className="fixed inset-0 z-[9998] bg-[var(--bg-canvas)] flex flex-col">
      {/* Шапка */}
      <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0"
           style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top, 0px))' }}>
        <Wrench size={17} className="text-[var(--accent)] shrink-0" />
        <h2 className="text-sm font-semibold text-[var(--text)] shrink-0">Журнал стройки</h2>
        {anchor && (
          <span className="text-[11px] font-mono text-[var(--text-muted)] hidden sm:inline">
            данные по {new Date(`${anchor}T00:00:00Z`).toLocaleDateString('ru')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          <button type="button" className="btn btn-primary text-[11px]" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            <span className="hidden sm:inline">{busy ? 'Читаю…' : 'Загрузить журнал'}</span>
          </button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Закрыть"><X size={16} /></button>
        </div>
      </div>

      {/* Фильтры */}
      {!empty && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 md:px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
          <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md">
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
              <button key={p} type="button" onClick={() => setPeriod(p)}
                className={`px-2 py-1 text-[11px] rounded transition-colors ${
                  period === p ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          <select value={oblast} onChange={(e) => setOblast(e.target.value)}
                  className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)] max-w-[190px]">
            <option value="">Все области</option>
            {oblasts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={smu} onChange={(e) => setSmu(e.target.value)}
                  className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)]">
            <option value="">Все СМУ</option>
            {smus.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(oblast || smu) && (
            <button type="button" className="btn btn-ghost text-[11px]" onClick={() => { setOblast(''); setSmu(''); }}>Сбросить</button>
          )}
        </div>
      )}

      {/* Содержимое */}
      <div className="flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4">
        {error && (
          <div className="mb-3 flex items-start gap-2 p-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[12px] text-[var(--danger)]">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}

        {report && (
          <div className="mb-3 p-3 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent-dim)] text-[12px] text-[var(--text)]">
            <div className="font-semibold mb-1 text-[var(--accent)]">Журнал загружен</div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-[var(--text-muted)]">
              <span>реестр СНП: <b className="text-[var(--text)]">{report.orderRows}</b></span>
              <span>подземка: <b className="text-[var(--text)]">{report.groundRows}</b></span>
              <span>подвес: <b className="text-[var(--text)]">{report.aerialRows}</b></span>
              <span>ГНБ: <b className="text-[var(--text)]">{report.drillRows}</b></span>
              <span>точек на карту: <b className="text-[var(--accent)]">{report.drillPoints}</b></span>
              {report.drillAmbiguous > 0 && <span>уточнено по области: <b className="text-[var(--warn)]">{report.drillAmbiguous}</b></span>}
              {report.drillUnparsed > 0 && <span>без координат: <b className="text-[var(--warn)]">{report.drillUnparsed}</b></span>}
            </div>
          </div>
        )}

        {empty ? (
          <EmptyJournal onPick={() => fileRef.current?.click()} busy={busy} />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Ключевые цифры */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Kpi label="Проложено за период" value={fmtKm(totals.meters)} unit="км" accent />
              <Kpi label="Всего в журнале" value={fmtKm(allTotals.meters)} unit="км" />
              <Kpi label="Бестраншейно (ГНБ/ГНП)" value={fmtKm(totals.drillM)} unit={`км · ${totals.drillCount} шт`} />
              <Kpi label="Точек ГНБ на карте" value={String(mappedPoints)} unit={`из ${drills.length} записей`} />
            </div>

            {/* Выработка по дням */}
            {days.length > 1 && <DayChart days={days} />}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <BarList title="По областям" icon={<MapPin size={13} />} rows={byOblast} />
              <BarList title="По СМУ" icon={<Wrench size={13} />} rows={bySmu} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <MethodBlock byMethod={totals.byMethod} total={totals.meters} />
              <MaterialBlock byMaterial={totals.byMaterial} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Составные части ──────────────────────────────────────────────────────────

function Kpi({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent
      ? 'border-[var(--accent)]/35 bg-[var(--accent-dim)]'
      : 'border-[var(--border)] bg-[var(--bg-surface)]'}`}>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-tight">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-2xl font-semibold font-mono tabular-nums ${accent ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{value}</span>
        {unit && <span className="text-[11px] text-[var(--text-muted)]">{unit}</span>}
      </div>
    </div>
  );
}

function DayChart({ days }: { days: { date: string; meters: number }[] }) {
  const max = Math.max(...days.map((d) => d.meters), 1);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Выработка по дням</div>
      <div className="flex items-end gap-[3px] h-24">
        {days.map((d) => (
          <div key={d.date} className="flex-1 min-w-[3px] group relative flex items-end h-full">
            <div className="w-full rounded-t-sm bg-[var(--accent)]/60 group-hover:bg-[var(--accent)] transition-colors"
                 style={{ height: `${Math.max(2, (d.meters / max) * 100)}%` }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block
                            whitespace-nowrap rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)]
                            px-1.5 py-0.5 text-[10px] font-mono text-[var(--text)] z-10">
              {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' })} · {fmtKm(d.meters)} км
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-mono text-[var(--text-muted)]">
        <span>{new Date(`${days[0].date}T00:00:00Z`).toLocaleDateString('ru')}</span>
        <span>пик {fmtKm(max)} км</span>
        <span>{new Date(`${days[days.length - 1].date}T00:00:00Z`).toLocaleDateString('ru')}</span>
      </div>
    </div>
  );
}

function BarList({ title, icon, rows }: {
  title: string; icon: React.ReactNode;
  rows: { name: string; meters: number; entries: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.meters), 1);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
        {icon}{title}
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">Нет данных за период</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.slice(0, 9).map((r) => (
            <div key={r.name}>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-[var(--text)] truncate" title={r.name}>{r.name}</span>
                <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0">
                  {fmtKm(r.meters)} км · {r.entries}
                </span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-[var(--bg-canvas)] overflow-hidden">
                <div className="h-full rounded-full bg-[var(--accent)]/70" style={{ width: `${(r.meters / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MethodBlock({ byMethod, total }: { byMethod: Record<string, number>; total: number }) {
  const rows = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Способы прокладки</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">Нет данных за период</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map(([m, v]) => (
            <div key={m} className="flex items-baseline justify-between gap-2 text-[11px] py-0.5 border-b border-[var(--border)] last:border-0">
              <span className="text-[var(--text)] truncate">{LAY_METHOD_LABEL[m as LayMethod] ?? m}</span>
              <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0">
                {fmtKm(v)} км
                <span className="ml-1.5 text-[var(--accent)]">{total ? Math.round((v / total) * 100) : 0}%</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MaterialBlock({ byMaterial }: { byMaterial: Record<string, number> }) {
  const rows = Object.entries(byMaterial).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
        <Boxes size={13} />Материалы за период
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">Нет данных за период</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {rows.map(([m, v]) => {
            const unit = MATERIAL_UNIT[m as MaterialKind] ?? 'шт';
            return (
              <div key={m} className="flex items-baseline justify-between gap-2 text-[11px] py-0.5">
                <span className="text-[var(--text)] truncate">{MATERIAL_LABEL[m as MaterialKind] ?? m}</span>
                <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0">
                  {unit === 'м' ? fmtMeters(v) : `${v.toLocaleString('ru')} шт`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyJournal({ onPick, busy }: { onPick: () => void; busy: boolean }) {
  return (
    <div className="h-full flex items-center justify-center py-12">
      <div className="max-w-md text-center flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center">
          <Wrench size={22} className="text-[var(--accent)]" />
        </div>
        <h3 className="text-base font-semibold text-[var(--text)]">Журнал пока пуст</h3>
        <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">
          Загрузите рабочий файл СНП — читаются листы «Все СНП заказа», «DATA»,
          «DATA ПОДВЕС» и «ГНБ Журнал». Координаты переходов разбираются в точки на карте,
          даже когда широта и долгота записаны в разном порядке.
        </p>
        <button type="button" className="btn btn-primary text-[12px]" onClick={onPick} disabled={busy}>
          <Upload size={15} />Выбрать файл журнала
        </button>
      </div>
    </div>
  );
}
