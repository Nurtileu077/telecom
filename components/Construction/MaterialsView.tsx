'use client';
import { useState, useMemo } from 'react';
import { Plus, Trash2, AlertTriangle, PackageCheck, TrendingDown, Disc } from 'lucide-react';
import {
  MaterialKind, MATERIAL_KINDS, MATERIAL_UNIT, MaterialDelivery, CableDrum,
} from '@/types/construction';
import { JournalState, MATERIAL_LABEL, fmtMeters, distinct, plural } from './journalStore';
import {
  materialForecast, lowStock, negativeStock, unknownStock, daysLeftText, LOW_STOCK_DAYS,
  materialByScope,
} from './materialForecast';
import { spendOf, stockValueOf, fmtMoney, hasPrices } from './materialCost';
import { drumStates, drumTotals, unknownDrums } from './drums';

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
  onSetPrice: (material: MaterialKind, price: number | undefined) => void;
  /** Барабаны кабеля: приход заводят здесь, остаток считается. */
  onSaveDrum?: (d: CableDrum) => void;
  onRemoveDrum?: (id: string) => void;
  author: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function MaterialsView({
  journal, onAddDelivery, onRemoveDelivery, onSetPrice, onSaveDrum, onRemoveDrum, author,
}: Props) {
  const oblasti = useMemo(() => distinct(journal.ground, (e) => e.oblast), [journal.ground]);
  const [oblast, setOblast] = useState('');
  const [adding, setAdding] = useState(false);
  const [addingDrum, setAddingDrum] = useState(false);

  // Барабаны: паспортная длина минус то, что с них задули по меткам.
  const drums = useMemo(
    () => drumStates(
      journal.drums.filter((d) => !oblast || !d.oblast || d.oblast === oblast),
      journal,
    ),
    [journal, oblast],
  );
  const drumSum = useMemo(() => drumTotals(drums), [drums]);
  const lostDrums = useMemo(() => unknownDrums(journal.drums, journal), [journal]);

  const stocks = useMemo(
    () => materialForecast(journal.ground, journal.deliveries, { oblast: oblast || undefined }),
    [journal.ground, journal.deliveries, oblast],
  );
  const low = lowStock(stocks);
  const negative = negativeStock(stocks);
  const unknown = unknownStock(stocks);

  // Разрез по территории: снабжению нужно знать не «сколько всего», а
  // «куда везти». Районы показывают расход — приход на них заводят редко.
  const [level, setLevel] = useState<'oblast' | 'rayon'>('oblast');
  const scopes = useMemo(
    () => materialByScope(journal.ground, journal.deliveries, level)
      .filter((r) => !oblast || r.oblast === oblast),
    [journal.ground, journal.deliveries, level, oblast],
  );

  // Деньги показываем, только когда заданы цены: сумма из половины цен
  // выглядит точной, будучи наполовину придуманной.
  const priced = hasPrices(journal.prices);
  const spend = useMemo(() => spendOf(stocks, journal.prices), [stocks, journal.prices]);
  const left = useMemo(() => stockValueOf(stocks, journal.prices), [stocks, journal.prices]);
  const [pricesOpen, setPricesOpen] = useState(false);

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

      {unknown.length > 0 && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-muted)]">
          <PackageCheck size={15} className="shrink-0 mt-0.5" />
          <span>
            Приход не внесён: <b className="text-[var(--text)]">{unknown.map((s) => MATERIAL_LABEL[s.material]).join(', ')}</b>.
            Расход по ним идёт, накладных нет — остаток показан нулём, потому что
            считать его не из чего. Это не нехватка материала, а пробел в учёте.
          </span>
        </div>
      )}

      {negative.length > 0 && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--danger)]/50 bg-[var(--danger)]/10 text-[12px] text-[var(--text)]">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <span>
            Расход больше прихода: <b>{negative.map((s) => MATERIAL_LABEL[s.material]).join(', ')}</b>.
            Поставки внесены не полностью — прогноз по этим позициям неверен.
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

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Деньги</h4>
          <button type="button" onClick={() => setPricesOpen((v) => !v)}
                  className="text-[11px] text-[var(--accent)] hover:underline">
            {pricesOpen ? 'свернуть цены' : priced ? 'изменить цены' : 'задать цены'}
          </button>
        </div>

        {priced ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Израсходовано{oblast ? ` · ${oblast}` : ''}
              </div>
              <div className="text-[18px] font-semibold text-[var(--text)] leading-tight">
                {fmtMoney(spend.total)}
              </div>
              {spend.partial && (
                <div className="text-[10.5px] text-[var(--warn)]">
                  без цены {spend.unpriced} {plural(spend.unpriced, 'позиция', 'позиции', 'позиций')} — сумма неполная
                </div>
              )}
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Лежит на остатке</div>
              <div className="text-[18px] font-semibold text-[var(--text)] leading-tight">
                {fmtMoney(left.total)}
              </div>
              <div className="text-[10.5px] text-[var(--text-muted)]">по внесённому приходу</div>
            </div>
          </div>
        ) : (
          <p className="text-[11.5px] text-[var(--text-muted)]">
            Цены не заданы, поэтому суммы не считаются. Свои цены система не
            выдумывает — у каждого подрядчика они свои.
          </p>
        )}

        {pricesOpen && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] p-3">
            {MATERIAL_KINDS.map((m) => (
              <label key={m} className="flex flex-col gap-1">
                <span className="text-[10.5px] text-[var(--text-muted)]">
                  {MATERIAL_LABEL[m]}, ₸ за {MATERIAL_UNIT[m]}
                </span>
                <input inputMode="decimal"
                       value={journal.prices[m] === undefined ? '' : String(journal.prices[m])}
                       onChange={(e) => {
                         const raw = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
                         const n = parseFloat(raw);
                         onSetPrice(m, raw === '' || !Number.isFinite(n) ? undefined : n);
                       }}
                       placeholder="—"
                       className="bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)] font-mono tabular-nums" />
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Кому отправлять ({scopes.length})
          </h4>
          <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md ml-auto">
            {([['oblast', 'По областям'], ['rayon', 'По районам']] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setLevel(v)}
                className={`px-2 py-1 text-[11px] rounded ${level === v ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {scopes.length === 0 ? (
          <p className="text-[11.5px] text-[var(--text-muted)]">Расхода по территории пока нет.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {scopes.slice(0, 40).map((r) => {
              const urgent = r.minDaysLeft !== null && r.minDaysLeft <= LOW_STOCK_DAYS;
              return (
                <div key={`${r.oblast}|${r.rayon ?? ''}`}
                     className="rounded-lg border bg-[var(--bg-surface)] px-3 py-2 flex flex-col gap-1"
                     style={{ borderColor: urgent ? 'var(--warn)' : 'var(--border)' }}>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[12.5px] font-medium text-[var(--text)]">
                      {r.rayon ? r.rayon : r.oblast}
                    </span>
                    {r.rayon && <span className="text-[10.5px] text-[var(--text-muted)]">{r.oblast}</span>}
                    <span className="ml-auto text-[11px]"
                          style={{ color: urgent ? 'var(--warn)' : 'var(--text-muted)' }}>
                      {r.minDaysLeft !== null
                        ? `запас ${r.minDaysLeft} раб. дн.`
                        : 'приход не внесён'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--text-muted)]">
                    {r.stocks.filter((s) => s.used > 0).map((s) => (
                      <span key={s.material}>
                        {MATERIAL_LABEL[s.material]}{' '}
                        <b className="text-[var(--text)] font-mono">
                          {s.hasDeliveries
                            ? (s.unit === 'м' ? fmtMeters(Math.max(0, s.remaining)) : `${Math.max(0, s.remaining)} шт`)
                            : (s.unit === 'м' ? fmtMeters(s.used) : `${s.used} шт`)}
                        </b>
                        <span className="text-[var(--text-muted)]">
                          {s.hasDeliveries ? ' ост.' : ' израсх.'}
                        </span>
                      </span>
                    ))}
                  </div>
                  {priced && (
                    <div className="text-[10.5px] text-[var(--text-muted)]">
                      израсходовано на <b className="text-[var(--text)]">{fmtMoney(spendOf(r.stocks, journal.prices).total)}</b>
                    </div>
                  )}
                  {r.low.length > 0 && (
                    <div className="text-[10.5px] text-[var(--warn)]">
                      пора отправлять: {r.low.map((s) => MATERIAL_LABEL[s.material]).join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {level === 'rayon' && (
          <p className="text-[10.5px] text-[var(--text-muted)]">
            По районам виден расход: накладные обычно оформляют на область.
            Заведите поставку с районом — и остаток посчитается по нему.
          </p>
        )}
      </section>

      {/* Барабаны кабеля: остаток считается, а не вводится */}
      {onSaveDrum && (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 mt-1">
            <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
              <Disc size={12} />Барабаны кабеля {drums.length > 0 && `(${drums.length})`}
            </h4>
            {drums.length > 0 && (
              <span className="text-[10.5px] text-[var(--text-muted)]">
                остаток {fmtMeters(drumSum.leftM)} из {fmtMeters(drumSum.totalM)}
                {drumSum.empty > 0 && ` · пустых ${drumSum.empty}`}
              </span>
            )}
            <button type="button" className="btn text-[11px] ml-auto"
                    onClick={() => setAddingDrum(true)}>
              <Plus size={14} />Барабан
            </button>
          </div>

          {drums.length === 0 ? (
            <p className="text-[11.5px] text-[var(--text-muted)]">
              Барабаны не заведены. Номер и длину пишут на щеке барабана —
              внесите их один раз, остаток дальше считается по меткам задувки.
            </p>
          ) : drums.map((d) => (
            <div key={d.drum.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[12.5px] text-[var(--text)]">№{d.drum.number}</span>
                <span className="text-[11px] text-[var(--text-muted)] truncate">
                  {[d.drum.cable, d.drum.oblast, d.drum.rayon].filter(Boolean).join(' · ')}
                </span>
                <span className="ml-auto font-mono tabular-nums text-[12.5px] shrink-0"
                      style={{ color: d.leftM === 0 ? 'var(--text-muted)' : 'var(--accent)' }}>
                  {fmtMeters(d.leftM)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--bg-canvas)] overflow-hidden">
                <div className="h-full rounded-full"
                     style={{
                       width: `${Math.round(d.share * 100)}%`,
                       background: d.overrun > 0 ? 'var(--warn)' : d.share >= 1 ? 'var(--text-muted)' : 'var(--accent)',
                     }} />
              </div>
              <div className="flex items-baseline gap-2 text-[10.5px] text-[var(--text-muted)]">
                <span>задуто {fmtMeters(d.usedM)} из {fmtMeters(d.drum.lengthM)}</span>
                {d.days.length > 0 && (
                  <span>· {d.days.length} {plural(d.days.length, 'смена', 'смены', 'смен')}</span>
                )}
                {d.overrun > 0 && (
                  <span className="text-[var(--warn)]">
                    · списано на {fmtMeters(d.overrun)} больше паспортной длины — проверьте метки
                  </span>
                )}
                {d.leftM === 0 && d.overrun === 0 && <span>· пустой</span>}
                {onRemoveDrum && (
                  <button type="button" onClick={() => onRemoveDrum(d.drum.id)} title="Удалить барабан"
                          className="ml-auto text-[var(--text-muted)] hover:text-[var(--danger)]">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {lostDrums.length > 0 && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--warn)]/50 bg-[var(--warn)]/10 text-[11.5px] text-[var(--text)]">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
              <span>
                Метки есть, а барабанов в списке нет:{' '}
                {lostDrums.slice(0, 6).map((d) => `№${d.number} (${fmtMeters(d.usedM)})`).join(', ')}
                {lostDrums.length > 6 && ` и ещё ${lostDrums.length - 6}`}.
                Заведите их — метры с них уже ушли в трассу.
              </span>
            </div>
          )}
        </section>
      )}

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

      {addingDrum && onSaveDrum && (
        <DrumForm
          oblasti={oblasti}
          defaultOblast={oblast}
          author={author}
          onSave={(d) => { onSaveDrum(d); setAddingDrum(false); }}
          onClose={() => setAddingDrum(false)}
        />
      )}

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
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Закрыть"
                  onClick={onClose}>✕</button>
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

/**
 * Барабан заводят один раз: номер и длина написаны на щеке. Остаток
 * потом считается сам — по меткам барабана в дневных отчётах.
 */
function DrumForm({ oblasti, defaultOblast, author, onSave, onClose }: {
  oblasti: string[];
  defaultOblast: string;
  author: string;
  onSave: (d: CableDrum) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayIso);
  const [number, setNumber] = useState('');
  const [cable, setCable] = useState('');
  const [lengthM, setLengthM] = useState('');
  const [oblast, setOblast] = useState(defaultOblast || oblasti[0] || '');
  const [rayon, setRayon] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  const n = parseFloat(lengthM.replace(',', '.'));
  const canSave = !!number.trim() && Number.isFinite(n) && n > 0;

  const submit = () => {
    setTouched(true);
    if (!canSave) return;
    const now = new Date().toISOString();
    onSave({
      id: `drum-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      number: number.trim(),
      cable: cable.trim() || undefined,
      lengthM: Math.round(n),
      oblast: oblast.trim() || undefined,
      rayon: rayon.trim() || undefined,
      date,
      note: note.trim() || undefined,
      author, createdAt: now, updatedAt: now, sync: 'local',
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--bg-surface)] w-full max-w-[420px] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text)]">Барабан кабеля</h3>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Закрыть"
                  onClick={onClose}>✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Номер барабана</span>
              <input id="dr-number" value={number} onChange={(e) => setNumber(e.target.value)}
                     placeholder="4003"
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)] font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Длина по паспорту, м</span>
              <input id="dr-length" inputMode="decimal" value={lengthM}
                     onChange={(e) => setLengthM(e.target.value.replace(/[^\d.,]/g, ''))}
                     placeholder="4000"
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)] font-mono tabular-nums" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)]">Тип кабеля</span>
            <input id="dr-cable" value={cable} onChange={(e) => setCable(e.target.value)}
                   placeholder="ОК-24"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Область</span>
              <input id="dr-oblast" list="dr-oblasti" value={oblast} onChange={(e) => setOblast(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
              <datalist id="dr-oblasti">{oblasti.map((o) => <option key={o} value={o} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">Район</span>
              <input id="dr-rayon" value={rayon} onChange={(e) => setRayon(e.target.value)}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)]">Дата прихода</span>
            <input id="dr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)]">Примечание</span>
            <input id="dr-note" value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="№ накладной, склад"
                   className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[13px] text-[var(--text)]" />
          </label>
          {touched && !canSave && (
            <p className="text-[11px] text-[var(--danger)]">Нужны номер барабана и длина больше нуля.</p>
          )}
          <p className="text-[10.5px] text-[var(--text-muted)]">
            Остаток вводить не нужно: он считается по меткам барабана в
            дневных отчётах — «с какого барабана сколько задули».
          </p>
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary flex-1" onClick={submit} disabled={!canSave}>
            Завести барабан
          </button>
        </div>
      </div>
    </div>
  );
}
