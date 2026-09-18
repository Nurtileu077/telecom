'use client';
import { useMemo, useState } from 'react';
import { X, Crosshair, MapPin, Loader2, Check } from 'lucide-react';
import {
  CROSSING_KINDS, type CrossingKind, type DrillKind, type DrillLogEntry, type DrillPoint,
} from '@/types/construction';
import { JournalState, distinct } from './journalStore';
import { getCurrentPosition, positionErrorText } from './currentPosition';
import { drillLengthM } from './drillPlan';

/**
 * Прокол: сначала план, потом факт.
 *
 * ГНБщик отмечает, что берёт на сегодня или на неделю, а закрывает по
 * факту — с координатами входа и выхода. Метраж тогда считается сам, и
 * прокол встаёт на карту отрезком: под дорогой прошли отсюда и досюда.
 *
 * Метка на карте рождается здесь и больше нигде: разметка обследования
 * показывала бы вчерашний день сегодняшним.
 */

interface Props {
  journal: JournalState;
  initial?: DrillLogEntry | null;
  author: string;
  onSave: (d: DrillLogEntry) => void;
  onClose: () => void;
  onRequestPick?: (label: string) => Promise<{ lat: number; lon: number } | null>;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function num(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export default function DrillForm({
  journal, initial, author, onSave, onClose, onRequestPick,
}: Props) {
  const [status, setStatus] = useState<'planned' | 'done'>(initial?.status ?? 'done');
  const [date, setDate] = useState(initial?.date || todayIso());
  const [plannedFor, setPlannedFor] = useState(initial?.plannedFor || todayIso());
  const [drillKind, setDrillKind] = useState<DrillKind>(initial?.drillKind ?? 'ГНБ');
  const [uchastok, setUchastok] = useState(initial?.uchastok ?? '');
  const [count, setCount] = useState(String(initial?.count || 1));
  const [meters, setMeters] = useState(initial?.meters ? String(initial.meters) : '');
  const [crossings, setCrossings] = useState<CrossingKind[]>(initial?.crossings ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const [a, setA] = useState<DrillPoint | null>(initial?.points?.[0] ?? null);
  const [b, setB] = useState<DrillPoint | null>(initial?.points?.[1] ?? null);
  const [geoBusy, setGeoBusy] = useState<'a' | 'b' | null>(null);
  const [geoNote, setGeoNote] = useState('');

  const sections = useMemo(() => {
    const s = new Set<string>();
    for (const e of journal.ground) if (e.uchastok) s.add(e.uchastok);
    for (const d of journal.drills) if (d.uchastok) s.add(d.uchastok);
    return [...s].sort((x, y) => x.localeCompare(y, 'ru'));
  }, [journal]);

  /** Данные участка — берём из журнала, чтобы не спрашивать область и КАТО. */
  const place = useMemo(() => {
    const hit = journal.ground.find((e) => e.uchastok === uchastok)
      ?? journal.drills.find((d) => d.uchastok === uchastok);
    return { oblast: hit?.oblast ?? '', rayon: hit?.rayon, kato: hit?.kato ?? '', contractor: hit?.contractor };
  }, [journal, uchastok]);

  const points = [a, b].filter((p): p is DrillPoint => !!p);
  const byCoords = drillLengthM(points);

  const takeGps = async (which: 'a' | 'b') => {
    setGeoBusy(which); setGeoNote('');
    try {
      const pos = await getCurrentPosition();
      const pt = { lat: pos.lat, lon: pos.lon };
      if (which === 'a') setA(pt); else setB(pt);
      setGeoNote(`Точность ±${pos.accuracyM} м`);
    } catch (e) {
      setGeoNote(positionErrorText(e));
    } finally { setGeoBusy(null); }
  };

  const pickOnMap = async (which: 'a' | 'b') => {
    if (!onRequestPick) return;
    const p = await onRequestPick(which === 'a' ? 'вход прокола' : 'выход прокола');
    if (!p) return;
    const pt = { lat: p.lat, lon: p.lon };
    if (which === 'a') setA(pt); else setB(pt);
  };

  const toggleCrossing = (c: CrossingKind) => {
    setCrossings((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const canSave = !!uchastok.trim()
    && (status === 'planned' || (points.length >= 1 && num(meters) > 0));

  const save = () => {
    const now = new Date().toISOString();
    const finalMeters = num(meters) || byCoords;
    onSave({
      kind: 'drill',
      id: initial?.id ?? `drill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: status === 'done' ? date : plannedFor,
      smu: initial?.smu ?? '',
      contractor: initial?.contractor ?? place.contractor,
      column: initial?.column,
      oblast: place.oblast,
      rayon: place.rayon,
      uchastok: uchastok.trim(),
      kato: place.kato,
      drillKind,
      meters: status === 'done' ? finalMeters : num(meters),
      count: Math.max(1, Math.round(num(count) || 1)),
      points,
      crossings: crossings.length ? crossings : undefined,
      note: note.trim() || undefined,
      status,
      plannedFor: status === 'planned' ? plannedFor : initial?.plannedFor,
      doneBy: status === 'done' ? author : initial?.doneBy,
      author: initial?.author ?? author,
      createdAt: initial?.createdAt ?? now,
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
        <header className="sticky top-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)]">
          <h3 className="text-[14px] font-semibold text-[var(--text)] flex-1">
            {initial ? 'Прокол' : 'Новый прокол'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Закрыть"
                  className="btn btn-ghost btn-icon"><X size={16} /></button>
        </header>

        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md self-start">
            {([['planned', 'В плане'], ['done', 'Сделано']] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setStatus(v)}
                className={`px-2.5 py-1 text-[11.5px] rounded ${
                  status === v ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">
                {status === 'planned' ? 'Когда планируется' : 'Дата'}
              </span>
              <input type="date"
                     value={status === 'planned' ? plannedFor : date}
                     onChange={(e) => (status === 'planned' ? setPlannedFor : setDate)(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Вид</span>
              <select value={drillKind} onChange={(e) => setDrillKind(e.target.value as DrillKind)}
                      className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]">
                <option value="ГНБ">ГНБ</option>
                <option value="ГНП">ГНП</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-[var(--text-muted)]">Участок</span>
            <input list="drill-sections" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                   placeholder="например, с.Сауыншы"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            <datalist id="drill-sections">
              {sections.slice(0, 400).map((s) => <option key={s} value={s} />)}
            </datalist>
            {place.oblast && (
              <span className="text-[10px] text-[var(--text-muted)]">
                {place.oblast}{place.rayon ? `, ${place.rayon}` : ''}
                {place.kato ? ` · ${place.kato}` : ''}
              </span>
            )}
          </label>

          <div>
            <span className="text-[10.5px] text-[var(--text-muted)]">Что колем</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {CROSSING_KINDS.map((c) => (
                <button key={c} type="button" onClick={() => toggleCrossing(c)}
                  className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                    crossings.includes(c)
                      ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Метраж, м</span>
              <input inputMode="decimal" value={meters} onChange={(e) => setMeters(e.target.value)}
                     placeholder={byCoords ? String(byCoords) : '0'}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Проколов, шт</span>
              <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono" />
            </label>
          </div>

          {status === 'done' && (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] p-3">
              <span className="text-[10.5px] text-[var(--text-muted)]">
                Вход и выход — по ним прокол встаёт на карту отрезком
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex gap-1">
                  <button type="button" onClick={() => takeGps('a')} disabled={geoBusy !== null}
                          className="btn btn-ghost text-[10.5px] flex-1">
                    {geoBusy === 'a' ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
                    Вход здесь
                  </button>
                  {onRequestPick && (
                    <button type="button" onClick={() => pickOnMap('a')}
                            className="btn btn-ghost text-[10.5px] flex-1">
                      <MapPin size={13} />На карте
                    </button>
                  )}
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => takeGps('b')} disabled={geoBusy !== null}
                          className="btn btn-ghost text-[10.5px] flex-1">
                    {geoBusy === 'b' ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
                    Выход здесь
                  </button>
                  {onRequestPick && (
                    <button type="button" onClick={() => pickOnMap('b')}
                            className="btn btn-ghost text-[10.5px] flex-1">
                      <MapPin size={13} />На карте
                    </button>
                  )}
                </div>
              </div>
              <div className="text-[10.5px] font-mono text-[var(--text-muted)]">
                вход {a ? `${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}` : '—'}
              </div>
              <div className="text-[10.5px] font-mono text-[var(--text-muted)]">
                выход {b ? `${b.lat.toFixed(6)}, ${b.lon.toFixed(6)}` : '—'}
              </div>
              {byCoords > 0 && (
                <div className="text-[11px] text-[var(--accent)]">
                  По координатам {byCoords} м
                  {num(meters) > 0 && Math.abs(num(meters) - byCoords) > byCoords * 0.25 && (
                    <span className="text-[var(--warn)]">
                      {' '}— расходится с введённым метражом, проверьте
                    </span>
                  )}
                </div>
              )}
              {geoNote && <div className="text-[10.5px] text-[var(--accent)]">{geoNote}</div>}
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-[var(--text-muted)]">Примечание</span>
            <input value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="что мешало, чем пересекались"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
          </label>

          <div className="flex gap-2 pt-1">
            <button type="button" className="btn btn-primary text-[12px]" disabled={!canSave} onClick={save}>
              <Check size={14} />
              {status === 'planned' ? 'В план' : 'Сохранить как сделанный'}
            </button>
            <button type="button" className="btn btn-ghost text-[12px]" onClick={onClose}>Отменить</button>
          </div>
          {!canSave && (
            <p className="text-[10.5px] text-[var(--text-muted)]">
              {!uchastok.trim()
                ? 'Укажите участок.'
                : 'Для сделанного прокола нужны метраж и хотя бы одна координата.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
