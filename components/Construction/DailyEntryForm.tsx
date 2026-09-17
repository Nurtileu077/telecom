'use client';
import { useState, useMemo, useEffect } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import {
  WorkTech, WORK_TECHS, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
  MaterialKind, MATERIAL_KINDS, MATERIAL_UNIT, DailyWorkEntry,
} from '@/types/construction';
import { JournalState, loadLastContext, saveLastContext, MATERIAL_LABEL } from './journalStore';

/**
 * Закрытие рабочего дня.
 *
 * Метры, а не километры: в поле считают метрами, а перевод в километры для
 * отчётности система делает сама. Контекст (СМУ, область, участок) подставляется
 * из прошлой записи — назавтра бригаде остаётся вписать только цифры.
 */

interface Props {
  journal: JournalState;
  onSave: (entry: DailyWorkEntry) => void;
  onClose: () => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function DailyEntryForm({ journal, onSave, onClose }: Props) {
  const last = useMemo(() => loadLastContext(), []);

  const [date, setDate] = useState(todayIso);
  const [smu, setSmu] = useState(last?.smu ?? '');
  const [oblast, setOblast] = useState(last?.oblast ?? '');
  const [rayon, setRayon] = useState(last?.rayon ?? '');
  const [uchastok, setUchastok] = useState(last?.uchastok ?? '');
  const [kato, setKato] = useState(last?.kato ?? '');
  const [tech, setTech] = useState<WorkTech>(last?.tech ?? 'МКТ');
  const [byMethod, setByMethod] = useState<Partial<Record<LayMethod, string>>>({});
  const [drillM, setDrillM] = useState('');
  const [drillCount, setDrillCount] = useState('');
  const [openCrossings, setOpenCrossings] = useState('');
  const [blowingM, setBlowingM] = useState('');
  const [materials, setMaterials] = useState<Partial<Record<MaterialKind, string>>>({});
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Подсказки из уже накопленных данных
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

  const smus = useMemo(() => {
    const s = new Set<string>();
    for (const g of journal.ground) if (g.smu) s.add(g.smu);
    return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [journal]);

  // Участок знаем — подставим КАТО, область и район из журнала или реестра
  useEffect(() => {
    if (!uchastok) return;
    const prev = journal.ground.find((g) => g.uchastok === uchastok);
    if (prev) {
      if (!kato) setKato(prev.kato);
      if (!oblast) setOblast(prev.oblast);
      if (!rayon && prev.rayon) setRayon(prev.rayon);
      return;
    }
    const order = journal.orders.find((o) => o.snp === uchastok);
    if (order) {
      if (!kato) setKato(order.kato);
      if (!oblast) setOblast(order.oblast);
      if (!rayon && order.rayon) setRayon(order.rayon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uchastok]);

  const numOf = (v?: string): number => {
    if (!v) return 0;
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const totalMeters = useMemo(
    () => LAY_METHODS.reduce((s, m) => s + numOf(byMethod[m]), 0),
    [byMethod],
  );

  const hasWork = totalMeters > 0 || numOf(drillM) > 0 || numOf(blowingM) > 0;
  const canSave = !!date && !!uchastok.trim() && hasWork;

  const submit = () => {
    setTouched(true);
    if (!canSave) return;
    const now = new Date().toISOString();

    const methods: Partial<Record<LayMethod, number>> = {};
    for (const m of LAY_METHODS) {
      const v = Math.round(numOf(byMethod[m]));
      if (v > 0) methods[m] = v;
    }
    const mats: Partial<Record<MaterialKind, number>> = {};
    for (const m of MATERIAL_KINDS) {
      const v = numOf(materials[m]);
      if (v > 0) mats[m] = MATERIAL_UNIT[m] === 'м' ? Math.round(v) : v;
    }

    onSave({
      kind: 'ground',
      id: `g-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date, smu: smu.trim(), oblast: oblast.trim(),
      rayon: rayon.trim() || undefined,
      uchastok: uchastok.trim(), kato: kato.trim(), tech,
      byMethod: methods,
      drillM: Math.round(numOf(drillM)) || undefined,
      drillCount: numOf(drillCount) || undefined,
      openCrossings: numOf(openCrossings) || undefined,
      blowingM: Math.round(numOf(blowingM)) || undefined,
      materials: mats,
      note: note.trim() || undefined,
      createdAt: now, updatedAt: now, sync: 'local',
    });

    saveLastContext({ smu, oblast, rayon, uchastok, kato, tech });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-stretch sm:items-center sm:justify-center sm:p-4">
      <div className="bg-[var(--bg-surface)] w-full sm:max-w-[560px] sm:rounded-xl border border-[var(--border)]
                      flex flex-col max-h-full sm:max-h-[90vh] overflow-hidden">
        {/* Шапка */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0"
             style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text)]">Закрыть день</h3>
            <p className="text-[11px] text-[var(--text-muted)] truncate">
              {uchastok ? uchastok : 'Выберите участок'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon ml-auto" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {/* Где */}
          <Group title="Где">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Дата">
                <input id="ce-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="inp" />
              </Field>
              <Field label="СМУ">
                <input id="ce-smu" list="ce-smus" value={smu} onChange={(e) => setSmu(e.target.value)}
                       placeholder="СМУ-2" className="inp" />
                <datalist id="ce-smus">{smus.map((s) => <option key={s} value={s} />)}</datalist>
              </Field>
            </div>
            <Field label="Участок" required error={touched && !uchastok.trim() ? 'Укажите участок' : ''}>
              <input id="ce-uchastok" list="ce-uchastki" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                     placeholder="сущ. ОМ - Акбеит" className="inp" />
              <datalist id="ce-uchastki">{uchastki.map((u) => <option key={u} value={u} />)}</datalist>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Область">
                <input id="ce-oblast" list="ce-oblasti" value={oblast} onChange={(e) => setOblast(e.target.value)} className="inp" />
                <datalist id="ce-oblasti">{oblasti.map((o) => <option key={o} value={o} />)}</datalist>
              </Field>
              <Field label="КАТО">
                <input id="ce-kato" value={kato} onChange={(e) => setKato(e.target.value)}
                       inputMode="numeric" placeholder="подставится сам" className="inp font-mono" />
              </Field>
            </div>
          </Group>

          {/* Что делали */}
          <Group title="Что делали">
            <div className="flex gap-1 bg-[var(--bg-canvas)] p-0.5 rounded-md">
              {WORK_TECHS.map((t) => (
                <button key={t} type="button" onClick={() => setTech(t)}
                  className={`flex-1 py-1.5 text-[12px] rounded transition-colors ${
                    tech === t ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-medium' : 'text-[var(--text-muted)]'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {LAY_METHODS.map((m) => (
                <NumField key={m} id={`ce-m-${m}`} label={LAY_METHOD_LABEL[m]} unit="м"
                          value={byMethod[m] ?? ''}
                          onChange={(v) => setByMethod((p) => ({ ...p, [m]: v }))} />
              ))}
            </div>
            <div className="flex items-baseline justify-between px-1 pt-1 border-t border-[var(--border)]">
              <span className="text-[11px] text-[var(--text-muted)]">Итого за день</span>
              <span className="font-mono tabular-nums text-sm text-[var(--accent)]">
                {totalMeters.toLocaleString('ru')} м
                {totalMeters >= 1000 && <span className="text-[var(--text-muted)] text-[11px] ml-1.5">
                  ≈ {(totalMeters / 1000).toFixed(2)} км</span>}
              </span>
            </div>
          </Group>

          {/* Переходы */}
          <Group title="Переходы и задувка">
            <div className="grid grid-cols-2 gap-2">
              <NumField id="ce-drill-m" label="ГНБ/ГНП" unit="м" value={drillM} onChange={setDrillM} />
              <NumField id="ce-drill-n" label="Проколов" unit="шт" value={drillCount} onChange={setDrillCount} />
              <NumField id="ce-open" label="Открытый переход" unit="шт" value={openCrossings} onChange={setOpenCrossings} />
              <NumField id="ce-blow" label="Задувка ОК" unit="м" value={blowingM} onChange={setBlowingM} />
            </div>
          </Group>

          {/* Материалы */}
          <Group title="Материалы за день">
            <div className="grid grid-cols-3 gap-2">
              {MATERIAL_KINDS.map((m) => (
                <NumField key={m} id={`ce-mat-${m}`} label={MATERIAL_LABEL[m]} unit={MATERIAL_UNIT[m]}
                          value={materials[m] ?? ''}
                          onChange={(v) => setMaterials((p) => ({ ...p, [m]: v }))} />
              ))}
            </div>
          </Group>

          <Field label="Примечание">
            <textarea id="ce-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                      placeholder="Что мешало, что перешли, особенности" className="inp resize-none" />
          </Field>

          {touched && !canSave && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[11.5px] text-[var(--warn)]">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{!uchastok.trim() ? 'Укажите участок.' : 'Впишите хотя бы одну цифру выработки — метры, ГНБ или задувку.'}</span>
            </div>
          )}
        </div>

        {/* Кнопки */}
        <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)] shrink-0"
             style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary flex-1" onClick={submit} disabled={!canSave}>
            <Check size={15} />Сохранить день
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

function NumField({ id, label, unit, value, onChange }: {
  id: string; label: string; unit: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-[var(--text-muted)] leading-tight truncate" title={label}>{label}</span>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="0"
          className="inp pr-7 font-mono tabular-nums"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] pointer-events-none">
          {unit}
        </span>
      </div>
    </label>
  );
}
