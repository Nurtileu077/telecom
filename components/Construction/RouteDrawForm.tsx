'use client';
import { useMemo, useState } from 'react';
import { X, Ruler } from 'lucide-react';
import {
  DEVIATION_REASONS, DESIGN_DEPTH_M, type Deviation, type PlanRoute,
} from '@/types/construction';
import { JournalState, fmtKm, distinct } from './journalStore';
import { polylineLengthM } from './planImport';
import { routeViews } from './routeStyle';
import { effectiveProgress } from './stageDerive';
import { normName } from './areaImport';

/**
 * Что сохранить из нарисованной линии.
 *
 * Рисуют на карте по двум поводам: либо трассы в системе ещё нет, либо
 * пошли не так, как в проекте. Второе — обычный случай, поэтому отклонение
 * стоит первым. Метраж считается по координатам; глубину система не знает
 * и не выдумывает — где-то 1,2, где-то иначе, и это вписывает человек.
 */

interface Props {
  journal: JournalState;
  coords: [number, number][];
  author: string;
  onSaveDeviation: (d: Deviation) => void;
  onSaveRoute: (r: PlanRoute) => void;
  onClose: () => void;
}

type Kind = 'deviation' | 'route';

function fmtCoord(c: [number, number]): string {
  return `${c[0].toFixed(6)}, ${c[1].toFixed(6)}`;
}

export default function RouteDrawForm({
  journal, coords, author, onSaveDeviation, onSaveRoute, onClose,
}: Props) {
  const lengthM = useMemo(() => polylineLengthM(coords), [coords]);
  const [kind, setKind] = useState<Kind>('deviation');
  const [uchastok, setUchastok] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState(DEVIATION_REASONS[0] ?? '');
  const [depth, setDepth] = useState<string>(String(DESIGN_DEPTH_M).replace('.', ','));
  const [note, setNote] = useState('');

  const sections = useMemo(
    () => distinct(journal.ground, (e) => e.uchastok),
    [journal.ground],
  );

  /** Трасса того же участка — к ней пристраивается отклонение. */
  const parent = useMemo(() => {
    if (!uchastok) return null;
    const progress = effectiveProgress(journal.progress, journal);
    const views = routeViews(journal.planRoutes, { progress });
    const key = normName(uchastok);
    return views.find((v) => [v.snp, v.to, v.from, v.name]
      .some((n) => n && normName(n) === key)) ?? null;
  }, [journal, uchastok]);

  const entry = useMemo(
    () => journal.ground.find((e) => e.uchastok === uchastok),
    [journal.ground, uchastok],
  );

  const save = () => {
    const now = new Date().toISOString();
    const date = now.slice(0, 10);

    if (kind === 'route') {
      const name = from && to ? `${from} ${to}` : from || to || uchastok || 'Новая трасса';
      onSaveRoute({
        id: `route-draw-${Date.now()}`,
        name,
        uchastok: uchastok || undefined,
        coords,
        lengthM,
        source: 'нарисовано на карте',
        createdAt: now,
        updatedAt: now,
      });
      onClose();
      return;
    }

    const actual = parseFloat(depth.replace(',', '.'));
    onSaveDeviation({
      id: `dev-draw-${Date.now()}`,
      kind: 'route',
      date,
      oblast: entry?.oblast ?? '',
      rayon: entry?.rayon,
      uchastok: uchastok || 'Не указан',
      kato: entry?.kato ?? '',
      contractor: entry?.contractor,
      fromPoint: from || undefined,
      toPoint: to || undefined,
      lengthM: Math.round(lengthM),
      designDepthM: DESIGN_DEPTH_M,
      actualDepthM: Number.isFinite(actual) ? actual : undefined,
      coords: coords.map(([lat, lon]) => ({ lat, lon })),
      reason: [reason, note].filter(Boolean).join('. '),
      author,
      createdAt: now,
      updatedAt: now,
      sync: 'local',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-3 md:p-6"
         onClick={onClose}>
      <div className="w-full max-w-lg max-h-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl"
           onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <Ruler size={16} className="text-[var(--accent)]" />
          <h3 className="text-[14px] font-semibold text-[var(--text)] flex-1">Нарисованная линия</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть"
                  className="btn btn-ghost btn-icon"><X size={16} /></button>
        </header>

        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md self-start">
            {([['deviation', 'Отклонение'], ['route', 'Новая трасса']] as [Kind, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`px-2.5 py-1 text-[11.5px] rounded ${
                  kind === k ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Метраж</span>
              <span className="ml-auto font-mono text-[15px] text-[var(--accent)]">
                {Math.round(lengthM).toLocaleString('ru')} м
              </span>
            </div>
            <div className="text-[10.5px] text-[var(--text-muted)] font-mono">
              начало {fmtCoord(coords[0])}
            </div>
            <div className="text-[10.5px] text-[var(--text-muted)] font-mono">
              конец {fmtCoord(coords[coords.length - 1])}
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">
              {coords.length} {coords.length === 2 ? 'точки' : 'точек'} · считается по координатам
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-[var(--text-muted)]">Участок</span>
            <input list="rdf-sections" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                   placeholder="например, с.Кураксу"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            <datalist id="rdf-sections">
              {sections.slice(0, 300).map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>

          {parent && (
            <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)] px-3 py-2 text-[11.5px] text-[var(--text)]">
              Пристыкуется к трассе «{parent.name}»: {fmtKm(parent.lengthM)} км
              {kind === 'deviation' && (
                <> + {Math.round(lengthM)} м = <b>{fmtKm(parent.lengthM + lengthM)} км</b> по участку</>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Откуда</span>
              <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="АТС, муфта, село"
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Куда</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="школа, ФАП, село"
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
          </div>

          {kind === 'deviation' && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] text-[var(--text-muted)]">Причина</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)}
                        className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]">
                  {DEVIATION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] text-[var(--text-muted)]">
                  Глубина фактическая, м — система её не знает
                </span>
                <input inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)}
                       className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono" />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] text-[var(--text-muted)]">Примечание</span>
                <input value={note} onChange={(e) => setNote(e.target.value)}
                       placeholder="что мешало пройти по проекту"
                       className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
              </label>

              <p className="text-[10.5px] text-[var(--text-muted)]">
                Отклонение по трассе требует протокола мобильной группы — его
                номер вписывается в карточке отклонения, и без него участок
                не закрыть актом.
              </p>
            </>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" className="btn btn-primary text-[12px]" onClick={save}>
              Сохранить
            </button>
            <button type="button" className="btn btn-ghost text-[12px]" onClick={onClose}>
              Отменить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
