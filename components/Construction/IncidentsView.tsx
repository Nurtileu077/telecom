'use client';
import { useMemo, useState } from 'react';
import {
  Siren, MapPin, Plus, Trash2, Check, AlertTriangle, History,
} from 'lucide-react';
import {
  Incident, IncidentCause, INCIDENT_CAUSES,
  MaterialKind, MATERIAL_KINDS, MATERIAL_UNIT,
} from '@/types/construction';
import { JournalState, MATERIAL_LABEL, fmtMeters, distinct, plural } from './journalStore';
import {
  openIncidents, incidentHours, incidentContext, nearbyIncidents,
  problemSpots, incidentStats,
} from './incidents';
import { getCurrentPosition, positionErrorText } from './currentPosition';

/**
 * Аварии и эксплуатация.
 *
 * Это тот экран, ради которого журнал стройки живёт после сдачи. Обычный
 * учёт аварий знает про аварию только саму аварию. Здесь под каждой лежит
 * стройка: глубина в этом месте, способ прокладки, подрядчик и причина
 * отклонения — то самое «кабель на 0,5 м, потому что скальник», которое
 * читает бригада, приехавшая на обрыв.
 */

interface Props {
  journal: JournalState;
  author: string;
  onSave: (i: Incident) => void;
  onRemove: (id: string) => void;
  onRequestPick?: (label: string) => Promise<{ lat: number; lon: number } | null>;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function IncidentsView({
  journal, author, onSave, onRemove, onRequestPick,
}: Props) {
  const [editing, setEditing] = useState<Incident | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = journal.incidents;
  const open = useMemo(() => openIncidents(list), [list]);
  const stats = useMemo(() => incidentStats(list), [list]);
  const spots = useMemo(() => problemSpots(list), [list]);
  const sorted = useMemo(
    () => [...list].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)),
    [list],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="text-[11.5px] text-[var(--text-muted)] flex-1">
          Под каждой аварией видно, что известно про это место по журналу
          стройки: глубина, способ, подрядчик, причина отклонения.
        </p>
        <button type="button" className="btn btn-primary text-[11px] shrink-0"
                onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus size={14} />Авария
        </button>
      </div>

