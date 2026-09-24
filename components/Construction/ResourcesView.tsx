'use client';
import { useMemo, useState } from 'react';
import {
  AlertTriangle, Plus, Truck, Fuel, Drill, PackageCheck, Trash2,
} from 'lucide-react';
import { MATERIAL_KINDS, MATERIAL_UNIT, type MaterialKind } from '@/types/construction';
import type { JournalState } from './journalStore';
import {
  materialOveruse, overuseText, overdueRequests, requestedTotals,
  REQUEST_STATUS_LIST, type MaterialRequest, type RequestStatus,
} from './supply';
import { equipmentUse, idleShare, fuelNeed, fuelTotal, drillQueue } from './equipmentUse';

/**
 * Ресурсы: материал, техника, ГНБ.
 *
 * Перерасход замечают на складе, когда материал кончился раньше срока —
 * то есть когда сделать уже нечего. Заявки передают голосом, и через
 * неделю никто не помнит, просили трубу или ленту. Где стоит вторая
 * установка ГНБ, знает тот, кто последним звонил.
 *
 * Всё это складывается из дневных отчётов, просто с другой стороны.
 */

interface Props {
  journal: JournalState;
  requests: MaterialRequest[];
  from?: string;
  to?: string;
  author?: string;
  onAddRequest: (r: MaterialRequest) => void;
  onSetRequestStatus: (id: string, status: RequestStatus) => void;
  onRemoveRequest: (id: string) => void;
  onFlash?: (text: string) => void;
}

