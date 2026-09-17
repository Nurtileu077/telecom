import {
  DailyWorkEntry, AerialWorkEntry, DrillLogEntry, SettlementOrder,
  LayMethod, MaterialKind, AerialCableType, AerialMaterialKind,
  OperationKind, OPERATIONS, OPERATION_KINDS, EQUIPMENT_KINDS,
} from '@/types/construction';
import { formatDuctMarks } from './ductMarks';

/**
 * Выгрузка журнала обратно в Excel — в том же виде, в котором его ведут.
 *
 * Смысл: переход на систему не должен ломать привычный оборот документов.
 * Руководство продолжает получать тот же файл с теми же листами и колонками,
 * просто он больше не собирается руками.
 *
 * Метры внутри системы переводятся обратно в километры, как в исходной книге.
 * Координаты ГНБ выгружаются уже разобранными — «широта, долгота (длина)»,
 * без разнобоя в порядке, который был в исходных данных.
 */

/** Метры → километры для колонок «…, км». Три знака = метровая точность. */
function m2km(m?: number): number | '' {
  if (!m) return '';
  return Math.round(m) / 1000;
}

function n(v?: number): number | '' {
  return v ? v : '';
}

/** YYYY-MM-DD → Date, чтобы Excel распознал колонку как дату. */
function toDate(iso?: string): Date | '' {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return isNaN(d.getTime()) ? '' : d;
}

// ── Заголовки: один в один из рабочей книги ──────────────────────────────────

export const GROUND_HEADERS = [
  'Дата', 'СМУ', 'Область', 'Участок', 'КАТО', 'Район', 'Тип технологии',
  'Кабелеукладчиком, км', 'Мех. способом (экскаватор), км', 'По сущ.тел. канализации',
  'Бар, км', 'Ручным способом, км',
  'ГНБ/ГНП, км', 'ГНБ/ГНП, шт', 'Открытый переход, шт', 'Задувка ОК, км',
  'Лента, км', 'КОД, шт', 'ПЭТ, км', 'Муфта, шт', 'МКТ, км', 'ФИТИНГ, шт',
] as const;

const GROUND_METHOD_ORDER: LayMethod[] = [
  'кабелеукладчик', 'экскаватор', 'сущ_канализация', 'бар', 'вручную',
];
const GROUND_MATERIAL_ORDER: MaterialKind[] = ['Лента', 'КОД', 'ПЭТ', 'Муфта', 'МКТ', 'ФИТИНГ'];

export function groundRow(e: DailyWorkEntry): (string | number | Date)[] {
  const methods = GROUND_METHOD_ORDER.map((m) => m2km(e.byMethod[m]));
  const materials = GROUND_MATERIAL_ORDER.map((m) =>
    // Метровые материалы возвращаются в километры, штучные — как есть.
    (m === 'МКТ' || m === 'ПЭТ' || m === 'Лента') ? m2km(e.materials[m]) : n(e.materials[m]),
  );
  return [
    toDate(e.date), e.smu, e.oblast, e.uchastok, e.kato, e.rayon ?? '', e.tech ?? '',
    ...methods,
    m2km(e.drillM), n(e.drillCount), n(e.openCrossings), m2km(e.blowingM),
    ...materials,
  ];
}

export const AERIAL_HEADERS = [
  'Дата', 'СМУ', 'Область', 'Район', 'Участок', 'КАТО', 'Подвес кабеля (км)',
  'Подвес кабеля ОК2, км', 'Подвес кабеля ОК4, км', 'Подвес кабеля ОК8, км',
  'Подвес кабеля ОК16, км', 'Подвес кабеля ХХ, км',
  'ОПОРЫ, шт', 'ККС, шт', 'Термошкаф, шт', 'ОРК без сплиттера, шт', 'ОРК со сплиттером, шт',
  'МУФТА, шт', 'Узел крепления УКН, шт', 'Зажим анкерный РА, шт',
  'Зажим поддерживающий НС, шт', 'Зажим промежуточный, шт',
] as const;

const AERIAL_CABLE_ORDER: AerialCableType[] = ['ОК2', 'ОК4', 'ОК8', 'ОК16', 'ХХ'];
const AERIAL_MATERIAL_ORDER: AerialMaterialKind[] = [
  'Опоры', 'ККС', 'Термошкаф', 'ОРК без сплиттера', 'ОРК со сплиттером',
  'Муфта', 'УКН', 'Зажим анкерный', 'Зажим поддерживающий', 'Зажим промежуточный',
];

export function aerialRow(e: AerialWorkEntry): (string | number | Date)[] {
  return [
    toDate(e.date), e.smu, e.oblast, e.rayon ?? '', e.uchastok, e.kato,
    m2km(e.totalM),
    ...AERIAL_CABLE_ORDER.map((c) => m2km(e.byCable[c])),
    ...AERIAL_MATERIAL_ORDER.map((m) => n(e.materials[m])),
  ];
}

export const DRILL_HEADERS = [
  'Дата', 'КАТО', 'Участок', 'Протяженность, км', 'Координаты',
  'Примечание', 'Технология', 'Количество', 'область',
] as const;

