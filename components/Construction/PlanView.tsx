'use client';
import { useMemo, useState } from 'react';
import { Plus, Trash2, Send, Copy, Target } from 'lucide-react';
import type { JournalState } from './journalStore';
import {
  planProgress, planSummary, suggestTarget, orderText, type PlanRow,
} from './weekPlan';
import { weekStart } from './entriesTable';
import { moneyBehind } from './payroll';
import { openShare, systemShare, type Messenger } from '@/lib/share';

/**
 * План на неделю.
 *
 * План держат в голове и на планёрке: кто куда едет и сколько должен
 * дать. К среде половина помнит его иначе, а к пятнице спорят, было ли
 * задание вообще.
 *
 * Цифру ставит человек — это обещание, а не прогноз. Система показывает
 * средний темп этой бригады на этом участке и то, что из обещания
 * вышло.
 */

interface Props {
  journal: JournalState;
  author?: string;
  onAddPlan: (row: PlanRow) => void;
  onRemovePlan: (id: string) => void;
  onFlash?: (text: string) => void;
}

const newId = () => `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const m = (v: number) => `${Math.round(v).toLocaleString('ru')} м`;

function weekLabel(week: string): string {
  if (!week) return '—';
  const a = new Date(`${week}T00:00:00Z`);
  const b = new Date(a.getTime() + 6 * 86_400_000);
  const f = (d: Date) => d.toLocaleDateString('ru', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${f(a)} — ${f(b)}`;
}

