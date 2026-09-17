import {
  DailyWorkEntry, Deviation, LayMethod, LAY_METHODS, DESIGN_DEPTH_M,
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
 *   «Комплектов для сращивания защитной МКТ»  → материал КОД
 *   «Лента на глубине ½ от глубины МКТ»       → материал Лента
 *   «Глубина: по проекту / фактически»        → карточки отклонений
 *
 * То, чего в дневном отчёте нет по существу (рекультивация, восстановление
 * покрытий, столбики, шаровые маркеры, разбивка переходов по ПЭТ-63/110),
 * остаётся полями акта и заполняется при закрытии — система их не выдумывает.
 */

export type Recultivation = 'выполнена' | 'не выполнена';
export type PavementRestore = 'выполнено' | 'не выполнено' | 'не предусматривается проектом';

/** Считается из журнала. */
export interface SectionActTotals {
  /** Защитной МКТ проложено всего, метры. */
  totalM: number;
  byMethod: Record<LayMethod, number>;
  /** Предупредительно-сигнальная лента, метры. */
  tapeM: number;
  /** Комплекты для сращивания МКТ (КОД), штуки. */
  splicingKits: number;
  /** Бестраншейные переходы. */
  drillM: number;
  drillCount: number;
  /** Открытые переходы, штуки. */
  openCrossings: number;
  /** Всего переходов на участке. */
  crossingsTotal: number;
  designDepthM: number;
  /** Наименьшая фактическая глубина по участку — её и пишут в акт. */
  actualDepthM: number;
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
    splicingKits += e.materials['КОД'] ?? 0;
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
  // В акт идёт наименьшая фактическая глубина: именно она определяет,
  // соответствует участок проекту или нет.
  const actualDepthM = depthDeviations.reduce(
    (min, d) => (d.actualDepthM !== undefined && d.actualDepthM < min ? d.actualDepthM : min),
    designDepthM,
  );

  const openDeviations = deviations.filter(
    (d) => (d.kind === 'route' || (d.actualDepthM !== undefined && d.actualDepthM < (d.designDepthM ?? DESIGN_DEPTH_M) - 0.01))
      && !d.protocol?.number?.trim(),
  );

  return {
    totalM, byMethod, tapeM, splicingKits,
    drillM, drillCount, openCrossings,
    crossingsTotal: drillCount + openCrossings,
    designDepthM, actualDepthM,
    depthDeviations, openDeviations,
    dateFrom, dateTo,
    performers: [...performers].sort((a, b) => a.localeCompare(b, 'ru')),
    entriesCount: entries.length,
  };
}

/** Километры для акта: в документах объёмы пишут в км с тремя знаками. */
export function actKm(meters: number): string {
  return (Math.round(meters) / 1000).toFixed(3).replace('.', ',');
}
