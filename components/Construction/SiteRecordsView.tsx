'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Copy, AlertTriangle, Phone, Bell } from 'lucide-react';
import {
  notifyState, askNotify, notifyOnce, type NotifyPermission,
} from '@/lib/notify';
import {
  RECORD_KINDS, RECORD_KIND_LIST, ofKind, countByKind, reminders,
  effectiveStatus, daysLeft, contactsText,
  type SiteRecord, type RecordKind, type RecordStatus,
} from './siteRecords';

/**
 * Разрешения, допуски, контакты, претензии, задачи.
 *
 * Согласование с дорожниками истекает — узнают, когда приезжает
 * инспектор. Допуск сварщика кончился — узнают на сдаче. Телефон акима
 * ищут в переписке. Мелкое поручение теряется через день.
 *
 * Напоминаем за неделю: столько идёт продление согласования, и
 * напоминать в день окончания — значит напоминать поздно.
 */

interface Props {
  records: SiteRecord[];
  author?: string;
  onUpsert: (r: SiteRecord) => void;
  onRemove: (id: string) => void;
  onFlash?: (text: string) => void;
}

const newId = () => `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const STATUSES: RecordStatus[] = ['открыто', 'в работе', 'закрыто'];

export default function SiteRecordsView({ records, author, onUpsert, onRemove, onFlash }: Props) {
  const [kind, setKind] = useState<RecordKind>('permit');
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>('unsupported');
  useEffect(() => { setNotifyPerm(notifyState()); }, []);

  const counts = useMemo(() => countByKind(records), [records]);
  const soon = useMemo(() => reminders(records), [records]);
  const list = useMemo(() => ofKind(records, kind), [records, kind]);
  const spec = RECORD_KINDS[kind];

  /**
   * Напоминание в браузере.
   *
   * Журнал держат открытым во вкладке весь день, а срок подходит молча:
   * чтобы его заметить, надо зайти в раздел, куда как раз и не заходят.
   * Работает только пока страница открыта — без своего сервера
   * разбудить закрытое приложение нельзя.
   */
  useEffect(() => {
    if (notifyPerm !== 'granted' || soon.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    notifyOnce(soon.map((r) => ({
      id: r.record.id,
      title: r.days < 0 ? 'Просрочено' : 'Скоро истекает',
      body: `${r.record.title}${r.record.who ? ` · ${r.record.who}` : ''}`
        + (r.days < 0 ? ` — ${-r.days} дн назад` : ` — через ${r.days} дн`),
    })), today);
  }, [notifyPerm, soon]);

  function add() {
    const title = window.prompt(`${spec.label}: что это? (${spec.hint})`, '');
    if (title === null || !title.trim()) return;
    const who = window.prompt(`${spec.whoLabel}:`, '') ?? '';
    const phone = kind === 'contact' ? (window.prompt('Телефон:', '') ?? '') : '';
    const until = spec.dated
      ? (window.prompt('До какого числа (ГГГГ-ММ-ДД, можно пусто):', '') ?? '')
      : '';
    const now = new Date().toISOString();
    onUpsert({
      id: newId(),
      kind,
      title: title.trim(),
      who: who.trim() || undefined,
      phone: phone.trim() || undefined,
      until: until.trim() || undefined,
      from: now.slice(0, 10),
      status: 'открыто',
      author,
      createdAt: now,
      updatedAt: now,
    });
    onFlash?.(`${spec.label} записано`);
  }

  async function copyContacts() {
    const text = contactsText(records);
    if (!text) { onFlash?.('Контактов пока нет'); return; }
    try {
      await navigator.clipboard.writeText(text);
      onFlash?.('Контакты скопированы');
    } catch {
      window.prompt('Скопируйте контакты вручную:', text);
    }
  }

  return (
    <div className="p-3 space-y-3">
      {/* Напоминания — они и есть главное в этом разделе. */}
      {soon.length > 0 && (
        <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--warn)]">
            <AlertTriangle size={14} />Требует внимания: {soon.length}
            {notifyPerm === 'default' && (
              <button
                type="button"
                className="btn btn-ghost text-[11px] ml-auto"
                title="Показывать напоминание, пока журнал открыт во вкладке"
                onClick={async () => {
                  const next = await askNotify();
                  setNotifyPerm(next);
                  if (next === 'granted') onFlash?.('Буду напоминать, пока журнал открыт');
                }}
              >
                <Bell size={12} />Напоминать
              </button>
            )}
          </div>
          {soon.slice(0, 8).map((rem) => (
            <div key={rem.record.id} className="flex items-baseline gap-2 text-[11.5px]">
              <span className="min-w-0 flex-1 text-[var(--text)] truncate">
                {RECORD_KINDS[rem.record.kind].icon} {rem.record.title}
                {rem.record.who ? ` · ${rem.record.who}` : ''}
              </span>
              <span className={`font-mono tabular-nums shrink-0 ${
                rem.level === 'overdue' ? 'text-[var(--danger)]' : 'text-[var(--warn)]'}`}>
                {rem.days < 0 ? `просрочено ${-rem.days} дн` : `через ${rem.days} дн`}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1 flex-wrap">
        {RECORD_KIND_LIST.map((k) => {
          const c = counts.find((x) => x.kind === k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-2 py-1 rounded text-[11.5px] border inline-flex items-center gap-1 ${
                k === kind
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'border-[var(--border)] text-[var(--text-muted)]'}`}
            >
              <span>{RECORD_KINDS[k].icon}</span>
              {RECORD_KINDS[k].label}
              {(c?.total ?? 0) > 0 && (
                <span className="font-mono text-[10px]">{c!.total}</span>
              )}
              {(c?.attention ?? 0) > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warn)]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-[var(--text)]">{spec.plural}</span>
        {kind === 'contact' && records.some((r) => r.kind === 'contact') && (
          <button type="button" className="btn btn-ghost btn-icon" title="Скопировать все контакты"
                  onClick={copyContacts}>
            <Copy size={14} />
          </button>
        )}
        <button type="button" className="btn btn-ghost text-[11px] ml-auto" onClick={add}>
          <Plus size={13} />Добавить
        </button>
      </div>

      {list.length === 0 ? (
        <div className="p-6 text-center text-[12.5px] text-[var(--text-muted)]">
          Пока пусто. {spec.hint}.
        </div>
      ) : list.map((r) => {
        const status = effectiveStatus(r);
        const days = daysLeft(r);
        return (
          <div key={r.id}
               className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[12.5px] text-[var(--text)] min-w-0 flex-1 truncate">
                {r.title}
              </span>
              <select
                value={r.status}
                onChange={(e) => onUpsert({ ...r, status: e.target.value as RecordStatus })}
                aria-label="Состояние"
                className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                           px-1 py-0.5 text-[11px] text-[var(--text)]"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="button" className="btn btn-ghost btn-icon text-[var(--danger)]"
                      title="Удалить" onClick={() => onRemove(r.id)}>
                <Trash2 size={13} />
              </button>
            </div>
            <div className="flex items-baseline gap-2 text-[11px] text-[var(--text-muted)] flex-wrap">
              {r.who && <span>{spec.whoLabel}: {r.who}</span>}
              {r.phone && (
                <a href={`tel:${r.phone.replace(/\s/g, '')}`}
                   className="inline-flex items-center gap-1 text-[var(--accent)]">
                  <Phone size={11} />{r.phone}
                </a>
              )}
              {r.number && <span>№ {r.number}</span>}
              {r.until && (
                <span className={
                  status === 'просрочено' ? 'text-[var(--danger)]'
                    : days !== null && days <= 7 ? 'text-[var(--warn)]' : ''
                }>
                  до {new Date(`${r.until}T00:00:00Z`).toLocaleDateString('ru')}
                  {status === 'просрочено' ? ' · просрочено' : ''}
                </span>
              )}
              {r.uchastok && <span>{r.uchastok}</span>}
            </div>
            {r.note && (
              <div className="text-[11px] text-[var(--text-muted)]">{r.note}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
