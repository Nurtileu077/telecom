import {
  DailyWorkEntry, AerialWorkEntry, DrillLogEntry, SettlementOrder,
  LayMethod, MaterialKind, CorrectionRequest, Contractor, JournalRole,
  LAY_METHOD_LABEL, Deviation, isDeviationClosed, needsProtocol,
  Crew, crewOnDuty, crewEquipmentCount, MaterialDelivery, PlanRoute,
  SnpProgress, SnpStage, StageState, MapArea, SiteObject, ChangeLogEntry,
  CableDrum, FieldPhoto, SpliceRecord, Incident, normalizeRole, WorkRate, Payment,
} from '@/types/construction';
import { haversineM } from '@/components/Network/KMeans';
import { splitRoute, joinRoutes, joinedName, splitNames } from './routeEdit';

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
  /** Приход материалов по областям — без него остаток не из чего вычесть. */
  deliveries: MaterialDelivery[];
  /** Барабаны кабеля: номер и паспортная длина. Остаток считается. */
  drums: CableDrum[];
  /** Карточки полевых фото. Сами файлы лежат отдельно — см. photoStore. */
  photos: FieldPhoto[];
  /** Протоколы сварки: чем подтверждается, что линия работает. */
  splices: SpliceRecord[];
  /** Аварии на сети — то, ради чего журнал стройки живёт после сдачи. */
  incidents: Incident[];
  /** Проектные трассы из KML: план, который стройка не переписывает. */
  planRoutes: PlanRoute[];
  /** Обведённые районы и сёла из KML — границы, а не трассы. */
  areas: MapArea[];
  /** Цены материалов — у каждого подрядчика свои, система их не выдумывает. */
  prices: import('./materialCost').MaterialPrices;
  /**
   * Когда правили каждую цену. Сброс — тоже правка, просто без значения:
   * по этому времени обмен и решает, чья версия свежее.
   */
  pricedAt?: Record<string, string>;
  /** Расценки по видам работ — у каждого подрядчика свои и с какого числа. */
  rates: WorkRate[];
  /** Движение денег с подрядчиками: аванс, удержание, оплата. */
  payments: Payment[];
  /** Заявки на материал: их передавали голосом и забывали. */
  requests: import('./supply').MaterialRequest[];
  /** План на неделю: кто где и сколько должен дать. */
  plans: import('./weekPlan').PlanRow[];
  /** Разрешения, допуски, контакты, претензии, задачи — всё со сроками. */
  records: import('./siteRecords').SiteRecord[];
  /** Муфты, столбы, конечные точки, ККС — то, что стоит вдоль трассы. */
  objects: SiteObject[];
  /**
   * Докуда дошли по трассе каждого участка. Положение колонны — следствие
   * метража, а не отдельная запись: прошли четыре километра — сдвинулись
   * по линии на четыре километра.
   */
  sectionProgress: Record<string, import('./routeProgress').SectionProgress>;
  /** Прохождение этапов по населённым пунктам — основа нарядов. */
  progress: SnpProgress[];
  contractors: Contractor[];
  /**
   * Журнал изменений трассы: кто, когда и как было. Одобрения правка не
   * требует — линия и есть форма, — но след оставляет.
   */
  changes: ChangeLogEntry[];
  /** Поля актов, заполняемые при закрытии, по участкам. */
  actFields: Record<string, import('./sectionAct').SectionActManual>;
  /**
   * Реквизиты сторон: кто сдаёт, кому и по какому договору.
   *
   * Подряд меняется, а документы печатаются каждый день. Держать
   * название заказчика в коде — значит просить переписать программу
   * всякий раз, когда меняется договор.
   */
  requisites?: import('./requisites').Requisites;
  /**
   * Надгробия удалённых записей.
   *
   * Без них удаление не переживает синхронизацию: сосед, у которого запись
   * ещё есть, при следующем обмене вернёт её обратно. Храним id и время
   * удаления, чтобы отличить «удалили после правки» от «правили после удаления».
   */
  deleted: DeletedMark[];
  /**
   * Корзина.
   *
   * Удалённая по ошибке смена — это не «упс», а пропавшие метры в акте.
   * Строка лежит месяц и возвращается одним нажатием; для обмена она
   * по-прежнему удалена — надгробие никуда не делось.
   */
  trash: TrashedEntry[];
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
    corrections: [], deviations: [], crews: [], deliveries: [], drums: [],
    photos: [], splices: [], incidents: [], planRoutes: [],
    areas: [], prices: {}, pricedAt: {}, rates: [], payments: [],
    requests: [], plans: [], records: [],
    objects: [], sectionProgress: {}, progress: [],
    contractors: DEFAULT_CONTRACTORS, changes: [], actFields: {},
    deleted: [], trash: [], updatedAt: '',
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

/**
 * СМУ заказчика: их семь, и номера постоянные.
 *
 * Поле было свободным текстом со списком из уже введённого — пока в
 * журнале ни одного СМУ, выбирать было не из чего, и их перестали
 * ставить. Стартовый список возвращает выбор; всё, что введут своё,
 * добавляется к нему, а не заменяет.
 */
export const DEFAULT_SMUS = [
  'СМУ-1', 'СМУ-2', 'СМУ-3', 'СМУ-4', 'СМУ-5', 'СМУ-6', 'СМУ-7',
];

