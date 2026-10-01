'use client';
import { useMemo, useState } from 'react';
import { Plus, Trash2, Copy, AlertTriangle, Pencil } from 'lucide-react';
import {
  PAYMENT_KIND_LABEL, type WorkRate, type Payment, type PaymentKind,
} from '@/types/construction';
import type { JournalState } from './journalStore';
import ExportButton, { type ExportColumn } from '@/components/Layout/ExportButton';
import {
  payroll, compareContractors, payrollSummary, paymentLines, costPerMeter,
  PAYABLE_WORKS, rateFor, rateStart, brokenRates, checkRate, payableOption,
  type PayLine, type RateDraft,
} from './payroll';
import { useT } from '@/components/Layout/LangProvider';

/**
 * Деньги с подрядчиками.
 *
 * Объёмы записаны в журнале, расценки — в договоре, авансы — в тетради,
 * а «сколько мы должны Дозеру» знает один человек и по памяти. Отсюда
 * половина споров: подрядчик считает по своим цифрам, мы по своим, и
 * сходятся они только на планёрке.
 */

interface Props {
  journal: JournalState;
  from?: string;
  to?: string;
  author?: string;
  onAddRate: (rate: WorkRate) => void;
  onRemoveRate: (id: string) => void;
  onAddPayment: (payment: Payment) => void;
  onRemovePayment: (id: string) => void;
  onFlash?: (text: string) => void;
}

const money = (v: number) => `${Math.round(v).toLocaleString('ru')} ₸`;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Колонки расчёта — те же, что на экране.
 *
 * Оценённый объём стоит отдельной колонкой: по нему считается сумма, а
 * по общему — нет, и в файле это должно быть видно так же, как в
 * разговоре с подрядчиком.
 */
const PAY_COLUMNS: ExportColumn<PayLine>[] = [
  { header: 'Работа', value: (l) => l.label },
  { header: `Объём`, value: (l) => l.quantity },
  { header: 'Единица', value: (l) => l.unit },
  { header: 'По расценке', value: (l) => l.pricedQuantity },
  { header: 'Цена', value: (l) => l.price ?? '' },
  { header: 'Сумма', value: (l) => l.sum ?? '' },
];