export default function PlanView({ journal, author, onAddPlan, onRemovePlan, onFlash }: Props) {
  const thisWeek = weekStart(new Date().toISOString().slice(0, 10));
  const [week, setWeek] = useState(thisWeek);

  const rows = useMemo(
    () => planProgress(journal.plans, journal.ground),
    [journal.plans, journal.ground],
  );
  const weeks = useMemo(() => {
    const set = new Set(rows.map((r) => r.week));
    set.add(thisWeek);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [rows, thisWeek]);

  const shown = rows.filter((r) => r.week === week);
  const summary = planSummary(shown);
  const gap = useMemo(() => moneyBehind(shown, journal.rates), [shown, journal.rates]);

  const crews = useMemo(
    () => [...new Set([
      ...journal.crews.map((c) => c.name),
      ...journal.ground.map((e) => e.column).filter((v): v is string => !!v),
    ])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru')),
    [journal.crews, journal.ground],
  );
  const sections = useMemo(
    () => [...new Set(journal.ground.map((e) => e.uchastok).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru')),
    [journal.ground],
  );

  function addPlan() {
    const crew = window.prompt(`Кому (${crews.slice(0, 6).join(', ')}…):`, crews[0] ?? '');
    if (crew === null || !crew.trim()) return;
    const uchastok = window.prompt(`Участок (${sections.slice(0, 4).join(', ')}…):`, sections[0] ?? '');
    if (uchastok === null || !uchastok.trim()) return;

    const hint = suggestTarget(journal.ground, crew.trim(), uchastok.trim());
    const target = Number((window.prompt(
      hint !== null
        ? `Задание на неделю, м (обычно эта бригада даёт ${hint.toLocaleString('ru')}):`
        : 'Задание на неделю, м:',
      hint !== null ? String(hint) : '',
    ) ?? '').replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(target) || target <= 0) return;

    const now = new Date().toISOString();
    onAddPlan({
      id: newId(),
      week,
      crew: crew.trim(),
      uchastok: uchastok.trim(),
      targetM: target,
      contractor: journal.ground.find((e) => e.column === crew.trim())?.contractor,
      author,
      createdAt: now,
      updatedAt: now,
    });
    onFlash?.('Задание записано');
  }

  function orderTextOf(id: string): string | null {
    const plan = shown.find((p) => p.id === id);
    if (!plan) return null;
    return orderText({
      plan,
      crew: journal.crews.find((c) => c.name === plan.crew),
      date: new Date().toISOString().slice(0, 10),
      issuedBy: author,
    });
  }

  /**
   * Наряд туда, где бригада и так сидит.
   *
   * Сначала пробуем системное «Поделиться» — на телефоне оно показывает
   * все приложения сразу. Нет его — открываем мессенджер напрямую.
   */
  async function sendOrder(id: string, to: Messenger) {
    const text = orderTextOf(id);
    if (!text) return;
    if (await systemShare('Наряд', text)) return;
    if (!openShare(to, text)) {
      window.prompt('Скопируйте наряд вручную:', text);
    }
  }

  async function copyOrder(id: string) {
    const plan = shown.find((p) => p.id === id);
    if (!plan) return;
    const text = orderText({
      plan,
      crew: journal.crews.find((c) => c.name === plan.crew),
      date: new Date().toISOString().slice(0, 10),
      issuedBy: author,
    });
    try {
      await navigator.clipboard.writeText(text);
      onFlash?.('Наряд скопирован — вставьте в чат бригады');
    } catch {
      window.prompt('Скопируйте наряд вручную:', text);
    }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-1 flex-wrap items-center">
        {weeks.slice(0, 6).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWeek(w)}
            className={`chip ${w === week ? 'chip-on' : ''}`}
          >
            {weekLabel(w)}
            {w === thisWeek && <span className="text-[9px] ml-1">сейчас</span>}
          </button>
        ))}
        <button type="button" className="btn btn-primary text-[11.5px] ml-auto" onClick={addPlan}>
          <Plus size={13} />Задание
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="p-6 text-center text-[13px] text-[var(--text-muted)]">
          На эту неделю заданий нет.
          <span className="block text-[11.5px] mt-1">
            Пока план держат в голове, к пятнице спорят, было ли задание вообще.
          </span>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
            <div className="flex items-baseline gap-2">
              <Target size={14} className="text-[var(--text-muted)]" />
              <span className="text-[13px] text-[var(--text)]">
                {m(summary.doneM)} из {m(summary.targetM)}
              </span>
              <span className={`ml-auto font-mono tabular-nums text-[14px] ${
                summary.share >= 1 ? 'text-[var(--success)]'
                  : summary.share >= 0.8 ? 'text-[var(--text)]' : 'text-[var(--warn)]'}`}>
                {Math.round(summary.share * 100)}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  summary.share >= 1 ? 'bg-[var(--success)]'
                    : summary.share >= 0.8 ? 'bg-[var(--accent)]' : 'bg-[var(--warn)]'}`}
                style={{ width: `${Math.min(100, Math.round(summary.share * 100))}%` }}
              />
            </div>
            {summary.behind.length > 0 && (
              <div className="mt-1.5 text-[11px] text-[var(--warn)]">
                Отстают: {summary.behind.map((b) => `${b.crew} (${Math.round(b.share * 100)}%)`).join(', ')}
              </div>
            )}
            {/* Метры недобора понятны прорабу, а руководству нужен тот же
                недобор в тенге: по нему считают, чем это кончится. */}
            {gap.totalM > 0 && (
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                Недобор {m(gap.totalM)}
                {gap.totalMoney > 0
                  ? ` — это ${Math.round(gap.totalMoney).toLocaleString('ru')} ₸ по расценке`
                  : ' · в деньгах не считаем: расценки нет'}
              </div>
            )}
          </div>

          {shown.map((p) => (
            <div key={p.id}
                 className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[12.5px] font-semibold text-[var(--text)]">{p.crew}</span>
                <span className="text-[11px] text-[var(--text-muted)] truncate">{p.uchastok}</span>
                <span className={`ml-auto font-mono tabular-nums text-[12.5px] ${
                  p.share >= 1 ? 'text-[var(--success)]'
                    : p.share >= 0.8 ? 'text-[var(--text)]' : 'text-[var(--warn)]'}`}>
                  {Math.round(p.share * 100)}%
                </span>
              </div>
              <div className="h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    p.share >= 1 ? 'bg-[var(--success)]' : 'bg-[var(--accent)]'}`}
                  style={{ width: `${Math.min(100, Math.round(p.share * 100))}%` }}
                />
              </div>
              <div className="flex items-baseline gap-2 text-[11px] text-[var(--text-muted)]">
                <span>{m(p.doneM)} из {m(p.targetM)}</span>
                {p.leftM > 0 && <span>· осталось {m(p.leftM)}</span>}
                <span>· смен {p.shifts}</span>
                <button type="button" className="btn btn-ghost btn-icon ml-auto"
                        title="Отправить наряд в WhatsApp"
                        onClick={() => sendOrder(p.id, 'whatsapp')}>
                  <Send size={13} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon"
                        title="Скопировать наряд"
                        onClick={() => copyOrder(p.id)}>
                  <Copy size={13} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon text-[var(--danger)]"
                        title="Убрать задание" onClick={() => onRemovePlan(p.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="btn btn-ghost text-[11.5px] w-full"
            onClick={async () => {
              const text = shown
                .filter((p) => p.leftM > 0)
                .map((p) => orderText({
                  plan: p,
                  crew: journal.crews.find((c) => c.name === p.crew),
                  date: new Date().toISOString().slice(0, 10),
                  issuedBy: author,
                }))
                .join('\n\n———\n\n');
              if (!text) { onFlash?.('Все задания закрыты'); return; }
              try {
                await navigator.clipboard.writeText(text);
                onFlash?.('Наряды скопированы');
              } catch {
                window.prompt('Скопируйте наряды вручную:', text);
              }
            }}
          >
            <Copy size={13} />Все наряды сразу
          </button>
        </>
      )}
    </div>
  );
}
