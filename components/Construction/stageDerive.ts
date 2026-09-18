import {
  SnpProgress, SnpStage, SNP_STAGES, StageState, StageStatus,
  SettlementOrder, DailyWorkEntry, AerialWorkEntry, DrillLogEntry,
} from '@/types/construction';

/**
 * Этапы, посчитанные из журнала.
 *
 * Руками отмечать шесть этапов на шестистах сёлах никто не будет — доска
 * так и останется серой, а серая доска не отвечает ни на один вопрос.
 * Но журнал уже знает, что происходит: есть метры по способам — значит МКТ
 * кладут; есть проколы — работает ГНБ; пошла задувка — трубу, очевидно,
 * уже проложили.
 *
 * Отсюда правило: система выводит состояние сама, человек его уточняет.
 * Ручная отметка всегда сильнее выведенной, и выведенная помечается как
 * выведенная — чтобы её не путали с чьим-то подтверждением.
 */

export interface DeriveContext {
  orders: SettlementOrder[];
  ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[];
  drills: DrillLogEntry[];
}

interface Fact {
  /** Метры по способам прокладки — это и есть прокладка МКТ. */
  laidM: number;
  /** Задувка ОК, метры. */
  blownM: number;
  /** Подвес, метры. */
  aerialM: number;
  drills: number;
  lastDate: string;
}

function entryMeters(e: DailyWorkEntry): number {
  let m = 0;
  for (const v of Object.values(e.byMethod)) m += v ?? 0;
  return m;
}

export function factsByKato(ctx: DeriveContext): Map<string, Fact> {
  const acc = new Map<string, Fact>();
  const row = (kato: string): Fact => {
    let f = acc.get(kato);
    if (!f) { f = { laidM: 0, blownM: 0, aerialM: 0, drills: 0, lastDate: '' }; acc.set(kato, f); }
    return f;
  };
  const stamp = (f: Fact, date?: string) => {
    if (date && date > f.lastDate) f.lastDate = date;
  };

  for (const e of ctx.ground) {
    if (!e.kato) continue;
    const f = row(e.kato);
    f.laidM += entryMeters(e);
    f.blownM += e.blowingM ?? 0;
    stamp(f, e.date);
  }
  for (const a of ctx.aerial) {
    if (!a.kato) continue;
    const f = row(a.kato);
    f.aerialM += a.totalM ?? 0;
    stamp(f, a.date);
  }
  for (const d of ctx.drills) {
    if (!d.kato) continue;
    const f = row(d.kato);
    f.drills += Math.max(1, d.count || 0);
    stamp(f, d.date);
  }
  return acc;
}

/**
 * Этап считается закрытым, когда факт добрал план. План ниже факта на
 * стройке бывает, поэтому сравниваем с запасом вниз: 98% — это сделано,
 * а не «почти».
 */
const DONE_SHARE = 0.98;

function statusFromVolume(fact: number, plan: number | undefined): StageStatus | null {
  if (fact <= 0) return null;
  if (plan && plan > 0 && fact >= plan * DONE_SHARE) return 'done';
  return 'in_progress';
}

/** Что можно сказать об этапах одного СНП, глядя только в журнал. */
export function deriveStages(
  fact: Fact | undefined,
  order: SettlementOrder | undefined,
): Partial<Record<SnpStage, StageStatus>> {
  if (!fact) return {};
  const out: Partial<Record<SnpStage, StageStatus>> = {};

  const mkt = statusFromVolume(fact.laidM, order?.planMktM ?? order?.planVolsM);
  if (mkt) out.mkt = mkt;
  if (fact.drills > 0) out.gnb = 'in_progress';
  const zaduvka = statusFromVolume(fact.blownM, order?.planVokM ?? order?.planVolsM);
  if (zaduvka) out.zaduvka = zaduvka;
  const podves = statusFromVolume(fact.aerialM, order?.planAerialM);
  if (podves) out.podves = podves;

  // Задувать можно только в проложенную трубу. Если пошла задувка, а МКТ
  // по бумагам не закрыта — значит закрыта, просто отметить забыли.
  if (out.zaduvka && out.mkt !== 'done') out.mkt = 'done';
  if (out.podves && out.mkt === undefined) out.mkt = 'done';

  return out;
}

/**
 * Накладывает выведенное на заведённые карточки.
 *
 * Ручная отметка не трогается никогда: человек на месте знает больше
 * журнала. Выведенное помечается `derived`, чтобы в интерфейсе было видно
 * разницу между «посчитали» и «подтвердили».
 */
export function applyDerived(progress: SnpProgress[], ctx: DeriveContext): SnpProgress[] {
  const facts = factsByKato(ctx);
  const orders = new Map(ctx.orders.map((o) => [o.kato, o]));

  return progress.map((p) => {
    const derived = deriveStages(facts.get(p.kato), orders.get(p.kato));
    if (Object.keys(derived).length === 0) return p;

    const stages: Partial<Record<SnpStage, StageState>> = { ...p.stages };
    let changed = false;
    for (const s of SNP_STAGES) {
      const status = derived[s];
      if (!status) continue;
      const own = stages[s];
      // Ручная отметка сильнее. Своей отметкой считаем ту, что человек
      // поставил: у выведенной стоит флаг.
      if (own && !own.derived) continue;
      if (own?.status === status) continue;
      stages[s] = {
        status,
        derived: true,
        doneAt: status === 'done' ? facts.get(p.kato)?.lastDate : undefined,
        startedAt: facts.get(p.kato)?.lastDate,
      };
      changed = true;
    }
    return changed ? { ...p, stages } : p;
  });
}

/**
 * Карточки СНП по реестру заказа плюс всё, что встретилось в журнале.
 *
 * Отдельно от seedProgress: тот сохраняет карточки в документ, а этот
 * ничего не пишет — он нужен, чтобы доска и карта показывали положение
 * дел ещё до того, как кто-нибудь нажал «завести этапы».
 */
export function effectiveProgress(
  progress: SnpProgress[],
  ctx: DeriveContext,
  now = new Date().toISOString(),
): SnpProgress[] {
  const byKato = new Map(progress.map((p) => [p.kato, p]));

  const add = (kato: string, snp: string, oblast?: string, rayon?: string) => {
    if (!kato || byKato.has(kato)) return;
    byKato.set(kato, { kato, snp, oblast, rayon, stages: {}, updatedAt: now });
  };
  for (const o of ctx.orders) add(o.kato, o.snp, o.oblast, o.rayon);
  for (const e of ctx.ground) add(e.kato, e.uchastok, e.oblast, e.rayon);
  for (const a of ctx.aerial) add(a.kato, a.uchastok, a.oblast, a.rayon);

  return applyDerived([...byKato.values()], ctx);
}
