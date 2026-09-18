import {
  DailyWorkEntry, AerialWorkEntry, DrillLogEntry, SettlementOrder,
  LayMethod, MaterialKind, CorrectionRequest, Contractor, JournalRole,
  LAY_METHOD_LABEL, Deviation, isDeviationClosed, needsProtocol,
  Crew, crewOnDuty, crewEquipmentCount,
} from '@/types/construction';

/** Состояние журнала стройки — Слой 2. */
export interface JournalState {
  orders: SettlementOrder[];
  ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[];
  drills: DrillLogEntry[];
  /** Заявки на исправление: применяются только после подтверждения. */
  corrections: CorrectionRequest[];
  /** Отклонения от проекта: глубина и трасса. */
  deviations: Deviation[];
  /** Колонны на карте. */
  crews: Crew[];
  contractors: Contractor[];
  /**
   * Надгробия удалённых записей.
   *
   * Без них удаление не переживает синхронизацию: сосед, у которого запись
   * ещё есть, при следующем обмене вернёт её обратно. Храним id и время
   * удаления, чтобы отличить «удалили после правки» от «правили после удаления».
   */
  deleted: DeletedMark[];
  updatedAt: string;
}

export interface DeletedMark {
  id: string;
  /** Когда удалили — ISO. */
  at: string;
}

export function emptyJournal(): JournalState {
  return {
    orders: [], ground: [], aerial: [], drills: [],
    corrections: [], deviations: [], crews: [],
    contractors: DEFAULT_CONTRACTORS, deleted: [], updatedAt: '',
  };
}

/**
 * Известные подрядчики и их районы — со слов заказчика.
 * Справочник редактируемый: это стартовые значения, а не жёсткий список.
 */
export const DEFAULT_CONTRACTORS: Contractor[] = [
  {
    id: 'transtelecom', name: 'Транстелеком',
    fullName: 'АО «Транстелеком»',
    note: 'Генподрядчик',
  },
  {
    id: 'favorit', name: 'СК Фаворит',
    fullName: 'ТОО «СК Фаворит Инжиниринг»',
    worksUnder: 'Транстелеком',
    note: 'Подрядчик; его именем оформляются акты и тетради технадзора',
  },
  {
    id: 'terra-tech', name: 'TERRA TECH',
    worksUnder: 'СК Фаворит',
    areas: [{ oblast: 'Акмолинская область', rayon: 'Зерендинский' }],
  },
  {
    id: 'modul-stroy', name: 'Модуль Строй',
    worksUnder: 'СК Фаворит',
    areas: [{ oblast: 'Акмолинская область', rayon: 'Бурабайский' }],
  },
  { id: 'dozer', name: 'Дозер', worksUnder: 'СК Фаворит' },
];

/**
 * От чьего имени оформляются документы по этому исполнителю.
 * Поднимается по цепочке субподряда до организации, которая значится
 * в актах. Защищено от закольцованных ссылок в справочнике.
 */
export function documentContractor(contractors: Contractor[], name: string): Contractor | undefined {
  const norm = (s: string) => s.trim().toLowerCase();
  let current = contractors.find((c) => norm(c.name) === norm(name));
  const seen = new Set<string>();
  while (current?.worksUnder && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = contractors.find((c) => norm(c.name) === norm(current!.worksUnder!));
    // Генподрядчик в актах не подписывает работы — останавливаемся на подрядчике.
    if (!parent || !parent.worksUnder) break;
    current = parent;
  }
  return current;
}

