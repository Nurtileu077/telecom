'use client';
import { useState, useMemo, useEffect } from 'react';
import { X, Check, Crosshair, MapPin, Loader2 } from 'lucide-react';
import { getCurrentPosition, positionErrorText } from './currentPosition';
import {
  Crew, CrewKind, CrewStatus, CrewMember,
  CREW_KINDS, CREW_KIND_LIST, CREW_STATUS, EQUIPMENT_KINDS,
} from '@/types/construction';
import { JournalState, suggestContractor } from './journalStore';

/**
 * Карточка колонны: вид работ, состояние, где стоит, состав и техника.
 * Положение можно задать здесь координатами, но обычно колонну просто
 * перетаскивают по карте.
 */

interface Props {
  journal: JournalState;
  initial?: Crew | null;
  onSave: (c: Crew) => void;
  onRequestPick?: (label: string) => Promise<{ lat: number; lon: number } | null>;
  onClose: () => void;
}

const STATUSES = Object.keys(CREW_STATUS) as CrewStatus[];

export default function CrewForm({ journal, initial, onSave, onRequestPick, onClose }: Props) {
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoNote, setGeoNote] = useState('');
  const [kind, setKind] = useState<CrewKind>(initial?.kind ?? 'mkt');
  const [name, setName] = useState(initial?.name ?? '');
  const [status, setStatus] = useState<CrewStatus>(initial?.status ?? 'working');
  const [contractor, setContractor] = useState(initial?.contractor ?? '');
  const [oblast, setOblast] = useState(initial?.oblast ?? '');
  const [rayon, setRayon] = useState(initial?.rayon ?? '');
  const [uchastok, setUchastok] = useState(initial?.uchastok ?? '');
  const [lat, setLat] = useState(initial?.lat !== undefined ? String(initial.lat) : '');
  const [lon, setLon] = useState(initial?.lon !== undefined ? String(initial.lon) : '');
  const [members, setMembers] = useState<CrewMember[]>(initial?.members ?? []);
  const [equipment, setEquipment] = useState<Record<string, string>>(() => {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(initial?.equipment ?? {})) e[k] = String(v);
    return e;
  });
  const [note, setNote] = useState(initial?.note ?? '');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const num = (v: string): number => {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };

  const uchastki = useMemo(() => {
    const s = new Set<string>();
    for (const g of journal.ground) if (g.uchastok) s.add(g.uchastok);
    for (const o of journal.orders) if (o.snp) s.add(o.snp);
    return [...s].sort((a, b) => a.localeCompare(b, 'ru')).slice(0, 400);
  }, [journal]);

  const oblasti = useMemo(() => {
    const s = new Set<string>();
    for (const g of journal.ground) if (g.oblast) s.add(g.oblast);
    for (const o of journal.orders) if (o.oblast) s.add(o.oblast);
    return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [journal]);

  const suggested = useMemo(
    () => suggestContractor(journal.contractors, oblast, rayon),
    [journal.contractors, oblast, rayon],
  );

  const onDuty = members.filter((m) => !m.dayOff).length;
  const canSave = !!name.trim();

  const submit = () => {
    setTouched(true);
    if (!canSave) return;
    const eq: Record<string, number> = {};
    for (const [k, v] of Object.entries(equipment)) {
      const n = num(v);
      if (Number.isFinite(n) && n > 0) eq[k] = n;
    }
    const la = num(lat);
    const lo = num(lon);
    onSave({
      id: initial?.id ?? `crew-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind, name: name.trim(), status,
      contractor: contractor.trim() || undefined,
      oblast: oblast.trim() || undefined,
      rayon: rayon.trim() || undefined,
      uchastok: uchastok.trim() || undefined,
      lat: Number.isFinite(la) ? la : undefined,
      lon: Number.isFinite(lo) ? lo : undefined,
      members: members.filter((m) => m.name.trim()).map((m) => ({
        name: m.name.trim(), role: m.role?.trim() || undefined, dayOff: m.dayOff || undefined,
      })),
      equipment: eq,
      note: note.trim() || undefined,
      updatedAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-stretch sm:items-center sm:justify-center sm:p-4">
      <div className="bg-[var(--bg-surface)] w-full sm:max-w-[560px] sm:rounded-xl border border-[var(--border)]
                      flex flex-col max-h-full sm:max-h-[90vh] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0"
             style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
          <span className="text-lg leading-none">{CREW_KINDS[kind].icon}</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {initial ? 'Колонна' : 'Новая колонна'}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] truncate">
              {name || 'Укажите название'} · в строю {onDuty} из {members.length}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon ml-auto" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          <Group title="Кто и чем занят">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1">
              {CREW_KIND_LIST.map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`py-1.5 px-1 text-[11px] rounded border transition-colors flex flex-col items-center gap-0.5 ${
                    kind === k ? 'border-current' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
                  style={kind === k ? { color: CREW_KINDS[k].color, background: `${CREW_KINDS[k].color}18` } : undefined}>
                  <span className="text-sm leading-none">{CREW_KINDS[k].icon}</span>
                  {CREW_KINDS[k].short}
                </button>
              ))}
            </div>
            <Field label="Название колонны" required
                   error={touched && !name.trim() ? 'Укажите название' : ''}>
              <input id="cr-name" value={name} onChange={(e) => setName(e.target.value)}
                     placeholder="1-колонна" className="inp" />
            </Field>
            <div className="grid grid-cols-4 gap-1">
              {STATUSES.map((s) => (
                <button key={s} type="button" onClick={() => setStatus(s)}
                  className={`py-1.5 text-[11px] rounded border transition-colors ${
                    status === s ? 'border-current' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
                  style={status === s ? { color: CREW_STATUS[s].color, background: `${CREW_STATUS[s].color}18` } : undefined}>
                  {CREW_STATUS[s].label}
                </button>
              ))}
            </div>
          </Group>

          <Group title="Где стоит">
            <Field label="Участок">
              <input id="cr-uch" list="cr-uchastki" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                     placeholder="сущ. ОМ - Акбеит" className="inp" />
              <datalist id="cr-uchastki">{uchastki.map((u) => <option key={u} value={u} />)}</datalist>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Область">
                <input id="cr-obl" list="cr-oblasti" value={oblast} onChange={(e) => setOblast(e.target.value)} className="inp" />
                <datalist id="cr-oblasti">{oblasti.map((o) => <option key={o} value={o} />)}</datalist>
              </Field>
              <Field label="Район">
                <input id="cr-rayon" value={rayon} onChange={(e) => setRayon(e.target.value)} className="inp" />
              </Field>
            </div>
            <Field label="Подрядчик">
              <input id="cr-contr" list="cr-contractors" value={contractor}
                     onChange={(e) => setContractor(e.target.value)}
                     placeholder={suggested ? suggested.name : 'TERRA TECH'} className="inp" />
              <datalist id="cr-contractors">
                {journal.contractors.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Широта">
                <input id="cr-lat" inputMode="decimal" value={lat}
                       onChange={(e) => setLat(e.target.value.replace(/[^\d.,-]/g, ''))}
                       placeholder="52.09" className="inp font-mono" />
              </Field>
              <Field label="Долгота">
                <input id="cr-lon" inputMode="decimal" value={lon}
                       onChange={(e) => setLon(e.target.value.replace(/[^\d.,-]/g, ''))}
                       placeholder="69.41" className="inp font-mono" />
              </Field>
            </div>
            <div className="flex gap-1">
              <button type="button" disabled={geoBusy} className="btn btn-ghost text-[10.5px] flex-1"
                      title="Взять координаты с устройства"
                      onClick={async () => {
                        setGeoBusy(true); setGeoNote('');
                        try {
                          const pos = await getCurrentPosition();
                          setLat(pos.lat.toFixed(6)); setLon(pos.lon.toFixed(6));
                          setGeoNote(`Точность ±${pos.accuracyM} м`);
                        } catch (e) { setGeoNote(positionErrorText(e)); }
                        finally { setGeoBusy(false); }
                      }}>
                {geoBusy ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
                Колонна здесь
              </button>
              {onRequestPick && (
                <button type="button" className="btn btn-ghost text-[10.5px] flex-1"
                        title="Указать место на карте"
                        onClick={async () => {
                          const p = await onRequestPick(`колонна ${name || ''}`.trim());
                          if (p) { setLat(p.lat.toFixed(6)); setLon(p.lon.toFixed(6)); }
                        }}>
                  <MapPin size={13} />На карте
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-[var(--text-muted)] -mt-1">
              Координаты можно не заполнять: поставьте колонну на карту перетаскиванием.
              {geoNote && <span className="text-[var(--accent)]"> {geoNote}</span>}
            </p>
          </Group>

          <Group title={`Состав — в строю ${onDuty} из ${members.length}`}>
            {members.map((m, i) => (
              <div key={i} className="flex gap-2 items-end">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-[10.5px] text-[var(--text-muted)]">ФИО</span>
                  <input value={m.name} placeholder="Какенов Е.А."
                         onChange={(e) => setMembers((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                         className="inp" />
                </label>
                <label className="flex flex-col gap-1 w-[34%]">
                  <span className="text-[10.5px] text-[var(--text-muted)]">Должность</span>
                  <input value={m.role ?? ''} placeholder="мастер участка"
                         onChange={(e) => setMembers((p) => p.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
                         className="inp" />
                </label>
                <button type="button" title={m.dayOff ? 'Вернуть в строй' : 'Отметить выходной'}
                        onClick={() => setMembers((p) => p.map((x, j) => j === i ? { ...x, dayOff: !x.dayOff } : x))}
                        className="btn btn-ghost btn-icon mb-0.5 text-[11px]"
                        style={m.dayOff ? { color: 'var(--danger)' } : undefined}>
                  {m.dayOff ? 'вых' : '✓'}
                </button>
                <button type="button" title="Убрать"
                        onClick={() => setMembers((p) => p.filter((_, j) => j !== i))}
                        className="btn btn-ghost btn-icon mb-0.5 text-[var(--text-muted)] hover:text-[var(--danger)]">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setMembers((p) => [...p, { name: '' }])}
                    className="self-start text-[11px] text-[var(--accent)] hover:underline">
              + Добавить сотрудника
            </button>
          </Group>

          <Group title="Техника">
            <div className="grid grid-cols-2 gap-2">
              {EQUIPMENT_KINDS.map((k) => (
                <label key={k} className="flex flex-col gap-1">
                  <span className="text-[10.5px] text-[var(--text-muted)] truncate" title={k}>{k}</span>
                  <div className="relative">
                    <input inputMode="numeric" value={equipment[k] ?? ''} placeholder="0"
                           onChange={(e) => setEquipment((p) => ({ ...p, [k]: e.target.value.replace(/[^\d]/g, '') }))}
                           className="inp pr-7 font-mono tabular-nums" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">шт</span>
                  </div>
                </label>
              ))}
            </div>
          </Group>

          <Field label="Примечание">
            <textarea id="cr-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                      placeholder="Ждут ГНБ, перебазирование на Кызылегис" className="inp resize-none" />
          </Field>
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)] shrink-0"
             style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary flex-1" onClick={submit} disabled={!canSave}>
            <Check size={15} />Сохранить
          </button>
        </div>
      </div>

      <style jsx global>{`
        .inp {
          width: 100%;
          background: var(--bg-canvas);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 7px 9px;
          font-size: 13px;
          color: var(--text);
        }
        .inp:focus { outline: none; border-color: var(--accent); }
        .inp::placeholder { color: var(--text-muted); }
      `}</style>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, children, required, error }: {
  label: string; children: React.ReactNode; required?: boolean; error?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--text-muted)]">
        {label}{required && <span className="text-[var(--danger)] ml-0.5">*</span>}
      </span>
      {children}
      {error && <span className="text-[10.5px] text-[var(--danger)]">{error}</span>}
    </label>
  );
}
