import { DailyWorkEntry, SettlementOrder, SnpProgress, SNP_STAGES } from '@/types/construction';
import { stageStatus } from './stageTasks';
import { methodRates, totalShifts } from './crewRate';

/**
 * Рейтинг исполнителей и план на неделю.
 *
 * Соревнование само по себе ничего не строит, но отвечает на вопрос,
 * который иначе решается «на глаз»: кто идёт с запасом, а кому нужна
 * помощь. Поэтому здесь не очки и не медали, а те же метры, только
 * рядом друг с другом и приведённые к смене — иначе бригада, которая
 * работала двадцать дней, всегда «лучше» той, что работала пять.
 *
 * Срывы считаются отдельно и не вычитаются из метров: смешивать их в
 * один балл — значит прятать и то и другое.
 */

export interface RatingRow {
  /** Подрядчик, СМУ или колонна — смотря по чему считаем. */
  name: string;
  meters: number;
  shifts: number;
  /** Метров в смену — главное число рейтинга. */
  perShift: number;
  /** Сколько сёл закрыто полностью. */
  snpDone: number;
  /** Дней с простоем. */
  stalls: number;
  /** Доля смен без простоя. */
  reliability: number;
  lastDate: string;
}

export type RatingBy = 'contractor' | 'smu' | 'column';

function keyOf(e: DailyWorkEntry, by: RatingBy): string {
  if (by === 'smu') return (e.smu ?? '').trim();
  if (by === 'column') return (e.column ?? '').trim();
  return (e.contractor ?? '').trim();
}

function entryMeters(e: DailyWorkEntry): number {
  let m = 0;
  for (const v of Object.values(e.byMethod)) m += v ?? 0;
  return m;
}

export interface RatingInput {
  ground: DailyWorkEntry[];
  progress?: SnpProgress[];
  by?: RatingBy;
  from?: string;
  to?: string;
}

export function rating(input: RatingInput): RatingRow[] {
  const by = input.by ?? 'contractor';
  const acc = new Map<string, {
    meters: number; days: Set<string>; stallDays: Set<string>;
    katos: Set<string>; lastDate: string;
  }>();

  for (const e of input.ground) {
    if (input.from && e.date < input.from) continue;
    if (input.to && e.date > input.to) continue;
    const name = keyOf(e, by);
    // Без имени в рейтинг не попадаем: приписывать метры «не указано»
    // и ставить это в таблицу рядом с людьми — бессмысленно.
    if (!name) continue;
    const rec = acc.get(name) ?? {
      meters: 0, days: new Set<string>(), stallDays: new Set<string>(),
      katos: new Set<string>(), lastDate: '',
    };
    const m = entryMeters(e);
    rec.meters += m;
    if (e.date && m > 0) rec.days.add(e.date);
    if (e.date && e.downtime?.trim()) rec.stallDays.add(e.date);
    if (e.kato) rec.katos.add(e.kato);
    if (e.date > rec.lastDate) rec.lastDate = e.date;
    acc.set(name, rec);
  }

  const doneKatos = new Set(
    (input.progress ?? [])
      .filter((p) => SNP_STAGES.every((s) => stageStatus(p, s) === 'done'))
      .map((p) => p.kato),
  );

  return [...acc.entries()]
    .map(([name, r]) => {
      const shifts = r.days.size;
      const stalls = r.stallDays.size;
      return {
        name,
        meters: r.meters,
        shifts,
        perShift: shifts ? Math.round(r.meters / shifts) : 0,
        snpDone: [...r.katos].filter((k) => doneKatos.has(k)).length,
        stalls,
        reliability: shifts ? Math.round(((shifts - Math.min(stalls, shifts)) / shifts) * 100) / 100 : 0,
        lastDate: r.lastDate,
      };
    })
    // По метрам в смену: иначе тот, кто работал дольше, всегда впереди.
    .sort((a, b) => b.perShift - a.perShift || b.meters - a.meters);
}

// ── План на неделю и месяц ───────────────────────────────────────────────────

export interface PlanTarget {
  /** Сколько метров укладывается в период при нынешнем темпе. */
  expectedM: number;
  /** Сколько уже сделано в этом периоде. */
  doneM: number;
  /** Сколько осталось по реестру заказа. */
  remainingM: number;
  /** Смен в периоде, по которым считали. */
  shifts: number;
  /** Доля выполнения ожидаемого, 0..1+. */
  share: number;
}

/**
 * План — не пожелание, а темп, умноженный на рабочие дни.
 *
 * Считаем по медиане ведущего способа: одна рекордная смена не должна
 * назначать норму на неделю. Если темпа ещё нет, плана тоже нет — и мы
 * так и говорим, а не подставляем красивое число.
 */
export function planFor(
  ground: DailyWorkEntry[],
  orders: SettlementOrder[],
  opts: { days: number; from: string; to: string },
): PlanTarget | null {
  const rates = methodRates(ground);
  const lead = rates[0];
  if (!lead || lead.median <= 0) return null;

  const inPeriod = ground.filter((e) => e.date >= opts.from && e.date <= opts.to);
  const doneM = inPeriod.reduce((s, e) => s + entryMeters(e), 0);
  const shifts = totalShifts(inPeriod);

  const planM = orders.reduce((s, o) => s + (o.planVolsM ?? o.planMktM ?? 0), 0);
  const factM = ground.reduce((s, e) => s + entryMeters(e), 0);
  const remainingM = Math.max(0, planM - factM);

  // Сколько бригад в поле — столько параллельных смен в день. Берём по
  // фактическому числу разных исполнителей за период, а не по списку:
  // в списке они могут быть, а в поле их нет.
  const crews = new Set(
    inPeriod.filter((e) => entryMeters(e) > 0)
      .map((e) => (e.column || e.contractor || e.smu || '').trim())
      .filter(Boolean),
  ).size || 1;

  const expectedM = Math.round(lead.median * opts.days * crews);
  return {
    expectedM,
    doneM,
    remainingM,
    shifts,
    share: expectedM > 0 ? doneM / expectedM : 0,
  };
}

/** Понедельник текущей недели и сегодня — границы недельного плана. */
export function weekBounds(today: string): { from: string; to: string; days: number } {
  const d = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { from: today, to: today, days: 1 };
  const dow = (d.getUTCDay() + 6) % 7; // понедельник — 0
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - dow);
  return {
    from: start.toISOString().slice(0, 10),
    to: today,
    // Рабочих дней в неделе шесть: воскресенье в поле обычно выходной.
    days: Math.min(6, dow + 1),
  };
}

export function monthBounds(today: string): { from: string; to: string; days: number } {
  const d = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { from: today, to: today, days: 1 };
  const from = `${today.slice(0, 7)}-01`;
  // Рабочих дней считаем как календарные минус воскресенья.
  let days = 0;
  for (let i = 1; i <= d.getUTCDate(); i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), i));
    if (x.getUTCDay() !== 0) days += 1;
  }
  return { from, to: today, days };
}