/** Подсказка подрядчика по области и району. */
export function suggestContractor(
  contractors: Contractor[], oblast: string, rayon?: string,
): Contractor | undefined {
  if (!oblast) return undefined;
  const normalize = (s?: string) => (s ?? '').trim().toLowerCase().replace(/\s*(область|район)\s*/g, '').trim();
  const o = normalize(oblast);
  const r = normalize(rayon);
  // Сначала точное совпадение по району, потом только по области.
  return contractors.find((c) =>
    c.areas?.some((a) => normalize(a.oblast) === o && r && normalize(a.rayon) === r),
  ) ?? contractors.find((c) =>
    c.areas?.some((a) => normalize(a.oblast) === o && !a.rayon),
  );
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
      corrections: p.corrections ?? [],
      deviations: p.deviations ?? [],
      crews: p.crews ?? [],
      deleted: p.deleted ?? [],
      // Пустой справочник заменяем стартовым — иначе подрядчика не из чего выбрать.
      contractors: p.contractors?.length ? p.contractors : DEFAULT_CONTRACTORS,
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
    // Импорт файла не трогает заявки, отклонения, колонны и справочник.
    corrections: base.corrections,
    deviations: base.deviations,
    crews: base.crews,
    contractors: base.contractors.length ? base.contractors : DEFAULT_CONTRACTORS,
    deleted: base.deleted,
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
  contractor?: string;
  column?: string;
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

// ── Колонны ──────────────────────────────────────────────────────────────────

export function upsertCrew(base: JournalState, crew: Crew): JournalState {
  const now = new Date().toISOString();
  const exists = base.crews.some((c) => c.id === crew.id);
  const next = { ...crew, updatedAt: now };
  return {
    ...base,
    crews: exists ? base.crews.map((c) => (c.id === crew.id ? next : c)) : [...base.crews, next],
    updatedAt: now,
  };
}

export function removeCrew(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    crews: base.crews.filter((c) => c.id !== id),
    deleted: withTombstone(base, id, now),
    updatedAt: now,
  };
}

/** Перемещение колонны по карте — меняет только координаты. */
export function moveCrew(base: JournalState, id: string, lat: number, lon: number): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    crews: base.crews.map((c) => (c.id === id ? { ...c, lat, lon, updatedAt: now } : c)),
    updatedAt: now,
  };
}

/** Колонны, которым есть что показать на карте. */
export function placedCrews(base: JournalState): Crew[] {
  return base.crews.filter(
    (c) => typeof c.lat === 'number' && typeof c.lon === 'number'
      && Number.isFinite(c.lat) && Number.isFinite(c.lon),
  );
}

export { crewOnDuty, crewEquipmentCount };

// ── Отклонения от проекта ────────────────────────────────────────────────────

export function addDeviation(base: JournalState, d: Deviation): JournalState {
  return { ...base, deviations: [...base.deviations, d], updatedAt: new Date().toISOString() };
}

export function updateDeviation(base: JournalState, id: string, patch: Partial<Deviation>): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    deviations: base.deviations.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: now } : d)),
    updatedAt: now,
  };
}

export function removeDeviation(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    deviations: base.deviations.filter((d) => d.id !== id),
    deleted: withTombstone(base, id, now),
    updatedAt: now,
  };
}

/** Отклонения без оформленного протокола мобильной группы. */
export function openDeviations(base: JournalState): Deviation[] {
  return base.deviations.filter((d) => !isDeviationClosed(d));
}

export { isDeviationClosed, needsProtocol };

// ── Исправление отчётов ──────────────────────────────────────────────────────

/**
 * Подать заявку на исправление. Сама запись не меняется — в сводке
 * продолжают считаться прежние цифры, пока отчётность не подтвердит.
 */