export function smuList(base: Pick<JournalState, 'ground' | 'aerial' | 'drills'>): string[] {
  const s = new Set<string>(DEFAULT_SMUS);
  for (const e of base.ground) if (e.smu?.trim()) s.add(e.smu.trim());
  for (const e of base.aerial) if (e.smu?.trim()) s.add(e.smu.trim());
  for (const e of base.drills) if (e.smu?.trim()) s.add(e.smu.trim());
  // «СМУ-10» после «СМУ-9», а не между «СМУ-1» и «СМУ-2».
  return [...s].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
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

/**
 * Область, выбранная один раз, держится во всех разрезах.
 *
 * Выбрать «Акмолинская» в сводке, зайти в день и увидеть там Мангистау —
 * значит один раз поверить цифре, которая к выбранной области отношения
 * не имеет. Поэтому фильтр применяется не к отдельному списку, а к
 * журналу целиком: дальше каждый экран считает как считал.
 *
 * Записи без области не прячем: мы отбрасываем только то, про что точно
 * знаем, что оно из другого места. Потерять запись фильтром хуже, чем
 * показать лишнюю.
 */
export function scopeJournal(base: JournalState, oblast?: string): JournalState {
  const o = oblast?.trim();
  if (!o) return base;
  const keep = (v?: string) => !v || v === o;
  return {
    ...base,
    orders: base.orders.filter((r) => keep(r.oblast)),
    ground: base.ground.filter((e) => keep(e.oblast)),
    aerial: base.aerial.filter((e) => keep(e.oblast)),
    drills: base.drills.filter((e) => keep(e.oblast)),
    deviations: base.deviations.filter((d) => keep(d.oblast)),
    deliveries: base.deliveries.filter((d) => keep(d.oblast)),
    drums: base.drums.filter((d) => keep(d.oblast)),
    photos: base.photos.filter((p) => keep(p.oblast)),
    incidents: base.incidents.filter((i) => keep(i.oblast)),
    objects: base.objects.filter((r) => keep(r.oblast)),
    crews: base.crews.filter((c) => keep(c.oblast)),
    progress: base.progress.filter((p) => keep(p.oblast)),
  };
}

/**
 * Журнал глазами субподрядчика.
 *
 * Сейчас ему либо показывают всё, либо ничего — и обычно ничего, потому
 * что в общем журнале чужие объёмы и чужие деньги. А свои смены, свой
 * план и свой расчёт ему нужны каждый день.
 *
 * Прячем чужое целиком, а не помечаем: «видно, но нельзя» — это всё
 * равно видно.
 */
export function scopeToContractor(base: JournalState, contractor?: string): JournalState {
  const c = contractor?.trim();
  if (!c) return base;
  const mine = (v?: string) => v === c;
  return {
    ...base,
    ground: base.ground.filter((e) => mine(e.contractor)),
    aerial: base.aerial.filter((e) => mine(e.contractor)),
    drills: base.drills.filter((e) => mine(e.contractor)),
    deviations: base.deviations.filter((d) => mine(d.contractor)),
    crews: base.crews.filter((cr) => mine(cr.contractor)),
    incidents: base.incidents.filter((i) => mine(i.contractor)),
    payments: base.payments.filter((p) => mine(p.contractor)),
    // Расценки: свои и общие. Чужую цену подрядчику видеть незачем.
    rates: base.rates.filter((r) => !r.contractor || r.contractor === c),
    plans: base.plans.filter((p) => mine(p.contractor)),
    // Заявки и допуски привязаны к бригадам, а не к подрядчику — их
    // оставляем как есть: скрыть их значило бы спрятать работу.
  };
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

/**
 * Починить запись, пришедшую снаружи.
 *
 * Типы гарантируют форму записи, пока она рождается в нашем коде. Но
 * записи приходят и из чужих рук: из копии, снятой полгода назад, из
 * импорта таблицы, с сервера, где работает устройство постарше. Там поля
 * может не быть.
 *
 * Одна такая запись роняет полприложения: `e.materials` разыменовывают в
 * десятке мест — ведомость объёмов, акт, сводка за день, прогноз
 * материалов, выгрузка в Excel. Падает уже при отрисовке, и try/catch
 * вокруг чтения не спасает: разбор-то прошёл.
 *
 * Поэтому чиним один раз на входе, а не десятью проверками по месту.
 * То же и с проколами: без `points` падает карта проколов и план ГНБ.
 */
const isPlainObject = (v: unknown): boolean =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Смена: без `materials` и `byMethod` падают ведомость, акт и сводка. */
export function fixWorkEntry<T>(e: T): T {
  if (!isPlainObject(e)) return e;
  const r = e as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (!isPlainObject(r.materials)) patch.materials = {};
  if (!isPlainObject(r.byMethod)) patch.byMethod = {};
  return Object.keys(patch).length ? { ...r, ...patch } as T : e;
}

/** Прокол: без `points` падает карта проколов и план ГНБ. */
export function fixDrillEntry<T>(d: T): T {
  if (!isPlainObject(d)) return d;
  const r = d as Record<string, unknown>;
  if (Array.isArray(r.points)) return d;
  return { ...r, points: [] } as T;
}

/** Список не тот — отдаём пустой, а не падаем. */
export function fixList<T>(list: T[] | undefined, fix: (x: T) => T): T[] {
  if (!Array.isArray(list)) return [];
  return list.map(fix);
}

export function loadJournal(): JournalState {
  if (typeof window === 'undefined') return emptyJournal();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyJournal();
    const p = JSON.parse(raw) as Partial<JournalState>;
    return {
      orders: p.orders ?? [],
      // Записи чиним на входе: у пришедшей из старой копии может не быть
      // полей, которые весь остальной код считает обязательными.
      ground: fixList(p.ground, fixWorkEntry),
      aerial: fixList(p.aerial, fixWorkEntry),
      drills: fixList(p.drills, fixDrillEntry),
      corrections: p.corrections ?? [],
      changes: p.changes ?? [],
      deviations: p.deviations ?? [],
      crews: p.crews ?? [],
      deliveries: p.deliveries ?? [],
      drums: p.drums ?? [],
      photos: p.photos ?? [],
      splices: p.splices ?? [],
      incidents: p.incidents ?? [],
      areas: p.areas ?? [],
      prices: p.prices ?? {},
      pricedAt: p.pricedAt ?? {},
      rates: p.rates ?? [],
      requests: p.requests ?? [],
      plans: p.plans ?? [],
      records: p.records ?? [],
      payments: p.payments ?? [],
      objects: p.objects ?? [],
      sectionProgress: p.sectionProgress ?? {},
      planRoutes: p.planRoutes ?? [],
      progress: p.progress ?? [],
      actFields: p.actFields ?? {},
      requisites: p.requisites,
      deleted: p.deleted ?? [],
      trash: p.trash ?? [],
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
    // Импортированный файл делали не мы: поля, которое весь остальной код
    // считает обязательным, там может не быть.
    ground: mergeList(base.ground, fixList(add.ground, fixWorkEntry)),
    aerial: mergeList(base.aerial, fixList(add.aerial, fixWorkEntry)),
    drills: mergeList(base.drills, fixList(add.drills, fixDrillEntry)),
    // Импорт файла не трогает заявки, отклонения, колонны, контуры и справочник.
    areas: base.areas,
    prices: base.prices,
    pricedAt: base.pricedAt,
    rates: base.rates,
    requests: base.requests,
    plans: base.plans,
    records: base.records,
    payments: base.payments.filter((p) => true),
    objects: base.objects,
    sectionProgress: base.sectionProgress,
    corrections: base.corrections,
    drums: base.drums,
    photos: base.photos,
    splices: base.splices,
    incidents: base.incidents,
    changes: base.changes,
    deviations: base.deviations,
    crews: base.crews,
    deliveries: base.deliveries,
    planRoutes: base.planRoutes,
    progress: base.progress,
    contractors: base.contractors.length ? base.contractors : DEFAULT_CONTRACTORS,
    actFields: base.actFields,
    requisites: base.requisites,
    deleted: base.deleted,
    trash: base.trash,
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

/** Отклонение, у которого есть что показать на карте. */
export interface DeviationMapItem {
  id: string;
  coords: { lat: number; lon: number }[];
  kind: Deviation['kind'];
  uchastok: string;
  date: string;
  lengthM: number;
  designDepthM?: number;
  actualDepthM?: number;
  reason: string;
  contractor?: string;
  /** Есть ли протокол мобильной группы. */
  closed: boolean;
  protocolNumber?: string;
}

export function deviationMapItems(state: JournalState): DeviationMapItem[] {
  const out: DeviationMapItem[] = [];
  for (const d of state.deviations) {
    const pts = (d.coords ?? []).filter(
      (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon),
    );
    if (pts.length === 0) continue;
    out.push({
      id: d.id, coords: pts, kind: d.kind,
      uchastok: d.uchastok, date: d.date, lengthM: d.lengthM,
      designDepthM: d.designDepthM, actualDepthM: d.actualDepthM,
      reason: d.reason, contractor: d.contractor,
      closed: isDeviationClosed(d),
      protocolNumber: d.protocol?.number,
    });
  }
  return out;
}

/**
 * Проколы для карты.
 *
 * Прокол — это не точка, а отрезок: у него есть вход и выход. Когда в
 * записи сняли обе координаты, рисуем линию; когда одну — метку. Так на
 * карте видно, где ГНБ прошла под дорогой, а не просто «здесь что-то было».
 */
/**
 * Насколько далеко друг от друга могут быть концы одного прокола.
 *
 * Прокол — это переход: через дорогу, арык, речку. Десятки метров, редко
 * сотня-другая. Если в одной записи журнала стоят две координаты за
 * километры друг от друга, это не вход и выход одного прокола — это два
 * разных прокола, записанных одной строкой. Так в журнале и пишут:
 * «Координаты: 1. …; 2. …».
 *
 * Считать их концами одного — значит протянуть розовую линию через всю
 * трассу и сказать, что там пробурено. Поэтому меряем: длина прокола в
 * записи есть, и концы должны в неё укладываться.
 */
export const DRILL_SPAN_LIMIT_M = 500;

export function isOneDrill(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  meters?: number,
): boolean {
  const d = haversineM(a.lat, a.lon, b.lat, b.lon);
  // Запас на точность координат: телефон врёт на десятки метров, и
  // прокол в 72 м может лечь как 90. Но не как 9 000.
  const limit = meters && meters > 0
    ? Math.max(meters * 2 + 100, 150)
    : DRILL_SPAN_LIMIT_M;
  return d <= limit;
}

/** Точки записи, годные для карты. */
function drillPointsOf(d: DrillLogEntry): { lat: number; lon: number; meters?: number }[] {
  return d.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/** Запись рисуется линией только если её концы — это и правда один прокол. */
function drillIsLine(d: DrillLogEntry): boolean {
  const pts = drillPointsOf(d);
  return pts.length === 2 && isOneDrill(pts[0], pts[1], d.meters);
}

export function drillMapPoints(state: JournalState): DrillMapPoint[] {
  const out: DrillMapPoint[] = [];
  for (const d of state.drills) {
    if (d.status === 'planned') continue; // план на карте не показываем
    // Линией рисуется только настоящий прокол с входом и выходом.
    // Всё остальное — отдельные проколы, каждый своей меткой.
    if (drillIsLine(d)) continue;
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

/** Прокол с началом и концом — рисуется линией своего цвета. */
export interface DrillMapLine {
  id: string;
  coords: { lat: number; lon: number }[];
  drillKind: 'ГНБ' | 'ГНП';
  meters?: number;
  count?: number;
  uchastok: string;
  oblast: string;
  date: string;
  note?: string;
  contractor?: string;
  crossings?: string[];
  /** Сколько проколов сделано здесь же раньше — история по месту. */
  historyCount: number;
  /** Всего метров бестраншейно по этому селу. */
  historyMeters: number;
}

export function drillMapLines(state: JournalState): DrillMapLine[] {
  // История по месту: через три года сюда приедет аварийная бригада, и
  // вопрос будет один — что здесь под землёй и сколько раз тут кололи.
  const byKato = new Map<string, { count: number; meters: number }>();
  for (const d of state.drills) {
    if (!d.kato || d.status === 'planned') continue;
    const cur = byKato.get(d.kato) ?? { count: 0, meters: 0 };
    cur.count += Math.max(1, d.count || 1);
    cur.meters += d.meters || 0;
    byKato.set(d.kato, cur);
  }

  const out: DrillMapLine[] = [];
  for (const d of state.drills) {
    if (d.status === 'planned') continue; // план под землёй не лежит
    if (!drillIsLine(d)) continue;
    const pts = drillPointsOf(d);
    const hist = byKato.get(d.kato) ?? { count: 0, meters: 0 };
    out.push({
      id: d.id,
      coords: pts.map((p) => ({ lat: p.lat, lon: p.lon })),
      drillKind: d.drillKind,
      meters: d.meters,
      count: d.count,
      uchastok: d.uchastok,
      oblast: d.oblast,
      date: d.date,
      note: d.note,
      contractor: d.contractor,
      crossings: d.crossings,
      historyCount: hist.count,
      historyMeters: hist.meters,
    });
  }
  return out;
}

// ── Контекст последней записи ────────────────────────────────────────────────

const LAST_KEY = 'optiq-journal-last-v1';

/**
 * Что подставить в форму завтра, чтобы бригаде осталось вписать цифры.
 *
 * Техника и состав переносятся вместе с участком: колонна не меняет
 * кабелеукладчик на манипулятор каждое утро. Убрали — система спросит
 * почему, и это окажется в отчёте само.
 */
export interface LastContext {
  smu: string;
  contractor?: string;
  column?: string;
  oblast: string;
  rayon: string;
  uchastok: string;
  kato: string;
  tech: import('@/types/construction').WorkTech;
  /** Техника вчерашней смены: название → количество. */
  equipment?: Record<string, number>;
  /** Дата той записи — чтобы спросить «вчера был этот СНП, продолжаем?». */
  date?: string;
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
export function placedCrews<T extends Pick<Crew, 'lat' | 'lon'>>(
  base: { crews: T[] },
): T[] {
  // Обобщённо: колонна приходит сюда уже с расчётной точкой и маршрутом,
  // и обрезать её до голой карточки значит потерять их по дороге к карте.
  return base.crews.filter(
    (c) => typeof c.lat === 'number' && typeof c.lon === 'number'
      && Number.isFinite(c.lat) && Number.isFinite(c.lon),
  );
}

export { crewOnDuty, crewEquipmentCount };

// ── Этапы по населённым пунктам ──────────────────────────────────────────────

/** Замена карточек этапов целиком — после автозаведения из реестра. */
export function setProgress(base: JournalState, rows: SnpProgress[]): JournalState {
  return { ...base, progress: rows, updatedAt: new Date().toISOString() };
}

/**
 * Отметка этапа. Время проставляется здесь, а не в интерфейсе: от него
 * зависит очередь нарядов, и оно не должно приходить из формы.
 */
export function setStage(
  base: JournalState,
  kato: string,
  stage: SnpStage,
  patch: Partial<StageState>,
  by: string,
  /** Данные села — нужны, когда карточку ещё не заводили. */
  meta?: { snp?: string; oblast?: string; rayon?: string },
): JournalState {
  const now = new Date().toISOString();
  const mark = (p: SnpProgress): SnpProgress => {
    const prev = p.stages[stage] ?? { status: 'not_started' as const };
    // derived снимаем: отметка человека перестаёт быть выведенной, иначе
    // следующий пересчёт журнала её затрёт.
    const next: StageState = { ...prev, ...patch, by, derived: undefined };
    if (patch.status === 'in_progress' && !next.startedAt) next.startedAt = now;
    if (patch.status === 'done') next.doneAt = now;
    if (patch.status === 'blocked' && !next.startedAt) next.startedAt = now;
    // Снятие блокировки и возврат в работу не должны тащить старую причину.
    if (patch.status && patch.status !== 'blocked') next.blockReason = undefined;
    return { ...p, stages: { ...p.stages, [stage]: next }, updatedAt: now };
  };

  // Карточки может не быть: доска показывает и сёла, выведенные из журнала,
  // а сохраняем мы только то, что человек тронул руками.
  const known = base.progress.some((p) => p.kato === kato);
  const progress = known
    ? base.progress.map((p) => (p.kato === kato ? mark(p) : p))
    : [...base.progress, mark({
        kato, snp: meta?.snp || kato, oblast: meta?.oblast, rayon: meta?.rayon,
        stages: {}, updatedAt: now,
      })];

  return { ...base, progress, updatedAt: now };
}

// ── Барабаны кабеля ──────────────────────────────────────────────────────────

export function upsertDrumRecord(base: JournalState, drum: CableDrum): JournalState {
  const now = new Date().toISOString();
  const exists = base.drums.some((d) => d.id === drum.id);
  return {
    ...base,
    drums: exists
      ? base.drums.map((d) => (d.id === drum.id ? { ...drum, updatedAt: now } : d))
      : [...base.drums, { ...drum, updatedAt: now }],
    updatedAt: now,
  };
}

export function removeDrumRecord(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    drums: base.drums.filter((d) => d.id !== id),
    deleted: [...base.deleted, { id, at: now }],
    updatedAt: now,
  };
}

// ── Аварии ───────────────────────────────────────────────────────────────────

export function upsertIncident(base: JournalState, i: Incident): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    incidents: [...base.incidents.filter((x) => x.id !== i.id), { ...i, updatedAt: now }],
    updatedAt: now,
  };
}

export function removeIncident(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    incidents: base.incidents.filter((i) => i.id !== id),
    deleted: [...base.deleted, { id, at: now }],
    updatedAt: now,
  };
}

// ── Сварка ───────────────────────────────────────────────────────────────────

export function upsertSplice(base: JournalState, rec: SpliceRecord): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    splices: [...base.splices.filter((r) => r.id !== rec.id), { ...rec, updatedAt: now }],
    updatedAt: now,
  };
}

export function removeSplice(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    splices: base.splices.filter((r) => r.id !== id),
    deleted: [...base.deleted, { id, at: now }],
    updatedAt: now,
  };
}

// ── Полевые фото ─────────────────────────────────────────────────────────────

export function addPhoto(base: JournalState, photo: FieldPhoto): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    photos: [...base.photos.filter((p) => p.id !== photo.id), { ...photo, updatedAt: now }],
    updatedAt: now,
  };
}

