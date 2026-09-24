'use client';
import { useState, useMemo } from 'react';
import {
  ListChecks, Play, Check, Ban, RotateCcw, Sparkles, MoreHorizontal, Route,
} from 'lucide-react';
import {
  SnpStage, SNP_STAGES, SNP_STAGE_SPECS, StageStatus, STAGE_STATUS_SPECS,
  CREW_KINDS, BLOCK_REASONS, CrewKind, SnpProgress,
} from '@/types/construction';
import { JournalState, plural, fmtMeters } from './journalStore';
import {
  pendingTasks, stageStatus, stageState, blockedStages, snpCompletion, handoffTasks,
  nextStageAction,
} from './stageTasks';
import Glyph from '@/components/Layout/Glyph';

/**
 * Этапы по населённым пунктам и наряды между бригадами.
 *
 * Наряд не рассылается вручную: он появляется сам, когда предыдущий этап
 * закрыт. Закрыли МКТ на Еленовке — у ГНБ в списке возникла Еленовка.
 *
 * На строке села одно действие, а не восемнадцать. Шесть этапов, у
 * каждого «закрыть», «стоит» и «вернуть» — это доска, на которую боятся
 * нажимать. Работа всегда идёт по ближайшему незакрытому этапу, его и
 * предлагаем; остальные — под «…», когда действительно нужно.
 */

interface Props {
  journal: JournalState;
  onSeed: () => void;
  onSetStage: (kato: string, stage: SnpStage, patch: { status: StageStatus; blockReason?: string; crew?: string }) => void;
  /** Показать трассу этого села на карте — «от и до». */
  onShowRoute?: (kato: string) => void;
  /** У каких сёл трасса вообще есть: кнопка, которая ничего не делает, врёт. */
  routeKatos?: Set<string>;
}