/** Точки в читаемый столбец: по строке на прокол, порядок уже выверен. */
export function formatDrillCoords(e: DrillLogEntry): string {
  if (e.points.length === 0) return e.rawCoords ?? '';
  return e.points
    .map((p, i) => {
      const base = `${i + 1}. ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
      return p.meters ? `${base} (${p.meters}м)` : base;
    })
    .join('\n');
}

export function drillRow(e: DrillLogEntry): (string | number | Date)[] {
  return [
    toDate(e.date), e.kato, e.uchastok, m2km(e.meters), formatDrillCoords(e),
    e.note ?? '', e.drillKind, n(e.count), e.oblast,
  ];
}

// ── Детали работ: то, что не помещается в исходные колонки Excel ─────────────
// Отдельный лист, чтобы формат «DATA» остался привычным. Колонка ID нужна
// для обратного импорта: без неё подробности терялись бы при обороте файла.

export const DETAIL_HEADERS = [
  'ID', 'Дата', 'Участок', 'КАТО',
  ...OPERATION_KINDS.map((k) => `${OPERATIONS[k].label}, ${OPERATIONS[k].unit}`),
  ...EQUIPMENT_KINDS.map((k) => `Техника: ${k}, шт`),
  'Метки трубы', 'Тотал за день, м', 'Тотал по участку, м', 'Запас МКТ ГНБ, м',
  'Причины простоя', 'План на завтра',
] as const;

/** Есть ли в записи что-то для листа деталей. */
export function hasDetails(e: DailyWorkEntry): boolean {
  return !!(e.operations || e.equipment || e.ductMarks?.length
    || e.totalMktM || e.totalUchastokM || e.reserveMktM || e.downtime || e.tomorrow);
}

export function detailRow(e: DailyWorkEntry): (string | number | Date)[] {
  return [
    e.id, toDate(e.date), e.uchastok, e.kato,
    ...OPERATION_KINDS.map((k) => n(e.operations?.[k])),
    ...EQUIPMENT_KINDS.map((k) => n(e.equipment?.[k])),
    formatDuctMarks(e.ductMarks),
    n(e.totalMktM), n(e.totalUchastokM), n(e.reserveMktM),
    e.downtime ?? '', e.tomorrow ?? '',
  ];
}

export const ORDER_HEADERS = [
  'КАТО', 'Область', 'Район', 'Сельский округ', 'СНП', 'Год',
  'Начала СМР', 'Завершение СМР', 'Кол-во ГУ', 'Технология',
  'ПЛАН ВОЛС (км)', 'МКТ, км', 'ВОК, км', 'Подвес кабеля, км', 'Примечание',
] as const;

export function orderRow(o: SettlementOrder): (string | number | Date)[] {
  return [
    o.kato, o.oblast, o.rayon ?? '', o.okrug ?? '', o.snp, n(o.year),
    toDate(o.planStart), toDate(o.planEnd), n(o.guCount), o.tech ?? '',
    m2km(o.planVolsM), m2km(o.planMktM), m2km(o.planVokM), m2km(o.planAerialM),
    o.note ?? '',
  ];
}

// ── Сборка книги ─────────────────────────────────────────────────────────────

export interface JournalExportInput {
  orders: SettlementOrder[];
  ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[];
  drills: DrillLogEntry[];
}

/** Ширины колонок — чтобы файл открывался читаемым, а не «решётками». */
function widthsFor(headers: readonly string[]): { wch: number }[] {
  return headers.map((h) => ({ wch: Math.min(34, Math.max(10, h.length + 2)) }));
}

export async function buildJournalWorkbook(data: JournalExportInput): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const addSheet = (
    name: string,
    headers: readonly string[],
    rows: (string | number | Date)[][],
  ) => {
    const ws = XLSX.utils.aoa_to_sheet([[...headers], ...rows]);
    (ws as Record<string, unknown>)['!cols'] = widthsFor(headers);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  // Порядок листов — как в исходной книге: сначала план, потом факт.
  addSheet('Все СНП заказа', ORDER_HEADERS, data.orders.map(orderRow));
  addSheet('DATA', GROUND_HEADERS, sortByDate(data.ground).map(groundRow));
  addSheet('ГНБ Журнал', DRILL_HEADERS, sortByDate(data.drills).map(drillRow));
  addSheet('DATA ПОДВЕС', AERIAL_HEADERS, sortByDate(data.aerial).map(aerialRow));

  // Лист деталей добавляем только когда есть что писать — иначе он
  // просто мешал бы тем, кто привык к четырём листам.
  const withDetails = sortByDate(data.ground).filter(hasDetails);
  if (withDetails.length > 0) {
    addSheet('Детали работ', DETAIL_HEADERS, withDetails.map(detailRow));
  }

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function sortByDate<T extends { date: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

/** Имя файла выгрузки: с датой, чтобы версии не путались. */
export function journalFileName(): string {
  return `Журнал-СНП-${new Date().toISOString().slice(0, 10)}.xlsx`;
}
