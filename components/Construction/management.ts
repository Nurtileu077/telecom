import {
  SettlementOrder, DailyWorkEntry, AerialWorkEntry, Deviation, Crew, SnpProgress,
  SNP_STAGES,
} from '@/types/construction';
import { stageStatus, snpCompletion } from './stageTasks';

/**
 * Взгляд руководства: план против факта.
 *
 * Дневная сводка отвечает на вопрос «сколько сделали». Руководству нужен
 * другой вопрос: «успеваем ли и где не успеваем». Ответ получается только
 * из сравнения с реестром заказа — там лежат плановые метры по каждому
 * населённому пункту, и это единственная цифра, с которой можно сверяться.
 *
 * Все проценты здесь считаются от плана. Если плана нет — процент не
 * выдумывается: показывается прочерк. Деление на ноль в отчёте руководству
 * опаснее пустой клетки.
 */

export interface RegionProgress {
  name: string;
  planM: number;
  factM: number;
  /** Доля выполнения, 0..1. null — плана нет, считать не от чего. */
  pct: number | null;
  /** Сколько осталось по плану. Отрицательное приводим к нулю: перевыполнение
   *  не создаёт «минус работы». */
  remainingM: number;
  snpTotal: number;
  snpDone: number;
  snpActive: number;
  snpBlocked: number;
  crews: number;
  openDeviations: number;
}

export interface ManagementContext {
  orders: SettlementOrder[];
  ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[];
  progress: SnpProgress[];
  crews: Crew[];
  deviations: Deviation[];
}

function entryMeters(e: DailyWorkEntry): number {
  let m = 0;
  for (const v of Object.values(e.byMethod)) m += v ?? 0;
  return m;
}

export type RegionLevel = 'oblast' | 'rayon' | 'snp';

export interface RegionOptions {
  /** Разрез: по областям, по районам внутри области, по сёлам внутри района. */
  level?: RegionLevel;
  oblast?: string;
  rayon?: string;
}

/** Сравнение названий районов: в журнале слово «район» стоит не всегда. */
function sameRegion(a?: string, b?: string): boolean {
  const norm = (v?: string) => (v ?? '')
    .toLowerCase()
    .replace(/район|ауданы|аудан|р-н|область|области|обл\./g, '')
    .replace(/[^a-zа-я0-9]+/g, '');
  return norm(a) === norm(b);
}

/**
 * Сводка по территории: область, район или село.
 *
 * Один и тот же расчёт на трёх уровнях — иначе в районном разрезе
 * незаметно заведётся своя арифметика, и цифры перестанут сходиться с
 * областными.
 */
export function regionProgress(ctx: ManagementContext, opts: RegionOptions = {}): RegionProgress[] {
  const level = opts.level ?? 'oblast';
  const acc = new Map<string, RegionProgress>();

  const inScope = (x: { oblast?: string; rayon?: string }): boolean =>
    (!opts.oblast || sameRegion(x.oblast, opts.oblast))
    && (!opts.rayon || sameRegion(x.rayon, opts.rayon));

  const keyOf = (x: { oblast?: string; rayon?: string; name?: string }): string => {
    if (level === 'oblast') return x.oblast || '';
    if (level === 'rayon') return x.rayon || '';
    return x.name || '';
  };

  const row = (name: string): RegionProgress => {
    const key = name || 'Не указано';
    let r = acc.get(key);
    if (!r) {
      r = {
        name: key, planM: 0, factM: 0, pct: null, remainingM: 0,
        snpTotal: 0, snpDone: 0, snpActive: 0, snpBlocked: 0,
        crews: 0, openDeviations: 0,
      };
      acc.set(key, r);
    }
    return r;
  };

  for (const o of ctx.orders) {
    if (!inScope(o)) continue;
    row(keyOf({ ...o, name: o.snp })).planM += o.planVolsM ?? 0;
  }
  for (const e of ctx.ground) {
    if (!inScope(e)) continue;
    row(keyOf({ ...e, name: e.uchastok })).factM += entryMeters(e);
  }
  // Подвес — это тоже построенная линия: считать его отдельно от плана
  // значит вечно не добирать процент там, где идут по опорам.
  for (const a of ctx.aerial) {
    if (!inScope(a)) continue;
    row(keyOf({ ...a, name: a.uchastok })).factM += a.totalM ?? 0;
  }

  for (const p of ctx.progress) {
    if (!inScope(p)) continue;
    const r = row(keyOf({ ...p, name: p.snp }));
    r.snpTotal++;
    if (snpCompletion(p) >= 1) r.snpDone++;
    else if (SNP_STAGES.some((s) => stageStatus(p, s) === 'in_progress')) r.snpActive++;
    if (SNP_STAGES.some((s) => stageStatus(p, s) === 'blocked')) r.snpBlocked++;
  }

  for (const c of ctx.crews) {
    if (!inScope(c)) continue;
    const key = keyOf({ ...c, name: c.uchastok });
    if (key) row(key).crews++;
  }
  for (const d of ctx.deviations) {
    if (!inScope(d)) continue;
    row(keyOf({ ...d, name: d.uchastok })).openDeviations++;
  }

  const rows = [...acc.values()];
  for (const r of rows) {
    r.pct = r.planM > 0 ? r.factM / r.planM : null;
    r.remainingM = Math.max(0, r.planM - r.factM);
  }
  // Первым — то, где больше всего осталось: туда и смотрит руководство.
  return rows.sort((a, b) => b.remainingM - a.remainingM || b.planM - a.planM);
}

