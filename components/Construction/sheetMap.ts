import {
  DailyWorkEntry, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
} from '@/types/construction';
import { parseMeters } from './units';

/**
 * Чужая таблица.
 *
 * У каждого прораба своя книга: «Дата», «Участок», «Проложено, м» — или
 * «число», «объект», «выполнение». Заставлять его переделывать таблицу
 * под нашу форму бессмысленно: он ведёт её три года и не перестанет.
 *
 * Поэтому колонки угадываем по названиям, а угаданное показываем и даём
 * поправить. Угадывать молча нельзя: перепутанная колонка — это не
 * кривой импорт, а неверные метры в акте.
 */

export type SheetField =
  | 'date' | 'uchastok' | 'kato' | 'oblast' | 'rayon'
  | 'contractor' | 'column' | 'smu' | 'note'
  | 'meters' | 'drillM' | 'blowingM'
  | LayMethod;

export interface FieldSpec {
  label: string;
  /** Куски заголовков, по которым узнаём колонку. */
  hints: string[];
  /** Обязательное поле: без него строка не запись. */
  required?: boolean;
  kind: 'text' | 'date' | 'meters';
}

export const SHEET_FIELDS: Record<SheetField, FieldSpec> = {
  date: { label: 'Дата', hints: ['дата', 'число', 'день', 'date'], required: true, kind: 'date' },
  uchastok: {
    label: 'Участок',
    hints: ['участок', 'объект', 'трасса', 'направление', 'снп', 'село', 'населенный'],
    required: true,
    kind: 'text',
  },
  kato: { label: 'КАТО', hints: ['като', 'код'], kind: 'text' },
  oblast: { label: 'Область', hints: ['область', 'обл'], kind: 'text' },
  rayon: { label: 'Район', hints: ['район'], kind: 'text' },
  contractor: {
    label: 'Подрядчик',
    hints: ['подрядчик', 'субподряд', 'организац', 'исполнитель'],
    kind: 'text',
  },
  column: { label: 'Колонна', hints: ['колонн', 'бригад', 'звено'], kind: 'text' },
  smu: { label: 'СМУ', hints: ['сму'], kind: 'text' },
  note: { label: 'Примечание', hints: ['примечан', 'коммент', 'заметк'], kind: 'text' },
  meters: {
    label: 'Метры (общие)',
    hints: ['проложено', 'выполнен', 'метр', 'итого', 'всего', 'объем', 'м/п', 'пог'],
    kind: 'meters',
  },
  drillM: { label: 'ГНБ, м', hints: ['гнб', 'гнп', 'прокол', 'бестранш'], kind: 'meters' },
  blowingM: { label: 'Задувка, м', hints: ['задув', 'продув', 'затяж'], kind: 'meters' },
  'кабелеукладчик': { label: LAY_METHOD_LABEL['кабелеукладчик'], hints: ['кабелеуклад', 'плуг'], kind: 'meters' },
  'экскаватор': { label: LAY_METHOD_LABEL['экскаватор'], hints: ['экскават', 'мех'], kind: 'meters' },
  'сущ_канализация': { label: LAY_METHOD_LABEL['сущ_канализация'], hints: ['канализ', 'колодц'], kind: 'meters' },
  'бар': { label: LAY_METHOD_LABEL['бар'], hints: ['бар'], kind: 'meters' },
  'вручную': { label: LAY_METHOD_LABEL['вручную'], hints: ['вручн', 'ручн'], kind: 'meters' },
};

export const SHEET_FIELD_LIST = Object.keys(SHEET_FIELDS) as SheetField[];

export type SheetMapping = Partial<Record<SheetField, number>>;

function norm(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, 'е');
}

/**
 * Строка-шапка.
 *
 * Берём самую заполненную из первых нескольких: в книгах прорабов
 * сверху обычно стоит название объекта и пустая строка, а шапка — там,
 * где текста больше всего.
 */
