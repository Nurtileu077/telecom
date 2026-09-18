'use client';
import { useState, useMemo } from 'react';
import { Plus, Trash2, AlertTriangle, PackageCheck, TrendingDown } from 'lucide-react';
import {
  MaterialKind, MATERIAL_KINDS, MATERIAL_UNIT, MaterialDelivery,
} from '@/types/construction';
import { JournalState, MATERIAL_LABEL, fmtMeters, distinct } from './journalStore';
import {
  materialForecast, lowStock, negativeStock, daysLeftText, LOW_STOCK_DAYS,
} from './materialForecast';

/**
 * Остатки материалов и прогноз, на сколько хватит.
 *
 * Отвечает на управленческий вопрос «пора ли слать МКТ в Акмолинскую»
 * раньше, чем он возникнет у снабжения. Расход берётся из дневных отчётов,
 * приход вносится здесь же — без него остаток не из чего вычесть.
 */

interface Props {
  journal: JournalState;
  onAddDelivery: (d: MaterialDelivery) => void;
  onRemoveDelivery: (id: string) => void;
  author: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function MaterialsView({ journal, onAddDelivery, onRemoveDelivery, author }: Props) {
  const oblasti = useMemo(() => distinct(journal.ground, (e) => e.oblast), [journal.ground]);
  const [oblast, setOblast] = useState('');
  const [adding, setAdding] = useState(false);

  const stocks = useMemo(
    () => materialForecast(journal.ground, journal.deliveries, { oblast: oblast || undefined }),
    [journal.ground, journal.deliveries, oblast],
  );
  const low = lowStock(stocks);
  const negative = negativeStock(stocks);

  const deliveries = useMemo(
    () => journal.deliveries
      .filter((d) => !oblast || d.oblast === oblast)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50),
    [journal.deliveries, oblast],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={oblast} onChange={(e) => setOblast(e.target.value)}
                className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)] max-w-[220px]">
          <option value="">Все области</option>
          {oblasti.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <p className="text-[11px] text-[var(--text-muted)] flex-1 min-w-[200px]">
          Темп считается по рабочим дням — тем, в которые был расход. Календарные
          простои занижали бы его и делали прогноз самоуспокоительным.
        </p>
        <button type="button" className="btn btn-primary text-[11px]" onClick={() => setAdding(true)}>
          <Plus size={14} />Поставка
        </button>
      </div>

      {low.length > 0 && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--warn)]/50 bg-[var(--warn)]/10 text-[12px] text-[var(--text)]">
          <TrendingDown size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
          <span>
            Пора отправлять{oblast ? ` в ${oblast}` : ''}:{' '}
            <b>{low.map((s) => `${MATERIAL_LABEL[s.material]} (${daysLeftText(s)})`).join(', ')}</b>.
            Порог — {LOW_STOCK_DAYS} рабочих дней.
          </span>
        </div>
      )}

      {negative.length > 0 && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--danger)]/50 bg-[var(--danger)]/10 text-[12px] text-[var(--text)]">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <span>
            Расход больше прихода: <b>{negative.map((s) => MATERIAL_LABEL[s.material]).join(', ')}</b>.
            Скорее всего, поставки внесены не полностью — прогноз по этим позициям неверен.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {stocks.map((s) => {
          const isLow = s.daysLeft !== null && s.perDay > 0 && s.daysLeft <= LOW_STOCK_DAYS;
          const isNeg = s.remaining < 0;
          const tone = isNeg ? 'var(--danger)' : isLow ? 'var(--warn)' : 'var(--border)';
          const fmt = (v: number) => s.unit === 'м' ? fmtMeters(Math.abs(v)) : `${Math.abs(v).toLocaleString('ru')} шт`;
          return (
            <div key={s.material} className="rounded-lg border bg-[var(--bg-surface)] p-3 flex flex-col gap-1"
                 style={{ borderColor: tone }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-medium text-[var(--text)]">{MATERIAL_LABEL[s.material]}</span>
                <span className="text-[10px] text-[var(--text-muted)]">{daysLeftText(s)}</span>
              </div>
              <div className="font-mono tabular-nums text-xl"
                   style={{ color: isNeg ? 'var(--danger)' : isLow ? 'var(--warn)' : 'var(--text)' }}>
                {isNeg ? '−' : ''}{fmt(s.remaining)}
              </div>
              <div className="flex flex-wrap gap-x-3 text-[10.5px] text-[var(--text-muted)]">
                <span>приход {fmt(s.delivered)}</span>
                <span>расход {fmt(s.used)}</span>
                {s.perDay > 0 && (
                  <span>в день ~{s.unit === 'м' ? fmtMeters(Math.round(s.perDay)) : `${Math.round(s.perDay)} шт`}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-1">
          Поставки {deliveries.length > 0 && `(${deliveries.length})`}
        </h4>
        {deliveries.length === 0 ? (
          <div className="text-center py-8 flex flex-col items-center gap-2">
            <PackageCheck size={20} className="text-[var(--text-muted)]" />
            <p className="text-[12px] text-[var(--text-muted)]">
              Поставки не внесены — остаток считать не из чего
            </p>
          </div>
        ) : deliveries.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
            <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums shrink-0">
              {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ru')}
            </span>
            <span className="text-[12.5px] text-[var(--text)] min-w-0 flex-1 truncate">
              {MATERIAL_LABEL[d.material]}
              <span className="text-[var(--text-muted)]"> · {d.oblast}</span>
              {d.note && <span className="text-[var(--text-muted)]"> · {d.note}</span>}
            </span>
            <span className="font-mono tabular-nums text-[12.5px] text-[var(--text)] shrink-0">
              {MATERIAL_UNIT[d.material] === 'м' ? fmtMeters(d.qty) : `${d.qty.toLocaleString('ru')} шт`}
            </span>
            <button type="button" onClick={() => onRemoveDelivery(d.id)} title="Удалить"
                    className="btn btn-ghost btn-icon shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)]">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {adding && (
        <DeliveryForm
          oblasti={oblasti}
          defaultOblast={oblast}
          author={author}
          onSave={(d) => { onAddDelivery(d); setAdding(false); }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function DeliveryForm({ oblasti, defaultOblast, author, onSave, onClose }: {
  oblasti: string[];
  defaultOblast: string;
  author: string;
  onSave: (d: MaterialDelivery) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayIso);
  const [oblast, setOblast] = useState(defaultOblast || oblasti[0] || '');
  const [material, setMaterial] = useState<MaterialKind>('МКТ');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  const n = parseFloat(qty.replace(',', '.'));
  const canSave = !!date && !!oblast.trim() && Number.isFinite(n) && n > 0;

  const submit = () => {
    setTouched(true);
    if (!canSave) return;
    const now = new Date().toISOString();
    onSave({
      id: `sup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date, oblast: oblast.trim(), material,
      qty: MATERIAL_UNIT[material] === 'м' ? Math.round(n) : n,
      note: note.trim() || undefined,
      author, createdAt: now, updatedAt: now,
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--bg-surface)] w-full max-w-[420px] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text)]">Приход материала</h3>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Дата</span>
              <input id="dl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Материал</span>
              <select id="dl-material" value={material} onChange={(e) => setMaterial(e.target.value as MaterialKind)}
                      className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]">
                {MATERIAL_KINDS.map((m) => (
                  <option key={m} value={m}>{MATERIAL_LABEL[m]}, {MATERIAL_UNIT[m]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)]">Область</span>
            <input id="dl-oblast" list="dl-oblasti" value={oblast} onChange={(e) => setOblast(e.target.value)}
                   placeholder="Акмолинская область"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
            <datalist id="dl-oblasti">{oblasti.map((o) => <option key={o} value={o} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)]">
              Количество, {MATERIAL_UNIT[material]}
            </span>
            <input id="dl-qty" inputMode="decimal" value={qty}
                   onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))}
                   placeholder="0"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)] font-mono tabular-nums" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)]">Накладная / примечание</span>
            <input id="dl-note" value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="№ накладной"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
          </label>
          {touched && !canSave && (
            <p className="text-[11px] text-[var(--danger)]">Укажите область и количество больше нуля.</p>
          )}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary flex-1" onClick={submit} disabled={!canSave}>
            Записать приход
          </button>
        </div>
      </div>
    </div>
  );
}