export function removePhoto(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    photos: base.photos.filter((p) => p.id !== id),
    deleted: [...base.deleted, { id, at: now }],
    updatedAt: now,
  };
}

// ── Плановые трассы ──────────────────────────────────────────────────────────

/** Загрузка плана: трассы с теми же id заменяются, остальные добавляются. */
export function addPlanRoutes(base: JournalState, routes: PlanRoute[]): JournalState {
  const byId = new Map(base.planRoutes.map((r) => [r.id, r]));
  for (const r of routes) byId.set(r.id, r);
  return { ...base, planRoutes: [...byId.values()], updatedAt: new Date().toISOString() };
}

/** Убрать все трассы, пришедшие из одного файла. */
export function removePlanSource(base: JournalState, source: string): JournalState {
  const now = new Date().toISOString();
  const gone = base.planRoutes.filter((r) => r.source === source);
  if (gone.length === 0) return base;
  return {
    ...base,
    planRoutes: base.planRoutes.filter((r) => r.source !== source),
    deleted: withTombstones(base, gone.map((r) => r.id), now),
    updatedAt: now,
  };
}

/**
 * Запись в журнал изменений.
 *
 * Одобрения правка трассы не требует — линия на карте и есть форма, и
 * ждать подтверждения, чтобы сдвинуть вершину, никто не станет. Но след
 * она оставляет: кто, когда и как было. Через неделю иначе не вспомнить,
 * где линия шла до того, как её поправили.
 */
