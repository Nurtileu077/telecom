'use client';
import { useMemo, useState } from 'react';
import {
  TrendingUp, AlertTriangle, CalendarClock, Users, MapPin, ChevronRight, Gauge, Ban,
  Share2,
} from 'lucide-react';
import { JournalState, fmtKm, fmtMeters, plural, openDeviations, pendingCorrections } from './journalStore';
import { materialForecast, lowStock, negativeStock, unknownStock } from './materialForecast';
import { blockedStages } from './stageTasks';
import {
  regionProgress, pace, attention, daysSince, RegionProgress, AttentionItem,
} from './management';
import { MATERIAL_LABEL } from './journalStore';
import { methodRates, crewRates, shiftsLeft, METHOD_LABEL } from './crewRate';
import { downtimeReasons } from './dayPlan';
import { rating, planFor, weekBounds, monthBounds, type RatingBy } from './rating';
import { publicReportHtml, publicReportFileName } from './publicReport';

/**
 * Взгляд руководства.
 *
 * Дневная сводка отвечает «сколько сделали». Здесь другой вопрос —
 * «успеваем ли и где не успеваем», и он требует сравнения с реестром
 * заказа. Первым в экране идёт не красивая цифра, а то, что требует
 * решения сегодня: без этого дашборд превращается в украшение.
 */

interface Props {
  journal: JournalState;
  onOpenView?: (v: NonNullable<AttentionItem['view']>) => void;
}

function pctText(p: number | null): string {
  if (p === null) return '—';
  return `${Math.round(p * 100)}%`;
}