      {list.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Kpi label="Всего" value={String(stats.total)} />
          <Kpi label="Открыто" value={String(stats.open)} warn={stats.open > 0} />
          <Kpi label="Среднее устранение"
               value={stats.avgHours === null ? '—' : String(stats.avgHours)}
               note={stats.avgHours === null ? 'нет закрытых' : 'часов'} />
          <Kpi label="Проблемных мест" value={String(stats.spots)}
               note="рвётся не в первый раз" warn={stats.spots > 0} />
        </div>
      )}

      {spots.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <History size={12} />Здесь рвётся чаще
          </h4>
          {spots.slice(0, 6).map((s, i) => (
            <div key={i} className="flex items-baseline gap-2 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-1.5">
              <span className="text-[12px] text-[var(--text)]">
                {s.place || `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`}
              </span>
              {s.topCause && (
                <span className="text-[11px] text-[var(--text-muted)]">чаще всего — {s.topCause}</span>
              )}
              <span className="ml-auto font-mono text-[11px] text-[var(--warn)]">
                {s.count} {plural(s.count, 'раз', 'раза', 'раз')}
              </span>
            </div>
          ))}
          <p className="text-[10.5px] text-[var(--text-muted)]">
            Одна авария — событие, две в одном месте — закономерность.
            Это список для профилактики, а не для отчёта.
          </p>
        </section>
      )}

      {list.length === 0 ? (
        <div className="text-center py-12 flex flex-col items-center gap-2">
          <Siren size={22} className="text-[var(--text-muted)]" />
          <p className="text-[12.5px] text-[var(--text-muted)] max-w-sm">
            Аварий нет. Это хорошая новость — и заодно пустой экран: он
            наполнится, когда сеть пойдёт в эксплуатацию.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Сначала открытые: они требуют выезда сегодня. Устранённые —
              ниже и отдельно, потому что через год важно не то, что их
              закрыли, а что они были. */}
          {([
            ['Открытые', open],
            ['Устранённые', sorted.filter((i) => !!i.fixedAt)],
          ] as [string, typeof sorted][]).map(([title, group]) => (
            group.length === 0 ? null : (
              <div key={title} className="flex flex-col gap-2">
                <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {title} ({group.length})
                </h4>
                {group.map((i) => (
                  <IncidentCard
                    key={i.id}
                    incident={i}
                    journal={journal}
                    open={expanded === i.id}
                    onToggle={() => setExpanded(expanded === i.id ? null : i.id)}
                    onEdit={() => { setEditing(i); setFormOpen(true); }}
                    onRemove={() => onRemove(i.id)}
                    onClose={() => onSave({ ...i, fixedAt: new Date().toISOString() })}
                  />
                ))}
              </div>
            )
          ))}
        </div>
      )}

      {formOpen && (
        <IncidentForm
          journal={journal}
          initial={editing}
          author={author}
          onRequestPick={onRequestPick}
          onSave={(i) => { onSave(i); setFormOpen(false); setEditing(null); }}
          onClose={() => { setFormOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, note, warn }: {
  label: string; value: string; note?: string; warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="text-[18px] font-semibold leading-tight"
           style={{ color: warn ? 'var(--warn)' : 'var(--text)' }}>{value}</div>
      {note && <div className="text-[10.5px] text-[var(--text-muted)]">{note}</div>}
    </div>
  );
}

function IncidentCard({ incident, journal, open, onToggle, onEdit, onRemove, onClose }: {
  incident: Incident;
  journal: JournalState;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ctx = useMemo(
    () => incidentContext(incident, {
      ground: journal.ground,
      deviations: journal.deviations,
      objects: journal.objects,
    }),
    [incident, journal.ground, journal.deviations, journal.objects],
  );
  const history = useMemo(
    () => nearbyIncidents(journal.incidents, incident.lat, incident.lon, 300, incident.id),
    [journal.incidents, incident],
  );

  const hours = incidentHours(incident);
  const isOpen = !incident.fixedAt;
  const when = new Date(incident.reportedAt);

  return (
    <div className="rounded-lg border bg-[var(--bg-surface)] px-3 py-2 flex flex-col gap-1.5"
         style={{ borderColor: isOpen ? 'var(--danger)' : 'var(--border)' }}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[12.5px] text-[var(--text)]">{incident.damage}</span>
        <span className="text-[10.5px] text-[var(--text-muted)] truncate">
          {[incident.uchastok, incident.rayon].filter(Boolean).join(', ')}
        </span>
        {incident.cause && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-muted)]">
            {incident.cause}
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">
          {Number.isNaN(when.getTime()) ? '—' : when.toLocaleString('ru', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit',
          })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span style={{ color: isOpen ? 'var(--danger)' : 'var(--accent)' }}>
          {isOpen ? '● открыта' : '● устранена'}
        </span>
        {hours !== null && <span>за {hours} ч</span>}
        {incident.crew && <span>{incident.crew}</span>}
        {incident.reporter && <span>заявил {incident.reporter}</span>}
        {history.length > 0 && (
          <span className="text-[var(--warn)]">
            здесь уже рвалось {history.length} {plural(history.length, 'раз', 'раза', 'раз')}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={onToggle} className="text-[var(--accent)] hover:underline">
            {open ? 'свернуть' : 'что здесь построено'}
          </button>
          {isOpen && (
            <button type="button" onClick={onClose} title="Отметить устранённой"
                    className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--accent)]">
              <Check size={13} />
            </button>
          )}
          <button type="button" onClick={onEdit} className="text-[var(--text-muted)] hover:text-[var(--accent)]">
            изменить
          </button>
          <button type="button" onClick={onRemove}
                  className="text-[var(--text-muted)] hover:text-[var(--danger)]">
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {open && (
        <div className="flex flex-col gap-1 pt-1.5 border-t border-[var(--border)]">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
            {ctx.depthM !== undefined ? (
              <span>
                глубина <b className="text-[var(--text)]">{String(ctx.depthM).replace('.', ',')} м</b>
                {ctx.depthFrom && ` (${ctx.depthFrom})`}
              </span>
            ) : (
              <span>глубина не записана</span>
            )}
            {ctx.method && <span>{ctx.method}</span>}
            {ctx.contractor && <span>{ctx.contractor}</span>}
            {ctx.builtAt && (
              <span>построено {new Date(`${ctx.builtAt}T00:00:00Z`).toLocaleDateString('ru')}</span>
            )}
            {ctx.object && (
              <span>рядом {ctx.object.name || ctx.object.kind}</span>
            )}
          </div>
          {ctx.deviation && (
            <div className="flex items-start gap-1.5 text-[11px] text-[var(--warn)]">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>Здесь было отклонение: {ctx.deviation}</span>
            </div>
          )}
          {!ctx.method && !ctx.contractor && (
            <p className="text-[11px] text-[var(--text-muted)]">
              По этому месту в журнале стройки записей нет — ни села, ни участка
              не удалось сопоставить.
            </p>
          )}
          {incident.materials && Object.keys(incident.materials).length > 0 && (
            <p className="text-[11px] text-[var(--text-muted)]">
              Ушло: {Object.entries(incident.materials)
                .filter(([, v]) => v)
                .map(([k, v]) => `${MATERIAL_LABEL[k as MaterialKind] ?? k} — ${
                  MATERIAL_UNIT[k as MaterialKind] === 'м' ? fmtMeters(v as number) : `${v} шт`}`)
                .join(', ')}
            </p>
          )}
          {history.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {history.slice(0, 5).map((h) => (
                <div key={h.id} className="text-[10.5px] text-[var(--text-muted)]">
                  {new Date(h.reportedAt).toLocaleDateString('ru')} — {h.damage}
                  {h.cause ? ` · ${h.cause}` : ''}
                </div>
              ))}
            </div>
          )}
          {incident.note && <p className="text-[11px] text-[var(--text-muted)]">{incident.note}</p>}
        </div>
      )}
    </div>
  );
}

function IncidentForm({ journal, initial, author, onSave, onClose, onRequestPick }: {
  journal: JournalState;
  initial: Incident | null;
  author: string;
  onSave: (i: Incident) => void;
  onClose: () => void;
  onRequestPick?: (label: string) => Promise<{ lat: number; lon: number } | null>;
}) {
  const [damage, setDamage] = useState(initial?.damage ?? '');
  const [reporter, setReporter] = useState(initial?.reporter ?? '');
  const [cause, setCause] = useState<IncidentCause | ''>(initial?.cause ?? '');
  const [crew, setCrew] = useState(initial?.crew ?? '');
  const [uchastok, setUchastok] = useState(initial?.uchastok ?? '');
  const [date, setDate] = useState((initial?.reportedAt ?? new Date().toISOString()).slice(0, 10));
  const [time, setTime] = useState((initial?.reportedAt ?? new Date().toISOString()).slice(11, 16));
  const [fixed, setFixed] = useState(!!initial?.fixedAt);
  const [fixedDate, setFixedDate] = useState((initial?.fixedAt ?? new Date().toISOString()).slice(0, 10));
  const [hours, setHours] = useState(initial?.hours ? String(initial.hours) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [lat, setLat] = useState(initial ? String(initial.lat) : '');
  const [lon, setLon] = useState(initial ? String(initial.lon) : '');
  const [geoNote, setGeoNote] = useState('');
  const [materials, setMaterials] = useState<Partial<Record<MaterialKind, string>>>(
    () => Object.fromEntries(
      Object.entries(initial?.materials ?? {}).map(([k, v]) => [k, String(v)]),
    ) as Partial<Record<MaterialKind, string>>,
  );

  const sections = useMemo(() => distinct(journal.ground, (e) => e.uchastok), [journal.ground]);
  const place = useMemo(() => {
    const hit = journal.ground.find((e) => e.uchastok === uchastok);
    return { oblast: hit?.oblast, rayon: hit?.rayon, kato: hit?.kato };
  }, [journal.ground, uchastok]);

  const latN = parseFloat(lat.replace(',', '.'));
  const lonN = parseFloat(lon.replace(',', '.'));
  const coordsOk = Number.isFinite(latN) && Number.isFinite(lonN);
  const canSave = !!damage.trim() && coordsOk;

  const takeGps = async () => {
    setGeoNote('');
    try {
      const pos = await getCurrentPosition();
      setLat(String(pos.lat)); setLon(String(pos.lon));
      setGeoNote(`Точность ±${pos.accuracyM} м`);
    } catch (e) {
      setGeoNote(positionErrorText(e));
    }
  };

  const save = () => {
    if (!canSave) return;
    const now = new Date().toISOString();
    const mats: Partial<Record<MaterialKind, number>> = {};
    for (const [k, v] of Object.entries(materials)) {
      const n = parseFloat((v ?? '').replace(',', '.'));
      if (Number.isFinite(n) && n > 0) mats[k as MaterialKind] = n;
    }
    const h = parseFloat(hours.replace(',', '.'));
    onSave({
      id: initial?.id ?? `inc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      reportedAt: `${date}T${time || '00:00'}:00.000Z`,
      fixedAt: fixed ? `${fixedDate}T12:00:00.000Z` : undefined,
      lat: latN, lon: lonN,
      oblast: place.oblast, rayon: place.rayon, kato: place.kato,
      uchastok: uchastok.trim() || undefined,
      damage: damage.trim(),
      reporter: reporter.trim() || undefined,
      cause: cause || undefined,
      crew: crew.trim() || undefined,
      hours: Number.isFinite(h) && h > 0 ? h : undefined,
      materials: Object.keys(mats).length ? mats : undefined,
      note: note.trim() || undefined,
      author: initial?.author ?? author,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      sync: 'local',
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-3 md:p-6"
         onClick={onClose}>
      <div className="w-full max-w-lg max-h-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]"
           onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)]">
          <h3 className="text-[14px] font-semibold text-[var(--text)] flex-1">
            {initial ? 'Авария' : 'Новая авария'}
          </h3>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon">✕</button>
        </header>

        <div className="p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-[var(--text-muted)]">Что повреждено</span>
            <input value={damage} onChange={(e) => setDamage(e.target.value)}
                   placeholder="ОК-24, 2 волокна"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Дата заявки</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Время</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Кто заявил</span>
              <input value={reporter} onChange={(e) => setReporter(e.target.value)}
                     placeholder="аким, житель, оператор"
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Участок</span>
              <input list="inc-sections" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
              <datalist id="inc-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Широта</span>
              <input value={lat} onChange={(e) => setLat(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Долгота</span>
              <input value={lon} onChange={(e) => setLon(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn text-[11px]" onClick={takeGps}>
              <MapPin size={13} />Я здесь
            </button>
            {onRequestPick && (
              <button type="button" className="btn text-[11px]"
                      onClick={async () => {
                        const p = await onRequestPick('место аварии');
                        if (p) { setLat(String(p.lat)); setLon(String(p.lon)); }
                      }}>
                Указать на карте
              </button>
            )}
            {geoNote && <span className="text-[10.5px] text-[var(--text-muted)]">{geoNote}</span>}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-[var(--text-muted)]">Причина</span>
            <select value={cause} onChange={(e) => setCause(e.target.value as IncidentCause | '')}
                    className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]">
              <option value="">не установлена</option>
              {INCIDENT_CAUSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-[10.5px] text-[var(--text-muted)]">
              Ставится при закрытии: три «экскаватора» в одном месте — это
              отсутствие знаков, а не невезение.
            </span>
          </label>

          <label className="flex items-center gap-2 text-[12px] text-[var(--text)] cursor-pointer">
            <input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)}
                   className="accent-[var(--accent)]" />
            Устранена
          </label>

          {fixed && (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] text-[var(--text-muted)]">Дата устранения</span>
                <input type="date" value={fixedDate} onChange={(e) => setFixedDate(e.target.value)}
                       className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] text-[var(--text-muted)]">Часов на устранение</span>
                <input value={hours} inputMode="decimal"
                       onChange={(e) => setHours(e.target.value.replace(/[^\d.,]/g, ''))}
                       placeholder="по времени заявки"
                       className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono" />
              </label>
              <label className="flex flex-col gap-1 col-span-2">
                <span className="text-[10.5px] text-[var(--text-muted)]">Кто устранял</span>
                <input value={crew} onChange={(e) => setCrew(e.target.value)}
                       className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
              </label>
            </div>
          )}

          <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)]">
            <summary className="px-3 py-2 text-[11.5px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)]">
              Что ушло на устранение
            </summary>
            <div className="p-3 pt-0 grid grid-cols-3 gap-2">
              {MATERIAL_KINDS.map((m) => (
                <label key={m} className="flex flex-col gap-1">
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {MATERIAL_LABEL[m]}, {MATERIAL_UNIT[m]}
                  </span>
                  <input value={materials[m] ?? ''} inputMode="decimal"
                         onChange={(e) => setMaterials((p) => ({
                           ...p, [m]: e.target.value.replace(/[^\d.,]/g, ''),
                         }))}
                         className="bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1 text-[12px] text-[var(--text)] font-mono tabular-nums" />
                </label>
              ))}
            </div>
          </details>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-[var(--text-muted)]">Примечание</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                      className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] resize-none" />
          </label>
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)] sticky bottom-0 bg-[var(--bg-surface)]">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary flex-1" disabled={!canSave} onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
