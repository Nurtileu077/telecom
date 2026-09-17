import {
  DailyWorkEntry, AerialWorkEntry, DrillLogEntry, SettlementOrder,
  LayMethod, MaterialKind,
} from '@/types/construction';

/** Состояние журнала стройки — Слой 2. */
export interface JournalState {
  orders: SettlementOrder[];
  ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[];
  drills: DrillLogEntry[];
  updatedAt: string;
}

export function emptyJournal(): JournalState {
  return { orders: [], ground: [], aerial: [], drills: [], updatedAt: '' };
}

// ── Фильтрация ───────────────────────────────────────────────────────────────

export interface JournalFilter {
  /** YYYY-MM-DD включительно */
  from?: string;
  to?: string;
  oblast?: string;
  smu?: string;
  kato?: string;
}

interface Filterable { date: string; oblast: string; smu: string; kato: string }

export function matchesFilter(e: Filterable, f: JournalFilter): boolean {
  if (f.from && e.date && e.date < f.from) return false;
  if (f.to && e.date && e.date > f.to) return false;
  if (f.oblast && e.oblast !== f.oblast) return false;
  if (f.smu && e.smu !== f.smu) return false;
  if (f.kato && e.kato !== f.kato) return false;
  return true;
}

// ── Сводки ───────────────────────────────────────────────────────────────────

export interface GroundTotals {
  /** Метры, проложенные всеми способами. */
  meters: number;
  byMethod: Record<string, number>;
  byMaterial: Record<string, number>;
  drillM: number;
  drillCount: number;
  openCrossings: number;
  blowingM: number;
  entries: number;
}

export function groundTotals(list: DailyWorkEntry[]): GroundTotals {
  const t: GroundTotals = {
    meters: 0, byMethod: {}, byMaterial: {},
    drillM: 0, drillCount: 0, openCrossings: 0, blowingM: 0, entries: list.length,
  };
  for (const e of list) {
    for (const [m, v] of Object.entries(e.byMethod)) {
      if (!v) continue;
      t.byMethod[m] = (t.byMethod[m] ?? 0) + v;
      t.meters += v;
    }
    for (const [m, v] of Object.entries(e.materials)) {
      if (!v) continue;
      t.byMaterial[m] = (t.byMaterial[m] ?? 0) + v;
    }
    t.drillM += e.drillM ?? 0;
    t.drillCount += e.drillCount ?? 0;
    t.openCrossings += e.openCrossings ?? 0;
    t.blowingM += e.blowingM ?? 0;
  }
  return t;
}

/** Группировка с суммой метров — для разрезов «по области», «по СМУ». */
export function metersBy(
  list: DailyWorkEntry[],
  key: (e: DailyWorkEntry) => string,
): { name: string; meters: number; entries: number }[] {
  const acc = new Map<string, { meters: number; entries: number }>();
  for (const e of list) {
    // Пустое значение показываем явно: в журнале таких строк много,
    // и «не указано» — это сама по себе управленческая информация.
    const k = key(e) || 'Не указано';
    const cur = acc.get(k) ?? { meters: 0, entries: 0 };
    for (const v of Object.values(e.byMethod)) cur.meters += v ?? 0;
    cur.entries++;
    acc.set(k, cur);
  }
  return [...acc.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.meters - a.meters);
}

/** Выработка по дням — для графика и для «вчера». */
export function metersByDay(list: DailyWorkEntry[]): { date: string; meters: number }[] {
  const acc = new Map<string, number>();
  for (const e of list) {
    if (!e.date) continue;
    let m = 0;
    for (const v of Object.values(e.byMethod)) m += v ?? 0;
    acc.set(e.date, (acc.get(e.date) ?? 0) + m);
  }
  return [...acc.entries()].map(([date, meters]) => ({ date, meters })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Последняя дата, по которой есть выработка. */
export function lastWorkDate(list: DailyWorkEntry[]): string {
  let last = '';
  for (const e of list) if (e.date && e.date > last) last = e.date;
  return last;
}

export function distinct<T extends Filterable>(list: T[], key: (e: T) => string): string[] {
  const s = new Set<string>();
  for (const e of list) { const v = key(e); if (v) s.add(v); }
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
}

// ── Хранение (оффлайн-первое) ────────────────────────────────────────────────

const KEY = 'optiq-journal-v1';

export function loadJournal(): JournalState {
  if (typeof window === 'undefined') return emptyJournal();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyJournal();
    const p = JSON.parse(raw) as Partial<JournalState>;
    return {
      orders: p.orders ?? [], ground: p.ground ?? [],
      aerial: p.aerial ?? [], drills: p.drills ?? [],
      updatedAt: p.updatedAt ?? '',
    };
  } catch { return emptyJournal(); }
}

/**
 * Запись журнала. Возвращает false при переполнении localStorage —
 * вызывающий код обязан сказать об этом пользователю, а не потерять данные молча.
 */
export function saveJournal(state: JournalState): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
    return true;
  } catch { return false; }
}