function Bar({ pct }: { pct: number | null }) {
  const v = pct === null ? 0 : Math.max(0, Math.min(1, pct));
  // Перевыполнение показываем цветом, а не полоской длиннее ста процентов.
  const color = pct === null ? '#334155'
    : pct >= 1 ? '#2dd4bf'
    : pct >= 0.6 ? '#4ade80'
    : pct >= 0.3 ? '#fbbf24'
    : '#f87171';
  return (
    <div className="h-1.5 rounded-full bg-[var(--bg-canvas)] overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
}

function RegionRow({ r, onOpen, open, children }: {
  r: RegionProgress;
  onOpen?: () => void;
  open?: boolean;
  children?: React.ReactNode;
}) {
  const Head = onOpen ? 'button' : 'div';
  return (
    <div className="rounded-lg border bg-[var(--bg-surface)] px-3 py-2 flex flex-col gap-1.5"
         style={{ borderColor: open ? 'var(--accent)' : 'var(--border)' }}>
      <Head {...(onOpen ? { type: 'button' as const, onClick: onOpen } : {})}
            className={`flex flex-col gap-1.5 text-left w-full ${onOpen ? 'cursor-pointer' : ''}`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        {onOpen && (
          <ChevronRight size={13}
                        className={`text-[var(--text-muted)] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        )}
        <span className="text-[12.5px] font-medium text-[var(--text)]">{r.name}</span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {fmtKm(r.factM)} из {fmtKm(r.planM)} км
        </span>
        <span className="ml-auto font-mono text-[12px] text-[var(--text)]">{pctText(r.pct)}</span>
      </div>
      <Bar pct={r.pct} />
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--text-muted)]">
        {r.remainingM > 0 && <span>осталось {fmtKm(r.remainingM)} км</span>}
        {r.snpTotal > 0 && (
          <span>
            сёл {r.snpDone}/{r.snpTotal} закрыто
            {r.snpActive > 0 ? ` · ${r.snpActive} в работе` : ''}
          </span>
        )}
        {r.snpBlocked > 0 && <span className="text-[var(--warn)]">стоит {r.snpBlocked}</span>}
        {r.crews > 0 && <span>{r.crews} {plural(r.crews, 'колонна', 'колонны', 'колонн')}</span>}
        {r.openDeviations > 0 && (
          <span className="text-[var(--danger)]">
            {r.openDeviations} {plural(r.openDeviations, 'отклонение', 'отклонения', 'отклонений')}
          </span>
        )}
      </div>
      </Head>
      {open && children && (
        <div className="pl-3 border-l-2 border-[var(--accent)]/40 flex flex-col gap-1.5">{children}</div>
      )}
    </div>
  );
}

export default function ManagementView({ journal, onOpenView }: Props) {
  const ctx = useMemo(() => ({
    orders: journal.orders,
    ground: journal.ground,
    aerial: journal.aerial,
    progress: journal.progress,
    crews: journal.crews,
    deviations: openDeviations(journal),
  }), [journal]);

  const regions = useMemo(() => regionProgress(ctx), [ctx]);
  // Раскрытие: область → районы → сёла. Одна цифра всегда должна
  // разбираться на то, из чего она сложилась.
  const [openOblast, setOpenOblast] = useState<string | null>(null);
  const [openRayon, setOpenRayon] = useState<string | null>(null);
  const rayons = useMemo(
    () => (openOblast ? regionProgress(ctx, { level: 'rayon', oblast: openOblast }) : []),
    [ctx, openOblast],
  );
  const snps = useMemo(
    () => (openOblast && openRayon
      ? regionProgress(ctx, { level: 'snp', oblast: openOblast, rayon: openRayon })
      : []),
    [ctx, openOblast, openRayon],
  );
  const p = useMemo(() => pace(ctx), [ctx]);

  // Норматив выработки: сколько выходит за смену каждым способом. План
  // «пройдём село за неделю» держится либо на опыте одного человека,
  // либо на этих цифрах.
  const rates = useMemo(() => methodRates(journal.ground), [journal.ground]);
  const byCrew = useMemo(() => crewRates(journal.ground), [journal.ground]);
  const shifts = useMemo(() => shiftsLeft(p.remainingM, rates), [p.remainingM, rates]);

  // Причины простоя пишут в каждом отчёте, но никто их не складывал.
  // Сложенные, они отвечают на вопрос, ради которого их и пишут.
  const stalls = useMemo(() => downtimeReasons(journal.ground), [journal.ground]);

  /**
   * Отчёт файлом. Обычная HTML-страница: открывается в любом телефоне,
   * пересылается в мессенджере и не требует ни входа, ни приложения.
   */
  const sendReport = () => {
    const html = publicReportHtml({ journal, contractor: undefined });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = publicReportFileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  };

  // Рейтинг и план на период. Соревнование ничего не строит само по себе,
  // но отвечает на вопрос, который иначе решают на глаз: кто идёт с
  // запасом, а кому нужна помощь.
  const [ratingBy, setRatingBy] = useState<RatingBy>('contractor');
  const today = p.lastDate || new Date().toISOString().slice(0, 10);
  const week = useMemo(() => weekBounds(today), [today]);
  const month = useMemo(() => monthBounds(today), [today]);
  const board = useMemo(
    () => rating({
      ground: journal.ground, progress: journal.progress,
      by: ratingBy, from: month.from,
    }),
    [journal.ground, journal.progress, ratingBy, month.from],
  );
  const weekPlan = useMemo(
    () => planFor(journal.ground, journal.orders, { days: week.days, from: week.from, to: week.to }),
    [journal.ground, journal.orders, week],
  );
  const monthPlan = useMemo(
    () => planFor(journal.ground, journal.orders, { days: month.days, from: month.from, to: month.to }),
    [journal.ground, journal.orders, month],
  );

  const totals = useMemo(() => {
    const planM = regions.reduce((s, r) => s + r.planM, 0);
    const factM = regions.reduce((s, r) => s + r.factM, 0);
    return { planM, factM, pct: planM > 0 ? factM / planM : null };
  }, [regions]);

  const items = useMemo(() => {
    const stocks = materialForecast(journal.ground, journal.deliveries);
    return attention({
      openDeviations: ctx.deviations.length,
      blocked: blockedStages(journal.progress).map((b) => ({ snp: b.snp, reason: b.reason })),
      lowStock: lowStock(stocks).map((s) => ({
        material: MATERIAL_LABEL[s.material] ?? s.material,
        daysLeft: s.daysLeft,
      })),
      negativeStock: negativeStock(stocks).length,
      unknownStock: unknownStock(stocks).length,
      pendingCorrections: pendingCorrections(journal).length,
      daysSinceLastEntry: daysSince(p.lastDate),
    });
  }, [journal, ctx.deviations.length, p.lastDate]);

  const finish = p.finishDate
    ? new Date(`${p.finishDate}T00:00:00Z`).toLocaleDateString('ru', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Требует решения */}
      {items.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Требует решения ({items.length})
          </h4>
          {items.map((it, i) => {
            const color = it.tone === 'danger' ? 'var(--danger)' : 'var(--warn)';
            const Wrap = it.view && onOpenView ? 'button' : 'div';
            return (
              <Wrap
                key={i}
                {...(it.view && onOpenView
                  ? { type: 'button' as const, onClick: () => onOpenView(it.view!) }
                  : {})}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left w-full"
                style={{
                  borderWidth: 1, borderStyle: 'solid',
                  borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
                  background: `color-mix(in srgb, ${color} 10%, transparent)`,
                }}
              >
                <AlertTriangle size={14} style={{ color }} className="shrink-0" />
                <span className="text-[12px] text-[var(--text)] flex-1">{it.text}</span>
                {it.view && onOpenView && (
                  <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />
                )}
              </Wrap>
            );
          })}
        </section>
      )}

      {/* Общий ход */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="rounded-lg border border-[var(--accent)]/35 bg-[var(--accent-dim)] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Выполнено от плана</div>
          <div className="text-[20px] font-semibold text-[var(--accent)] leading-tight">{pctText(totals.pct)}</div>
          <div className="text-[10.5px] text-[var(--text-muted)]">
            {fmtKm(totals.factM)} из {fmtKm(totals.planM)} км
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Темп</div>
          <div className="text-[20px] font-semibold text-[var(--text)] leading-tight">
            {fmtMeters(Math.round(p.metersPerDay))}
          </div>
          <div className="text-[10.5px] text-[var(--text-muted)]">
            в рабочий день · по {p.workingDays} {plural(p.workingDays, 'дню', 'дням', 'дням')}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Осталось</div>
          <div className="text-[20px] font-semibold text-[var(--text)] leading-tight">{fmtKm(p.remainingM)}</div>
          <div className="text-[10.5px] text-[var(--text-muted)]">
            км{p.daysLeft !== null ? ` · ${p.daysLeft} раб. ${plural(p.daysLeft, 'день', 'дня', 'дней')}` : ''}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">При этом темпе</div>
          <div className="text-[14px] font-semibold text-[var(--text)] leading-tight pt-1">
            {finish ?? '—'}
          </div>
          <div className="text-[10.5px] text-[var(--text-muted)]">
            {finish ? 'ожидаемое окончание' : 'темпа нет — прогноз невозможен'}
          </div>
        </div>
      </section>

      {/* По областям */}
      <section className="flex flex-col gap-2">
        <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
          <MapPin size={12} />По областям ({regions.length})
        </h4>
        {regions.length === 0 ? (
          <p className="text-[11.5px] text-[var(--text-muted)]">
            Нет данных: загрузите журнал с реестром заказа — плановые метры лежат там.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {regions.map((r) => (
              <RegionRow key={r.name} r={r}
                         open={openOblast === r.name}
                         onOpen={() => {
                           setOpenOblast(openOblast === r.name ? null : r.name);
                           setOpenRayon(null);
                         }}>
                {rayons.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-muted)] py-1">
                    Районы в записях не указаны — разложить область не по чему.
                  </p>
                ) : rayons.map((ry) => (
                  <RegionRow key={ry.name} r={ry}
                             open={openRayon === ry.name}
                             onOpen={() => setOpenRayon(openRayon === ry.name ? null : ry.name)}>
                    {snps.length === 0 ? (
                      <p className="text-[11px] text-[var(--text-muted)] py-1">Сёл в этом районе не нашлось.</p>
                    ) : snps.slice(0, 60).map((sn) => <RegionRow key={sn.name} r={sn} />)}
                    {snps.length > 60 && (
                      <p className="text-[10.5px] text-[var(--text-muted)]">Показаны первые 60 из {snps.length}.</p>
                    )}
                  </RegionRow>
                ))}
              </RegionRow>
            ))}
          </div>
        )}
      </section>

      {/* Отчёт заказчику: прогресс без доступа внутрь */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10.5px] text-[var(--text-muted)] flex-1 min-w-[200px]">
          Заказчику нужен прогресс, а не доступ внутрь. Отчёт — отдельная
          страница: области, план, факт, срок. Без подрядчиков, простоев и денег.
        </p>
        <button type="button" className="btn text-[11px]" onClick={sendReport}>
          <Share2 size={14} />Отчёт заказчику
        </button>
      </div>

      {/* План на неделю и месяц — темп, умноженный на рабочие дни */}
      {(weekPlan || monthPlan) && (
        <section className="flex flex-col gap-2">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <CalendarClock size={12} />План на период
          </h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {weekPlan && <PlanCard title="Эта неделя" plan={weekPlan} />}
            {monthPlan && <PlanCard title="Этот месяц" plan={monthPlan} />}
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">
            Ожидаемое — медиана ведущего способа, умноженная на рабочие дни и
            число бригад, которые реально выходили. Это не пожелание и не
            норма сверху: столько выходит при том темпе, что есть.
          </p>
        </section>
      )}

      {/* Рейтинг исполнителей */}
      {board.length > 1 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
              <Users size={12} />Кто как идёт за месяц
            </h4>
            <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md ml-auto">
              {([['contractor', 'Подрядчики'], ['smu', 'СМУ'], ['column', 'Колонны']] as [RatingBy, string][])
                .map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setRatingBy(k)}
                          className={`px-2 py-1 text-[11px] rounded ${
                            ratingBy === k ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                    {label}
                  </button>
                ))}
            </div>
          </div>
          {board.slice(0, 10).map((r, i) => (
            <div key={r.name} className="flex items-baseline gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5">
              <span className="w-5 text-[11px] font-mono text-[var(--text-muted)]">{i + 1}</span>
              <span className="text-[12px] text-[var(--text)] truncate">{r.name}</span>
              <span className="text-[10.5px] text-[var(--text-muted)]">
                {r.shifts} {plural(r.shifts, 'смена', 'смены', 'смен')}
                {r.snpDone > 0 && ` · ${r.snpDone} ${plural(r.snpDone, 'село', 'села', 'сёл')} закрыто`}
                {r.stalls > 0 && ` · простоев ${r.stalls}`}
              </span>
              <span className="ml-auto text-[10.5px] text-[var(--text-muted)] shrink-0">
                {fmtKm(r.meters)} км
              </span>
              <span className="font-mono text-[12px] text-[var(--accent)] shrink-0 w-20 text-right">
                {fmtMeters(r.perShift)}
              </span>
            </div>
          ))}
          <p className="text-[10.5px] text-[var(--text-muted)]">
            Справа — метров в смену: иначе тот, кто работал двадцать дней,
            всегда «лучше» того, кто работал пять. Простои показаны рядом и
            из метров не вычитаются — смешивать их в один балл значит
            спрятать и то и другое.
          </p>
        </section>
      )}

      {/* Почему не делали — из причин простоя, которые и так пишут */}
      {stalls.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <Ban size={12} />Почему стояли ({stalls.length})
          </h4>
          {stalls.slice(0, 8).map((r, i) => (
            <div key={i} className="flex items-baseline gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5">
              <span className="text-[12px] text-[var(--text)] min-w-0 flex-1">{r.text}</span>
              {r.places.length > 0 && (
                <span className="text-[10.5px] text-[var(--text-muted)] truncate max-w-[40%]">
                  {r.places.slice(0, 3).join(', ')}
                  {r.places.length > 3 && ` и ещё ${r.places.length - 3}`}
                </span>
              )}
              <span className="font-mono text-[11px] text-[var(--text-muted)] shrink-0">
                {r.count} {plural(r.count, 'раз', 'раза', 'раз')}
              </span>
            </div>
          ))}
          <p className="text-[10.5px] text-[var(--text-muted)]">
            Формулировки не сводятся к общим категориям: разница между
            «скальный грунт» и «ждали согласование» — это и есть ответ.
          </p>
        </section>
      )}

      {/* Выработка за смену — основа честного плана */}
      {rates.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <Gauge size={12} />Выработка за смену
          </h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {rates.map((r) => (
              <div key={r.method} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] text-[var(--text)]">{METHOD_LABEL[r.method]}</span>
                  <span className="ml-auto text-[13px] font-semibold text-[var(--accent)]">
                    {fmtMeters(r.median)}
                  </span>
                </div>
                <div className="text-[10.5px] text-[var(--text-muted)]">
                  обычная смена · среднее {fmtMeters(r.perShift)} · лучшая {fmtMeters(r.best)}
                  {' · '}{r.shifts} {plural(r.shifts, 'смена', 'смены', 'смен')}
                </div>
              </div>
            ))}
          </div>
          {byCrew.length > 0 && (
            <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
              <summary className="px-3 py-2 text-[11.5px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)]">
                По бригадам ({byCrew.length})
              </summary>
              <div className="px-3 pb-2 flex flex-col gap-1">
                {byCrew.slice(0, 30).map((r) => (
                  <div key={`${r.key}-${r.method}`} className="flex items-baseline gap-2 text-[11px]">
                    <span className="text-[var(--text)] truncate">{r.key}</span>
                    <span className="text-[var(--text-muted)] truncate">{METHOD_LABEL[r.method]}</span>
                    <span className="ml-auto font-mono text-[var(--text)] shrink-0">{fmtMeters(r.median)}</span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0 w-16 text-right">
                      {r.shifts} {plural(r.shifts, 'смена', 'смены', 'смен')}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
          <p className="text-[10.5px] text-[var(--text-muted)]">
            Обычная смена — медиана: одна рекордная смена не должна обещать,
            что так будет каждый день.
            {shifts !== null && p.remainingM > 0 && (
              <> При таком темпе остаток — <b className="text-[var(--text)]">
                {shifts} {plural(shifts, 'смена', 'смены', 'смен')}</b> ведущим способом.</>
            )}
          </p>
        </section>
      )}

      <p className="text-[10.5px] text-[var(--text-muted)] leading-relaxed">
        План — плановые объёмы ВОЛС из реестра заказа. Факт — подземка и подвес
        из дневных отчётов; заявки на исправление в факт не попадают, пока
        отчётность их не подтвердит. Темп и прогноз считаются по рабочим дням:
        календарные простои занижали бы темп и делали срок благодушным.
      </p>
    </div>
  );
}

/**
 * План на период. Три числа: сколько выходит при нынешнем темпе, сколько
 * сделано и сколько осталось по реестру. Четвёртого — «сколько должно
 * быть» — у нас нет, и придумывать его неоткуда.
 */
function PlanCard({ title, plan }: {
  title: string;
  plan: NonNullable<ReturnType<typeof planFor>>;
}) {
  const pct = plan.expectedM > 0 ? plan.doneM / plan.expectedM : 0;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] text-[var(--text)]">{title}</span>
        <span className="text-[10.5px] text-[var(--text-muted)]">
          {plan.shifts} {plural(plan.shifts, 'смена', 'смены', 'смен')}
        </span>
        <span className="ml-auto font-mono text-[13px]"
              style={{ color: pct >= 1 ? 'var(--accent)' : pct >= 0.7 ? 'var(--text)' : 'var(--warn)' }}>
          {Math.round(pct * 100)}%
        </span>
      </div>
      <Bar pct={pct} />
      <div className="text-[10.5px] text-[var(--text-muted)]">
        сделано {fmtKm(plan.doneM)} из ожидаемых {fmtKm(plan.expectedM)} км
        {plan.remainingM > 0 && ` · до конца заказа ${fmtKm(plan.remainingM)} км`}
      </div>
    </div>
  );
}
