/**
 * Модель данных стройки ВОЛС (Слой 2 — «как идём»).
 *
 * Колонки и единицы взяты один в один из рабочего журнала СНП:
 *   «DATA»          — дневная выработка подземки
 *   «DATA ПОДВЕС»   — дневная выработка подвеса
 *   «ГНБ Журнал»    — бестраншейные переходы
 *   «Все СНП заказа»— реестр заказа (план)
 *
 * Ключ записи — КАТО + Участок + Дата, тот же, что используется в таблице.
 * Длины внутри системы хранятся В МЕТРАХ (в Excel они в километрах) —
 * целые метры складываются без накопления ошибки округления.
 */

// ── Справочники ──────────────────────────────────────────────────────────────

/** Технология работ — лист DATA, колонка «Тип технологии». */
export type WorkTech = 'МКТ' | 'Задувка' | 'ПЭТ' | 'Лента';
export const WORK_TECHS: WorkTech[] = ['МКТ', 'Задувка', 'ПЭТ', 'Лента'];

/** Способ прокладки — отдельные колонки листа DATA. */
export type LayMethod =
  | 'кабелеукладчик'
  | 'экскаватор'
  | 'сущ_канализация'
  | 'бар'
  | 'вручную';

export const LAY_METHODS: LayMethod[] = [
  'кабелеукладчик', 'экскаватор', 'сущ_канализация', 'бар', 'вручную',
];

export const LAY_METHOD_LABEL: Record<LayMethod, string> = {
  'кабелеукладчик':   'Кабелеукладчиком',
  'экскаватор':       'Мех. способом (экскаватор)',
  'сущ_канализация':  'По сущ. тел. канализации',
  'бар':              'Бар',
  'вручную':          'Ручным способом',
};

/** Бестраншейный переход. */
export type DrillKind = 'ГНБ' | 'ГНП';

/** Расходные материалы подземки — колонки листа DATA. */
export type MaterialKind = 'МКТ' | 'ПЭТ' | 'Лента' | 'КОД' | 'Муфта' | 'ФИТИНГ';
export const MATERIAL_KINDS: MaterialKind[] = ['МКТ', 'ПЭТ', 'Лента', 'КОД', 'Муфта', 'ФИТИНГ'];

/** Единица учёта материала: 'м' считается метрами, 'шт' — штуками. */
export const MATERIAL_UNIT: Record<MaterialKind, 'м' | 'шт'> = {
  'МКТ': 'м', 'ПЭТ': 'м', 'Лента': 'м',
  'КОД': 'шт', 'Муфта': 'шт', 'ФИТИНГ': 'шт',
};

/** Что пересекали переходом — было свободным текстом в «Примечании». */
export type CrossingKind =
  | 'автодорога' | 'жд' | 'водоканал' | 'ТТС' | 'газопровод' | 'арык' | 'прочее';

export const CROSSING_KINDS: CrossingKind[] = [
  'автодорога', 'жд', 'водоканал', 'ТТС', 'газопровод', 'арык', 'прочее',
];

// ── Записи ───────────────────────────────────────────────────────────────────

/** Общая часть любой дневной записи: где и кто. */
export interface WorkEntryBase {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** СМУ-1 … СМУ-7 */
  smu: string;
  oblast: string;
  rayon?: string;
  /** «сущ. ОМ - Акбеит» */
  uchastok: string;
  /** Код КАТО — канонический ключ населённого пункта */
  kato: string;
  note?: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  /** Оффлайн-первый: запись живёт локально, пока не ушла на сервер. */
  sync?: 'local' | 'synced';
}

/** Дневная выработка подземки — строка листа DATA. */
export interface DailyWorkEntry extends WorkEntryBase {
  kind: 'ground';
  tech?: WorkTech;
  /** Метры по способам прокладки. */
  byMethod: Partial<Record<LayMethod, number>>;
  /** Бестраншейные переходы за день. */
  drillM?: number;
  drillCount?: number;
  /** Открытый переход, шт. */
  openCrossings?: number;
  /** Задувка ОК, метры. */
  blowingM?: number;
  /** Расход материалов: метры для 'м', штуки для 'шт'. */
  materials: Partial<Record<MaterialKind, number>>;
}