const newId = () => `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export default function ResourcesView({
  journal, requests, from, to, author,
  onAddRequest, onSetRequestStatus, onRemoveRequest, onFlash,
}: Props) {
  const [tab, setTab] = useState<'material' | 'equipment' | 'drill'>('material');

  const over = useMemo(
    () => materialOveruse(journal.ground, { from, to }),
    [journal.ground, from, to],
  );
  const use = useMemo(
    () => equipmentUse(journal.ground, { from, to }),
    [journal.ground, from, to],
  );
  const fuel = useMemo(() => fuelNeed(use), [use]);
  const queue = useMemo(
    () => drillQueue(journal.drills, journal.ground),
    [journal.drills, journal.ground],
  );
  const overdue = useMemo(() => overdueRequests(requests), [requests]);
  const waiting = useMemo(() => requestedTotals(requests), [requests]);

  function addRequest() {
    const material = window.prompt(
      `Что нужно (${MATERIAL_KINDS.join(', ')}):`,
      'МКТ',
    );
    if (material === null) return;
    const kind = MATERIAL_KINDS.find((m) => m.toLowerCase() === material.trim().toLowerCase());
    if (!kind) { onFlash?.('Такого материала нет в списке'); return; }
    const qty = Number((window.prompt(`Сколько, ${MATERIAL_UNIT[kind]}:`, '') ?? '').replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) return;
    const uchastok = window.prompt('Куда везти (участок):', '') ?? '';
    const needBy = window.prompt('К какому числу (ГГГГ-ММ-ДД, можно пусто):', '') ?? '';
    const now = new Date().toISOString();
    onAddRequest({
      id: newId(),
      date: now.slice(0, 10),
      material: kind,
      qty,
      uchastok: uchastok.trim() || undefined,
      needBy: needBy.trim() || undefined,
      author,
      status: 'открыта',
      createdAt: now,
      updatedAt: now,
    });
    onFlash?.('Заявка записана');
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-1">
        {([
          ['material', 'Материал', PackageCheck],
          ['equipment', 'Техника', Truck],
          ['drill', 'ГНБ', Drill],
        ] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`chip flex-1 justify-center ${tab === k ? 'chip-on' : ''}`}
          >
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {tab === 'material' && (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1.5">
            <div className="text-[13px] font-semibold text-[var(--text)]">
              {over.length === 0 ? 'Расход в пределах нормы' : `Расход мимо нормы: ${over.length}`}
            </div>
            {over.length === 0 ? (
              <div className="text-[11.5px] text-[var(--text-muted)]">
                Ни по одному материалу расход не расходится с нормой заметно.
              </div>
            ) : over.map((r) => (
              <div key={r.material} className="flex items-start gap-1.5 text-[11.5px]">
                <AlertTriangle
                  size={12}
                  className={`mt-0.5 shrink-0 ${
                    r.ratio > 1 ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]'}`}
                />
                <span>
                  <span className="text-[var(--text)]">{overuseText(r)}</span>
                  <span className="block text-[10.5px] text-[var(--text-muted)]">
                    Норма: {r.norm.why}
                  </span>
                </span>
              </div>
            ))}
            <p className="text-[10.5px] text-[var(--text-muted)]">
              Нормы — ориентир, а не приказ: их правят под свой объект. Расхождение
              в полтора раза означает либо потери, либо ошибку в записи, и оба
              случая ловят в тот же месяц.
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold text-[var(--text)]">
                Заявки: {requests.length}
              </span>
              {overdue.length > 0 && (
                <span className="text-[11px] text-[var(--warn)]">просрочено {overdue.length}</span>
              )}
              <button type="button" className="btn btn-ghost text-[11px] ml-auto" onClick={addRequest}>
                <Plus size={13} />Заявка
              </button>
            </div>

            {waiting.size > 0 && (
              <div className="text-[11.5px] text-[var(--text-muted)]">
                Ждём:{' '}
                {[...waiting].map(([m, q]) => `${m} ${Math.round(q).toLocaleString('ru')} ${MATERIAL_UNIT[m]}`).join(', ')}
              </div>
            )}

            {requests.length === 0 ? (
              <div className="text-[11.5px] text-[var(--text-muted)]">
                Заявок нет. Пока их передают голосом, через неделю никто не помнит,
                просили трубу или ленту.
              </div>
            ) : requests
              .slice()
              .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
              .map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-[11.5px]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[var(--text)] truncate">
                      {r.material} {Math.round(r.qty).toLocaleString('ru')} {MATERIAL_UNIT[r.material]}
                      {r.uchastok ? ` → ${r.uchastok}` : ''}
                    </span>
                    <span className="block text-[10.5px] text-[var(--text-muted)]">
                      {new Date(`${r.date}T00:00:00Z`).toLocaleDateString('ru')}
                      {r.needBy ? ` · нужно к ${new Date(`${r.needBy}T00:00:00Z`).toLocaleDateString('ru')}` : ''}
                      {r.author ? ` · ${r.author}` : ''}
                    </span>
                  </span>
                  <select
                    value={r.status}
                    onChange={(e) => onSetRequestStatus(r.id, e.target.value as RequestStatus)}
                    aria-label="Состояние заявки"
                    className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                               px-1 py-0.5 text-[11px] text-[var(--text)]"
                  >
                    {REQUEST_STATUS_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button type="button" className="btn btn-ghost btn-icon text-[var(--danger)]"
                          title="Удалить заявку" onClick={() => onRemoveRequest(r.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
          </div>
        </>
      )}

      {tab === 'equipment' && (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
            <div className="text-[13px] font-semibold text-[var(--text)] mb-1">
              Наработка по сменам
            </div>
            {use.length === 0 ? (
              <div className="text-[11.5px] text-[var(--text-muted)]">
                В отчётах за период технику не указывали.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11.5px]">
                  <thead className="text-[10px] uppercase text-[var(--text-muted)]">
                    <tr>
                      <th className="py-1 font-medium">Техника</th>
                      <th className="py-1 font-medium text-right">Смен</th>
                      <th className="py-1 font-medium text-right">Простой</th>
                      <th className="py-1 font-medium">Где была</th>
                    </tr>
                  </thead>
                  <tbody>
                    {use.map((u) => (
                      <tr key={u.name} className="border-t border-[var(--border)]">
                        <td className="py-1 text-[var(--text)]">
                          {u.name}
                          {u.offReasons.length > 0 && (
                            <span className="block text-[10px] text-[var(--text-muted)]">
                              {u.offReasons.join('; ')}
                            </span>
                          )}
                        </td>
                        <td className="py-1 text-right font-mono tabular-nums">{u.shifts}</td>
                        <td className={`py-1 text-right font-mono tabular-nums ${
                          idleShare(u) > 0.2 ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]'}`}>
                          {u.offShifts > 0 ? `${Math.round(idleShare(u) * 100)}%` : '—'}
                        </td>
                        <td className="py-1 text-[var(--text-muted)] truncate">
                          {u.lastUchastok || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10.5px] text-[var(--text-muted)] mt-1">
              Моточасов в журнале нет и не будет — их никто не пишет. Считаем
              сменами: это то, что действительно записано.
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
            <div className="flex items-baseline gap-2 mb-1">
              <Fuel size={14} className="text-[var(--text-muted)]" />
              <span className="text-[13px] font-semibold text-[var(--text)]">
                Потребность в топливе
              </span>
              <span className="ml-auto font-mono tabular-nums text-[13px] text-[var(--accent)]">
                {Math.round(fuelTotal(fuel)).toLocaleString('ru')} л
              </span>
            </div>
            {fuel.filter((l) => l.expectedL > 0).map((l) => (
              <div key={l.name} className="flex items-baseline gap-2 text-[11.5px]">
                <span className="min-w-0 flex-1 text-[var(--text-muted)] truncate">
                  {l.name} · {l.shifts} смен
                </span>
                <span className="font-mono tabular-nums text-[var(--text)]">
                  {Math.round(l.expectedL).toLocaleString('ru')} л
                </span>
              </div>
            ))}
            {fuel.some((l) => l.expectedL === 0) && (
              <div className="text-[10.5px] text-[var(--text-muted)] mt-1">
                Без нормы:{' '}
                {fuel.filter((l) => l.expectedL === 0).map((l) => l.name).join(', ')} —
                для них потребность не считаем, а не считаем нулём.
              </div>
            )}
            <p className="text-[10.5px] text-[var(--text-muted)] mt-1">
              Фактическую заправку журнал не знает — её ведут в путевых листах.
              Это потребность, с которой идут в снабжение.
            </p>
          </div>
        </>
      )}

      {tab === 'drill' && (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1">
            <div className="text-[13px] font-semibold text-[var(--text)]">
              Где ждут ГНБ
            </div>
            {queue.waiting.length === 0 ? (
              <div className="text-[11.5px] text-[var(--text-muted)]">
                Участков, ожидающих прокол, не видно.
              </div>
            ) : queue.waiting.slice(0, 12).map((w) => (
              <div key={w.uchastok} className="flex items-baseline gap-2 text-[11.5px]">
                <span className="min-w-0 flex-1 text-[var(--text)] truncate">{w.uchastok}</span>
                <span className={`font-mono tabular-nums ${
                  w.days > 14 ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]'}`}>
                  {w.days} дн
                </span>
              </div>
            ))}
            <p className="text-[10.5px] text-[var(--text-muted)]">
              Считаем от последней работы или последнего прокола на участке —
              смотря что было позже.
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1">
            <div className="text-[13px] font-semibold text-[var(--text)]">Сделанные проколы</div>
            {queue.done.slice(0, 20).map((d, i) => (
              <div key={`${d.date}-${d.uchastok}-${i}`}
                   className="flex items-baseline gap-2 text-[11.5px]">
                <span className="font-mono tabular-nums text-[var(--text-muted)] w-[74px] shrink-0">
                  {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ru')}
                </span>
                <span className="min-w-0 flex-1 text-[var(--text)] truncate">{d.uchastok}</span>
                <span className="font-mono tabular-nums text-[var(--text-muted)]">
                  {Math.round(d.meters)} м · {d.count} шт
                </span>
              </div>
            ))}
            {queue.done.length === 0 && (
              <div className="text-[11.5px] text-[var(--text-muted)]">Проколов пока нет.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
