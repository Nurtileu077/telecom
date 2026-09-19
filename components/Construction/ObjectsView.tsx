'use client';
import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, MapPin, Crosshair, Loader2, X, Check } from 'lucide-react';
import {
  SITE_OBJECT_SPECS, SITE_OBJECT_KINDS, MUFTA_STATES, ENDPOINT_KINDS,
  siteObjectColor,
  type SiteObject, type SiteObjectKind, type MuftaState,
} from '@/types/construction';
import { JournalState, distinct, plural } from './journalStore';
import { getCurrentPosition, positionErrorText } from './currentPosition';

/**
 * Что стоит вдоль трассы.
 *
 * Муфта живёт тремя состояниями: не установлена, установлена, заварена.
 * Это разные работы и разные дни, поэтому на карте они разного цвета —
 * иначе «муфта есть» означало бы и «лежит в машине», и «сварена».
 */

interface Props {
  journal: JournalState;
  author: string;
  editingId?: string | null;
  onSave: (o: SiteObject) => void;
  onDelete: (id: string) => void;
  onDoneEditing: () => void;
  onRequestPick?: (label: string) => Promise<{ lat: number; lon: number } | null>;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ObjectsView({
  journal, author, editingId, onSave, onDelete, onDoneEditing, onRequestPick,
}: Props) {
  const [kindFilter, setKindFilter] = useState<SiteObjectKind | ''>('');
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<SiteObject | null>(null);

  // Просят открыть карточку с карты — открываем её же форму.
  const editing = useMemo(
    () => (editingId ? journal.objects.find((o) => o.id === editingId) ?? null : null),
    [editingId, journal.objects],
  );
  const current = draft ?? editing;
  const open = formOpen || !!editing;

  const rows = useMemo(() => {
    const list = kindFilter
      ? journal.objects.filter((o) => o.kind === kindFilter)
      : journal.objects;
    return [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [journal.objects, kindFilter]);

  const counts = useMemo(() => {
    const acc = Object.fromEntries(SITE_OBJECT_KINDS.map((k) => [k, 0])) as Record<SiteObjectKind, number>;
    for (const o of journal.objects) acc[o.kind]++;
    return acc;
  }, [journal.objects]);

  const muftaStates = useMemo(() => {
    const acc = { planned: 0, installed: 0, spliced: 0 };
    for (const o of journal.objects) {
      if (o.kind === 'mufta') acc[o.state ?? 'planned']++;
    }
    return acc;
  }, [journal.objects]);

  const close = () => { setFormOpen(false); setDraft(null); onDoneEditing(); };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md">
          <button type="button" onClick={() => setKindFilter('')}
            className={`px-2.5 py-1 text-[11.5px] rounded ${
              !kindFilter ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
            Все
          </button>
          {SITE_OBJECT_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setKindFilter(k)}
              className={`px-2.5 py-1 text-[11.5px] rounded ${
                kindFilter === k ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {SITE_OBJECT_SPECS[k].icon} {SITE_OBJECT_SPECS[k].plural}
              {counts[k] > 0 && <span className="ml-1 text-[10px]">{counts[k]}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary text-[11px] ml-auto"
                onClick={() => { setDraft(null); setFormOpen(true); }}>
          <Plus size={14} />Объект
        </button>
      </div>

      {counts.mufta > 0 && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MUFTA_STATES) as MuftaState[]).map((st) => (
            <span key={st}
                  className="text-[11.5px] rounded-lg border px-2.5 py-1"
                  style={{ borderColor: MUFTA_STATES[st].color, color: MUFTA_STATES[st].color }}>
              {MUFTA_STATES[st].label}: <b>{muftaStates[st]}</b>
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)] py-3">
          Объектов нет. Муфты, столбы, конечные точки и ККС ставятся кнопкой
          «Объект» — координату можно взять с телефона или указать на карте.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.slice(0, 200).map((o) => {
            const spec = SITE_OBJECT_SPECS[o.kind];
            const color = siteObjectColor(o);
            const state = o.kind === 'mufta'
              ? MUFTA_STATES[o.state ?? 'planned'].label
              : o.endpointKind || spec.label;
            return (
              <div key={o.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 flex items-center gap-2">
                <span className="text-[15px] leading-none">{spec.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-[var(--text)] truncate">
                    {o.name || spec.label}
                    {o.number ? <span className="text-[var(--text-muted)]"> №{o.number}</span> : null}
                  </div>
                  <div className="text-[10.5px] truncate" style={{ color }}>
                    {state}
                    {o.uchastok ? <span className="text-[var(--text-muted)]"> · {o.uchastok}</span> : null}
                    {o.date ? (
                      <span className="text-[var(--text-muted)]">
                        {' '}· {new Date(`${o.date}T00:00:00Z`).toLocaleDateString('ru')}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-[var(--text-muted)] shrink-0 hidden sm:block">
                  {o.lat.toFixed(5)}, {o.lon.toFixed(5)}
                </span>
                <button type="button" onClick={() => { setDraft(o); setFormOpen(true); }}
                        title="Изменить"
                        className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--accent)]">
                  <Pencil size={13} />
                </button>
                <button type="button" onClick={() => onDelete(o.id)} title="Удалить"
                        className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--danger)]">
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
          {rows.length > 200 && (
            <p className="text-[10.5px] text-[var(--text-muted)] text-center py-1">
              Показаны первые 200 из {rows.length}.
            </p>
          )}
        </div>
      )}

      {open && (
        <ObjectForm
          journal={journal}
          initial={current}
          author={author}
          onSave={(o) => { onSave(o); close(); }}
          onClose={close}
          onRequestPick={onRequestPick}
        />
      )}
    </div>
  );
}

function ObjectForm({ journal, initial, author, onSave, onClose, onRequestPick }: {
  journal: JournalState;
  initial: SiteObject | null;
  author: string;
  onSave: (o: SiteObject) => void;
  onClose: () => void;
  onRequestPick?: (label: string) => Promise<{ lat: number; lon: number } | null>;
}) {
  const [kind, setKind] = useState<SiteObjectKind>(initial?.kind ?? 'mufta');
  const [name, setName] = useState(initial?.name ?? '');
  const [number, setNumber] = useState(initial?.number ?? '');
  const [state, setState] = useState<MuftaState>(initial?.state ?? 'planned');
  const [endpointKind, setEndpointKind] = useState(initial?.endpointKind ?? ENDPOINT_KINDS[0]);
  const [uchastok, setUchastok] = useState(initial?.uchastok ?? '');
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [note, setNote] = useState(initial?.note ?? '');
  // Паспорт сети: то, что спросят через три года, а не на стройке.
  const [feedFrom, setFeedFrom] = useState(initial?.feedFrom ?? '');
  const [feedTo, setFeedTo] = useState(initial?.feedTo ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [cable, setCable] = useState(initial?.cable ?? '');
  const [fibers, setFibers] = useState(initial?.fibers ? String(initial.fibers) : '');
  const [duct, setDuct] = useState(initial?.duct ?? '');
  const [depthM, setDepthM] = useState(initial?.depthM ? String(initial.depthM) : '');
  const [spanM, setSpanM] = useState(initial?.spanM ? String(initial.spanM) : '');

  const [lat, setLat] = useState(initial ? String(initial.lat) : '');
  const [lon, setLon] = useState(initial ? String(initial.lon) : '');
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoNote, setGeoNote] = useState('');

  const sections = useMemo(() => distinct(journal.ground, (e) => e.uchastok), [journal.ground]);
  const place = useMemo(() => {
    const hit = journal.ground.find((e) => e.uchastok === uchastok);
    return { oblast: hit?.oblast, rayon: hit?.rayon, kato: hit?.kato };
  }, [journal.ground, uchastok]);

  const takeGps = async () => {
    setGeoBusy(true); setGeoNote('');
    try {
      const pos = await getCurrentPosition();
      setLat(String(pos.lat)); setLon(String(pos.lon));
      setGeoNote(`Точность ±${pos.accuracyM} м`);
    } catch (e) {
      setGeoNote(positionErrorText(e));
    } finally { setGeoBusy(false); }
  };

  const pickOnMap = async () => {
    if (!onRequestPick) return;
    const p = await onRequestPick(`место: ${SITE_OBJECT_SPECS[kind].label.toLowerCase()}`);
    if (p) { setLat(String(p.lat)); setLon(String(p.lon)); }
  };

  const latN = parseFloat(lat.replace(',', '.'));
  const lonN = parseFloat(lon.replace(',', '.'));
  const coordsOk = Number.isFinite(latN) && Number.isFinite(lonN);

  const save = () => {
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? `obj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      name: name.trim() || undefined,
      number: number.trim() || undefined,
      lat: latN,
      lon: lonN,
      oblast: place.oblast,
      rayon: place.rayon,
      uchastok: uchastok.trim() || undefined,
      kato: place.kato,
      state: kind === 'mufta' ? state : undefined,
      endpointKind: kind === 'endpoint' ? endpointKind : undefined,
      date: date || undefined,
      note: note.trim() || undefined,
      feedFrom: feedFrom.trim() || undefined,
      feedTo: feedTo.trim() || undefined,
      model: model.trim() || undefined,
      cable: cable.trim() || undefined,
      fibers: numOrUndef(fibers),
      fiberUse: initial?.fiberUse,
      duct: duct.trim() || undefined,
      depthM: numOrUndef(depthM),
      spanM: numOrUndef(spanM),
      author: initial?.author ?? author,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      sync: 'local',
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-3 md:p-6"
         onClick={onClose}>
      <div className="w-full max-w-lg max-h-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl"
           onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)]">
          <h3 className="text-[14px] font-semibold text-[var(--text)] flex-1">
            {initial ? 'Объект' : 'Новый объект'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Закрыть"
                  className="btn btn-ghost btn-icon"><X size={16} /></button>
        </header>

        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            {SITE_OBJECT_KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`px-2.5 py-1 rounded text-[11.5px] border ${
                  kind === k
                    ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
                {SITE_OBJECT_SPECS[k].icon} {SITE_OBJECT_SPECS[k].label}
              </button>
            ))}
          </div>

          {kind === 'mufta' && (
            <div className="flex flex-wrap gap-1">
              {(Object.keys(MUFTA_STATES) as MuftaState[]).map((st) => (
                <button key={st} type="button" onClick={() => setState(st)}
                  className="px-2.5 py-1 rounded text-[11.5px] border"
                  style={{
                    borderColor: state === st ? MUFTA_STATES[st].color : 'var(--border)',
                    color: state === st ? MUFTA_STATES[st].color : 'var(--text-muted)',
                  }}>
                  {MUFTA_STATES[st].label}
                </button>
              ))}
            </div>
          )}

          {kind === 'endpoint' && (
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Что подключаем</span>
              <select value={endpointKind} onChange={(e) => setEndpointKind(e.target.value)}
                      className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]">
                {ENDPOINT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Название</span>
              <input value={name} onChange={(e) => setName(e.target.value)}
                     placeholder={SITE_OBJECT_SPECS[kind].label}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Номер</span>
              <input value={number} onChange={(e) => setNumber(e.target.value)}
                     placeholder="по проекту"
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono" />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-[var(--text-muted)]">Участок</span>
            <input list="obj-sections" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            <datalist id="obj-sections">
              {sections.slice(0, 400).map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] p-3 flex flex-col gap-2">
            <div className="flex gap-1">
              <button type="button" onClick={takeGps} disabled={geoBusy}
                      className="btn btn-ghost text-[10.5px] flex-1">
                {geoBusy ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
                Я здесь
              </button>
              {onRequestPick && (
                <button type="button" onClick={pickOnMap} className="btn btn-ghost text-[10.5px] flex-1">
                  <MapPin size={13} />На карте
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="широта"
                     className="bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono" />
              <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="долгота"
                     className="bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono" />
            </div>
            {geoNote && <span className="text-[10.5px] text-[var(--accent)]">{geoNote}</span>}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Дата</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Примечание</span>
              <input value={note} onChange={(e) => setNote(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
          </div>

          {/* Паспорт сети — вопросы аварийной бригады, а не стройки */}
          <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)]">
            <summary className="px-3 py-2 text-[11.5px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)]">
              Паспорт: кабель, волокна, глубина
            </summary>
            <div className="p-3 pt-0 grid grid-cols-2 gap-2">
              <Txt label="Питается от" value={feedFrom} onChange={setFeedFrom} ph="АТС Еленовка" />
              <Txt label="Питает" value={feedTo} onChange={setFeedTo} ph="Школа" />
              <Txt label="Тип / модель" value={model} onChange={setModel} ph="FOSC 400" />
              <Txt label="Кабель" value={cable} onChange={setCable} ph="ОК-24" />
              <Txt label="Волокон" value={fibers} onChange={(v) => setFibers(v.replace(/[^\d]/g, ''))} ph="24" mono />
              <Txt label="Труба" value={duct} onChange={setDuct} ph="МКТ 14/10" />
              <Txt label="Глубина, м" value={depthM} onChange={(v) => setDepthM(v.replace(/[^\d.,]/g, ''))} ph="1,2" mono />
              <Txt label="Пролёт, м" value={spanM} onChange={(v) => setSpanM(v.replace(/[^\d.,]/g, ''))} ph="2000" mono />
            </div>
          </details>

          <div className="flex gap-2 pt-1">
            <button type="button" className="btn btn-primary text-[12px]" disabled={!coordsOk} onClick={save}>
              <Check size={14} />Сохранить
            </button>
            <button type="button" className="btn btn-ghost text-[12px]" onClick={onClose}>Отменить</button>
          </div>
          {!coordsOk && (
            <p className="text-[10.5px] text-[var(--text-muted)]">
              Без координат объекта на карте не будет — возьмите точку с телефона
              или укажите на карте.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Число или ничего: пустое поле не должно превращаться в ноль. */
function numOrUndef(v: string): number | undefined {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function Txt({ label, value, onChange, ph, mono }: {
  label: string; value: string; onChange: (v: string) => void; ph?: string; mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-[var(--text-muted)]">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph}
             className={`bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]${
               mono ? ' font-mono tabular-nums' : ''}`} />
    </label>
  );
}
