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

/**
 * Подрядная организация. В журнале СМУ заполнено меньше чем в половине
 * строк — работы ведут подрядчики, и именно их нужно знать, чтобы
 * ответить «кто тянул этот участок».
 */
export interface Contractor {
  id: string;
  /** Короткое имя, как говорят в переписке: «TERRA TECH». */
  name: string;
  /** Полное наименование для документов: ТОО «СК Фаворит инжиниринг». */
  fullName?: string;
  /**
   * Чьим именем работает. Субподрядчики (Terra Tech, Модуль Строй, Дозер)
   * выходят на объект от имени СК Фаворит, поэтому в тетрадях технадзора и
   * актах стоит Фаворит. Для учёта важно знать обоих: кто фактически тянул
   * и от чьего имени оформлены документы.
   */
  worksUnder?: string;
  /** Где работает — для подсказки при вводе. */
  areas?: { oblast: string; rayon?: string }[];
  note?: string;
}

/** Общая часть любой дневной записи: где и кто. */
export interface WorkEntryBase {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** СМУ-1 … СМУ-7. Пусто, когда работы вёл подрядчик. */
  smu: string;
  /** Подрядная организация, выполнявшая работы. */
  contractor?: string;
  /** Номер колонны бригады — «1-колонна», «Колонна-2». */
  column?: string;
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

// ── Подробный отчёт инженера по контролю строительства ───────────────────────

/**
 * Операции из ежедневного отчёта инженера. В отличие от пяти обобщённых
 * колонок Excel, это то, что реально пишут в поле.
 *
 * ВАЖНО: операции НЕ складываются в дневной прогресс. «Прокладка МКТ 4100 м»
 * и «Прокладка сигнальной ленты 4100 м» — один и тот же участок трассы,
 * пройденный дважды разными работами. Итог за день ведётся отдельным полем
 * totalMktM, как в самом отчёте («Тотал МКТ за сегодня: 4100 м»).
 */
export type OperationKind =
  | 'kirkovka' | 'proporka'
  | 'trench_excavator' | 'trench_bar' | 'trench_manual'
  | 'lay_mkt_heavy' | 'lay_mkt' | 'lay_tape'
  | 'backfill_excavator' | 'backfill_half'
  | 'obvalovka_tractor' | 'obvalovka'
  | 'install_kod';

export interface OperationSpec {
  label: string;
  unit: 'м' | 'шт';
  group: 'Подготовка' | 'Траншея' | 'Прокладка' | 'Завершение';
}

export const OPERATIONS: Record<OperationKind, OperationSpec> = {
  kirkovka:           { label: 'Кирковка тяжёлой техникой',        unit: 'м',  group: 'Подготовка' },
  proporka:           { label: 'Пропорка тяжёлой техникой',        unit: 'м',  group: 'Подготовка' },
  trench_excavator:   { label: 'Траншея экскаватором 3в1',         unit: 'м',  group: 'Траншея' },
  trench_bar:         { label: 'Траншея баровым трактором',        unit: 'м',  group: 'Траншея' },
  trench_manual:      { label: 'Траншея вручную',                  unit: 'м',  group: 'Траншея' },
  lay_mkt_heavy:      { label: 'МКТ и лента тяжёлой техникой',     unit: 'м',  group: 'Прокладка' },
  lay_mkt:            { label: 'Прокладка МКТ',                    unit: 'м',  group: 'Прокладка' },
  lay_tape:           { label: 'Прокладка сигнальной ленты',       unit: 'м',  group: 'Прокладка' },
  backfill_excavator: { label: 'Обратная засыпка экскаватором',    unit: 'м',  group: 'Завершение' },
  backfill_half:      { label: 'Обратная засыпка наполовину',      unit: 'м',  group: 'Завершение' },
  obvalovka_tractor:  { label: 'Обваловка трактором',              unit: 'м',  group: 'Завершение' },
  obvalovka:          { label: 'Обваловка',                        unit: 'м',  group: 'Завершение' },
  install_kod:        { label: 'Установка КОД',                    unit: 'шт', group: 'Завершение' },
};

export const OPERATION_KINDS = Object.keys(OPERATIONS) as OperationKind[];

export const OPERATION_GROUPS: OperationSpec['group'][] =
  ['Подготовка', 'Траншея', 'Прокладка', 'Завершение'];

/** Техника на смене — «Кабелеукладчик — 1 шт». */
export const EQUIPMENT_KINDS: string[] = [
  'Кабелеукладчик', 'Манипулятор', 'Экскаватор 3/1', 'Пропорщик',
  'Бульдозер', 'Баровый трактор', 'Трактор', 'Самосвал',
];

/**
 * Метка трубы: с какой отметки на какую ушла бухта МКТ.
 * В отчёте пишут «4000 — 2490 м». Без этого метраж нечем подтвердить,
 * а расход бухт не сходится с длиной участка.
 */
export interface DuctMark {
  /** Номер бухты или метка на трубе. */
  coil: string;
  /** Метраж по метке. */
  meters: number;
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

