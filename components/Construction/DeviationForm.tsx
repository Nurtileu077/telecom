'use client';
import { useState, useMemo, useEffect } from 'react';
import { X, Check, AlertTriangle, FileWarning } from 'lucide-react';
import {
  Deviation, DeviationKind, DEVIATION_KIND_LABEL, DEVIATION_REASONS,
  DESIGN_DEPTH_M, needsProtocol, isKzLat, isKzLon,
} from '@/types/construction';
import { JournalState, suggestContractor } from './journalStore';

/**
 * Отклонение от проекта: по глубине или по трассе.
 *
 * Когда фактическая глубина меньше проектной, требуется протокол мобильной
 * группы — его номер уходит в Приложение 12 (ОДС/П-14-4-4-01), в пункт
 * «допущены отклонения от проектно-сметной документации». Форма показывает
 * это требование сразу, как только цифры расходятся, а не при сдаче.
 */

interface Props {
  journal: JournalState;
  initial?: Deviation | null;
  onSave: (d: Deviation) => void;
  onClose: () => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const numToStr = (v?: number) => (v === undefined || v === null ? '' : String(v));

export default function DeviationForm({ journal, initial, onSave, onClose }: Props) {
  const [kind, setKind] = useState<DeviationKind>(initial?.kind ?? 'depth');
  const [date, setDate] = useState(initial?.date ?? todayIso);
  const [oblast, setOblast] = useState(initial?.oblast ?? '');
  const [rayon, setRayon] = useState(initial?.rayon ?? '');
  const [uchastok, setUchastok] = useState(initial?.uchastok ?? '');
  const [kato, setKato] = useState(initial?.kato ?? '');
  const [contractor, setContractor] = useState(initial?.contractor ?? '');
  const [fromPoint, setFromPoint] = useState(initial?.fromPoint ?? '');
  const [toPoint, setToPoint] = useState(initial?.toPoint ?? '');
  const [lengthM, setLengthM] = useState(numToStr(initial?.lengthM));
  const [designDepth, setDesignDepth] = useState(numToStr(initial?.designDepthM ?? DESIGN_DEPTH_M));
  const [actualDepth, setActualDepth] = useState(numToStr(initial?.actualDepthM));
  const [latA, setLatA] = useState(initial?.coords?.[0] ? String(initial.coords[0].lat) : '');
  const [lonA, setLonA] = useState(initial?.coords?.[0] ? String(initial.coords[0].lon) : '');
  const [latB, setLatB] = useState(initial?.coords?.[1] ? String(initial.coords[1].lat) : '');
  const [lonB, setLonB] = useState(initial?.coords?.[1] ? String(initial.coords[1].lon) : '');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [protoNumber, setProtoNumber] = useState(initial?.protocol?.number ?? '');
  const [protoDate, setProtoDate] = useState(initial?.protocol?.date ?? '');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const num = (v: string): number => {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
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

  // Подставляем привязку по уже введённым дням того же участка
  useEffect(() => {
    if (!uchastok) return;
    const prev = journal.ground.find((g) => g.uchastok === uchastok);
    if (prev) {
      if (!kato) setKato(prev.kato);
      if (!oblast) setOblast(prev.oblast);
      if (!rayon && prev.rayon) setRayon(prev.rayon);
      if (!contractor && prev.contractor) setContractor(prev.contractor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uchastok]);

  const suggested = useMemo(
    () => suggestContractor(journal.contractors, oblast, rayon),
    [journal.contractors, oblast, rayon],
  );

  /**
   * Координаты отклонения: начало обязательно, конец нет.
   * Одна точка — отметка на карте, две — отрезок трассы.
   * Проверка по границам Казахстана отсекает опечатки вроде
   * перепутанных широты и долготы.
   */
  const buildCoords = (): { lat: number; lon: number }[] | undefined => {
    const pts: { lat: number; lon: number }[] = [];
    const a = { lat: num(latA), lon: num(lonA) };
    if (isKzLat(a.lat) && isKzLon(a.lon)) pts.push(a);
    const b = { lat: num(latB), lon: num(lonB) };
    if (isKzLat(b.lat) && isKzLon(b.lon)) pts.push(b);
    return pts.length ? pts : undefined;
  };

  const coordsTouched = !!(latA || lonA || latB || lonB);
  const coordsValid = !coordsTouched || !!buildCoords();

  const draft = {
    kind,
    designDepthM: kind === 'depth' ? num(designDepth) : undefined,
    actualDepthM: kind === 'depth' && actualDepth ? num(actualDepth) : undefined,
  };
  const protocolRequired = needsProtocol(draft);
  const protocolFilled = !!protoNumber.trim() && !!protoDate;

  const depthOk = kind !== 'depth' || !!actualDepth;
  const canSave = !!date && !!uchastok.trim() && !!reason.trim() && num(lengthM) > 0 && depthOk;

  const submit = () => {
    setTouched(true);
    if (!canSave) return;
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind, date,
      oblast: oblast.trim(), rayon: rayon.trim() || undefined,
      uchastok: uchastok.trim(), kato: kato.trim(),
      contractor: contractor.trim() || undefined,
      fromPoint: fromPoint.trim() || undefined,
      toPoint: toPoint.trim() || undefined,
      lengthM: Math.round(num(lengthM)),
      designDepthM: kind === 'depth' ? num(designDepth) : undefined,
      actualDepthM: kind === 'depth' && actualDepth ? num(actualDepth) : undefined,
      coords: buildCoords(),
      reason: reason.trim(),
      protocol: protocolFilled
        ? { number: protoNumber.trim(), date: protoDate }
        : initial?.protocol && !protoNumber.trim() ? undefined : initial?.protocol,
      author: initial?.author ?? '',
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      sync: 'local',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-stretch sm:items-center sm:justify-center sm:p-4">
      <div className="bg-[var(--bg-surface)] w-full sm:max-w-[560px] sm:rounded-xl border border-[var(--border)]
                      flex flex-col max-h-full sm:max-h-[90vh] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0"
             style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {initial ? 'Отклонение от проекта' : 'Зафиксировать отклонение'}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] truncate">
              {uchastok || 'Выберите участок'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon ml-auto" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          <div className="flex gap-1 bg-[var(--bg-canvas)] p-0.5 rounded-md">
            {(['depth', 'route'] as DeviationKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`flex-1 py-1.5 text-[12px] rounded transition-colors ${
                  kind === k ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-medium' : 'text-[var(--text-muted)]'}`}>
                {DEVIATION_KIND_LABEL[k]}
              </button>
            ))}
          </div>

          <Group title="Где и когда">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Дата">
                <input id="dv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="inp" />
              </Field>
              <Field label="Протяжённость" required
                     error={touched && !(num(lengthM) > 0) ? 'Укажите метры' : ''}>
                <div className="relative">
                  <input id="dv-len" inputMode="decimal" value={lengthM}
                         onChange={(e) => setLengthM(e.target.value.replace(/[^\d.,]/g, ''))}
                         placeholder="0" className="inp pr-7 font-mono tabular-nums" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">м</span>
                </div>
              </Field>
            </div>
            <Field label="Участок" required error={touched && !uchastok.trim() ? 'Укажите участок' : ''}>
              <input id="dv-uch" list="dv-uchastki" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                     placeholder="от муфты №4 ОК-714 до школы с. Акадыр" className="inp" />
              <datalist id="dv-uchastki">{uchastki.map((u) => <option key={u} value={u} />)}</datalist>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Область">
                <input id="dv-obl" list="dv-oblasti" value={oblast} onChange={(e) => setOblast(e.target.value)} className="inp" />
                <datalist id="dv-oblasti">{oblasti.map((o) => <option key={o} value={o} />)}</datalist>
              </Field>
              <Field label="Район">
                <input id="dv-rayon" value={rayon} onChange={(e) => setRayon(e.target.value)} className="inp" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Подрядчик">
                <input id="dv-contr" list="dv-contractors" value={contractor}
                       onChange={(e) => setContractor(e.target.value)}
                       placeholder={suggested ? suggested.name : 'TERRA TECH'} className="inp" />
                <datalist id="dv-contractors">
                  {journal.contractors.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </Field>
              <Field label="КАТО">
                <input id="dv-kato" value={kato} onChange={(e) => setKato(e.target.value)}
                       inputMode="numeric" className="inp font-mono" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Начало участка">
                <input id="dv-from" value={fromPoint} onChange={(e) => setFromPoint(e.target.value)}
                       placeholder="ПК или ориентир" className="inp" />
              </Field>
              <Field label="Конец участка">
                <input id="dv-to" value={toPoint} onChange={(e) => setToPoint(e.target.value)}
                       placeholder="ПК или ориентир" className="inp" />
              </Field>
            </div>
          </Group>

          <Group title="Координаты — чтобы отклонение было видно на карте">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Широта начала">
                <input id="dv-lat-a" inputMode="decimal" value={latA}
                       onChange={(e) => setLatA(e.target.value.replace(/[^\d.,-]/g, ''))}
                       placeholder="44.480565" className="inp font-mono" />
              </Field>
              <Field label="Долгота начала">
                <input id="dv-lon-a" inputMode="decimal" value={lonA}
                       onChange={(e) => setLonA(e.target.value.replace(/[^\d.,-]/g, ''))}
                       placeholder="52.091435" className="inp font-mono" />
              </Field>
              <Field label="Широта конца">
                <input id="dv-lat-b" inputMode="decimal" value={latB}
                       onChange={(e) => setLatB(e.target.value.replace(/[^\d.,-]/g, ''))}
                       placeholder="необяз." className="inp font-mono" />
              </Field>
              <Field label="Долгота конца">
                <input id="dv-lon-b" inputMode="decimal" value={lonB}
                       onChange={(e) => setLonB(e.target.value.replace(/[^\d.,-]/g, ''))}
                       placeholder="необяз." className="inp font-mono" />
              </Field>
            </div>
            <p className="text-[10.5px] text-[var(--text-muted)] -mt-1">
              Одна точка — отметка на карте, две — отрезок трассы.
              {coordsTouched && !coordsValid && (
                <span className="text-[var(--danger)]"> Координаты вне границ Казахстана — проверьте порядок широты и долготы.</span>
              )}
            </p>
          </Group>

          {kind === 'depth' && (
            <Group title="Глубина прокладки">
              <div className="grid grid-cols-2 gap-2">
                <Field label="По проекту">
                  <div className="relative">
                    <input id="dv-design" inputMode="decimal" value={designDepth}
                           onChange={(e) => setDesignDepth(e.target.value.replace(/[^\d.,]/g, ''))}
                           className="inp pr-7 font-mono tabular-nums" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">м</span>
                  </div>
                </Field>
                <Field label="Фактически" required
                       error={touched && !actualDepth ? 'Укажите фактическую глубину' : ''}>
                  <div className="relative">
                    <input id="dv-actual" inputMode="decimal" value={actualDepth}
                           onChange={(e) => setActualDepth(e.target.value.replace(/[^\d.,]/g, ''))}
                           placeholder="0,5" className="inp pr-7 font-mono tabular-nums" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">м</span>
                  </div>
                </Field>
              </div>
            </Group>
          )}

          <Field label="Причина" required error={touched && !reason.trim() ? 'Укажите причину' : ''}>
            <input id="dv-reason" list="dv-reasons" value={reason} onChange={(e) => setReason(e.target.value)}
                   placeholder="Скальный грунт" className="inp" />
            <datalist id="dv-reasons">{DEVIATION_REASONS.map((r) => <option key={r} value={r} />)}</datalist>
          </Field>

          {protocolRequired && (
            <div className="rounded-lg border p-3 flex flex-col gap-2"
                 style={{
                   borderColor: protocolFilled ? 'var(--success)' : 'var(--warn)',
                   background: protocolFilled ? 'color-mix(in srgb, var(--success) 8%, transparent)'
                                              : 'color-mix(in srgb, var(--warn) 10%, transparent)',
                 }}>
              <div className="flex items-start gap-2">
                <FileWarning size={15} className="shrink-0 mt-0.5"
                             style={{ color: protocolFilled ? 'var(--success)' : 'var(--warn)' }} />
                <p className="text-[11.5px] leading-snug" style={{ color: 'var(--text)' }}>
                  {kind === 'route'
                    ? 'Изменение трассы требует протокола мобильной группы.'
                    : `Фактическая глубина ниже проектной — нужен протокол мобильной группы.`}
                  <span className="text-[var(--text-muted)]"> Его номер уходит в Приложение 12, пункт об отклонениях от ПСД.</span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Протокол №">
                  <input id="dv-proto-n" value={protoNumber} onChange={(e) => setProtoNumber(e.target.value)}
                         placeholder="например 14" className="inp" />
                </Field>
                <Field label="Дата протокола">
                  <input id="dv-proto-d" type="date" value={protoDate}
                         onChange={(e) => setProtoDate(e.target.value)} className="inp" />
                </Field>
              </div>
              {!protocolFilled && (
                <p className="text-[11px] text-[var(--text-muted)]">
                  Можно сохранить и без протокола — отклонение попадёт в список незакрытых.
                </p>
              )}
            </div>
          )}

          {touched && !canSave && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[11.5px] text-[var(--warn)]">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>Заполните участок, протяжённость, причину{kind === 'depth' ? ' и фактическую глубину' : ''}.</span>
            </div>
          )}
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