export function logChange(
  base: JournalState,
  entry: Omit<ChangeLogEntry, 'id' | 'at'> & { id?: string; at?: string },
): JournalState {
  const at = entry.at ?? new Date().toISOString();
  const rec: ChangeLogEntry = {
    ...entry,
    id: entry.id ?? `ch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at,
  };
  return {
    ...base,
    changes: [rec, ...(base.changes ?? [])].slice(0, 2000),
    updatedAt: at,
  };
}

/**
 * Правка трассы с записью в журнал.
 *
 * Одна точка входа: иначе правка однажды пройдёт мимо журнала, и именно
 * та, из-за которой потом будут разбираться.
 */
export function updateRouteCoords(
  base: JournalState,
  id: string,
  coords: [number, number][],
  ctx: { author: string; lengthM: number; kato?: string },
): JournalState {
  const prev = base.planRoutes.find((r) => r.id === id);
  if (!prev) return base;
  const now = new Date().toISOString();
  const next: JournalState = {
    ...base,
    planRoutes: base.planRoutes.map((r) => (
      r.id === id ? { ...r, coords, lengthM: ctx.lengthM, updatedAt: now } : r
    )),
    updatedAt: now,
  };
  return logChange(next, {
    at: now,
    author: ctx.author,
    kind: 'route_edit',
    target: prev.name || prev.uchastok || 'трасса',
    detail: `было ${changeKm(prev.lengthM)}, стало ${changeKm(ctx.lengthM)}`,
    routeId: id,
    kato: ctx.kato,
    before: prev.coords,
  });
}

/** Удаление трассы — тоже с записью: вернуть её иначе будет неоткуда. */
/**
 * Разрезать трассу в стольких-то метрах от начала.
 *
 * Исходная линия исчезает, вместо неё появляются две — с теми же
 * данными о происхождении. Граница СМУ, стык бригад, конец участка:
 * до сих пор всё это держали в голове, потому что резать было нечем.
 */
export function splitPlanRoute(
  base: JournalState,
  id: string,
  atM: number,
  author: string,
): JournalState {
  const prev = base.planRoutes.find((r) => r.id === id);
  if (!prev) return base;
  const cut = splitRoute(prev.coords, atM);
  if (!cut) return base;

  const now = new Date().toISOString();
  const [nameA, nameB] = splitNames(prev.name);
  const make = (
    suffix: string, name: string, coords: [number, number][], lengthM: number,
  ): PlanRoute => ({
    ...prev,
    id: `${prev.id}-${suffix}`,
    name,
    coords,
    lengthM,
    createdAt: prev.createdAt,
    updatedAt: now,
  });

  const next: JournalState = {
    ...base,
    planRoutes: [
      ...base.planRoutes.filter((r) => r.id !== id),
      make('a', nameA, cut.head, cut.headM),
      make('b', nameB, cut.tail, cut.tailM),
    ],
    // Исходная трасса больше не существует: без надгробия она вернётся с
    // сервера и ляжет поверх обеих половин.
    deleted: withTombstone(base, id, now),
    updatedAt: now,
  };
  return logChange(next, {
    at: now,
    author,
    kind: 'route_split',
    target: prev.name || prev.uchastok || 'трасса',
    detail: `${changeKm(cut.headM)} и ${changeKm(cut.tailM)}`,
    routeId: id,
    before: prev.coords,
  });
}

/**
 * Свести две линии в одну.
 *
 * Куда какой конец — решает расстояние между ними, а не порядок, в
 * котором линии нарисованы: человек знает, что эти две — одна трасса, и
 * не обязан помнить, в какую сторону их вели.
 */
export function joinPlanRoutes(
  base: JournalState,
  idA: string,
  idB: string,
  author: string,
  maxGapM = 250,
): JournalState {
  if (idA === idB) return base;
  const a = base.planRoutes.find((r) => r.id === idA);
  const b = base.planRoutes.find((r) => r.id === idB);
  if (!a || !b) return base;

  const joined = joinRoutes(a.coords, b.coords, maxGapM);
  if (!joined) return base;

  const now = new Date().toISOString();
  const merged: PlanRoute = {
    ...a,
    name: joinedName(a.name, b.name),
    coords: joined.coords,
    lengthM: a.lengthM + b.lengthM,
    updatedAt: now,
  };
  const next: JournalState = {
    ...base,
    planRoutes: base.planRoutes
      .filter((r) => r.id !== idB)
      .map((r) => (r.id === idA ? merged : r)),
    // Вторая линия вошла в первую и больше не существует отдельно.
    deleted: withTombstone(base, idB, now),
    updatedAt: now,
  };
  return logChange(next, {
    at: now,
    author,
    kind: 'route_join',
    target: merged.name,
    detail: joined.gapM < 1
      ? `${changeKm(merged.lengthM)} одной линией`
      : `${changeKm(merged.lengthM)}, разрыв в стыке ${Math.round(joined.gapM)} м`,
    routeId: idA,
    before: a.coords,
  });
}

export function deleteRoute(
  base: JournalState,
  id: string,
  author: string,
): JournalState {
  const prev = base.planRoutes.find((r) => r.id === id);
  if (!prev) return base;
  const now = new Date().toISOString();
  const next: JournalState = {
    ...base,
    planRoutes: base.planRoutes.filter((r) => r.id !== id),
    deleted: withTombstone(base, id, now),
    updatedAt: now,
  };
  return logChange(next, {
    at: now,
    author,
    kind: 'route_delete',
    target: prev.name || prev.uchastok || 'трасса',
    detail: `удалена, была ${changeKm(prev.lengthM)}`,
    routeId: id,
    before: prev.coords,
  });
}

/**
 * Вернуть трассу как было — по записи журнала.
 *
 * Возврат сам становится записью: история не переписывается, она
 * продолжается. Удалённая трасса возвращается целиком.
 */
export function restoreShape(
  base: JournalState,
  changeId: string,
  author: string,
): JournalState {
  const ch = (base.changes ?? []).find((c) => c.id === changeId);
  if (!ch?.before?.length) return base;
  if (ch.areaId) return restoreArea(base, changeId, author);
  if (!ch.routeId) return base;
  const now = new Date().toISOString();
  const lengthM = Math.round(coordsLengthM(ch.before));
  const exists = base.planRoutes.find((r) => r.id === ch.routeId);

  const planRoutes = exists
    ? base.planRoutes.map((r) => (
      r.id === ch.routeId ? { ...r, coords: ch.before!, lengthM, updatedAt: now } : r
    ))
    : [...base.planRoutes, {
      id: ch.routeId,
      name: ch.target,
      coords: ch.before,
      lengthM,
      source: 'восстановлено',
      createdAt: now,
      updatedAt: now,
    }];

  return logChange({ ...base, planRoutes, updatedAt: now }, {
    at: now,
    author,
    kind: 'route_edit',
    target: ch.target,
    detail: `возвращено как было на ${new Date(ch.at).toLocaleString('ru')}`,
    routeId: ch.routeId,
    before: exists?.coords,
  });
}

/**
 * Вернуть контур как было.
 *
 * Удалённый возвращается целиком; у правленого откатывается геометрия.
 * Возврат сам становится записью: история продолжается, а не переписывается.
 */
function restoreArea(base: JournalState, changeId: string, author: string): JournalState {
  const ch = (base.changes ?? []).find((c) => c.id === changeId);
  if (!ch?.before?.length || !ch.areaId) return base;
  const now = new Date().toISOString();
  const exists = base.areas.find((a) => a.id === ch.areaId);

  const areas = exists
    ? base.areas.map((a) => (a.id === ch.areaId ? { ...a, coords: ch.before!, updatedAt: now } : a))
    : [...base.areas, {
      id: ch.areaId,
      kind: 'snp' as const,
      name: ch.target,
      coords: ch.before,
      oblast: ch.oblast,
      rayon: ch.rayon,
      kato: ch.kato,
      source: 'восстановлено',
      createdAt: now,
      updatedAt: now,
    }];

  return logChange({ ...base, areas, updatedAt: now }, {
    at: now, author, kind: 'area_edit',
    target: ch.target,
    detail: `возвращено как было на ${new Date(ch.at).toLocaleString('ru')}`,
    areaId: ch.areaId,
    before: exists?.coords,
  });
}

/** Километры в журнале изменений — с запятой, как их пишут и читают. */
function changeKm(m: number): string {
  return `${(m / 1000).toFixed(3).replace('.', ',')} км`;
}

/** Длина ломаной в метрах — по той же формуле, что и везде в стройке. */
function coordsLengthM(coords: [number, number][]): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const [la1, lo1] = coords[i - 1];
    const [la2, lo2] = coords[i];
    const dLat = (la2 - la1) * 111_320;
    const dLon = (lo2 - lo1) * 111_320 * Math.cos(((la1 + la2) / 2) * Math.PI / 180);
    m += Math.hypot(dLat, dLon);
  }
  return m;
}

// ── Продвижение по трассе ────────────────────────────────────────────────────

/** Запоминаем, докуда дошли: по этому потом едет метка колонны. */
export function setSectionProgress(
  base: JournalState,
  kato: string,
  value: import('./routeProgress').SectionProgress,
): JournalState {
  if (!kato) return base;
  return {
    ...base,
    sectionProgress: { ...base.sectionProgress, [kato]: value },
    updatedAt: new Date().toISOString(),
  };
}

// ── Объекты на трассе ────────────────────────────────────────────────────────

export function upsertObject(base: JournalState, o: SiteObject): JournalState {
  const now = new Date().toISOString();
  const next = { ...o, updatedAt: now };
  const exists = base.objects.some((x) => x.id === o.id);
  return {
    ...base,
    objects: exists
      ? base.objects.map((x) => (x.id === o.id ? next : x))
      : [...base.objects, next],
    updatedAt: now,
  };
}

export function removeObject(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    objects: base.objects.filter((o) => o.id !== id),
    deleted: withTombstone(base, id, now),
    updatedAt: now,
  };
}

// ── Контуры районов и сёл ────────────────────────────────────────────────────

export function addAreas(base: JournalState, areas: MapArea[]): JournalState {
  const byId = new Map(base.areas.map((a) => [a.id, a]));
  for (const a of areas) byId.set(a.id, a);
  return { ...base, areas: [...byId.values()], updatedAt: new Date().toISOString() };
}

/** Убрать все контуры, пришедшие из одного файла. */
export function removeAreaSource(base: JournalState, source: string): JournalState {
  const now = new Date().toISOString();
  const gone = base.areas.filter((a) => a.source === source);
  if (gone.length === 0) return base;
  return {
    ...base,
    areas: base.areas.filter((a) => a.source !== source),
    deleted: withTombstones(base, gone.map((a) => a.id), now),
    updatedAt: now,
  };
}

/**
 * Контур, нарисованный на карте.
 *
 * До сих пор рисовать можно было только линию, а обводку — лишь принести
 * из Google Земли. Но обводят на месте то же, что и чертят: границу села,
 * кусок, который нельзя трогать, площадку под барабан. Рисуется она здесь
 * же и ложится в свой слой «нарисовано», чтобы не путаться с импортом.
 */
export function addDrawnArea(
  base: JournalState,
  args: { name: string; coords: [number, number][]; kind?: MapArea['kind']; author: string },
): JournalState {
  const coords = args.coords;
  if (coords.length < 3) return base;
  const now = new Date().toISOString();
  const area: MapArea = {
    id: `area-draw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: args.kind ?? 'snp',
    name: args.name.trim() || 'Без названия',
    coords,
    source: DRAWN_SOURCE,
    createdAt: now,
    updatedAt: now,
  };
  return logChange({ ...base, areas: [...base.areas, area], updatedAt: now }, {
    at: now, author: args.author, kind: 'area_add',
    target: area.name,
    detail: `${coords.length} вершин`,
    areaId: area.id,
  });
}