export function guessHeaderRow(rows: unknown[][], scan = 10): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(scan, rows.length); i++) {
    const cells = (rows[i] ?? []).filter((v) => norm(v) !== '');
    // Шапка — это текст, а не числа: строка из одних чисел это уже данные.
    const texty = cells.filter((v) => Number.isNaN(Number(v))).length;
    const score = cells.length + texty;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/**
 * Совпадает ли заголовок с подсказкой.
 *
 * Короткие подсказки куском текста искать нельзя: «ок» находится внутри
 * «участок», а «бар» — внутри «барабан», и колонка достаётся не тому
 * полю. Для коротких требуем отдельное слово, допуская склонение:
 * «бар», «баром», «бара» — да, «барабан» — нет.
 */
function headerMatches(header: string, hint: string): boolean {
  if (hint.length > 3) return header.includes(hint);
  return header.split(/[^0-9a-zа-я]+/).some(
    (w) => w.startsWith(hint) && w.length <= hint.length + 3,
  );
}

/**
 * Что в какой колонке.
 *
 * Одна колонка не может отвечать за два поля: если «метры» и «бар»
 * попали на одну, побеждает более точное совпадение.
 */
export function guessMapping(headers: unknown[]): SheetMapping {
  const cols = headers.map(norm);
  const out: SheetMapping = {};
  const taken = new Set<number>();

  // Сначала узкие поля (способы, ГНБ), потом широкие: «итого» не должно
  // занять колонку «итого по бару».
  const order: SheetField[] = [
    ...LAY_METHODS, 'drillM', 'blowingM',
    'date', 'kato', 'smu', 'column', 'contractor', 'oblast', 'rayon',
    'uchastok', 'note', 'meters',
  ];

  for (const field of order) {
    const spec = SHEET_FIELDS[field];
    let bestIdx = -1;
    let bestLen = 0;
    cols.forEach((h, i) => {
      if (!h || taken.has(i)) return;
      for (const hint of spec.hints) {
        if (!headerMatches(h, hint)) continue;
        // Из двух подходящих берём ту, где совпадение длиннее.
        if (hint.length > bestLen) { bestLen = hint.length; bestIdx = i; }
      }
    });
    if (bestIdx >= 0) {
      out[field] = bestIdx;
      taken.add(bestIdx);
    }
  }
  return out;
}

export interface SheetImportOptions {
  /** Куда класть общие метры, если колонок по способам нет. */
  defaultMethod?: LayMethod;
  oblast?: string;
  author?: string;
  now?: string;
}

export interface SheetImportResult {
  entries: DailyWorkEntry[];
  /** Строки, которые не стали записями, и почему. */
  skipped: { row: number; why: string }[];
}

/** День календаря — существует ли он вообще. */
function realDate(year: number, month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  // 31 апреля и 30 февраля в таблицах встречаются: их набирают руками.
  // Принимать их молча значит положить в журнал день, которого не было.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return d.toISOString().slice(0, 10);
}

function cellDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel отдаёт дату полночью по местному времени. Взять от неё
    // toISOString значит в Казахстане отмотать день назад: смена за
    // 25 июля ляжет в журнал двадцать четвёртым.
    return realDate(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  const s = String(v ?? '').trim();
  if (!s) return '';
  const iso = s.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (iso) return realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dotted = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (dotted) {
    const year = Number(dotted[3]) < 100 ? 2000 + Number(dotted[3]) : Number(dotted[3]);
    return realDate(year, Number(dotted[2]), Number(dotted[1]));
  }
  // Excel хранит даты числом дней от 1899-12-30.
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 60_000) {
    const ms = Math.round((serial - 25569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  return '';
}

function cellMeters(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const parsed = parseMeters(String(v ?? ''));
  return parsed.ok ? parsed.meters : 0;
}

function cellText(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Строки таблицы — в записи журнала.
 *
 * Пропущенные строки не выбрасываем молча: их число и причина уходят
 * наверх, чтобы человек увидел «12 строк без даты», а не разницу в
 * итогах через месяц.
 */
export function rowsToEntries(
  rows: unknown[][],
  headerRow: number,
  mapping: SheetMapping,
  opts: SheetImportOptions = {},
): SheetImportResult {
  const now = opts.now ?? new Date().toISOString();
  const entries: DailyWorkEntry[] = [];
  const skipped: { row: number; why: string }[] = [];

  const at = (row: unknown[], field: SheetField): unknown => {
    const i = mapping[field];
    return i === undefined ? undefined : row[i];
  };

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((v) => cellText(v) === '')) continue;

    const date = cellDate(at(row, 'date'));
    const uchastok = cellText(at(row, 'uchastok'));
    if (!date) { skipped.push({ row: r + 1, why: 'нет даты' }); continue; }
    if (!uchastok) { skipped.push({ row: r + 1, why: 'нет участка' }); continue; }

    const byMethod: Partial<Record<LayMethod, number>> = {};
    for (const m of LAY_METHODS) {
      const v = cellMeters(at(row, m));
      if (v > 0) byMethod[m] = Math.round(v);
    }
    const common = cellMeters(at(row, 'meters'));
    if (common > 0 && Object.keys(byMethod).length === 0) {
      // Общие метры кладём в выбранный способ и говорим об этом в UI:
      // «как-нибудь» распределять их между способами нельзя.
      byMethod[opts.defaultMethod ?? 'кабелеукладчик'] = Math.round(common);
    }

    const drillM = Math.round(cellMeters(at(row, 'drillM')));
    const blowingM = Math.round(cellMeters(at(row, 'blowingM')));
    const total = Object.values(byMethod).reduce((s, v) => s + (v ?? 0), 0);
    if (total === 0 && drillM === 0 && blowingM === 0) {
      skipped.push({ row: r + 1, why: 'нет метров' });
      continue;
    }

    entries.push({
      kind: 'ground',
      id: `imp-${date}-${r}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      smu: cellText(at(row, 'smu')),
      contractor: cellText(at(row, 'contractor')) || undefined,
      column: cellText(at(row, 'column')) || undefined,
      oblast: cellText(at(row, 'oblast')) || opts.oblast || '',
      rayon: cellText(at(row, 'rayon')) || undefined,
      uchastok,
      kato: cellText(at(row, 'kato')),
      byMethod,
      drillM: drillM || undefined,
      drillCount: drillM > 0 ? 1 : undefined,
      blowingM: blowingM || undefined,
      materials: {},
      note: cellText(at(row, 'note')) || undefined,
      author: opts.author,
      createdAt: now,
      updatedAt: now,
      sync: 'local',
    });
  }

  return { entries, skipped };
}

/** Чего не хватает, чтобы вообще что-то загрузить. */
export function missingRequired(mapping: SheetMapping): SheetField[] {
  return SHEET_FIELD_LIST.filter((f) => SHEET_FIELDS[f].required && mapping[f] === undefined);
}
