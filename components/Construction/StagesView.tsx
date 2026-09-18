'use client';
import { useState, useMemo } from 'react';
import { ListChecks, Play, Check, Ban, RotateCcw, Sparkles } from 'lucide-react';
import {
  SnpStage, SNP_STAGES, SNP_STAGE_SPECS, StageStatus, STAGE_STATUS_SPECS,
  CREW_KINDS, BLOCK_REASONS, CrewKind,
} from '@/types/construction';
import { JournalState, plural, fmtMeters } from './journalStore';
import {
  pendingTasks, stageStatus, stageState, blockedStages, snpCompletion, handoffTasks,
} from './stageTasks';

/**
 * Этапы по населённым пунктам и наряды между бригадами.
 *
 * Наряд не рассылается вручную: он появляется сам, когда предыдущий этап
 * закрыт. Закрыли МКТ на Еленовке — у ГНБ в списке возникла Еленовка.
 */

interface Props {
  journal: JournalState;
  onSeed: () => void;
  onSetStage: (kato: string, stage: SnpStage, patch: { status: StageStatus; blockReason?: string; crew?: string }) => void;
}

export default function StagesView({ journal, onSeed, onSetStage }: Props) {
  const [crewFilter, setCrewFilter] = useState<CrewKind | ''>('');
  const [onlyActive, setOnlyActive] = useState(true);

  const tasks = useMemo(
    () => pendingTasks(journal.progress, { orders: journal.orders, drills: journal.drills }),
    [journal.progress, journal.orders, journal.drills],
  );
  const handoffs = useMemo(() => handoffTasks(tasks), [tasks]);
  // По умолчанию показываем переданный фронт: непочатых СНП сотни, и если
  // валить их в одну кучу с ожидающими, очередь перестаёт быть видимой.
  const [showBacklog, setShowBacklog] = useState(false);
  const base = showBacklog ? tasks : handoffs;
  const shownTasks = crewFilter ? base.filter((t) => t.crewKind === crewFilter) : base;
  const blocked = useMemo(() => blockedStages(journal.progress), [journal.progress]);

  const rows = useMemo(() => {
    const list = [...journal.progress];
    // Сначала те, где что-то идёт: список СНП длинный, а смотрят в него,
    // чтобы понять текущее положение, а не листать архив.
    list.sort((a, b) => snpCompletion(a) - snpCompletion(b) || a.snp.localeCompare(b.snp, 'ru'));
    return onlyActive ? list.filter((p) => snpCompletion(p) < 1) : list;
  }, [journal.progress, onlyActive]);

  if (journal.progress.length === 0) {
    return (
      <div className="text-center py-12 flex flex-col items-center gap-3">
        <ListChecks size={22} className="text-[var(--text-muted)]" />
        <p className="text-[12.5px] text-[var(--text-muted)] max-w-sm">
          Этапы не заведены. Населённые пункты уже известны из реестра заказа и
          дневных записей — их можно завести одним нажатием.
        </p>
        <button type="button" className="btn btn-primary text-[12px]" onClick={onSeed}>
          <Sparkles size={15} />Завести этапы по СНП
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Наряды */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {showBacklog ? 'Все наряды' : 'Передан фронт'} ({shownTasks.length})
          </h4>
          <button type="button" onClick={() => setShowBacklog((v) => !v)}
                  className="text-[11px] text-[var(--accent)] hover:underline">
            {showBacklog
              ? `показать только переданный фронт (${handoffs.length})`
              : `показать и непочатые (${tasks.length})`}
          </button>
          <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md ml-auto">
            <button type="button" onClick={() => setCrewFilter('')}
              className={`px-2 py-1 text-[11px] rounded ${!crewFilter ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              Все
            </button>
            {(Object.keys(CREW_KINDS) as CrewKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setCrewFilter(k)}
                className={`px-2 py-1 text-[11px] rounded ${crewFilter === k ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
                title={CREW_KINDS[k].label}>
                {CREW_KINDS[k].icon}
              </button>
            ))}
          </div>
        </div>

        {shownTasks.length === 0 ? (
          <p className="text-[11.5px] text-[var(--text-muted)] py-2">
            {showBacklog
              ? 'Нарядов нет: либо всё в работе, либо этапы закрыты.'
              : 'Переданного фронта нет — никто никого не ждёт.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {shownTasks.slice(0, 40).map((t) => (
              <div key={`${t.kato}-${t.stage}`}
                   className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)] p-3 flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {t.crewKind && <span className="text-base leading-none">{CREW_KINDS[t.crewKind].icon}</span>}
                  <span className="text-[13px] font-medium text-[var(--text)]">{t.snp}</span>
                  <span className="text-[11px] text-[var(--accent)]">{SNP_STAGE_SPECS[t.stage].label}</span>
                  <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">{t.kato}</span>
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {[t.oblast, t.rayon].filter(Boolean).join(', ')}
                  {t.planM ? ` · план ${fmtMeters(t.planM)}` : ''}
                  {t.drillCount ? ` · ${t.drillCount} ${plural(t.drillCount, 'прокол', 'прокола', 'проколов')}` : ''}
                </div>
                {t.readySince && (
                  <div className="text-[10.5px] text-[var(--text-muted)]">
                    Фронт передан {new Date(t.readySince).toLocaleDateString('ru')} —
                    закрыт этап «{SNP_STAGE_SPECS[t.after].label}»
                  </div>
                )}
                <button type="button" className="btn btn-primary text-[11px] self-start"
                        onClick={() => onSetStage(t.kato, t.stage, { status: 'in_progress' })}>
                  <Play size={13} />Взять в работу
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {blocked.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Стоит ({blocked.length})
          </h4>
          {blocked.slice(0, 20).map((b, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2">
              <span className="text-[12.5px] text-[var(--text)]">{b.snp}</span>
              <span className="text-[11px] text-[var(--text-muted)]">{SNP_STAGE_SPECS[b.stage].label}</span>
              <span className="ml-auto text-[11px] text-[var(--danger)]">{b.reason}</span>
            </div>
          ))}
        </section>
      )}

      {/* Доска этапов */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Населённые пункты ({rows.length})
          </h4>
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)}
                   className="accent-[var(--accent)]" />
            только незакрытые
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          {rows.slice(0, 200).map((p) => (
            <div key={p.kato} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[12.5px] font-medium text-[var(--text)] truncate">{p.snp}</span>
                <span className="text-[10.5px] text-[var(--text-muted)] truncate">
                  {[p.oblast, p.rayon].filter(Boolean).join(', ')}
                </span>
                <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">{p.kato}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {SNP_STAGES.map((s) => {
                  const st = stageStatus(p, s);
                  const spec = STAGE_STATUS_SPECS[st];
                  const info = stageState(p, s);
                  return (
                    <div key={s} className="flex items-center gap-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded border"
                            style={{ color: spec.color, borderColor: spec.color }}
                            title={`${SNP_STAGE_SPECS[s].label}: ${spec.label}${info.by ? ` · ${info.by}` : ''}${info.blockReason ? ` · ${info.blockReason}` : ''}`}>
                        {SNP_STAGE_SPECS[s].label}
                      </span>
                      {st !== 'done' && (
                        <span className="flex">
                          <button type="button" title="Закрыть этап"
                                  onClick={() => onSetStage(p.kato, s, { status: 'done' })}
                                  className="px-1 text-[var(--text-muted)] hover:text-[var(--accent)]">
                            <Check size={12} />
                          </button>
                          <button type="button" title="Отметить простой"
                                  onClick={() => {
                                    const reason = prompt(`Почему стоит «${SNP_STAGE_SPECS[s].label}»?\n${BLOCK_REASONS.join(', ')}`);
                                    if (reason === null) return;
                                    onSetStage(p.kato, s, { status: 'blocked', blockReason: reason.trim() || undefined });
                                  }}
                                  className="px-1 text-[var(--text-muted)] hover:text-[var(--danger)]">
                            <Ban size={12} />
                          </button>
                        </span>
                      )}
                      {st === 'done' && (
                        <button type="button" title="Вернуть в работу"
                                onClick={() => onSetStage(p.kato, s, { status: 'in_progress' })}
                                className="px-1 text-[var(--text-muted)] hover:text-[var(--warn)]">
                          <RotateCcw size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {rows.length > 200 && (
            <p className="text-[11px] text-[var(--text-muted)] text-center py-2">
              Показаны первые 200 из {rows.length}.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