/** Тип подвешиваемого кабеля — колонки листа DATA ПОДВЕС. */
export type AerialCableType = 'ОК2' | 'ОК4' | 'ОК8' | 'ОК16' | 'ХХ';
export const AERIAL_CABLE_TYPES: AerialCableType[] = ['ОК2', 'ОК4', 'ОК8', 'ОК16', 'ХХ'];

/** Материалы подвеса — колонки листа DATA ПОДВЕС. */
export type AerialMaterialKind =
  | 'Опоры' | 'ККС' | 'Термошкаф'
  | 'ОРК без сплиттера' | 'ОРК со сплиттером' | 'Муфта'
  | 'УКН' | 'Зажим анкерный' | 'Зажим поддерживающий' | 'Зажим промежуточный';

export const AERIAL_MATERIAL_KINDS: AerialMaterialKind[] = [
  'Опоры', 'ККС', 'Термошкаф', 'ОРК без сплиттера', 'ОРК со сплиттером',
  'Муфта', 'УКН', 'Зажим анкерный', 'Зажим поддерживающий', 'Зажим промежуточный',
];

/** Дневная выработка подвеса — строка листа DATA ПОДВЕС. */
export interface AerialWorkEntry extends WorkEntryBase {
  kind: 'aerial';
  /** Всего подвешено за день, метры. */
  totalM: number;
  /** Разбивка по типу кабеля, метры. */
  byCable: Partial<Record<AerialCableType, number>>;
  materials: Partial<Record<AerialMaterialKind, number>>;
}

/** Точка перехода с координатами — то, чего в Excel не было структурно. */
export interface DrillPoint {
  lat: number;
  lon: number;
  /** Длина этого конкретного прокола, метры (в тексте была как «(72м)»). */
  meters?: number;
}

/** Запись журнала ГНБ. */
export interface DrillLogEntry extends WorkEntryBase {
  kind: 'drill';
  drillKind: DrillKind;
  /** Протяжённость, метры. */
  meters: number;
  /** Количество проколов. */
  count: number;
  /** Разобранные координаты. Пусто — значит разобрать не удалось. */
  points: DrillPoint[];
  /** Что пересекали. */
  crossings?: CrossingKind[];
  /** Исходный текст координат — сохраняем всегда, чтобы ничего не потерять. */
  rawCoords?: string;
}

export type ConstructionEntry = DailyWorkEntry | AerialWorkEntry | DrillLogEntry;

/** Строка реестра заказа — лист «Все СНП заказа» (план). */
export interface SettlementOrder {
  kato: string;
  oblast: string;
  rayon?: string;
  okrug?: string;
  snp: string;
  year?: number;
  /** Плановые даты СМР. */
  planStart?: string;
  planEnd?: string;
  /** Количество гос. учреждений — это и есть конечные точки (ФАП, школа, аким аппарат). */
  guCount?: number;
  tech?: string;
  /** Плановые объёмы, метры. */
  planVolsM?: number;
  planMktM?: number;
  planVokM?: number;
  planAerialM?: number;
  note?: string;
}

// ── Границы Казахстана — для проверки координат ──────────────────────────────

export const KZ_BOUNDS = { latMin: 40.0, latMax: 56.0, lonMin: 46.0, lonMax: 88.0 };

export function isKzLat(v: number): boolean {
  return Number.isFinite(v) && v >= KZ_BOUNDS.latMin && v <= KZ_BOUNDS.latMax;
}
export function isKzLon(v: number): boolean {
  return Number.isFinite(v) && v >= KZ_BOUNDS.lonMin && v <= KZ_BOUNDS.lonMax;
}