/** Слой для всего, что нарисовали руками: он не приходит из файла. */
export const DRAWN_SOURCE = 'нарисовано на карте';

/**
 * Правка контура с записью в журнал.
 *
 * Обводка — такая же нарисованная вещь, как трасса, и правится так же:
 * без согласования, но со следом. Отличие одно — у неё замкнутое кольцо,
 * и рвать его правкой нельзя.
 */
export function updateAreaCoords(
  base: JournalState,
  id: string,
  coords: [number, number][],
  author: string,
): JournalState {
  const prev = base.areas.find((a) => a.id === id);
  if (!prev || coords.length < 3) return base;
  const now = new Date().toISOString();
  const next: JournalState = {
    ...base,
    areas: base.areas.map((a) => (a.id === id ? { ...a, coords, updatedAt: now } : a)),
    updatedAt: now,
  };
  return logChange(next, {
    at: now, author, kind: 'area_edit',
    target: prev.name,
    detail: `вершин было ${prev.coords.length}, стало ${coords.length}`,
    areaId: id,
    oblast: prev.oblast, rayon: prev.rayon, kato: prev.kato,
    before: prev.coords,
  });
}

/** Переименование: в KML контуры подписаны как попало, и это поправимо. */
export function renameArea(
  base: JournalState,
  id: string,
  name: string,
  author: string,
): JournalState {
  const prev = base.areas.find((a) => a.id === id);
  const clean = name.trim();
  if (!prev || !clean || clean === prev.name) return base;
  const now = new Date().toISOString();
  const next: JournalState = {
    ...base,
    areas: base.areas.map((a) => (a.id === id ? { ...a, name: clean, updatedAt: now } : a)),
    updatedAt: now,
  };
  return logChange(next, {
    at: now, author, kind: 'area_rename',
    target: clean,
    detail: `было «${prev.name}»`,
    areaId: id,
    oblast: prev.oblast, rayon: prev.rayon, kato: prev.kato,
    before: prev.coords,
  });
}

