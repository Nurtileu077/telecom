import {
  DailyWorkEntry, Deviation, LayMethod, LAY_METHODS, DESIGN_DEPTH_M,
  MobileGroupProtocol,
} from '@/types/construction';

/**
 * Свод по участку для закрывающих актов — АСР (СН РК 1.03-00-2022) и
 * ОСР (Приложение 12 к ОДС/П-14-4-4-01).
 *
 * Оба документа содержат одну и ту же таблицу из 17 строк, и почти каждая
 * её строка считается из дневных записей, которые уже введены:
 *
 *   «Защитной МКТ проложено всего»            → сумма по способам прокладки
 *   «Кабелеукладчиком с двукратной пропоркой» → способ «кабелеукладчик»
 *   «Вручную / Экскаватором / Бар / По сущ. канализации» → те же способы
 *   «Комплектов для сращивания защитной МКТ»  → материал ФИТИНГ
 *   «Лента на глубине ½ от глубины МКТ»       → материал Лента
 *   «Глубина: по проекту / фактически»        → карточки отклонений
 *
 * ВАЖНО про глубину: акт не один на участок. Каждая фактическая глубина
 * закрывается своим актом. Если на СНП 11 100 м уложены по проектным 1,2 м,
 * а 50 м прошли по 0,5 м, получается два АСР/ОСР на один и тот же участок:
 * основной на 11 050 м с глубиной 1,2 и отдельный на 50 м с глубиной 0,5,
 * со ссылкой на протокол мобильной группы. Поэтому свод возвращает набор
 * актов, а не одну «наименьшую глубину» на всю трассу.
 *
 * То, чего в дневном отчёте нет по существу (рекультивация, восстановление
 * покрытий, столбики, шаровые маркеры, разбивка переходов по ПЭТ-63/110),
 * остаётся полями акта и заполняется при закрытии — система их не выдумывает.
 */

export type Recultivation = 'выполнена' | 'не выполнена';

/** Варианты ровно те, что перечислены в скобках самого бланка. */
export type PavementRestore =
  | 'выполнено' | 'не выполнено' | 'выполнено частично'
  | 'не требуется' | 'не предусмотрено проектом';

/**
 * Один акт АСР/ОСР: участок трассы, уложенный на одной глубине.
 * Основной идёт по проектной глубине, каждое отклонение закрывается своим.
 */
export interface SectionActVariant {
  /** true — основной акт по проектной глубине. */
  isMain: boolean;
  designDepthM: number;
  actualDepthM: number;
  /** Протяжённость этого акта, метры. */
  lengthM: number;
  /** Отклонения, вошедшие в акт (пусто у основного). */
  deviations: Deviation[];
  /** Протоколы мобильной группы, на которые ссылается акт. */
  protocols: MobileGroupProtocol[];
  /** Есть отклонение без протокола — акт не закрыть. */
  blocked: boolean;
}

/**
 * Поля акта, которых нет в дневном отчёте по существу: их заполняют при
 * закрытии участка. Хранятся по участку, чтобы не вводить заново.
 */
export interface SectionActManual {
  /** Переходы ГНБ с защитой ПЭТ-63 и ПЭТ-110, метры. */
  gnbPet63M?: number;
  gnbPet110M?: number;
  /** Переходы открытым способом: ПЭТ-63 и стальная труба 63, метры. */
  openPet63M?: number;
  openSteel63M?: number;
  recultivation?: Recultivation;
  pavement?: PavementRestore;
  /** Обваловка — строка ОСР под таблицей. */
  obvalovka?: string;
  /** Идентификационные столбики и шаровые маркеры, штуки. */
  markerPosts?: number;
  ballMarkers?: number;
  /** Реквизиты акта. */
  actNumber?: string;
  actDate?: string;
  city?: string;

