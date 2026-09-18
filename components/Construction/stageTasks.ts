import {
  SnpProgress, SnpStage, SNP_STAGES, SNP_STAGE_SPECS, StageStatus, StageState,
  CrewKind, SettlementOrder, DailyWorkEntry, DrillLogEntry,
  nextStage, prevStage,
} from '@/types/construction';

/**
 * Наряды между бригадами.
 *
 * Правило одно и оно объяснимо на пальцах: этап становится нарядом, когда
 * предыдущий закрыт, а сам он ещё не начат. Закрыли МКТ на Еленовке —
 * у ГНБ появилась задача на Еленовку. Ничего не рассылается вручную и
 * ничего не теряется в переписке.
 *
 * Наряды не хранятся: они вычисляются из состояния этапов. Хранить их
 * отдельно означало бы держать две правды и однажды их рассинхронизировать.
 */

export interface StageTask {
  kato: string;
  snp: string;
  oblast?: string;
  rayon?: string;
  /** Этап, который можно начинать. */
  stage: SnpStage;
  /** Этап, закрытие которого открыло наряд. */
  after: SnpStage;
  /** Кому наряд — вид колонны. */
  crewKind?: CrewKind;
  /** Когда предыдущий этап закрыли. */
  readySince?: string;
  /** Плановый объём из реестра заказа, метры. */
  planM?: number;
  /** Сколько проколов ожидается по журналу ГНБ. */
  drillCount?: number;
}

export function stageState(p: SnpProgress, s: SnpStage): StageState {
  return p.stages[s] ?? { status: 'not_started' };
}

export function stageStatus(p: SnpProgress, s: SnpStage): StageStatus {
  return stageState(p, s).status;
}

/**
 * Первый этап особый: у него нет предшественника, поэтому он готов сразу.
 * Иначе стройка никогда бы не началась.
 */
export function isStageReady(p: SnpProgress, s: SnpStage): boolean {
  if (stageStatus(p, s) !== 'not_started') return false;
  const before = prevStage(s);
  if (!before) return true;
  return stageStatus(p, before) === 'done';
}

export interface TaskContext {
  orders?: SettlementOrder[];
  drills?: DrillLogEntry[];
}

export function pendingTasks(progress: SnpProgress[], ctx: TaskContext = {}): StageTask[] {
  const orderByKato = new Map((ctx.orders ?? []).map((o) => [o.kato, o]));
  const drillsByKato = new Map<string, number>();
  for (const d of ctx.drills ?? []) {
    if (!d.kato) continue;
    drillsByKato.set(d.kato, (drillsByKato.get(d.kato) ?? 0) + (d.count || 0));
  }

  const out: StageTask[] = [];
  for (const p of progress) {
    for (const s of SNP_STAGES) {
      if (!isStageReady(p, s)) continue;
      const before = prevStage(s);
      // Первый этап без предшественника показываем только когда по СНП
      // вообще ничего не начато — иначе он висел бы вечно.
      if (!before && SNP_STAGES.some((x) => stageStatus(p, x) !== 'not_started')) continue;
      const order = orderByKato.get(p.kato);
      out.push({
        kato: p.kato, snp: p.snp, oblast: p.oblast, rayon: p.rayon,
        stage: s,
        after: before ?? s,
        crewKind: SNP_STAGE_SPECS[s].crewKind,
        readySince: before ? stageState(p, before).doneAt : undefined,
        planM: order?.planVolsM,
        drillCount: s === 'gnb' ? drillsByKato.get(p.kato) : undefined,
      });
      // По одному наряду на СНП: следующий появится, когда закроют этот.
      break;
    }
  }
  return out.sort((a, b) => (a.readySince ?? '').localeCompare(b.readySince ?? ''));
}

/** Наряды для конкретного вида колонн — рабочий стол бригады. */
export function tasksForCrewKind(tasks: StageTask[], kind: CrewKind): StageTask[] {
  return tasks.filter((t) => t.crewKind === kind);
}