/** Удаление одного контура — тоже с записью: вернуть иначе неоткуда. */
export function removeArea(base: JournalState, id: string, author: string): JournalState {
  const prev = base.areas.find((a) => a.id === id);
  if (!prev) return base;
  const now = new Date().toISOString();
  const next: JournalState = {
    ...base,
    areas: base.areas.filter((a) => a.id !== id),
    deleted: [...base.deleted, { id, at: now }],
    updatedAt: now,
  };
  return logChange(next, {
    at: now, author, kind: 'area_delete',
    target: prev.name,
    detail: 'контур удалён',
    areaId: id,
    oblast: prev.oblast, rayon: prev.rayon, kato: prev.kato,
    before: prev.coords,
  });
}

/** Файлы контуров со сводкой — для списка в интерфейсе. */
export function areaSources(base: JournalState): { source: string; areas: number }[] {
  const acc = new Map<string, number>();
  for (const a of base.areas) acc.set(a.source, (acc.get(a.source) ?? 0) + 1);
  return [...acc.entries()].map(([source, areas]) => ({ source, areas }));
}

/**
 * Реквизиты сторон.
 *
 * Общие данные: их заводят один раз и они уезжают на обмен вместе с
 * журналом, чтобы у бригады в поле документ печатался с теми же
 * реквизитами, что и в конторе.
 */
export function setRequisites(
  base: JournalState,
  r: import('./requisites').Requisites,
): JournalState {
  const now = new Date().toISOString();
  return { ...base, requisites: { ...r, updatedAt: now }, updatedAt: now };
}

/**
 * Цены материалов: задаются руками и живут вместе с журналом.
 *
 * У цен нет своих id, но время правки им нужно. Иначе сброс цены не
 * отличить от «у меня её просто нет», и при обмене старая возвращается
 * с сервера в расчёт.
 *
 * Надгробие тут не годится: оно вечное. Сбросил цену — и правильная
 * цена, поставленная соседом позже, уже никогда до меня не доедет,
 * потому что надгробие продолжает её убивать при каждом обмене.
 *
 * Поэтому у каждой цены своё время правки, и сброс — это тоже правка,
 * просто без значения. Кто правил позже, тот и прав: то же правило, что
 * и у всего остального в журнале.
 */
export function setMaterialPrice(
  base: JournalState,
  material: MaterialKind,
  price: number | undefined,
): JournalState {
  const now = new Date().toISOString();
  const prices = { ...base.prices };
  const cleared = price === undefined || !Number.isFinite(price) || price <= 0;
  if (cleared) delete prices[material];
  else prices[material] = price;
  return {
    ...base,
    prices,
    pricedAt: { ...(base.pricedAt ?? {}), [material]: now },
    // Старые надгробия на цены больше не нужны: они и были тем, что
    // не давало чужой правке доехать.
    deleted: base.deleted.filter((d) => !d.id.startsWith('price:')),
    updatedAt: now,
  };
}

/** Файлы плана со сводкой — для списка в интерфейсе. */
export function planSources(base: JournalState): { source: string; routes: number; lengthM: number }[] {
  const acc = new Map<string, { routes: number; lengthM: number }>();
  for (const r of base.planRoutes) {
    const cur = acc.get(r.source) ?? { routes: 0, lengthM: 0 };
    cur.routes++; cur.lengthM += r.lengthM;
    acc.set(r.source, cur);
  }
  return [...acc.entries()].map(([source, v]) => ({ source, ...v }));
}

// ── Поставки материалов ──────────────────────────────────────────────────────

export function upsertDelivery(base: JournalState, d: MaterialDelivery): JournalState {
  const now = new Date().toISOString();
  const exists = base.deliveries.some((x) => x.id === d.id);
  const next = { ...d, updatedAt: now };
  return {
    ...base,
    deliveries: exists
      ? base.deliveries.map((x) => (x.id === d.id ? next : x))
      : [...base.deliveries, next],
    updatedAt: now,
  };
}

