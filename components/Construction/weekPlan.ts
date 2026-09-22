import type { DailyWorkEntry, Crew } from '@/types/construction';
import { entryMeters, weekStart } from './entriesTable';
import { normName } from './areaImport';

/**
 * План на неделю и наряд бригаде.
 *
 * План держат в голове и на планёрке: кто куда едет и сколько должен
 * дать. К среде половина помнит его иначе, а к пятнице спорят, было ли
 * задание вообще. Наряд при этом уже есть — он складывается из того же
 * плана, только на одну бригаду.
 *
 * План — это обещание, а не прогноз: цифру ставит человек, а система
 * показывает, чем она подкреплена и что из неё вышло.
 */

export interface PlanRow {
  id: string;
  /** Понедельник недели, YYYY-MM-DD. */
  week: string;
  /** Кому: колонна или бригада. */
  crew: string;
  uchastok: string;
  /** Сколько метров обещано за неделю. */
  targetM: number;
  contractor?: string;
  note?: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  sync?: 'local' | 'synced';
}

export interface PlanProgress extends PlanRow {
  /** Сколько прошли по факту за ту же неделю. */
  doneM: number;
  /** Доля выполнения, 0..1+. */
  share: number;
  /** Смен отработано. */
  shifts: number;
  /** Сколько осталось до обещанного. */
  leftM: number;
}

function sameCrew(a: string | undefined, b: string | undefined): boolean {
  return normName(a ?? '') === normName(b ?? '');
}

function sameSection(a: string | undefined, b: string | undefined): boolean {
  return normName(a ?? '') === normName(b ?? '');
}

/**
 * План против факта.
 *
 * Факт берём по той же неделе, той же колонне и тому же участку: сложить
 * всё, что бригада сделала где угодно, и назвать это выполнением плана
 * — значит закрыть план чужой работой.
 */
export function planProgress(plans: PlanRow[], rows: DailyWorkEntry[]): PlanProgress[] {
  return plans.map((p) => {
    const mine = rows.filter((e) => weekStart(e.date) === p.week
      && sameCrew(e.column, p.crew)
      && sameSection(e.uchastok, p.uchastok));
    const doneM = mine.reduce((s, e) => s + entryMeters(e), 0);
    return {
      ...p,
      doneM,
      shifts: mine.length,
      share: p.targetM > 0 ? doneM / p.targetM : 0,
      leftM: Math.max(0, p.targetM - doneM),
    };
  }).sort((a, b) => b.week.localeCompare(a.week)
    || a.crew.localeCompare(b.crew, 'ru'));
}

export interface PlanSummary {
  targetM: number;
  doneM: number;
  share: number;
  /** Кто отстаёт больше всех — по ним и спрашивают. */
  behind: PlanProgress[];
  /** Кто уже перевыполнил. */
  ahead: PlanProgress[];
}

export function planSummary(rows: PlanProgress[], behindBelow = 0.8): PlanSummary {
  const targetM = rows.reduce((s, r) => s + r.targetM, 0);
  const doneM = rows.reduce((s, r) => s + r.doneM, 0);
  return {
    targetM,
    doneM,
    share: targetM > 0 ? doneM / targetM : 0,
    behind: rows.filter((r) => r.targetM > 0 && r.share < behindBelow)
      .sort((a, b) => a.share - b.share),
    ahead: rows.filter((r) => r.share >= 1).sort((a, b) => b.share - a.share),
  };
}

/**
 * Что предложить в план на новую неделю.
 *
 * Берём средний темп этой бригады на этом участке за последние недели:
 * своя история честнее любой нормы, а если истории нет — не подсказываем
 * ничего, чтобы не выдумать цифру.
 */
export function suggestTarget(
  rows: DailyWorkEntry[],
  crew: string,
  uchastok: string,
  weeks = 4,
): number | null {
  const mine = rows.filter((e) => sameCrew(e.column, crew) && sameSection(e.uchastok, uchastok));
  if (mine.length === 0) return null;

  const byWeek = new Map<string, number>();
  for (const e of mine) {
    const w = weekStart(e.date);
    if (!w) continue;
    byWeek.set(w, (byWeek.get(w) ?? 0) + entryMeters(e));
  }
  const values = [...byWeek.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, weeks)
    .map(([, v]) => v);
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

// ── Наряд-задание ────────────────────────────────────────────────────────────

export interface OrderInput {
  plan: PlanProgress;
  crew?: Crew;
  /** На какой день выписан наряд. */
  date: string;
  /** Кто выдал. */
  issuedBy?: string;
  /** Что ещё сказать бригаде. */
  note?: string;
}

/**
 * Наряд текстом.
 *
 * Его отправляют в чат — туда, где бригада и так сидит. Поэтому это не
 * документ с рамкой, а короткое сообщение, которое читают с телефона на
 * морозе.
 */
export function orderText(i: OrderInput): string {
  const p = i.plan;
  const when = new Date(`${i.date}T00:00:00Z`).toLocaleDateString('ru');
  const lines = [
    `НАРЯД на ${when}`,
    `${p.crew}${p.contractor ? ` (${p.contractor})` : ''}`,
    `Участок: ${p.uchastok}`,
    `Задание на неделю: ${Math.round(p.targetM).toLocaleString('ru')} м`,
    `Сделано: ${Math.round(p.doneM).toLocaleString('ru')} м`
      + (p.leftM > 0 ? `, осталось ${Math.round(p.leftM).toLocaleString('ru')} м` : ' — задание закрыто'),
  ];
  if (i.crew?.members.length) {
    const people = i.crew.members.filter((m) => !m.dayOff).map((m) => m.name).join(', ');
    if (people) lines.push(`Состав: ${people}`);
  }
  if (i.crew && Object.keys(i.crew.equipment).length) {
    lines.push(`Техника: ${Object.entries(i.crew.equipment)
      .map(([k, v]) => (v > 1 ? `${k} ×${v}` : k)).join(', ')}`);
  }
  if (p.note) lines.push(`По участку: ${p.note}`);
  if (i.note) lines.push(i.note);
  if (i.issuedBy) lines.push(`Выдал: ${i.issuedBy}`);
  return lines.join('\n');
}

/** Наряды выписывают пачкой — на всю неделю и на все бригады сразу. */
export function ordersForWeek(
  plans: PlanProgress[],
  week: string,
  date: string,
  crews: Crew[],
  issuedBy?: string,
): { crew: string; text: string }[] {
  return plans
    .filter((p) => p.week === week && p.leftM > 0)
    .map((plan) => ({
      crew: plan.crew,
      text: orderText({
        plan,
        crew: crews.find((c) => sameCrew(c.name, plan.crew)),
        date,
        issuedBy,
      }),
    }));
}