export default function StagesView({
  journal, onSeed, onSetStage, onShowRoute, routeKatos,
}: Props) {
  /** Раскрытые строки: там, где нужно отметить не ближайший этап. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (kato: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(kato)) next.delete(kato); else next.add(kato);
    return next;
  });
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
    // Сначала то, где идёт работа, потом начатое, и только потом нетронутое.
    // Сортировка «по доле выполнения» поднимала наверх шестьсот непочатых
    // сёл, и доска выглядела мёртвой, хотя стройка шла.
    const rank = (p: SnpProgress) => {
      const done = snpCompletion(p);
      if (SNP_STAGES.some((s) => stageStatus(p, s) === 'blocked')) return 0;
      if (SNP_STAGES.some((s) => stageStatus(p, s) === 'in_progress')) return 1;
      if (done >= 1) return 4;
      return done > 0 ? 2 : 3;
    };
    list.sort((a, b) =>
      rank(a) - rank(b)
      || snpCompletion(b) - snpCompletion(a)
      || a.snp.localeCompare(b.snp, 'ru'));
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
                <Glyph name={CREW_KINDS[k].icon} />
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
                  {t.crewKind && <Glyph name={CREW_KINDS[t.crewKind].icon} size={16} />}
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
          <span className="text-[10.5px] text-[var(--text-muted)]">
            пунктиром — посчитано по журналу
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)}
                   className="accent-[var(--accent)]" />
            только незакрытые
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          {rows.slice(0, 200).map((p) => {
            const open = expanded.has(p.kato);
            const next = nextStageAction(p);
            const hasRoute = !routeKatos || routeKatos.has(p.kato);
            return (
            <div key={p.kato} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[12.5px] font-medium text-[var(--text)] truncate">{p.snp}</span>
                <span className="text-[10.5px] text-[var(--text-muted)] truncate">
                  {[p.oblast, p.rayon].filter(Boolean).join(', ')}
                </span>
                <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">{p.kato}</span>
              </div>

              {/* Этапы — чтобы видеть положение дел, а не чтобы нажимать. */}
              <div className="flex flex-wrap gap-1">
                {SNP_STAGES.map((s) => {
                  const st = stageStatus(p, s);
                  const spec = STAGE_STATUS_SPECS[st];
                  const info = stageState(p, s);
                  return (
                    <span key={s} className="text-[10px] px-1.5 py-0.5 rounded border"
                          style={{
                            color: spec.color,
                            borderColor: spec.color,
                            borderStyle: info.derived ? 'dashed' : 'solid',
                          }}
                          title={`${SNP_STAGE_SPECS[s].label}: ${spec.label}`
                            + (info.derived ? ' · по журналу, не подтверждено' : '')
                            + (info.by ? ` · ${info.by}` : '')
                            + (info.blockReason ? ` · ${info.blockReason}` : '')}>
                      {SNP_STAGE_SPECS[s].label}
                    </span>
                  );
                })}
              </div>

              {/* Одно действие на село: ближайший незакрытый этап. */}
              <div className="flex flex-wrap items-center gap-1.5">
                {next && (
                  <button type="button" className="btn btn-primary text-[11px]"
                          title={`Этап «${SNP_STAGE_SPECS[next.stage].label}»`}
                          onClick={() => onSetStage(p.kato, next.stage, {
                            status: next.action === 'close' ? 'done' : 'in_progress',
                          })}>
                    {/* С двоеточием: «Закрыть Прокладка МКТ» не по-русски,
                        а склонять названия этапов — не наша задача. */}
                    {next.action === 'close'
                      ? <><Check size={13} />Закрыть: {SNP_STAGE_SPECS[next.stage].label}</>
                      : next.action === 'resume'
                        ? <><RotateCcw size={13} />Снять простой</>
                        : <><Play size={13} />Взять в работу: {SNP_STAGE_SPECS[next.stage].label}</>}
                  </button>
                )}
                {next && next.action !== 'resume' && (
                  <button type="button" className="btn btn-ghost text-[11px] text-[var(--text-muted)]"
                          title="Отметить простой по этому этапу"
                          onClick={() => {
                            const reason = prompt(`Почему стоит «${SNP_STAGE_SPECS[next.stage].label}»?\n${BLOCK_REASONS.join(', ')}`);
                            if (reason === null) return;
                            onSetStage(p.kato, next.stage, { status: 'blocked', blockReason: reason.trim() || undefined });
                          }}>
                    <Ban size={13} />Стоит
                  </button>
                )}
                {onShowRoute && hasRoute && (
                  <button type="button" className="btn btn-ghost text-[11px] text-[var(--text-muted)]"
                          title="Показать трассу этого села на карте — от и до"
                          onClick={() => onShowRoute(p.kato)}>
                    <Route size={13} />Посмотреть трассу
                  </button>
                )}
                <button type="button" onClick={() => toggle(p.kato)}
                        className="btn btn-ghost text-[11px] text-[var(--text-muted)] ml-auto"
                        title="Отметить не ближайший этап">
                  <MoreHorizontal size={14} />
                </button>
              </div>

              {/* Остальные этапы — когда действительно нужно поправить не тот,
                  что идёт следующим: пересдача, возврат в работу, простой. */}
              {open && (
                <div className="flex flex-col gap-1 pt-1 border-t border-[var(--border)]">
                  {SNP_STAGES.map((s) => {
                    const st = stageStatus(p, s);
                    const spec = STAGE_STATUS_SPECS[st];
                    return (
                      <div key={s} className="flex items-center gap-2 text-[11px]">
                        <span className="w-24 shrink-0 text-[var(--text-muted)]">{SNP_STAGE_SPECS[s].label}</span>
                        <span style={{ color: spec.color }}>{spec.label}</span>
                        <span className="ml-auto flex gap-0.5">
                          {st !== 'in_progress' && (
                            <button type="button" title="В работу"
                                    onClick={() => onSetStage(p.kato, s, { status: 'in_progress' })}
                                    className="px-1 text-[var(--text-muted)] hover:text-[var(--accent)]">
                              <Play size={12} />
                            </button>
                          )}
                          {st !== 'done' && (
                            <button type="button" title="Закрыть этап"
                                    onClick={() => onSetStage(p.kato, s, { status: 'done' })}
                                    className="px-1 text-[var(--text-muted)] hover:text-[var(--accent)]">
                              <Check size={12} />
                            </button>
                          )}
                          {st !== 'blocked' && (
                            <button type="button" title="Отметить простой"
                                    onClick={() => {
                                      const reason = prompt(`Почему стоит «${SNP_STAGE_SPECS[s].label}»?\n${BLOCK_REASONS.join(', ')}`);
                                      if (reason === null) return;
                                      onSetStage(p.kato, s, { status: 'blocked', blockReason: reason.trim() || undefined });
                                    }}
                                    className="px-1 text-[var(--text-muted)] hover:text-[var(--danger)]">
                              <Ban size={12} />
                            </button>
                          )}
                          {st === 'done' && (
                            <button type="button" title="Вернуть в работу"
                                    onClick={() => onSetStage(p.kato, s, { status: 'in_progress' })}
                                    className="px-1 text-[var(--text-muted)] hover:text-[var(--warn)]">
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            );
          })}
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