export function submitCorrection(
  base: JournalState,
  args: { entry: DailyWorkEntry; proposed: DailyWorkEntry; reason: string; author: string },
): JournalState {
  const req: CorrectionRequest = {
    id: `cr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    entryId: args.entry.id,
    before: args.entry,
    proposed: { ...args.proposed, id: args.entry.id },
    reason: args.reason.trim(),
    author: args.author,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  return { ...base, corrections: [...base.corrections, req], updatedAt: new Date().toISOString() };
}

/** Подтверждение: правка применяется к записи, заявка закрывается. */
export function approveCorrection(
  base: JournalState, id: string, by: string, note?: string,
): JournalState {
  const req = base.corrections.find((c) => c.id === id);
  if (!req || req.status !== 'pending') return base;
  const now = new Date().toISOString();
  return {
    ...base,
    ground: base.ground.map((e) =>
      e.id === req.entryId ? { ...req.proposed, updatedAt: now, sync: 'local' } : e,
    ),
    corrections: base.corrections.map((c) =>
      c.id === id ? { ...c, status: 'approved', decidedBy: by, decidedAt: now, decisionNote: note } : c,
    ),
    updatedAt: now,
  };
}

/** Отказ: запись остаётся прежней, причина отказа сохраняется. */
export function rejectCorrection(
  base: JournalState, id: string, by: string, note?: string,
): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    corrections: base.corrections.map((c) =>
      c.id === id && c.status === 'pending'
        ? { ...c, status: 'rejected', decidedBy: by, decidedAt: now, decisionNote: note }
        : c,
    ),
    updatedAt: now,
  };
}

export function pendingCorrections(base: JournalState): CorrectionRequest[] {
  return base.corrections.filter((c) => c.status === 'pending');
}

/** Есть ли по записи неразобранная заявка — чтобы не плодить дубли. */
export function hasPendingCorrection(base: JournalState, entryId: string): boolean {
  return base.corrections.some((c) => c.entryId === entryId && c.status === 'pending');
}

/** Что именно меняется — для показа проверяющему. */
export interface FieldDiff { label: string; before: string; after: string }

export function diffEntries(a: DailyWorkEntry, b: DailyWorkEntry): FieldDiff[] {
  const out: FieldDiff[] = [];
  const push = (label: string, x: unknown, y: unknown) => {
    const sx = x === undefined || x === null || x === '' ? '—' : String(x);
    const sy = y === undefined || y === null || y === '' ? '—' : String(y);
    if (sx !== sy) out.push({ label, before: sx, after: sy });
  };
  push('Дата', a.date, b.date);
  push('Участок', a.uchastok, b.uchastok);
  push('КАТО', a.kato, b.kato);
  push('Область', a.oblast, b.oblast);
  push('Район', a.rayon, b.rayon);
  push('СМУ', a.smu, b.smu);
  push('Подрядчик', a.contractor, b.contractor);
  push('Колонна', a.column, b.column);
  push('Технология', a.tech, b.tech);
  for (const m of new Set([...Object.keys(a.byMethod), ...Object.keys(b.byMethod)])) {
    const label = LAY_METHOD_LABEL[m as LayMethod] ?? m;
    push(`${label}, м`, a.byMethod[m as LayMethod], b.byMethod[m as LayMethod]);
  }
  push('ГНБ, м', a.drillM, b.drillM);
  push('Проколов', a.drillCount, b.drillCount);
  push('Открытых переходов', a.openCrossings, b.openCrossings);
  push('Задувка, м', a.blowingM, b.blowingM);
  for (const m of new Set([...Object.keys(a.materials), ...Object.keys(b.materials)])) {
    push(`Материал: ${m}`, a.materials[m as MaterialKind], b.materials[m as MaterialKind]);
  }
  push('Примечание', a.note, b.note);
  return out;
}

// ── Роль внутри журнала ──────────────────────────────────────────────────────

const ROLE_KEY = 'optiq-journal-role';

export function loadJournalRole(): JournalRole {
  if (typeof window === 'undefined') return 'field';
  try {
    return localStorage.getItem(ROLE_KEY) === 'office' ? 'office' : 'field';
  } catch { return 'field'; }
}

export function saveJournalRole(r: JournalRole): void {
  try { localStorage.setItem(ROLE_KEY, r); } catch { /* приватный режим */ }
}

/** Отметить запись удалённой, чтобы удаление пережило синхронизацию. */
function withTombstone(base: JournalState, id: string, at: string): DeletedMark[] {
  const rest = base.deleted.filter((d) => d.id !== id);
  return [...rest, { id, at }];
}

export function removeEntry(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    ground: base.ground.filter((e) => e.id !== id),
    aerial: base.aerial.filter((e) => e.id !== id),
    drills: base.drills.filter((e) => e.id !== id),
    deleted: withTombstone(base, id, now),
    updatedAt: now,
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
