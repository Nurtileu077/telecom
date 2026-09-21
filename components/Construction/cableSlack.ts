/**
 * Сколько кабеля заказывать на участок.
 *
 * Длина трассы и длина кабеля — разные числа, и путают их дорого: кабель
 * идёт не по прямой в траншее, а с провисом, в каждой муфте оставляют
 * запас на две-три переварки, на заводке в здание — свой кусок, и на
 * барабане всегда остаётся хвост, который никуда не денешь.
 *
 * Проценты и метры здесь не выдуманы: это то, что закладывают на
 * практике. Каждое слагаемое названо отдельно, чтобы спорить можно было
 * с конкретным, а не с итогом.
 */

export interface SlackRule {
  /** Провис и неровности траншеи, процент от длины трассы. */
  slackPct: number;
  /** Запас в каждой муфте, метры. */
  perJointM: number;
  /** Заводка в здание — АТС, ФАП, школа. */
  perEntryM: number;
  /** Запас на каждом переходе ГНБ: протяжка съедает больше. */
  perDrillM: number;
}

export const DEFAULT_SLACK: SlackRule = {
  slackPct: 2,
  perJointM: 10,
  perEntryM: 15,
  perDrillM: 5,
};

export interface SlackInput {
  routeM: number;
  joints?: number;
  entries?: number;
  drills?: number;
}

export interface SlackResult {
  routeM: number;
  slackM: number;
  jointM: number;
  entryM: number;
  drillM: number;
  /** Сколько кабеля нужно всего. */
  totalM: number;
  /** Во сколько раз больше длины трассы. */
  ratio: number;
}

export function cableNeed(input: SlackInput, rule: SlackRule = DEFAULT_SLACK): SlackResult {
  const routeM = Math.max(0, input.routeM);
  const slackM = (routeM * Math.max(0, rule.slackPct)) / 100;
  const jointM = Math.max(0, input.joints ?? 0) * rule.perJointM;
  const entryM = Math.max(0, input.entries ?? 0) * rule.perEntryM;
  const drillM = Math.max(0, input.drills ?? 0) * rule.perDrillM;
  const totalM = routeM + slackM + jointM + entryM + drillM;
  return {
    routeM, slackM, jointM, entryM, drillM, totalM,
    ratio: routeM > 0 ? totalM / routeM : 0,
  };
}

/**
 * Сколько барабанов и что останется.
 *
 * Барабаны приходят одной длины, а участки — разной, и остаток с
 * предыдущего почти всегда короче следующего пролёта. Считаем честно:
 * сколько целых уйдёт и сколько останется на хвосте.
 */
export interface DrumPlan {
  drums: number;
  /** Остаток на последнем барабане. */
  leftoverM: number;
  /** Хватает ли остатка хоть на что-то осмысленное. */
  usableLeftover: boolean;
}

export function drumsFor(needM: number, drumM: number, minUsefulM = 200): DrumPlan {
  if (drumM <= 0 || needM <= 0) return { drums: 0, leftoverM: 0, usableLeftover: false };
  const drums = Math.ceil(needM / drumM);
  const leftoverM = drums * drumM - needM;
  return { drums, leftoverM, usableLeftover: leftoverM >= minUsefulM };
}

/** «1 240 м трассы → 1 300 м кабеля» — строка для карточки. */
export function slackSummary(r: SlackResult): string {
  const m = (v: number) => `${Math.round(v).toLocaleString('ru')} м`;
  const parts: string[] = [];
  if (r.slackM > 0) parts.push(`провис ${m(r.slackM)}`);
  if (r.jointM > 0) parts.push(`муфты ${m(r.jointM)}`);
  if (r.entryM > 0) parts.push(`заводки ${m(r.entryM)}`);
  if (r.drillM > 0) parts.push(`проколы ${m(r.drillM)}`);
  return `${m(r.routeM)} трассы → ${m(r.totalM)} кабеля`
    + (parts.length ? ` (${parts.join(', ')})` : '');
}