/**
 * Наряды, где фронт реально передали: предыдущий этап закрыт и его ждут.
 *
 * Отличается от общего списка тем, что не включает ещё не начатые СНП.
 * Их сотни, и если считать их срочными, счётчик перестаёт что-либо значить:
 * бэклог и переданный фронт — разные вещи.
 */
export function handoffTasks(tasks: StageTask[]): StageTask[] {
  return tasks.filter((t) => t.after !== t.stage);
}

/** Этапы, которые стоят с указанной причиной. */
export function blockedStages(progress: SnpProgress[]): {
  kato: string; snp: string; stage: SnpStage; reason: string; since?: string;
}[] {
  const out: { kato: string; snp: string; stage: SnpStage; reason: string; since?: string }[] = [];
  for (const p of progress) {
    for (const s of SNP_STAGES) {
      const st = stageState(p, s);
      if (st.status !== 'blocked') continue;
      out.push({
        kato: p.kato, snp: p.snp, stage: s,
        reason: st.blockReason || 'причина не указана',
        since: st.startedAt,
      });
    }
  }
  return out;
}

/** Доля закрытых этапов по СНП — для полоски прогресса. */
export function snpCompletion(p: SnpProgress): number {
  const done = SNP_STAGES.filter((s) => stageStatus(p, s) === 'done').length;
  return done / SNP_STAGES.length;
}

/** Сводка по этапам: сколько СНП на каком шаге. */
export function stageSummary(progress: SnpProgress[]): Record<SnpStage, number> {
  const acc = Object.fromEntries(SNP_STAGES.map((s) => [s, 0])) as Record<SnpStage, number>;
  for (const p of progress) {
    // СНП считаем на том этапе, который сейчас в работе; если ничего не в
    // работе — на первом незакрытом. Так видно, где стоит очередь.
    const active = SNP_STAGES.find((s) => stageStatus(p, s) === 'in_progress')
      ?? SNP_STAGES.find((s) => stageStatus(p, s) !== 'done');
    if (active) acc[active]++;
  }
  return acc;
}

/**
 * Создаёт карточки СНП из реестра заказа и дневных записей, чтобы этапы
 * не пришлось заводить руками: населённые пункты уже известны.
 */
export function seedProgress(
  orders: SettlementOrder[],
  entries: DailyWorkEntry[],
  existing: SnpProgress[] = [],
): SnpProgress[] {
  const now = new Date().toISOString();
  const byKato = new Map(existing.map((p) => [p.kato, p]));

  const add = (kato: string, snp: string, oblast?: string, rayon?: string) => {
    if (!kato || byKato.has(kato)) return;
    byKato.set(kato, { kato, snp, oblast, rayon, stages: {}, updatedAt: now });
  };

  for (const o of orders) add(o.kato, o.snp, o.oblast, o.rayon);
  for (const e of entries) add(e.kato, e.uchastok, e.oblast, e.rayon);

  return [...byKato.values()];
}

/**
 * Ближайший этап, по которому есть что делать, и что с ним делать.
 *
 * На доске у села одно действие, а не восемнадцать: шесть этапов с
 * «закрыть», «стоит» и «вернуть» на каждом — это экран, на который
 * боятся нажимать. Работа всегда идёт по первому незакрытому этапу, его
 * и предлагаем; остальные остаются под раскрытием строки.
 */
export function nextStageAction(p: SnpProgress): {
  stage: SnpStage; status: StageStatus; action: 'take' | 'close' | 'resume';
} | null {
  for (const s of SNP_STAGES) {
    const st = stageStatus(p, s);
    if (st === 'done') continue;
    if (st === 'in_progress') return { stage: s, status: st, action: 'close' };
    if (st === 'blocked') return { stage: s, status: st, action: 'resume' };
    return { stage: s, status: st, action: 'take' };
  }
  return null;
}