  // ── Подробная часть (отчёт инженера по контролю строительства) ──
  /** Операции за смену. НЕ суммируются в прогресс — см. OperationKind. */
  operations?: Partial<Record<OperationKind, number>>;
  /** Техника на смене: название → количество. */
  equipment?: Record<string, number>;
  /** Метки трубы — чем подтверждается метраж. */
  ductMarks?: DuctMark[];
  /** Итог по МКТ за день, как его пишут в отчёте. */
  totalMktM?: number;
  /** Нарастающий итог по участку. */
  totalUchastokM?: number;
  /** Запас МКТ под ГНБ, метры. */
  reserveMktM?: number;
  /** Причины простоя или невыполнения. */
  downtime?: string;
  /** План работы на завтра. */
  tomorrow?: string;
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

// ── Этапы по населённому пункту ──────────────────────────────────────────────

/**
 * Этапы прохождения СНП. Порядок значим: следующий этап становится
 * нарядом, только когда предыдущий закрыт.
 */
export type SnpStage = 'mkt' | 'gnb' | 'zaduvka' | 'podves' | 'svarka' | 'sdacha';

export const SNP_STAGES: SnpStage[] = ['mkt', 'gnb', 'zaduvka', 'podves', 'svarka', 'sdacha'];

export interface SnpStageSpec {
  label: string;
  /** Колонна какого вида выполняет этап. Сдача — не бригадный этап. */
  crewKind?: CrewKind;
}

export const SNP_STAGE_SPECS: Record<SnpStage, SnpStageSpec> = {
  mkt:     { label: 'Прокладка МКТ', crewKind: 'mkt' },
  gnb:     { label: 'ГНБ / переходы', crewKind: 'gnb' },
  zaduvka: { label: 'Задувка ОК',    crewKind: 'zaduvka' },
  podves:  { label: 'Подвес',        crewKind: 'podves' },
  svarka:  { label: 'Сварка',        crewKind: 'svarka' },
  sdacha:  { label: 'Сдача' },
};

export type StageStatus = 'not_started' | 'in_progress' | 'done' | 'blocked';

export const STAGE_STATUS_SPECS: Record<StageStatus, { label: string; color: string }> = {
  not_started: { label: 'Не начат',  color: '#64748b' },
  in_progress: { label: 'В работе',  color: '#4ade80' },
  done:        { label: 'Закрыт',    color: '#2dd4bf' },
  blocked:     { label: 'Стоит',     color: '#f87171' },
};

export interface StageState {
  status: StageStatus;
  startedAt?: string;
  doneAt?: string;
  /** Кто отметил. */
  by?: string;
  /** Колонна, выполнявшая этап. */
  crew?: string;
  note?: string;
  /** Почему стоит — обязательна при статусе blocked. */
  blockReason?: string;
}

/** Типовые причины простоя — из отчётов инженера. */
export const BLOCK_REASONS: string[] = [
  'Ждём согласование',
  'Скальный грунт',
  'Поломка техники',
  'Нет материала',
  'Погода',
  'Не передан фронт работ',
  'Прочее',
];

/** Прохождение этапов по одному населённому пункту. */
export interface SnpProgress {
  /** Ключ — КАТО, как и во всём журнале. */
  kato: string;
  snp: string;
  oblast?: string;
  rayon?: string;
  stages: Partial<Record<SnpStage, StageState>>;
  updatedAt: string;
}

/** Следующий этап после указанного. */
export function nextStage(s: SnpStage): SnpStage | null {
  const i = SNP_STAGES.indexOf(s);
  return i >= 0 && i < SNP_STAGES.length - 1 ? SNP_STAGES[i + 1] : null;
}

export function prevStage(s: SnpStage): SnpStage | null {
  const i = SNP_STAGES.indexOf(s);
  return i > 0 ? SNP_STAGES[i - 1] : null;
}

// ── Плановая трасса ──────────────────────────────────────────────────────────

/**
 * Проектная трасса из KML — «как должно быть».
 *
 * Живёт отдельно от фактических кабелей: план не переписывается стройкой,
 * иначе сравнивать станет не с чем и вопрос «почему ушли в сторону»
 * останется без ответа.
 */
export interface PlanRoute {
  id: string;
  name: string;
  /** Папка KML — обычно там лежит участок или населённый пункт. */
  folder?: string;
  uchastok?: string;
  coords: [number, number][];
  /** Длина по координатам, метры. */
  lengthM: number;
  /** Имя файла, из которого пришла трасса. */
  source: string;
  createdAt: string;
  updatedAt: string;
}

// ── Поставки материалов ──────────────────────────────────────────────────────

/**
 * Приход материала на область.
 *
 * Без поставок остаток не из чего вычесть: журнал знает только расход.
 * Учёт ведём по области, а не по участку — материал отгружают на регион,
 * и вопрос «пора ли слать МКТ в Акмолинскую» тоже региональный.
 */
export interface MaterialDelivery {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  oblast: string;
  material: MaterialKind;
  /** Метры для метровых позиций, штуки для штучных. */
  qty: number;
  /** Номер накладной или примечание. */
  note?: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Колонны на карте ─────────────────────────────────────────────────────────

/** Вид работ колонны — определяет цвет и значок на карте. */
export type CrewKind = 'mkt' | 'gnb' | 'zaduvka' | 'podves' | 'svarka';

export interface CrewKindSpec {
  label: string;
  short: string;
  color: string;
  icon: string;
}

export const CREW_KINDS: Record<CrewKind, CrewKindSpec> = {
  mkt:     { label: 'Прокладка МКТ', short: 'МКТ',    color: '#2dd4bf', icon: '🚜' },
  gnb:     { label: 'ГНБ / ГНП',     short: 'ГНБ',    color: '#fbbf24', icon: '🛠' },
  zaduvka: { label: 'Задувка',       short: 'Задувка', color: '#38bdf8', icon: '💨' },
  podves:  { label: 'Подвес',        short: 'Подвес', color: '#a78bfa', icon: '🗼' },
  svarka:  { label: 'Сварка',        short: 'Сварка', color: '#f472b6', icon: '🔥' },
};

export const CREW_KIND_LIST = Object.keys(CREW_KINDS) as CrewKind[];

/** Состояние колонны — то, что видно на карте с первого взгляда. */
export type CrewStatus = 'working' | 'waiting' | 'done' | 'idle';

export const CREW_STATUS: Record<CrewStatus, { label: string; color: string }> = {
  working: { label: 'Работает',    color: '#4ade80' },
  waiting: { label: 'В ожидании',  color: '#fbbf24' },
  done:    { label: 'Закончила',   color: '#64748b' },
  idle:    { label: 'Простой',     color: '#f87171' },
};

/** Сотрудник в составе колонны. */
export interface CrewMember {
  name: string;
  /** Мастер участка, машинист, сварщик, разнорабочий… */
  role?: string;
  /** Выходной — на карте состав показывается с пометкой. */
  dayOff?: boolean;
}

/**
 * Колонна: бригада с техникой и составом, стоящая на конкретном месте.
 * Положение приблизительное — его двигают руками по карте, когда бригада
 * переезжает на другой участок.
 */
export interface Crew {
  id: string;
  kind: CrewKind;
  /** «1-колонна», «Колонна-2». */
  name: string;
  contractor?: string;
  status: CrewStatus;
  lat?: number;
  lon?: number;
  oblast?: string;
  rayon?: string;
  /** Участок, на котором стоит. */
  uchastok?: string;
  members: CrewMember[];
  /** Техника: название → количество. */
  equipment: Record<string, number>;
  note?: string;
  updatedAt: string;
}

/** Сколько человек сегодня в строю. */
export function crewOnDuty(c: Crew): number {
  return c.members.filter((m) => !m.dayOff).length;
}

/** Единиц техники всего. */
export function crewEquipmentCount(c: Crew): number {
  return Object.values(c.equipment).reduce((s, v) => s + (v || 0), 0);
}

// ── Отклонения от проекта ────────────────────────────────────────────────────

/** Проектная глубина прокладки защитной трубы, м (по ПСД). */
export const DESIGN_DEPTH_M = 1.2;

/**
 * Протокол мобильной группы.
 *
 * Оформляется, когда фактическая глубина меньше проектной или изменена
 * трасса. Его номер и дата попадают в Приложение 12 (ОДС/П-14-4-4-01),
 * в пункт «При выполнении допущены отклонения от проектно-сметной
 * документации». Без протокола отклонение остаётся незакрытым и всплывёт
 * при сдаче.
 */
export interface MobileGroupProtocol {
  number: string;
  /** YYYY-MM-DD */
  date: string;
  note?: string;
}

export type DeviationKind = 'depth' | 'route';

export const DEVIATION_KIND_LABEL: Record<DeviationKind, string> = {
  depth: 'По глубине',
  route: 'По трассе',
};

/** Типовые причины — из примечаний журнала ГНБ и отчётов инженера. */
export const DEVIATION_REASONS: string[] = [
  'Скальный грунт',
  'Обход водопровода',
  'Обход газопровода',
  'Обход ТТС',
  'Пересечение автодороги',
  'Пересечение ж/д',
  'Существующие коммуникации',
  'Отказ в согласовании',
  'Прочее',
];

/** Отклонение от проекта на конкретном участке трассы. */
export interface Deviation {
  id: string;
  kind: DeviationKind;
  /** YYYY-MM-DD */
  date: string;
  oblast: string;
  rayon?: string;
  uchastok: string;
  kato: string;
  contractor?: string;
  /** Начало и конец участка отклонения — как пишут в акте фиксации. */
  fromPoint?: string;
  toPoint?: string;
  /** Протяжённость отклонения, метры. */
  lengthM: number;
  /** Глубина по проекту и фактическая, метры. Только для kind = 'depth'. */
  designDepthM?: number;
  actualDepthM?: number;
  /** Координаты начала и конца, если сняли на месте. */
  coords?: { lat: number; lon: number }[];
  reason: string;
  /** Протокол мобильной группы. Пока его нет — отклонение не закрыто. */
  protocol?: MobileGroupProtocol;
  author: string;
  createdAt: string;
  updatedAt: string;
  sync?: 'local' | 'synced';
}

/** Требуется ли протокол мобильной группы. */
export function needsProtocol(d: Pick<Deviation, 'kind' | 'designDepthM' | 'actualDepthM'>): boolean {
  if (d.kind === 'route') return true;
  const design = d.designDepthM ?? DESIGN_DEPTH_M;
  const actual = d.actualDepthM;
  if (actual === undefined || actual === null) return false;
  // Отклонение считаем значимым от сантиметра — иначе округление породит
  // протоколы там, где фактически уложились в проект.
  return actual < design - 0.01;
}

/** Отклонение закрыто, если протокол оформлен там, где он нужен. */
export function isDeviationClosed(d: Deviation): boolean {
  if (!needsProtocol(d)) return true;
  return !!d.protocol?.number?.trim();
}

// ── Исправление отчёта ───────────────────────────────────────────────────────

/**
 * Заявка на исправление уже сданного отчёта.
 *
 * Правка не применяется сразу: она уходит тому, кто ведёт отчётность,
 * и вступает в силу только после подтверждения. До этого в сводке
 * продолжают считаться прежние цифры — иначе отчётность «поплывёт»
 * задним числом, и никто не сможет объяснить расхождение.
 */
export type CorrectionStatus = 'pending' | 'approved' | 'rejected';

export interface CorrectionRequest {
  id: string;
  /** id исправляемой записи. */
  entryId: string;
  /** Значения до правки — чтобы показать, что именно меняется. */
  before: DailyWorkEntry;
  /** Предлагаемая версия записи целиком. */
  proposed: DailyWorkEntry;
  /** Почему исправляем — обязательно. */
  reason: string;
  author: string;
  createdAt: string;
  status: CorrectionStatus;
  decidedBy?: string;
  decidedAt?: string;
  /** Комментарий решения — особенно важен при отказе. */
  decisionNote?: string;
}

/** Роль внутри журнала: кто вносит и кто подтверждает исправления. */
export type JournalRole = 'field' | 'office';

export const JOURNAL_ROLE_LABEL: Record<JournalRole, string> = {
  field: 'Поле',
  office: 'Отчётность',
};

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