export function removeDelivery(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    deliveries: base.deliveries.filter((x) => x.id !== id),
    deleted: withTombstone(base, id, now),
    updatedAt: now,
  };
}

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
      e.id === req.entryId
        ? {
          ...req.proposed,
          // День закрыл инженер на объекте — им он и остаётся. Кто принёс
          // правку, видно отдельно: иначе подтверждённое исправление молча
          // переписывало бы авторство дня на того, кто его не закрывал.
          author: req.before.author ?? req.proposed.author,
          editedBy: req.author,
          updatedAt: now,
          sync: 'local' as const,
        }
        : e,
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
  if (typeof window === 'undefined') return 'mkt';
  try {
    // Старое «field» превращается в МКТ, а не сбрасывает выбор: человек
    // его однажды уже сделал.
    return normalizeRole(localStorage.getItem(ROLE_KEY));
  } catch { return 'mkt'; }
}

export function saveJournalRole(r: JournalRole): void {
  try { localStorage.setItem(ROLE_KEY, r); } catch { /* приватный режим */ }
}

/** Отметить запись удалённой, чтобы удаление пережило синхронизацию. */
function withTombstone(base: JournalState, id: string, at: string): DeletedMark[] {
  const rest = base.deleted.filter((d) => d.id !== id);
  return [...rest, { id, at }];
}

/**
 * То же на несколько записей сразу.
 *
 * Трассу режут пополам, склеивают надвое, выбрасывают весь KML-файл —
 * каждый раз со схемы уходит не одна линия. Без надгробий все они
 * возвращаются с сервера при первом же обмене и ложатся поверх новых.
 */
function withTombstones(base: JournalState, ids: string[], at: string): DeletedMark[] {
  if (ids.length === 0) return base.deleted;
  const gone = new Set(ids);
  return [...base.deleted.filter((d) => !gone.has(d.id)), ...ids.map((id) => ({ id, at }))];
}

/**
 * Прокол: добавляем новый или заменяем правленый.
 *
 * Метки на карте рождаются отсюда — из руки того, кто колет, а не из
 * разметки обследования.
 */
export function upsertDrill(base: JournalState, d: DrillLogEntry): JournalState {
  const now = new Date().toISOString();
  const next = { ...d, updatedAt: now };
  const exists = base.drills.some((x) => x.id === d.id);
  return {
    ...base,
    drills: exists
      ? base.drills.map((x) => (x.id === d.id ? next : x))
      : [...base.drills, next],
    updatedAt: now,
  };
}

/** Сколько корзина держит удалённое. */
export const TRASH_DAYS = 30;

export interface TrashedEntry {
  id: string;
  /** Когда удалили — ISO. */
  at: string;
  author?: string;
  /** Откуда строка: земля, подвес, прокол. */
  from: 'ground' | 'aerial' | 'drills';
  /** Сама запись — целиком, как была. */
  entry: DailyWorkEntry | AerialWorkEntry | DrillLogEntry;
}

export function removeEntry(base: JournalState, id: string, author?: string): JournalState {
  const now = new Date().toISOString();
  const ground = base.ground.find((e) => e.id === id);
  const aerial = base.aerial.find((e) => e.id === id);
  const drill = base.drills.find((e) => e.id === id);
  const found = ground
    ? { from: 'ground' as const, entry: ground as DailyWorkEntry }
    : aerial
      ? { from: 'aerial' as const, entry: aerial as AerialWorkEntry }
      : drill
        ? { from: 'drills' as const, entry: drill as DrillLogEntry }
        : null;

  const next: JournalState = {
    ...base,
    ground: base.ground.filter((e) => e.id !== id),
    aerial: base.aerial.filter((e) => e.id !== id),
    drills: base.drills.filter((e) => e.id !== id),
    deleted: withTombstone(base, id, now),
    trash: found
      ? [...base.trash.filter((t) => t.id !== id), { id, at: now, author, ...found }]
      : base.trash,
    updatedAt: now,
  };
  if (!found) return next;
  return logChange(next, {
    at: now,
    author: author ?? 'без имени',
    kind: 'entry_delete',
    target: ('uchastok' in found.entry ? found.entry.uchastok : '') || 'смена',
    detail: `${found.entry.date || 'без даты'} — в корзине`,
  });
}

/**
 * Вернуть из корзины.
 *
 * Надгробие снимаем: запись снова живая, и обмен должен увидеть её, а
 * не считать удалённой.
 */
export function restoreFromTrash(base: JournalState, id: string): JournalState {
  const item = base.trash.find((t) => t.id === id);
  if (!item) return base;
  const now = new Date().toISOString();
  const trashedAt = item.entry.updatedAt ?? '';

  /**
   * Пока запись лежала в корзине, с ней могло случиться две вещи.
   *
   * Она могла вернуться обменом такой же, какой была. Тогда дописать её
   * второй раз — значит задвоить метры смены, а по ним считают и акт, и
   * деньги.
   *
   * А могла вернуться исправленной: сосед поправил её у себя позже, чем
   * я удалил, и обмен признал его правку старше удаления. Тогда положить
   * поверх свою версию из корзины — значит стереть чужую работу, да ещё
   * и свежей отметкой времени, так что обмен разнесёт потерю по всем
   * устройствам.
   *
   * Поэтому сравниваем: что новее — то и остаётся.
   */
  let keptLive = false;
  const put = <T extends { id: string; updatedAt?: string }>(list: T[], from: string): T[] => {
    if (item.from !== from) return list;
    const live = list.find((x) => x.id === item.id);
    if (live && (live.updatedAt ?? '') > trashedAt) {
      // Живая версия свежее той, что лежала в корзине: оставляем её.
      keptLive = true;
      return list;
    }
    const back = { ...item.entry, updatedAt: now, sync: 'local' as const };
    return [...list.filter((x) => x.id !== item.id), back as unknown as T];
  };

  const next: JournalState = {
    ...base,
    ground: put(base.ground, 'ground'),
    aerial: put(base.aerial, 'aerial'),
    drills: put(base.drills, 'drills'),
    // Надгробие снимаем в любом случае: запись снова живая, и обмен
    // должен видеть её, а не считать удалённой.
    deleted: base.deleted.filter((d) => d.id !== id),
    trash: base.trash.filter((t) => t.id !== id),
    updatedAt: now,
  };
  return logChange(next, {
    at: now,
    author: item.author ?? 'без имени',
    kind: 'entry_restore',
    target: ('uchastok' in item.entry ? item.entry.uchastok : '') || 'смена',
    detail: keptLive
      ? `${item.entry.date || 'без даты'} — уже вернулась обменом, оставлена свежая версия`
      : `${item.entry.date || 'без даты'} — возвращена из корзины`,
  });
}

/** Что пролежало в корзине дольше срока — выбрасываем насовсем. */
export function purgeTrash(base: JournalState, now = new Date(), days = TRASH_DAYS): JournalState {
  const edge = now.getTime() - days * 24 * 3600 * 1000;
  const keep = base.trash.filter((t) => new Date(t.at).getTime() >= edge);
  if (keep.length === base.trash.length) return base;
  return { ...base, trash: keep };
}

/**
 * Правка сразу у многих строк.
 *
 * Бригаду переименовали, подрядчика переписали, участок назвали иначе —
 * и двадцать строк надо привести к одному виду. По одной это двадцать
 * открытых форм.
 */
