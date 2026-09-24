'use client';
import { useMemo } from 'react';
import {
  Play, Ban, HardHat, Boxes, FileWarning, CalendarDays, ChevronRight,
} from 'lucide-react';
import {
  SNP_STAGE_SPECS, CREW_KINDS, CREW_STATUS, SnpStage, StageStatus,
} from '@/types/construction';
import {
  JournalState, fmtKm, plural, openDeviations, lastWorkDate, metersByDay,
} from './journalStore';
import { pendingTasks, handoffTasks, blockedStages } from './stageTasks';
import { materialForecast, lowStock, daysLeftText } from './materialForecast';
import { MATERIAL_LABEL } from './journalStore';
import { placeCrews } from './crewPlace';
import { crewsFromJournal } from './crewDerive';
import { lastPlans, lastEquipment } from './dayPlan';
import Glyph from '@/components/Layout/Glyph';

/**
 * Первый экран стройки: что делать сегодня.
 *
 * Сводка отвечает «сколько сделали» — это вопрос вечера. Утром вопрос
 * другой: кого ждут, где стоит, что закрывать. Поэтому стройка
 * открывается здесь, а не на графике за месяц.
 */

interface Props {
  journal: JournalState;
  onOpenView: (v: 'stages' | 'materials' | 'deviations' | 'crews' | 'entries' | 'summary') => void;
  onSetStage: (kato: string, stage: SnpStage, patch: { status: StageStatus }) => void;
  onAddEntry: () => void;
}