  // ── Шапки бланков ──────────────────────────────────────────────────────
  /** АСР: «наименование и место расположения объекта». */
  objectName?: string;
  /** ОСР: «Участок ВОЛС: от … до …». */
  volsFrom?: string;
  volsTo?: string;
  /** Сельский округ — им заканчивается название участка в обоих бланках. */
  selsovet?: string;
  /** Генподрядчик, от чьего имени подписывают: в бланке это АО «Транстелеком». */
  genContractor?: string;
  /** «а также представителей, дополнительно участвующих в освидетельствовании». */
  extraParticipants?: string;
  /** АСР п.2: проектная организация, № чертежей. */
  psd?: string;
  /** Применённые материалы: в бланке это длинная постоянная строка. */
  materials?: string;
  /** АСР: «разрешается производство последующих работ по устройству (монтажу) …». */
  nextWorks?: string;
  /** ОСР: номер ТУСМ в подписи начальника ПТО. */
  tusm?: string;
}

/**
 * Постоянные строки бланков.
 *
 * Их печатают в каждом акте одинаково, и набирать их заново — только
 * плодить расхождения между актами одного объекта. Поправить можно в полях.
 */
export const ACT_MATERIALS_DEFAULT =
  'Пакет микротрубок kCl-SRV-G 2х14/10 tc-blue, Лента ЛСС 50мм/250м/100мкм '
  + '(«Не копать! Оптический кабель АО «Казахтелеком») (2 проводника), '
  + 'Соединитель прямой DSM 14, Заглушка концевая ES 14.';

export const ACT_NEXT_WORKS_DEFAULT = 'Задувка волоконно-оптического кабеля';

export const ACT_GEN_CONTRACTOR_DEFAULT = 'АО «Транстелеком»';

export const DEFAULT_ACT_MANUAL: SectionActManual = {
  recultivation: 'выполнена',
  pavement: 'не предусмотрено проектом',
  genContractor: ACT_GEN_CONTRACTOR_DEFAULT,
  materials: ACT_MATERIALS_DEFAULT,
  nextWorks: ACT_NEXT_WORKS_DEFAULT,
};

/** Считается из журнала. */
export interface SectionActTotals {
  /** Защитной МКТ проложено всего, метры. */
  totalM: number;
  byMethod: Record<LayMethod, number>;
  /** Предупредительно-сигнальная лента, метры. */
  tapeM: number;
  /** Комплекты для сращивания МКТ — по документам Казахтелекома это фитинги. */
  splicingKits: number;
  /** Бестраншейные переходы. */
  drillM: number;
  drillCount: number;
  /** Открытые переходы, штуки. */
  openCrossings: number;
  /** Всего переходов на участке. */
  crossingsTotal: number;
  designDepthM: number;
  /**
   * Акты по участку: основной по проектной глубине плюс по одному на
   * каждую фактическую глубину отклонения.
   */
  variants: SectionActVariant[];
  /** Отклонения по глубине, попавшие в участок. */
  depthDeviations: Deviation[];
  /** Отклонения без протокола мобильной группы — акт с ними не закрыть. */
  openDeviations: Deviation[];
  dateFrom: string;
  dateTo: string;
  /** Кто фактически работал. */
  performers: string[];
  entriesCount: number;
}

function emptyByMethod(): Record<LayMethod, number> {
  return {
    'кабелеукладчик': 0, 'экскаватор': 0, 'сущ_канализация': 0, 'бар': 0, 'вручную': 0,
  };
}

/** Записи участка: сравнение по названию без учёта регистра и лишних пробелов. */
export function entriesOfSection(entries: DailyWorkEntry[], uchastok: string): DailyWorkEntry[] {
  const key = uchastok.trim().toLowerCase();
  if (!key) return [];
  return entries.filter((e) => e.uchastok.trim().toLowerCase() === key);
}

export function deviationsOfSection(devs: Deviation[], uchastok: string): Deviation[] {
  const key = uchastok.trim().toLowerCase();
  if (!key) return [];
  return devs.filter((d) => d.uchastok.trim().toLowerCase() === key);
}