export function bulkPatchEntries(
  base: JournalState,
  ids: string[],
  patch: Partial<Pick<DailyWorkEntry, 'contractor' | 'column' | 'smu' | 'uchastok' | 'disputed' | 'disputeNote'>>,
  author?: string,
): JournalState {
  const set = new Set(ids);
  if (set.size === 0) return base;
  const now = new Date().toISOString();
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined && v !== ''),
  );
  if (Object.keys(clean).length === 0) return base;

  const apply = <T extends { id: string }>(rows: T[]): T[] => rows.map((r) => (
    set.has(r.id) ? { ...r, ...clean, editedBy: author, updatedAt: now, sync: 'local' as const } : r
  ));

  const next: JournalState = {
    ...base,
    ground: apply(base.ground),
    aerial: apply(base.aerial),
    updatedAt: now,
  };
  return logChange(next, {
    at: now,
    author: author ?? 'без имени',
    kind: 'entry_bulk',
    target: `${set.size} смен`,
    detail: Object.entries(clean).map(([k, v]) => `${k}: ${v}`).join(', '),
  });
}

/**
 * Отметить, что смену предъявили технадзору.
 *
 * Между записью и предъявлением проходят дни, а спрашивают потом
 * именно про предъявление. Отдельной тетради для этого вести не надо.
 */
export function markPresented(
  base: JournalState,
  ids: string[],
  to: string,
  at = new Date().toISOString(),
): JournalState {
  const set = new Set(ids);
  if (set.size === 0) return base;
  const apply = <T extends { id: string }>(rows: T[]): T[] => rows.map((r) => (
    set.has(r.id) ? { ...r, presentedAt: at, presentedTo: to || undefined, updatedAt: at } : r
  ));
  return {
    ...base,
    ground: apply(base.ground),
    aerial: apply(base.aerial),
    updatedAt: at,
  };
}

/**
 * Расценка.
 *
 * Цену меняют не задним числом, а с какого-то числа: работы до него
 * считаются по старой. Поэтому новая расценка не правит старую, а
 * встаёт рядом со своей датой начала.
 */
export function upsertRate(base: JournalState, rate: WorkRate): JournalState {
  const now = new Date().toISOString();
  const next = { ...rate, updatedAt: now };
  const exists = base.rates.some((r) => r.id === rate.id);
  return {
    ...base,
    rates: exists
      ? base.rates.map((r) => (r.id === rate.id ? next : r))
      : [...base.rates, next],
    updatedAt: now,
  };
}

export function removeRate(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    rates: base.rates.filter((r) => r.id !== id),
    // Без надгробия убранная расценка возвращается с сервера и перебивает
    // исправленную цену — а по ней считают деньги подрядчику.
    deleted: withTombstone(base, id, now),
    updatedAt: now,
  };
}

/** Аванс, удержание или оплата по акту. */
export function upsertPayment(base: JournalState, payment: Payment): JournalState {
  const now = new Date().toISOString();
  const next = { ...payment, updatedAt: now };
  const exists = base.payments.some((p) => p.id === payment.id);
  return {
    ...base,
    payments: exists
      ? base.payments.map((p) => (p.id === payment.id ? next : p))
      : [...base.payments, next],
    updatedAt: now,
  };
}

export function removePayment(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    payments: base.payments.filter((p) => p.id !== id),
    deleted: [...base.deleted, { id, at: now }],
    updatedAt: now,
  };
}

/** Заявка на материал. */
export function upsertRequest(
  base: JournalState,
  r: import('./supply').MaterialRequest,
): JournalState {
  const now = new Date().toISOString();
  const next = { ...r, updatedAt: now };
  const exists = base.requests.some((x) => x.id === r.id);
  return {
    ...base,
    requests: exists
      ? base.requests.map((x) => (x.id === r.id ? next : x))
      : [...base.requests, next],
    updatedAt: now,
  };
}

export function setRequestStatus(
  base: JournalState,
  id: string,
  status: import('./supply').RequestStatus,
): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    requests: base.requests.map((r) => (r.id === id ? { ...r, status, updatedAt: now } : r)),
    updatedAt: now,
  };
}

export function removeRequest(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    requests: base.requests.filter((r) => r.id !== id),
    deleted: [...base.deleted, { id, at: now }],
    updatedAt: now,
  };
}

/**
 * Строка плана.
 *
 * План — это обещание, а не прогноз: цифру ставит человек. Система
 * только показывает, чем она подкреплена и что из неё вышло.
 */
export function upsertPlan(
  base: JournalState,
  row: import('./weekPlan').PlanRow,
): JournalState {
  const now = new Date().toISOString();
  const next = { ...row, updatedAt: now };
  const exists = base.plans.some((p) => p.id === row.id);
  return {
    ...base,
    plans: exists
      ? base.plans.map((p) => (p.id === row.id ? next : p))
      : [...base.plans, next],
    updatedAt: now,
  };
}

export function removePlan(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    plans: base.plans.filter((p) => p.id !== id),
    deleted: [...base.deleted, { id, at: now }],
    updatedAt: now,
  };
}

/** Разрешение, допуск, контакт, претензия или задача. */
export function upsertSiteRecord(
  base: JournalState,
  r: import('./siteRecords').SiteRecord,
): JournalState {
  const now = new Date().toISOString();
  const next = { ...r, updatedAt: now };
  const exists = base.records.some((x) => x.id === r.id);
  return {
    ...base,
    records: exists
      ? base.records.map((x) => (x.id === r.id ? next : x))
      : [...base.records, next],
    updatedAt: now,
  };
}

export function removeSiteRecord(base: JournalState, id: string): JournalState {
  const now = new Date().toISOString();
  return {
    ...base,
    records: base.records.filter((r) => r.id !== id),
    deleted: [...base.deleted, { id, at: now }],
    updatedAt: now,
  };
}

/** Пометить строку спорной или снять пометку. */
export function setDisputed(
  base: JournalState,
  id: string,
  disputed: boolean,
  note?: string,
  author?: string,
): JournalState {
  const now = new Date().toISOString();
  const apply = <T extends { id: string }>(rows: T[]): T[] => rows.map((r) => (
    r.id === id
      ? { ...r, disputed, disputeNote: disputed ? note : undefined, updatedAt: now }
      : r
  ));
  const row = base.ground.find((e) => e.id === id) ?? base.aerial.find((e) => e.id === id);
  const next: JournalState = {
    ...base,
    ground: apply(base.ground),
    aerial: apply(base.aerial),
    updatedAt: now,
  };
  if (!row) return next;
  return logChange(next, {
    at: now,
    author: author ?? 'без имени',
    kind: 'entry_dispute',
    target: row.uchastok || 'смена',
    detail: disputed ? (note || 'заказчик не согласен') : 'пометка снята',
  });
}

// ── Форматирование ───────────────────────────────────────────────────────────

export function fmtKm(meters: number): string {
  if (!meters) return '0';
  return (meters / 1000).toLocaleString('ru', { maximumFractionDigits: 1 });
}

export function fmtMeters(meters: number): string {
  return meters >= 1000 ? `${fmtKm(meters)} км` : `${Math.round(meters)} м`;
}

/**
 * Русское склонение при числе: plural(2, 'трасса', 'трассы', 'трасс').
 * Нужно везде, где цифра показывается человеку: «2 трасс» читается как брак.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  const last = abs % 10;
  const tens = Math.floor((abs % 100) / 10);
  if (tens === 1) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
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