export interface Pace {
  /** Рабочих дней в расчёте — дней, в которые вообще была выработка. */
  workingDays: number;
  metersPerDay: number;
  /** Последний день с выработкой. */
  lastDate: string;
  remainingM: number;
  /** Сколько рабочих дней осталось при этом темпе. null — темпа нет. */
  daysLeft: number | null;
  /** Ожидаемая дата окончания по рабочим дням. null — темпа нет. */
  finishDate: string | null;
}

/**
 * Темп считаем по рабочим дням, а не по календарным.
 *
 * Между заездами бывают недели простоя, и календарный темп превращает
 * нормальную бригаду в отстающую. Прогноз тоже даём в рабочих днях и
 * переводим в дату по пятидневке — это ближе к тому, как реально выходят.
 */
export function pace(ctx: ManagementContext, window = 14): Pace {
  const byDay = new Map<string, number>();
  for (const e of ctx.ground) {
    if (!e.date) continue;
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + entryMeters(e));
  }
  for (const a of ctx.aerial) {
    if (!a.date) continue;
    byDay.set(a.date, (byDay.get(a.date) ?? 0) + (a.totalM ?? 0));
  }
  const days = [...byDay.entries()]
    .filter(([, m]) => m > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const planM = ctx.orders.reduce((s, o) => s + (o.planVolsM ?? 0), 0);
  const factM = [...byDay.values()].reduce((s, m) => s + m, 0);
  const remainingM = Math.max(0, planM - factM);

  const used = days.slice(-window);
  const total = used.reduce((s, [, m]) => s + m, 0);
  const metersPerDay = used.length > 0 ? total / used.length : 0;
  const lastDate = days.length > 0 ? days[days.length - 1][0] : '';

  const daysLeft = metersPerDay > 0 ? Math.ceil(remainingM / metersPerDay) : null;
  return {
    workingDays: used.length,
    metersPerDay,
    lastDate,
    remainingM,
    daysLeft,
    finishDate: daysLeft !== null && lastDate ? addWorkdays(lastDate, daysLeft) : null,
  };
}

/** Прибавляет рабочие дни к дате ISO — суббота и воскресенье пропускаются. */
export function addWorkdays(iso: string, days: number): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Больше десяти лет вперёд прогноз не имеет смысла: это уже не срок,
  // а сообщение о том, что темпа нет.
  if (days > 2600) return null;
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

export interface AttentionItem {
  kind: 'deviation' | 'blocked' | 'material' | 'correction' | 'idle';
  text: string;
  /** Куда ведёт: раздел журнала. */
  view?: 'deviations' | 'stages' | 'materials' | 'corrections' | 'entries';
  tone: 'danger' | 'warn';
}

/**
 * Что требует решения сегодня.
 *
 * Список сознательно короткий и без «информации к сведению»: если в нём
 * оказывается всё подряд, его перестают читать, и тогда он не спасает от
 * настоящей проблемы.
 */
export function attention(input: {
  openDeviations: number;
  blocked: { snp: string; reason: string }[];
  lowStock: { material: string; daysLeft: number | null }[];
  negativeStock: number;
  /** Позиции, по которым расходуют, но приход ни разу не вносили. */
  unknownStock: number;
  pendingCorrections: number;
  daysSinceLastEntry: number | null;
}): AttentionItem[] {
  const out: AttentionItem[] = [];

  if (input.openDeviations > 0) {
    out.push({
      kind: 'deviation', tone: 'danger', view: 'deviations',
      text: `Отклонений без протокола мобильной группы: ${input.openDeviations}. `
        + 'Без протокола участок не закрыть актом.',
    });
  }

  for (const b of input.blocked.slice(0, 5)) {
    out.push({ kind: 'blocked', tone: 'warn', view: 'stages', text: `${b.snp}: стоит — ${b.reason}` });
  }

  for (const s of input.lowStock.slice(0, 5)) {
    out.push({
      kind: 'material', tone: 'warn', view: 'materials',
      text: s.daysLeft !== null
        ? `${s.material}: хватит на ${s.daysLeft} раб. дн. — пора отправлять`
        : `${s.material}: остаток на исходе`,
    });
  }

  if (input.unknownStock > 0) {
    out.push({
      kind: 'material', tone: 'warn', view: 'materials',
      text: `Позиций без внесённого прихода: ${input.unknownStock}. `
        + 'Расход идёт, накладных нет — остаток посчитать не из чего.',
    });
  }

  if (input.negativeStock > 0) {
    out.push({
      kind: 'material', tone: 'warn', view: 'materials',
      text: `Материалов с отрицательным остатком: ${input.negativeStock}. `
        + 'Расход больше прихода — поставки внесены не полностью.',
    });
  }

  if (input.pendingCorrections > 0) {
    out.push({
      kind: 'correction', tone: 'warn', view: 'corrections',
      text: `Заявок на исправление отчёта: ${input.pendingCorrections}`,
    });
  }

  if (input.daysSinceLastEntry !== null && input.daysSinceLastEntry >= 3) {
    out.push({
      kind: 'idle', tone: 'warn', view: 'entries',
      text: `Последняя запись в журнале ${input.daysSinceLastEntry} дн. назад`,
    });
  }

  return out;
}

/** Календарных дней с последней записи. null — записей нет. */
export function daysSince(iso: string, today = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((t - d.getTime()) / 86400000));
}
