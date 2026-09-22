import type { DailyWorkEntry, PlanRoute } from '@/types/construction';
import { normName } from './areaImport';

/**
 * Журнал как таблица.
 *
 * Записей за сезон тысячи, и смотрят в них не подряд, а по вопросу:
 * «сколько дал Дозер в июле», «где мы просели», «что за смена на 4 800
 * метров». Пока список только листается сверху вниз, на каждый такой
 * вопрос уходит прокрутка глазами.
 *
 * Здесь — только разбор строк: поиск, порядок, недели, итоги. Рисует их
 * таблица.
 */

export type SortKey = 'date' | 'uchastok' | 'meters' | 'contractor' | 'smu';
export type SortDir = 'asc' | 'desc';

export const SORT_LABEL: Record<SortKey, string> = {
  date: 'Дата',
  uchastok: 'Участок',
  meters: 'Метры',
  contractor: 'Подрядчик',
  smu: 'СМУ',
};

/** Метры смены — сумма по способам. Отдельного поля «итого» в журнале нет. */
export function entryMeters(e: DailyWorkEntry): number {
  let m = 0;
  for (const v of Object.values(e.byMethod)) m += v ?? 0;
  return m;
}

function hay(e: DailyWorkEntry): string {
  return [
    e.date, e.uchastok, e.contractor, e.column, e.smu, e.oblast, e.rayon,
    e.note, e.author, e.tech, e.downtime, e.tomorrow, e.disputeNote,
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Поиск по строкам.
 *
 * Ищем по всему, что в записи написано словами, включая причину
 * простоя и примечание: «скальный» спрашивают именно там, а не в
 * названии участка.
 */
export function filterEntries(rows: DailyWorkEntry[], query: string): DailyWorkEntry[] {
  const q = (query ?? '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!q) return rows;
  const words = q.split(/\s+/).filter(Boolean);
  return rows.filter((e) => {
    const h = hay(e).replace(/ё/g, 'е');
    return words.every((w) => h.includes(w));
  });
}

export function sortEntries(
  rows: DailyWorkEntry[],
  key: SortKey,
  dir: SortDir,
): DailyWorkEntry[] {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (e: DailyWorkEntry): string | number => {
    switch (key) {
      case 'meters': return entryMeters(e);
      case 'uchastok': return e.uchastok || '';
      case 'contractor': return e.contractor || '';
      case 'smu': return e.smu || '';
      default: return e.date || '';
    }
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
    const cmp = String(va).localeCompare(String(vb), 'ru');
    // При равенстве — по дате: иначе порядок скачет от перерисовки к
    // перерисовке и строка «уезжает» из-под курсора.
    return (cmp !== 0 ? cmp : (a.date || '').localeCompare(b.date || '')) * sign;
  });
}

export interface WeekGroup {
  /** Понедельник недели, YYYY-MM-DD. */
  week: string;
  label: string;
  rows: DailyWorkEntry[];
  meters: number;
}

/** Понедельник той недели, в которую попала дата. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  // В ISO-неделе понедельник первый, а getUTCDay() считает с воскресенья.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function weekLabel(monday: string): string {
  const a = new Date(`${monday}T00:00:00Z`);
  const b = new Date(a.getTime() + 6 * 24 * 3600 * 1000);
  const fmt = (d: Date, withMonth: boolean) => d.toLocaleDateString('ru', {
    day: 'numeric', ...(withMonth ? { month: 'short' } : {}), timeZone: 'UTC',
  });
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  return `${fmt(a, !sameMonth)} — ${fmt(b, true)}`;
}

/**
 * По неделям.
 *
 * Месяц целиком — слишком крупно, чтобы увидеть провал, а день —
 * слишком мелко, чтобы увидеть темп. Неделя — то, чем меряют на
 * планёрке.
 */
export function groupByWeek(rows: DailyWorkEntry[]): WeekGroup[] {
  const acc = new Map<string, DailyWorkEntry[]>();
  for (const e of rows) {
    const key = weekStart(e.date);
    const list = acc.get(key);
    if (list) list.push(e); else acc.set(key, [e]);
  }
  return [...acc.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, list]) => ({
      week,
      label: week ? weekLabel(week) : 'Без даты',
      rows: list,
      meters: list.reduce((s, e) => s + entryMeters(e), 0),
    }));
}

export interface TableTotals {
  meters: number;
  /** Сколько смен — то есть строк. */
  shifts: number;
  /** Сколько разных дней. */
  days: number;
  /** Средние метры за смену. */
  perShift: number;
  drillM: number;
  disputed: number;
}

export function tableTotals(rows: DailyWorkEntry[]): TableTotals {
  const meters = rows.reduce((s, e) => s + entryMeters(e), 0);
  const days = new Set(rows.map((e) => e.date).filter(Boolean)).size;
  return {
    meters,
    shifts: rows.length,
    days,
    perShift: rows.length > 0 ? meters / rows.length : 0,
    drillM: rows.reduce((s, e) => s + (e.drillM ?? 0), 0),
    disputed: rows.filter((e) => e.disputed).length,
  };
}

/**
 * Выбранные строки текстом.
 *
 * Их кладут в письмо и в чат, где таблиц нет: разделитель — табуляция,
 * она вставится и в Excel, и в Word колонками.
 */
export function rowsToText(rows: DailyWorkEntry[]): string {
  const head = ['Дата', 'Участок', 'Подрядчик', 'Колонна', 'СМУ', 'Метры', 'ГНБ, м', 'Примечание'];
  const body = rows.map((e) => [
    e.date ? new Date(`${e.date}T00:00:00Z`).toLocaleDateString('ru') : '',
    e.uchastok || '',
    e.contractor || '',
    e.column || '',
    e.smu || '',
    String(Math.round(entryMeters(e))),
    e.drillM ? String(Math.round(e.drillM)) : '',
    e.note || '',
  ].join('\t'));
  return [head.join('\t'), ...body].join('\n');
}

export interface PlanFactRow {
  uchastok: string;
  factM: number;
  planM: number;
  /** Факт минус проект: плюс — прошли больше, чем в проекте. */
  diffM: number;
  /** Доля отклонения от проекта. */
  share: number;
}

/**
 * Где факт разошёлся с проектом.
 *
 * Проектная длина известна из KML, фактическая складывается из смен.
 * Расхождение само по себе не ошибка — трассу переносят, — но узнать о
 * нём лучше на стройке, а не при сдаче.
 */
export function planFact(
  rows: DailyWorkEntry[],
  routes: PlanRoute[],
  minDiffM = 100,
): PlanFactRow[] {
  const fact = new Map<string, number>();
  for (const e of rows) {
    const key = e.uchastok?.trim();
    if (!key) continue;
    fact.set(key, (fact.get(key) ?? 0) + entryMeters(e));
  }

  // Проект ищем по названию: в KML участок подписан так же, как в журнале.
  const plan = new Map<string, number>();
  for (const r of routes) {
    for (const name of [r.uchastok, r.name, r.folder]) {
      const key = normName(name ?? '');
      if (!key) continue;
      plan.set(key, (plan.get(key) ?? 0) + r.lengthM);
      break;
    }
  }

  const out: PlanFactRow[] = [];
  for (const [uchastok, factM] of fact) {
    const planM = plan.get(normName(uchastok)) ?? 0;
    if (planM <= 0) continue;
    const diffM = factM - planM;
    if (Math.abs(diffM) < minDiffM) continue;
    out.push({ uchastok, factM, planM, diffM, share: diffM / planM });
  }
  return out.sort((a, b) => Math.abs(b.diffM) - Math.abs(a.diffM));
}