export default function PayrollView({
  journal, from, to, author, onAddRate, onRemoveRate, onAddPayment, onRemovePayment, onFlash,
}: Props) {
  const { t } = useT();
  const contractors = useMemo(
    () => [...new Set(journal.ground.map((e) => e.contractor).filter((v): v is string => !!v))]
      .sort((a, b) => a.localeCompare(b, 'ru')),
    [journal.ground],
  );
  const [who, setWho] = useState<string>('');
  const current = who || contractors[0] || '';

  const result = useMemo(
    () => payroll(current, journal.ground, journal.rates, journal.payments, { from, to }),
    [current, journal.ground, journal.rates, journal.payments, from, to],
  );

  const deviationsBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of journal.deviations) {
      const key = d.contractor || '';
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [journal.deviations]);

  const table = useMemo(
    () => compareContractors(journal.ground, journal.rates, journal.payments, deviationsBy, { from, to }),
    [journal.ground, journal.rates, journal.payments, deviationsBy, from, to],
  );

  // Черновик расценки: открыт — значит, человек её сейчас заполняет.
  const [rateDraft, setRateDraft] = useState<RateDraft | null>(null);
  const [rateError, setRateError] = useState('');
  const broken = useMemo(() => brokenRates(journal.rates), [journal.rates]);

  function openRate(r?: WorkRate) {
    setRateError('');
    setRateDraft(r
      ? {
        id: r.id, work: r.work, price: String(r.price),
        // Нечитаемую дату не подставляем в календарь: он её всё равно не
        // покажет, а человек решит, что даты нет вовсе.
        from: rateStart(r) ?? '',
        contractor: r.contractor,
      }
      : {
        work: PAYABLE_WORKS[0].key, price: '',
        from: new Date().toISOString().slice(0, 10),
        contractor: current || undefined,
      });
  }

  function saveRate() {
    if (!rateDraft) return;
    const res = checkRate(rateDraft, new Date().toISOString(), () => newId('rate'));
    if ('error' in res) { setRateError(res.error); return; }
    onAddRate(res.rate);
    setRateDraft(null);
    setRateError('');
    onFlash?.(rateDraft.id ? 'Расценка исправлена' : 'Расценка добавлена');
  }

  function addPayment(kind: PaymentKind) {
    if (!current) return;
    const amount = Number((window.prompt(`${PAYMENT_KIND_LABEL[kind]}, ₸:`, '') ?? '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const note = window.prompt('За что (необязательно):', '') ?? '';
    const now = new Date().toISOString();
    onAddPayment({
      id: newId('pay'),
      contractor: current,
      kind,
      amount,
      date: now.slice(0, 10),
      note: note.trim() || undefined,
      author,
      createdAt: now,
      updatedAt: now,
    });
    onFlash?.(`${PAYMENT_KIND_LABEL[kind]} записан`);
  }

  async function copySummary() {
    const text = [
      `${current}, период ${result.from} — ${result.to}`,
      payrollSummary(result),
      '',
      ...result.lines.map((l) => {
        const head = `${l.label}: ${l.quantity.toLocaleString('ru')} ${l.unit}`;
        if (l.pricedQuantity === 0) return `${head} — без расценки`;
        // Когда оценён не весь объём или цена за период менялась, писать
        // «× цену» нельзя: у подрядчика не сойдётся, и начнётся спор.
        if (l.pricedQuantity < l.quantity || l.price === undefined) {
          return `${head}, из них по расценке `
            + `${l.pricedQuantity.toLocaleString('ru')} ${l.unit} = ${money(l.sum ?? 0)}`;
        }
        return `${head} × ${money(l.price)} = ${money(l.sum ?? 0)}`;
      }),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      onFlash?.('Расчёт скопирован');
    } catch {
      window.prompt('Скопируйте расчёт вручную:', text);
    }
  }

  if (contractors.length === 0) {
    return (
      <div className="p-6 text-center text-[13px] text-[var(--text-muted)]">
        В журнале пока нет смен с подрядчиком — считать нечего.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-1 flex-wrap">
        {contractors.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setWho(c)}
            className={`chip ${c === current ? 'chip-on' : ''}`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Расчёт */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-[var(--text)]">{current}</span>
          <span className="text-[11px] text-[var(--text-muted)]">
            {result.shifts} смен · {Math.round(result.meters).toLocaleString('ru')} м
            {result.idleShifts > 0 && ` · простой — ${result.idleShifts} смен`}
          </span>
          <span className="ml-auto inline-flex gap-1">
            <button type="button" onClick={copySummary} className="btn btn-ghost btn-icon"
                    title="Скопировать расчёт текстом — для чата">
              <Copy size={14} />
            </button>
            <ExportButton
              compact
              name={`Расчёт ${current}`}
              rows={result.lines}
              columns={PAY_COLUMNS}
              footer={{ 'Работа': 'Начислено', 'Сумма': result.accrued }}
              onFlash={onFlash}
            />
          </span>
        </div>

        <table className="w-full text-left text-[11.5px]">
          <tbody>
            {result.lines.map((l) => (
              <tr key={l.work} className="border-t border-[var(--border)]">
                <td className="py-1 text-[var(--text)]">{l.label}</td>
                <td className="py-1 text-right font-mono tabular-nums text-[var(--text-muted)]">
                  {l.quantity.toLocaleString('ru')} {l.unit}
                  {l.pricedQuantity < l.quantity && (
                    <span className="block text-[10px] text-[var(--warn)]"
                          title="Расценки на этот объём нет — договор начинается позже">
                      по расценке {l.pricedQuantity.toLocaleString('ru')}
                    </span>
                  )}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-[var(--text-muted)]">
                  {l.price !== undefined ? money(l.price)
                    : l.pricedQuantity > 0 ? 'разная' : '—'}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-[var(--text)]">
                  {l.sum !== undefined ? money(l.sum) : '—'}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-[var(--border)]">
              <td className="py-1 font-semibold text-[var(--text)]" colSpan={3}>Начислено</td>
              <td className="py-1 text-right font-mono tabular-nums font-semibold text-[var(--text)]">
                {money(result.accrued)}
              </td>
            </tr>
            {result.advances > 0 && (
              <tr><td className="py-0.5 text-[var(--text-muted)]" colSpan={3}>Аванс</td>
                <td className="py-0.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                  −{money(result.advances)}
                </td></tr>
            )}
            {result.deductions > 0 && (
              <tr><td className="py-0.5 text-[var(--text-muted)]" colSpan={3}>Удержано</td>
                <td className="py-0.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                  −{money(result.deductions)}
                </td></tr>
            )}
            {result.paid > 0 && (
              <tr><td className="py-0.5 text-[var(--text-muted)]" colSpan={3}>Оплачено</td>
                <td className="py-0.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                  −{money(result.paid)}
                </td></tr>
            )}
            <tr className="border-t border-[var(--border)]">
              <td className="py-1 font-semibold text-[var(--accent)]" colSpan={3}>
                {result.due >= 0 ? 'К оплате' : 'Переплата'}
              </td>
              <td className="py-1 text-right font-mono tabular-nums font-semibold text-[var(--accent)]">
                {money(Math.abs(result.due))}
              </td>
            </tr>
          </tbody>
        </table>

        {result.unpriced.length > 0 && (
          <div className="flex items-start gap-1.5 text-[11px] text-[var(--warn)]">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              Без расценки: {result.unpriced.join(', ')}.
              <span className="block text-[var(--text-muted)]">
                Эти работы в сумму не вошли — ноль здесь означал бы «бесплатно».
              </span>
            </span>
          </div>
        )}

        {costPerMeter(result) !== null && (
          <div className="text-[11px] text-[var(--text-muted)]">
            Метр обошёлся в {money(costPerMeter(result)!)} — по оплаченным работам,
            а не по всей длине трассы.
          </div>
        )}

        <div className="flex gap-1.5 flex-wrap">
          <button type="button" className="btn btn-ghost text-[11px]" onClick={() => openRate()}>
            <Plus size={13} />Расценка
          </button>
          {(['advance', 'deduction', 'payment'] as PaymentKind[]).map((k) => (
            <button key={k} type="button" className="btn btn-ghost text-[11px]"
                    onClick={() => addPayment(k)}>
              <Plus size={13} />{PAYMENT_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {/* Движение денег */}
      {journal.payments.some((p) => p.contractor === current) && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1">
          <div className="text-[12.5px] font-semibold text-[var(--text)]">Движение денег</div>
          {journal.payments
            .filter((p) => p.contractor === current)
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
            .map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-[11.5px]">
                <span className="min-w-0 flex-1 text-[var(--text-muted)] truncate">
                  {new Date(`${p.date}T00:00:00Z`).toLocaleDateString('ru')} ·{' '}
                  {PAYMENT_KIND_LABEL[p.kind]}
                  {p.note ? ` — ${p.note}` : ''}
                </span>
                <span className="font-mono tabular-nums text-[var(--text)]">
                  {money(p.amount)}
                </span>
                <button type="button" className="btn btn-ghost btn-icon text-[var(--danger)]"
                        title="Удалить запись" onClick={() => onRemovePayment(p.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Новая или исправляемая расценка */}
      {rateDraft && (
        <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--bg-surface)] p-3 space-y-2">
          <div className="text-[12.5px] font-semibold text-[var(--text)]">
            {rateDraft.id ? 'Исправить расценку' : 'Новая расценка'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[10.5px] text-[var(--text-muted)]">Вид работ</span>
              <select value={rateDraft.work}
                      onChange={(e) => setRateDraft({ ...rateDraft, work: e.target.value })}
                      className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]">
                {PAYABLE_WORKS.map((w) => (
                  <option key={w.key} value={w.key}>{payableOption(w.key)}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">
                Цена за 1 {PAYABLE_WORKS.find((w) => w.key === rateDraft.work)?.unit ?? 'м'}, ₸
              </span>
              <input value={rateDraft.price} inputMode="decimal" autoFocus
                     onChange={(e) => setRateDraft({ ...rateDraft, price: e.target.value })}
                     onKeyDown={(e) => { if (e.key === 'Enter') saveRate(); }}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] font-mono tabular-nums" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--text-muted)]">Действует с</span>
              <input type="date" value={rateDraft.from}
                     onChange={(e) => setRateDraft({ ...rateDraft, from: e.target.value })}
                     className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[10.5px] text-[var(--text-muted)]">Для кого</span>
              <select value={rateDraft.contractor ?? ''}
                      onChange={(e) => setRateDraft({ ...rateDraft, contractor: e.target.value || undefined })}
                      className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]">
                <option value="">Для всех подрядчиков</option>
                {[...new Set([...contractors, ...(rateDraft.contractor ? [rateDraft.contractor] : [])])]
                  .map((c) => <option key={c} value={c}>Только {c}</option>)}
              </select>
            </label>
          </div>
          {rateError && <div className="text-[11px] text-[var(--danger)]">{rateError}</div>}
          <div className="flex gap-1.5">
            <button type="button" className="btn btn-primary text-[11.5px]" onClick={saveRate}>
              Сохранить
            </button>
            <button type="button" className="btn btn-ghost text-[11.5px]"
                    onClick={() => { setRateDraft(null); setRateError(''); }}>
              {t('Отмена')}
            </button>
          </div>
          <div className="text-[10.5px] text-[var(--text-muted)]">
            Смены до этой даты считаются по прежней расценке: договор меняют с
            какого-то числа, и пересчитывать по нему старые смены нельзя.
          </div>
        </div>
      )}

      {/* Расценки */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1">
        <div className="text-[12.5px] font-semibold text-[var(--text)]">Расценки</div>
        {broken.length > 0 && (
          <div className="flex items-start gap-1.5 text-[11px] text-[var(--warn)]">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              У {broken.length === 1 ? 'расценки' : `${broken.length} расценок`} не читается дата
              начала — в расчёт {broken.length === 1 ? 'она не идёт' : 'они не идут'}.
              Нажмите карандаш и выберите дату в календаре.
            </span>
          </div>
        )}
        {journal.rates.length === 0 ? (
          <div className="text-[11.5px] text-[var(--text-muted)]">
            Расценок нет — начисления считать не из чего.
          </div>
        ) : [...journal.rates]
          .sort((a, b) => (rateStart(b) ?? '').localeCompare(rateStart(a) ?? ''))
          .map((r) => {
            const start = rateStart(r);
            const active = rateFor(journal.rates, r.work, to ?? new Date().toISOString().slice(0, 10),
              r.contractor)?.id === r.id;
            return (
              <div key={r.id} className="flex items-center gap-2 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className={active ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}>
                    {payableOption(r.work)}
                  </span>
                  <span className={`text-[10px] ${start ? 'text-[var(--text-muted)]' : 'text-[var(--warn)]'}`}>
                    {start
                      ? ` · с ${new Date(`${start}T00:00:00Z`).toLocaleDateString('ru')}`
                      : ` · дата «${r.from || 'пусто'}» не читается`}
                    {r.contractor ? ` · ${r.contractor}` : ' · для всех'}
                    {start && !active && ' · не действует'}
                  </span>
                </span>
                <span className="font-mono tabular-nums text-[var(--text)]">
                  {money(r.price)}/{r.unit}
                </span>
                <button type="button" className="btn btn-ghost btn-icon"
                        title="Исправить расценку" onClick={() => openRate(r)}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon text-[var(--danger)]"
                        title="Удалить расценку" onClick={() => onRemoveRate(r.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
      </div>

      {/* Сравнение */}
      {table.length > 1 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
          <div className="text-[12.5px] font-semibold text-[var(--text)] mb-1">
            Подрядчики рядом
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11.5px]">
              <thead className="text-[10px] uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="py-1 font-medium">{t('Подрядчик')}</th>
                  <th className="py-1 font-medium text-right">м/смену</th>
                  <th className="py-1 font-medium text-right">₸/м</th>
                  <th className="py-1 font-medium text-right">Отклонений</th>
                  <th className="py-1 font-medium text-right">К оплате</th>
                </tr>
              </thead>
              <tbody>
                {table.map((c) => (
                  <tr key={c.contractor} className="border-t border-[var(--border)]">
                    <td className="py-1 text-[var(--text)]">{c.contractor}</td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {Math.round(c.perShift).toLocaleString('ru')}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {c.perMeter !== null ? Math.round(c.perMeter).toLocaleString('ru') : '—'}
                    </td>
                    <td className={`py-1 text-right font-mono tabular-nums ${
                      c.deviations > 0 ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]'}`}>
                      {c.deviations}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums text-[var(--text)]">
                      {money(c.due)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)] mt-1">
            Кто быстрее, кто дешевле и у кого больше замечаний — три разных вопроса.
            Одной цифрой на них не ответить.
          </p>
        </div>
      )}
    </div>
  );
}