export function computeSectionAct(
  entries: DailyWorkEntry[],
  deviations: Deviation[] = [],
): SectionActTotals {
  const byMethod = emptyByMethod();
  let tapeM = 0;
  let splicingKits = 0;
  let drillM = 0;
  let drillCount = 0;
  let openCrossings = 0;
  let dateFrom = '';
  let dateTo = '';
  const performers = new Set<string>();

  for (const e of entries) {
    for (const m of LAY_METHODS) byMethod[m] += e.byMethod[m] ?? 0;
    tapeM += e.materials['Лента'] ?? 0;
    // По документам Казахтелекома комплекты для сращивания МКТ — это фитинги.
    splicingKits += e.materials['ФИТИНГ'] ?? 0;
    drillM += e.drillM ?? 0;
    drillCount += e.drillCount ?? 0;
    openCrossings += e.openCrossings ?? 0;
    if (e.date) {
      if (!dateFrom || e.date < dateFrom) dateFrom = e.date;
      if (!dateTo || e.date > dateTo) dateTo = e.date;
    }
    if (e.contractor) performers.add(e.contractor);
  }

  const totalM = LAY_METHODS.reduce((s, m) => s + byMethod[m], 0);

  const depthDeviations = deviations.filter((d) => d.kind === 'depth');
  const designDepthM = depthDeviations[0]?.designDepthM ?? DESIGN_DEPTH_M;

  const openDeviations = deviations.filter(
    (d) => (d.kind === 'route' || (d.actualDepthM !== undefined && d.actualDepthM < (d.designDepthM ?? DESIGN_DEPTH_M) - 0.01))
      && !d.protocol?.number?.trim(),
  );

  return {
    totalM, byMethod, tapeM, splicingKits,
    drillM, drillCount, openCrossings,
    crossingsTotal: drillCount + openCrossings,
    designDepthM,
    variants: buildVariants(totalM, designDepthM, depthDeviations),
    depthDeviations, openDeviations,
    dateFrom, dateTo,
    performers: [...performers].sort((a, b) => a.localeCompare(b, 'ru')),
    entriesCount: entries.length,
  };
}

/**
 * Разбивает участок на акты по фактической глубине.
 *
 * Отклонения с одинаковой глубиной объединяются в один акт — на СНП может
 * быть несколько кусков по 0,5 м, и они закрываются вместе. Остаток трассы
 * идёт основным актом по проектной глубине.
 */
function buildVariants(
  totalM: number,
  designDepthM: number,
  depthDeviations: Deviation[],
): SectionActVariant[] {
  const byDepth = new Map<number, Deviation[]>();
  for (const d of depthDeviations) {
    const depth = d.actualDepthM;
    // Уложились в проект — отдельный акт не нужен.
    if (depth === undefined || depth >= (d.designDepthM ?? designDepthM) - 0.01) continue;
    const list = byDepth.get(depth);
    if (list) list.push(d); else byDepth.set(depth, [d]);
  }

  const deviationVariants: SectionActVariant[] = [...byDepth.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([depth, list]) => ({
      isMain: false,
      designDepthM,
      actualDepthM: depth,
      lengthM: list.reduce((s, d) => s + d.lengthM, 0),
      deviations: list,
      protocols: list
        .map((d) => d.protocol)
        .filter((p): p is MobileGroupProtocol => !!p?.number?.trim()),
      blocked: list.some((d) => !d.protocol?.number?.trim()),
    }));

  const deviatedM = deviationVariants.reduce((s, v) => s + v.lengthM, 0);
  // Отклонения не могут занимать больше, чем проложено: если так вышло,
  // основного акта просто нет, а расхождение видно по цифрам.
  const mainLength = Math.max(0, totalM - deviatedM);

  const main: SectionActVariant = {
    isMain: true,
    designDepthM,
    actualDepthM: designDepthM,
    lengthM: mainLength,
    deviations: [],
    protocols: [],
    blocked: false,
  };

  return mainLength > 0 ? [main, ...deviationVariants] : deviationVariants;
}

/** Километры для акта: в документах объёмы пишут в км с тремя знаками. */
export function actKm(meters: number): string {
  return (Math.round(meters) / 1000).toFixed(3).replace('.', ',');
}
