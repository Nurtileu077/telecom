import {
  SettlementOrder, DailyWorkEntry, AerialWorkEntry, DrillLogEntry,
  LayMethod, MaterialKind, AerialCableType, AerialMaterialKind,
  WorkTech, DrillKind,
} from '@/types/construction';
import { parseCoordBlob, hintForOblast } from './coords';

/**
 * Импорт рабочего журнала СНП из Excel.
 *
 * Читает книгу как есть — той структурой, в которой её ведут:
 *   «Все СНП заказа» → план по населённым пунктам
 *   «DATA»           → дневная выработка подземки
 *   «DATA ПОДВЕС»    → дневная выработка подвеса
 *   «ГНБ Журнал»     → бестраншейные переходы (с разбором координат)
 *
 * Листы ищутся по имени без учёта регистра и лишних пробелов; отсутствующий
 * лист — не ошибка, а предупреждение. Длины переводятся из километров в метры.
 */

export interface JournalImportResult {
  orders: SettlementOrder[];
  ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[];
  drills: DrillLogEntry[];
  stats: {
    sheets: string[];
    orderRows: number;
    groundRows: number;
    aerialRows: number;
    drillRows: number;
    /** Сколько точек удалось поставить на карту из текстовых координат. */
    drillPoints: number;
    /** Сколько пар пришлось разрешать по подсказке области. */
    drillAmbiguous: number;
    /** Сколько записей ГНБ остались без координат. */
    drillUnparsed: number;
  };
  warnings: string[];
}

type Row = unknown[];

// ── Мелкие утилиты чтения ячеек ──────────────────────────────────────────────