/** Слияние импорта с тем, что уже есть: записи с теми же id заменяются. */
export function mergeJournal(base: JournalState, add: Partial<JournalState>): JournalState {
  const mergeList = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const byId = new Map(a.map((x) => [x.id, x]));
    for (const x of b) byId.set(x.id, x);
    return [...byId.values()];
  };
  const mergeOrders = (a: SettlementOrder[], b: SettlementOrder[]): SettlementOrder[] => {
    const byKato = new Map(a.map((x) => [x.kato || x.snp, x]));
    for (const x of b) byKato.set(x.kato || x.snp, x);
    return [...byKato.values()];
  };
  return {
    orders: mergeOrders(base.orders, add.orders ?? []),
    ground: mergeList(base.ground, add.ground ?? []),
    aerial: mergeList(base.aerial, add.aerial ?? []),
    drills: mergeList(base.drills, add.drills ?? []),
    updatedAt: new Date().toISOString(),
  };
}

// ── Точки для карты ──────────────────────────────────────────────────────────

/** Прокол ГНБ/ГНП как точка на карте. */
export interface DrillMapPoint {
  id: string;
  lat: number;
  lon: number;
  /** Длина этого прокола, метры. */
  meters?: number;
  drillKind: 'ГНБ' | 'ГНП';
  uchastok: string;
  oblast: string;
  date: string;
  note?: string;
}

/** Разворачивает записи журнала в плоский список точек для отрисовки. */
export function drillMapPoints(state: JournalState): DrillMapPoint[] {
  const out: DrillMapPoint[] = [];
  for (const d of state.drills) {
    d.points.forEach((p, i) => {
      out.push({
        id: `${d.id}#${i}`,
        lat: p.lat, lon: p.lon, meters: p.meters,
        drillKind: d.drillKind,
        uchastok: d.uchastok, oblast: d.oblast, date: d.date,
        note: d.note,
      });
    });
  }
  return out;
}

// ── Контекст последней записи ────────────────────────────────────────────────

const LAST_KEY = 'optiq-journal-last-v1';

/** Что подставить в форму завтра, чтобы бригаде осталось вписать цифры. */
export interface LastContext {
  smu: string;
  oblast: string;
  rayon: string;
  uchastok: string;
  kato: string;
  tech: import('@/types/construction').WorkTech;
}

export function loadLastContext(): LastContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as LastContext) : null;
  } catch { return null; }
}

export function saveLastContext(ctx: LastContext): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LAST_KEY, JSON.stringify(ctx)); } catch { /* приватный режим */ }
}

/** Добавление дневной записи в журнал. */
export function addGroundEntry(base: JournalState, entry: DailyWorkEntry): JournalState {
  return { ...base, ground: [...base.ground, entry], updatedAt: new Date().toISOString() };
}

export function removeEntry(base: JournalState, id: string): JournalState {
  return {
    ...base,
    ground: base.ground.filter((e) => e.id !== id),
    aerial: base.aerial.filter((e) => e.id !== id),
    drills: base.drills.filter((e) => e.id !== id),
    updatedAt: new Date().toISOString(),
  };
}

// ── Форматирование ───────────────────────────────────────────────────────────

export function fmtKm(meters: number): string {
  if (!meters) return '0';
  return (meters / 1000).toLocaleString('ru', { maximumFractionDigits: 1 });
}

export function fmtMeters(meters: number): string {
  return meters >= 1000 ? `${fmtKm(meters)} км` : `${Math.round(meters)} м`;
}

export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const MATERIAL_LABEL: Record<MaterialKind, string> = {
  'МКТ': 'МКТ', 'ПЭТ': 'ПЭТ', 'Лента': 'Лента',
  'КОД': 'КОД', 'Муфта': 'Муфта', 'ФИТИНГ': 'Фитинг',
};

export type { LayMethod, MaterialKind };
