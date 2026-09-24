'use client';
import { useMemo, useState } from 'react';
import { Plus, Trash2, Copy, AlertTriangle } from 'lucide-react';
import {
  PAYMENT_KIND_LABEL, type WorkRate, type Payment, type PaymentKind,
} from '@/types/construction';
import type { JournalState } from './journalStore';
import {
  payroll, compareContractors, payrollSummary, paymentLines, costPerMeter,
  PAYABLE_WORKS, rateFor,
} from './payroll';

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

export default function PayrollView({
  journal, from, to, author, onAddRate, onRemoveRate, onAddPayment, onRemovePayment, onFlash,
}: Props) {
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

  function addRate() {
    const work = window.prompt(
      `Вид работ (${PAYABLE_WORKS.map((w) => w.key).join(', ')}):`,
      'бар',
    );
    if (work === null) return;
    const spec = PAYABLE_WORKS.find((w) => w.key === work.trim());
    if (!spec) { onFlash?.('Такого вида работ нет'); return; }
    const price = Number((window.prompt(`Цена за 1 ${spec.unit}, ₸:`, '') ?? '').replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0) return;
    const fromDate = window.prompt(
      'С какого числа действует (ГГГГ-ММ-ДД):',
      new Date().toISOString().slice(0, 10),
    );
    if (fromDate === null) return;
    onAddRate({
      id: newId('rate'),
      contractor: current || undefined,
      work: spec.key,
      price,
      unit: spec.unit,
      from: fromDate.trim(),
      updatedAt: new Date().toISOString(),
    });
    onFlash?.('Расценка добавлена');
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
            className={`px-2 py-1 rounded text-[11.5px] border ${
              c === current
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                : 'border-[var(--border)] text-[var(--text-muted)]'}`}
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
          </span>
          <button type="button" onClick={copySummary} className="btn btn-ghost btn-icon ml-auto"
                  title="Скопировать расчёт">
            <Copy size={14} />
          </button>
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
          <button type="button" className="btn btn-ghost text-[11px]" onClick={addRate}>
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

      {/* Расценки */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1">
        <div className="text-[12.5px] font-semibold text-[var(--text)]">Расценки</div>
        {journal.rates.length === 0 ? (
          <div className="text-[11.5px] text-[var(--text-muted)]">
            Расценок нет — начисления считать не из чего.
          </div>
        ) : journal.rates
          .sort((a, b) => (b.from || '').localeCompare(a.from || ''))
          .map((r) => {
            const spec = PAYABLE_WORKS.find((w) => w.key === r.work);
            const active = rateFor(journal.rates, r.work, to ?? new Date().toISOString().slice(0, 10),
              r.contractor)?.id === r.id;
            return (
              <div key={r.id} className="flex items-center gap-2 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className={active ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}>
                    {spec?.label ?? r.work}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {' · с '}{new Date(`${r.from}T00:00:00Z`).toLocaleDateString('ru')}
                    {r.contractor ? ` · ${r.contractor}` : ' · для всех'}
                    {!active && ' · не действует'}
                  </span>
                </span>
                <span className="font-mono tabular-nums text-[var(--text)]">
                  {money(r.price)}/{r.unit}
                </span>
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
                  <th className="py-1 font-medium">Подрядчик</th>
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