function normHeader(v: unknown): string {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Индекс первого заголовка, содержащего все переданные подстроки. */
function findCol(headers: string[], ...needles: string[]): number {
  const want = needles.map((n) => n.toLowerCase());
  return headers.findIndex((h) => h && want.every((n) => h.includes(n)));
}

/** Строка с наибольшим числом заполненных ячеек среди первых `scan` — шапка. */
function headerRowIndex(rows: Row[], scan = 12): number {
  let best = -1;
  let bestCount = 0;
  const limit = Math.min(scan, rows.length);
  for (let i = 0; i < limit; i++) {
    const count = (rows[i] ?? []).filter((v) => v !== null && v !== undefined && v !== '').length;
    if (count > bestCount) { bestCount = count; best = i; }
  }
  return best < 0 ? 0 : best;
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Километры из таблицы → целые метры внутри системы. */
function km2m(v: unknown): number {
  const n = num(v);
  return n === 0 ? 0 : Math.round(n * 1000);
}

function str(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** Дата ячейки → YYYY-MM-DD. Пусто, если дату распознать не удалось. */
function isoDate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    // Серийная дата Excel: дни с 30.12.1899.
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return isoDate(new Date(ms));
  }
  const s = str(v);
  const m = s.match(/^(\d{2})[.\/](\d{2})[.\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

/** Строка считается пустой, если нет ни даты, ни участка, ни КАТО. */
function hasAnchor(date: string, uchastok: string, kato: string): boolean {
  return !!(date || uchastok || kato);
}

function sheetByName(names: string[], want: string): string | undefined {
  const w = want.toLowerCase().replace(/\s+/g, ' ').trim();
  return names.find((n) => n.toLowerCase().replace(/\s+/g, ' ').trim() === w);
}

// ── Разбор отдельных листов ──────────────────────────────────────────────────

function parseOrders(rows: Row[]): SettlementOrder[] {
  if (rows.length === 0) return [];
  const h = headerRowIndex(rows);
  const H = (rows[h] ?? []).map(normHeader);

  const c = {
    kato:   findCol(H, 'като'),
    oblast: findCol(H, 'область'),
    rayon:  findCol(H, 'район'),
    okrug:  findCol(H, 'сельский округ'),
    snp:    findCol(H, 'снп'),
    year:   findCol(H, 'год'),
    start:  findCol(H, 'начала смр'),
    end:    findCol(H, 'завершение смр'),
    gu:     findCol(H, 'гу'),
    tech:   findCol(H, 'технология'),
    plan:   findCol(H, 'план волс'),
    mkt:    findCol(H, 'мкт'),
    vok:    findCol(H, 'вок'),
    aerial: findCol(H, 'подвес кабеля'),
    note:   findCol(H, 'примечание'),
  };

  const out: SettlementOrder[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const kato = c.kato >= 0 ? str(r[c.kato]) : '';
    const snp = c.snp >= 0 ? str(r[c.snp]) : '';
    if (!kato && !snp) continue;

    out.push({
      kato,
      snp,
      oblast: c.oblast >= 0 ? str(r[c.oblast]) : '',
      rayon:  c.rayon >= 0 ? str(r[c.rayon]) : undefined,
      okrug:  c.okrug >= 0 ? str(r[c.okrug]) : undefined,
      year:   c.year >= 0 && num(r[c.year]) ? num(r[c.year]) : undefined,
      planStart: c.start >= 0 ? isoDate(r[c.start]) || undefined : undefined,
      planEnd:   c.end >= 0 ? isoDate(r[c.end]) || undefined : undefined,
      guCount:   c.gu >= 0 && num(r[c.gu]) ? num(r[c.gu]) : undefined,
      tech:      c.tech >= 0 ? str(r[c.tech]) || undefined : undefined,
      planVolsM:   c.plan >= 0 ? km2m(r[c.plan]) : undefined,
      planMktM:    c.mkt >= 0 ? km2m(r[c.mkt]) : undefined,
      planVokM:    c.vok >= 0 ? km2m(r[c.vok]) : undefined,
      planAerialM: c.aerial >= 0 ? km2m(r[c.aerial]) : undefined,
      note: c.note >= 0 ? str(r[c.note]) || undefined : undefined,
    });
  }
  return out;
}

const METHOD_NEEDLE: Record<LayMethod, string[]> = {
  'кабелеукладчик':  ['кабелеукладчик'],
  'экскаватор':      ['экскаватор'],
  'сущ_канализация': ['канализации'],
  'бар':             ['бар,'],
  'вручную':         ['ручным'],
};

const MATERIAL_NEEDLE: Record<MaterialKind, string[]> = {
  'МКТ':    ['мкт'],
  'ПЭТ':    ['пэт'],
  'Лента':  ['лента'],
  'КОД':    ['код'],
  'Муфта':  ['муфта'],
  'ФИТИНГ': ['фитинг'],
};

function parseGround(rows: Row[], now: string): DailyWorkEntry[] {
  if (rows.length === 0) return [];
  const h = headerRowIndex(rows);
  const H = (rows[h] ?? []).map(normHeader);

  const c = {
    date:   findCol(H, 'дата'),
    smu:    findCol(H, 'сму'),
    oblast: findCol(H, 'область'),
    rayon:  findCol(H, 'район'),
    uch:    findCol(H, 'участок'),
    kato:   findCol(H, 'като'),
    tech:   findCol(H, 'тип технологии'),
    drillKm:  findCol(H, 'гнб', 'км'),
    drillCnt: findCol(H, 'гнб', 'шт'),
    openCr:   findCol(H, 'открытый переход'),
    blow:     findCol(H, 'задувка'),
  };
  const methodCols = {} as Record<LayMethod, number>;
  for (const [k, needles] of Object.entries(METHOD_NEEDLE)) {
    methodCols[k as LayMethod] = findCol(H, ...needles);
  }
  const matCols = {} as Record<MaterialKind, number>;
  for (const [k, needles] of Object.entries(MATERIAL_NEEDLE)) {
    matCols[k as MaterialKind] = findCol(H, ...needles);
  }

  const out: DailyWorkEntry[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const date = c.date >= 0 ? isoDate(r[c.date]) : '';
    const uchastok = c.uch >= 0 ? str(r[c.uch]) : '';
    const kato = c.kato >= 0 ? str(r[c.kato]) : '';
    if (!hasAnchor(date, uchastok, kato)) continue;

    const byMethod: Partial<Record<LayMethod, number>> = {};
    for (const m of Object.keys(methodCols) as LayMethod[]) {
      const idx = methodCols[m];
      if (idx < 0) continue;
      const v = km2m(r[idx]);
      if (v > 0) byMethod[m] = v;
    }

    const materials: Partial<Record<MaterialKind, number>> = {};
    for (const m of Object.keys(matCols) as MaterialKind[]) {
      const idx = matCols[m];
      if (idx < 0) continue;
      // Метровые материалы лежат в километрах, штучные — уже в штуках.
      const v = (m === 'МКТ' || m === 'ПЭТ' || m === 'Лента') ? km2m(r[idx]) : num(r[idx]);
      if (v > 0) materials[m] = v;
    }

    const techRaw = c.tech >= 0 ? str(r[c.tech]) : '';
    const tech = (['МКТ', 'Задувка', 'ПЭТ', 'Лента'] as WorkTech[])
      .find((t) => t.toLowerCase() === techRaw.toLowerCase());

    const drillM = c.drillKm >= 0 ? km2m(r[c.drillKm]) : 0;
    const drillCount = c.drillCnt >= 0 ? num(r[c.drillCnt]) : 0;
    const openCrossings = c.openCr >= 0 ? num(r[c.openCr]) : 0;
    const blowingM = c.blow >= 0 ? km2m(r[c.blow]) : 0;

    out.push({
      kind: 'ground',
      id: `g-${kato || 'nokato'}-${date || 'nodate'}-${i}`,
      date, smu: c.smu >= 0 ? str(r[c.smu]) : '',
      oblast: c.oblast >= 0 ? str(r[c.oblast]) : '',
      rayon: c.rayon >= 0 ? str(r[c.rayon]) || undefined : undefined,
      uchastok, kato, tech,
      byMethod,
      drillM: drillM || undefined,
      drillCount: drillCount || undefined,
      openCrossings: openCrossings || undefined,
      blowingM: blowingM || undefined,
      materials,
      createdAt: now, updatedAt: now, sync: 'local',
    });
  }
  return out;
}

const AERIAL_CABLE_NEEDLE: Record<AerialCableType, string[]> = {
  'ОК2':  ['подвес', 'ок2'],
  'ОК4':  ['подвес', 'ок4'],
  'ОК8':  ['подвес', 'ок8'],
  'ОК16': ['подвес', 'ок16'],
  'ХХ':   ['подвес', 'хх'],
};

const AERIAL_MAT_NEEDLE: Record<AerialMaterialKind, string[]> = {
  'Опоры':              ['опоры'],
  'ККС':                ['ккс'],
  'Термошкаф':          ['термошкаф'],
  'ОРК без сплиттера':  ['орк без'],
  'ОРК со сплиттером':  ['орк со'],
  'Муфта':              ['муфта'],
  'УКН':                ['укн'],
  'Зажим анкерный':     ['анкерный'],
  'Зажим поддерживающий': ['поддерживающий'],
  'Зажим промежуточный':  ['промежуточный'],
};

function parseAerial(rows: Row[], now: string): AerialWorkEntry[] {
  if (rows.length === 0) return [];
  const h = headerRowIndex(rows);
  const H = (rows[h] ?? []).map(normHeader);

  const c = {
    date:   findCol(H, 'дата'),
    smu:    findCol(H, 'сму'),
    oblast: findCol(H, 'область'),
    rayon:  findCol(H, 'район'),
    uch:    findCol(H, 'участок'),
    kato:   findCol(H, 'като'),
    total:  findCol(H, 'подвес кабеля (км)'),
  };

  const cableCols = {} as Record<AerialCableType, number>;
  for (const [k, needles] of Object.entries(AERIAL_CABLE_NEEDLE)) {
    cableCols[k as AerialCableType] = findCol(H, ...needles);
  }
  const matCols = {} as Record<AerialMaterialKind, number>;
  for (const [k, needles] of Object.entries(AERIAL_MAT_NEEDLE)) {
    matCols[k as AerialMaterialKind] = findCol(H, ...needles);
  }

  const out: AerialWorkEntry[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const date = c.date >= 0 ? isoDate(r[c.date]) : '';
    const uchastok = c.uch >= 0 ? str(r[c.uch]) : '';
    const kato = c.kato >= 0 ? str(r[c.kato]) : '';
    if (!hasAnchor(date, uchastok, kato)) continue;

    const byCable: Partial<Record<AerialCableType, number>> = {};
    for (const k of Object.keys(cableCols) as AerialCableType[]) {
      const idx = cableCols[k];
      if (idx < 0) continue;
      const v = km2m(r[idx]);
      if (v > 0) byCable[k] = v;
    }
    const materials: Partial<Record<AerialMaterialKind, number>> = {};
    for (const k of Object.keys(matCols) as AerialMaterialKind[]) {
      const idx = matCols[k];
      if (idx < 0) continue;
      const v = num(r[idx]);
      if (v > 0) materials[k] = v;
    }

    out.push({
      kind: 'aerial',
      id: `a-${kato || 'nokato'}-${date || 'nodate'}-${i}`,
      date, smu: c.smu >= 0 ? str(r[c.smu]) : '',
      oblast: c.oblast >= 0 ? str(r[c.oblast]) : '',
      rayon: c.rayon >= 0 ? str(r[c.rayon]) || undefined : undefined,
      uchastok, kato,
      totalM: c.total >= 0 ? km2m(r[c.total]) : 0,
      byCable, materials,
      createdAt: now, updatedAt: now, sync: 'local',
    });
  }
  return out;
}

function parseDrills(rows: Row[], now: string) {
  const res = { list: [] as DrillLogEntry[], points: 0, ambiguous: 0, unparsed: 0 };
  if (rows.length === 0) return res;
  const h = headerRowIndex(rows);
  const H = (rows[h] ?? []).map(normHeader);

  const c = {
    date:   findCol(H, 'дата'),
    kato:   findCol(H, 'като'),
    uch:    findCol(H, 'участок'),
    len:    findCol(H, 'протяженность'),
    coords: findCol(H, 'координаты'),
    note:   findCol(H, 'примечание'),
    tech:   findCol(H, 'технология'),
    count:  findCol(H, 'количество'),
    oblast: findCol(H, 'область'),
  };

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const date = c.date >= 0 ? isoDate(r[c.date]) : '';
    const uchastok = c.uch >= 0 ? str(r[c.uch]) : '';
    const kato = c.kato >= 0 ? str(r[c.kato]) : '';
    if (!hasAnchor(date, uchastok, kato)) continue;

    const oblast = c.oblast >= 0 ? str(r[c.oblast]) : '';
    const rawCoords = c.coords >= 0 ? String(r[c.coords] ?? '') : '';
    const parsed = parseCoordBlob(rawCoords, hintForOblast(oblast));

    res.points += parsed.points.length;
    res.ambiguous += parsed.ambiguousCount;
    if (rawCoords.trim() && parsed.points.length === 0) res.unparsed++;

    const techRaw = c.tech >= 0 ? str(r[c.tech]).toUpperCase() : '';
    const drillKind: DrillKind = techRaw.includes('ГНП') ? 'ГНП' : 'ГНБ';

    res.list.push({
      kind: 'drill',
      id: `d-${kato || 'nokato'}-${date || 'nodate'}-${i}`,
      date, smu: '', oblast,
      uchastok, kato,
      drillKind,
      meters: c.len >= 0 ? km2m(r[c.len]) : 0,
      count: c.count >= 0 ? num(r[c.count]) : 0,
      points: parsed.points,
      note: c.note >= 0 ? str(r[c.note]) || undefined : undefined,
      rawCoords: rawCoords.trim() || undefined,
      createdAt: now, updatedAt: now, sync: 'local',
    });
  }
  return res;
}

// ── Точка входа ──────────────────────────────────────────────────────────────

export async function parseJournalBuffer(buf: ArrayBuffer): Promise<JournalImportResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const now = new Date().toISOString();
  const names = wb.SheetNames;
  const warnings: string[] = [];

  const readSheet = (want: string): Row[] => {
    const name = sheetByName(names, want);
    if (!name) { warnings.push(`Лист «${want}» не найден — пропущен`); return []; }
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as Row[];
  };

  const orders = parseOrders(readSheet('Все СНП заказа'));
  const ground = parseGround(readSheet('DATA'), now);
  const aerial = parseAerial(readSheet('DATA ПОДВЕС'), now);
  const drillRes = parseDrills(readSheet('ГНБ Журнал'), now);

  return {
    orders, ground, aerial, drills: drillRes.list,
    stats: {
      sheets: names,
      orderRows: orders.length,
      groundRows: ground.length,
      aerialRows: aerial.length,
      drillRows: drillRes.list.length,
      drillPoints: drillRes.points,
      drillAmbiguous: drillRes.ambiguous,
      drillUnparsed: drillRes.unparsed,
    },
    warnings,
  };
}

export async function importJournal(file: File): Promise<JournalImportResult> {
  return parseJournalBuffer(await file.arrayBuffer());
}