export default function TodayView({ journal, onOpenView, onSetStage, onAddEntry }: Props) {
  const tasks = useMemo(
    () => handoffTasks(pendingTasks(journal.progress, { orders: journal.orders, drills: journal.drills })),
    [journal.progress, journal.orders, journal.drills],
  );
  const blocked = useMemo(() => blockedStages(journal.progress), [journal.progress]);
  const devs = useMemo(() => openDeviations(journal), [journal]);
  const low = useMemo(
    () => lowStock(materialForecast(journal.ground, journal.deliveries)),
    [journal.ground, journal.deliveries],
  );
  // Колонны считаем вместе с выведенными по журналу: вопрос «сколько их
  // в поле» не различает, кто как попал в список.
  const crews = useMemo(
    () => placeCrews([...journal.crews, ...crewsFromJournal(journal)], journal),
    [journal],
  );

  // Что собирались сделать — утренний вопрос важнее вечернего «сколько
  // сделали». Поле «план на завтра» заполняют и так, его нужно показать.
  const plans = useMemo(() => lastPlans(journal.ground), [journal.ground]);
  const equip = useMemo(() => lastEquipment(journal.ground), [journal.ground]);

  const last = useMemo(() => lastWorkDate(journal.ground), [journal.ground]);
  const lastMeters = useMemo(() => {
    const day = metersByDay(journal.ground).find((d) => d.date === last);
    return day?.meters ?? 0;
  }, [journal.ground, last]);

  const auto = crews.filter((c) => c.derived).length;
  const working = crews.filter((c) => c.status === 'working');
  const idle = crews.filter((c) => c.status === 'idle' || c.status === 'waiting');

  const nothing = tasks.length === 0 && blocked.length === 0
    && devs.length === 0 && low.length === 0 && plans.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Вчерашний день одной строкой */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
        <CalendarDays size={14} className="text-[var(--text-muted)]" />
        {last ? (
          <span className="text-[12.5px] text-[var(--text)]">
            Последний отчёт — {new Date(`${last}T00:00:00Z`).toLocaleDateString('ru')}:
            {' '}<b>{fmtKm(lastMeters)} км</b>
          </span>
        ) : (
          <span className="text-[12.5px] text-[var(--text-muted)]">Отчётов ещё нет</span>
        )}
        <button type="button" onClick={onAddEntry} className="btn btn-primary text-[11px] ml-auto">
          Закрыть день
        </button>
        <button type="button" onClick={() => onOpenView('summary')}
                className="text-[11px] text-[var(--accent)] hover:underline">
          сводка
        </button>
      </div>

      {/* Что планировали на сегодня */}
      {plans.length > 0 && (
        <Section title={`Планировали (${plans.length})`} icon={<CalendarDays size={13} />}
                 onMore={() => onOpenView('entries')}>
          {plans.slice(0, 6).map((p) => (
            <div key={p.entryId}
                 className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[12px] text-[var(--text)]">{p.crew || p.uchastok}</span>
                <span className="text-[10.5px] text-[var(--text-muted)] truncate">
                  {p.uchastok}{p.rayon ? `, ${p.rayon}` : ''}
                </span>
                <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">
                  {new Date(`${p.date}T00:00:00Z`).toLocaleDateString('ru')}
                </span>
              </div>
              <div className="text-[11.5px] text-[var(--text-muted)]">{p.text}</div>
            </div>
          ))}
          {equip.length > 0 && (
            <p className="text-[10.5px] text-[var(--text-muted)]">
              Техника на той смене: {equip.map((e) => `${e.name} — ${e.count}`).join(', ')}.
            </p>
          )}
        </Section>
      )}

      {nothing && (
        <p className="text-[12.5px] text-[var(--text-muted)]">
          Ничего не ждёт решения: фронт не передавали, простоев нет, отклонения
          закрыты, материалов хватает. Это не поломка — это спокойный день.
        </p>
      )}

      {/* Кого ждут */}
      {tasks.length > 0 && (
        <Section title={`Ждут фронт (${tasks.length})`} icon={<Play size={13} />}
                 onMore={() => onOpenView('stages')}>
          {tasks.slice(0, 6).map((t) => (
            <div key={`${t.kato}-${t.stage}`}
                 className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)] px-3 py-2">
              {t.crewKind && <Glyph name={CREW_KINDS[t.crewKind].icon} size={15} />}
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-[var(--text)] truncate">{t.snp}</div>
                <div className="text-[10.5px] text-[var(--text-muted)] truncate">
                  {SNP_STAGE_SPECS[t.stage].label}
                  {t.rayon ? ` · ${t.rayon}` : ''}
                  {t.readySince
                    ? ` · передан ${new Date(t.readySince).toLocaleDateString('ru')}`
                    : ''}
                </div>
              </div>
              <button type="button" className="btn btn-primary text-[11px] shrink-0"
                      onClick={() => onSetStage(t.kato, t.stage, { status: 'in_progress' })}>
                Взять
              </button>
            </div>
          ))}
        </Section>
      )}

      {/* Где стоит */}
      {blocked.length > 0 && (
        <Section title={`Стоит (${blocked.length})`} icon={<Ban size={13} />}
                 onMore={() => onOpenView('stages')}>
          {blocked.slice(0, 5).map((b, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2">
              <span className="text-[12.5px] text-[var(--text)] truncate">{b.snp}</span>
              <span className="text-[10.5px] text-[var(--text-muted)] shrink-0">{SNP_STAGE_SPECS[b.stage].label}</span>
              <span className="ml-auto text-[11px] text-[var(--danger)] truncate">{b.reason}</span>
            </div>
          ))}
        </Section>
      )}

      {/* Колонны */}
      {crews.length > 0 && (
        <Section title={`Колонны (${crews.length})`} icon={<HardHat size={13} />}
                 onMore={() => onOpenView('crews')}>
          <div className="flex flex-wrap gap-1.5">
            {crews.slice(0, 12).map((c) => {
              const st = CREW_STATUS[c.status];
              return (
                <div key={c.id}
                     className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5"
                     style={{ borderColor: st.color, background: 'var(--bg-surface)' }}>
                  <Glyph name={CREW_KINDS[c.kind].icon} size={14} />
                  <div className="min-w-0">
                    <div className="text-[11.5px] text-[var(--text)] truncate">{c.name}</div>
                    <div className="text-[10px] truncate" style={{ color: st.color }}>
                      {st.label}{c.uchastok ? ` · ${c.uchastok}` : ''}
                    </div>
                    {/* Куда едет: «где её ждать» спрашивают каждый день */}
                    {(c.trip?.from || c.trip?.to) && (
                      <div className="text-[10px] text-[var(--text-muted)] truncate"
                           title={c.trip.route}>
                        🚚 {[c.trip.from, c.trip.to].filter(Boolean).join(' → ')}
                        {c.trip.leftM ? ` · ${fmtKm(c.trip.leftM)} км` : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">
            Работают {working.length}, ждут или стоят {idle.length}.
            Место берётся из последнего отчёта.
            {auto > 0 && <> {auto} выведены по журналу — их состав не заполнен.</>}
          </p>
        </Section>
      )}

      {/* Отклонения */}
      {devs.length > 0 && (
        <Section title={`Без протокола (${devs.length})`} icon={<FileWarning size={13} />}
                 onMore={() => onOpenView('deviations')}>
          <p className="text-[11.5px] text-[var(--text-muted)]">
            {devs.length} {plural(devs.length, 'отклонение', 'отклонения', 'отклонений')} ждут протокола
            мобильной группы. Без него участок не закрыть актом.
          </p>
        </Section>
      )}

      {/* Материалы */}
      {low.length > 0 && (
        <Section title={`Пора отправлять (${low.length})`} icon={<Boxes size={13} />}
                 onMore={() => onOpenView('materials')}>
          <div className="flex flex-wrap gap-1.5">
            {low.map((s) => (
              <span key={s.material}
                    className="text-[11.5px] rounded-lg border border-[var(--warn)]/50 bg-[var(--warn)]/10 px-2.5 py-1 text-[var(--text)]">
                {MATERIAL_LABEL[s.material]} — {daysLeftText(s)}
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon, onMore, children }: {
  title: string; icon: React.ReactNode; onMore?: () => void; children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
          {icon}{title}
        </h4>
        {onMore && (
          <button type="button" onClick={onMore}
                  className="ml-auto text-[11px] text-[var(--accent)] hover:underline inline-flex items-center gap-0.5">
            все<ChevronRight size={12} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
