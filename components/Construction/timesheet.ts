import type { DailyWorkEntry, Crew } from '@/types/construction';
import { normName } from './areaImport';
import { entryMeters } from './entriesTable';

/**
 * Табель: кто сколько отработал.
 *
 * Расчёт с бригадами идёт по сменам, а смены записаны по колоннам — не
 * по людям. Поэтому в конце месяца табель сводят вручную: открывают
 * журнал, считают строки, вспоминают, кто в какой колонне был. Половина
 * споров о деньгах начинается именно здесь.
 *
 * Состав колонны известен из её карточки, смены — из журнала. Свести их
 * можно и не переписывая ничего заново, если честно сказать, что состав
 * берётся сегодняшний: кто был в колонне в июле, журнал не помнит, и
 * выдумывать это нельзя.
 */

export interface TimesheetRow {
  /** Кто: фамилия из состава колонны. */
  name: string;
  role?: string;
  crew: string;
  contractor?: string;
  /** Сколько смен: строк журнала, где работала эта колонна. */
  shifts: number;
  /** Сколько дней — две смены в сутки это один день. */
  days: number;
  /** Метры колонны за период: на человека они не делятся. */
  crewMeters: number;
  /** Даты смен — по ним видно, где пропуски. */
  dates: string[];
}

export interface TimesheetTotals {
  people: number;
  shifts: number;
  meters: number;
}

function crewKey(name: string | undefined): string {
  return normName(name ?? '');
}

/**
 * Табель за период.
 *
 * Метры не делим на людей: колонна даёт метры вместе, и «по 120 м на
 * каждого» — цифра, которой нет смысла. Показываем выработку колонны
 * рядом с человеком, а делить её — дело расчёта, а не табеля.
 */
export function timesheet(
  rows: DailyWorkEntry[],
  crews: Crew[],
  opts: { from?: string; to?: string } = {},
): TimesheetRow[] {
  const inPeriod = rows.filter((e) => {
    if (opts.from && (e.date || '') < opts.from) return false;
    if (opts.to && (e.date || '') > opts.to) return false;
    return true;
  });

  const byCrew = new Map<string, { shifts: number; meters: number; dates: Set<string> }>();
  for (const e of inPeriod) {
    const key = crewKey(e.column);
    if (!key) continue;
    const acc = byCrew.get(key) ?? { shifts: 0, meters: 0, dates: new Set<string>() };
    acc.shifts += 1;
    acc.meters += entryMeters(e);
    if (e.date) acc.dates.add(e.date);
    byCrew.set(key, acc);
  }

  const out: TimesheetRow[] = [];
  for (const crew of crews) {
    const acc = byCrew.get(crewKey(crew.name));
    if (!acc || acc.shifts === 0) continue;
    // Выходные в табель не пишем: это состав на сегодня, а не график.
    for (const m of crew.members) {
      if (!m.name?.trim()) continue;
      out.push({
        name: m.name.trim(),
        role: m.role,
        crew: crew.name,
        contractor: crew.contractor,
        shifts: acc.shifts,
        days: acc.dates.size,
        crewMeters: acc.meters,
        dates: [...acc.dates].sort(),
      });
    }
  }

  return out.sort((a, b) => b.shifts - a.shifts
    || a.crew.localeCompare(b.crew, 'ru')
    || a.name.localeCompare(b.name, 'ru'));
}

/**
 * Колонны, у которых есть смены, но нет состава.
 *
 * Такие в табель не попадают вообще, и это надо назвать вслух: иначе
 * человек увидит неполный табель и решит, что данные потеряны.
 */
export function crewsWithoutMembers(
  rows: DailyWorkEntry[],
  crews: Crew[],
  opts: { from?: string; to?: string } = {},
): string[] {
  const known = new Map(crews.map((c) => [crewKey(c.name), c]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of rows) {
    if (opts.from && (e.date || '') < opts.from) continue;
    if (opts.to && (e.date || '') > opts.to) continue;
    const name = e.column?.trim();
    if (!name) continue;
    const key = crewKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const crew = known.get(key);
    if (!crew || crew.members.filter((m) => m.name?.trim()).length === 0) out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, 'ru'));
}

export function timesheetTotals(rows: TimesheetRow[]): TimesheetTotals {
  const crews = new Map<string, number>();
  for (const r of rows) crews.set(r.crew, r.crewMeters);
  return {
    people: new Set(rows.map((r) => `${r.crew}|${r.name}`)).size,
    shifts: rows.reduce((s, r) => s + r.shifts, 0),
    // Метры считаем по колоннам, а не по строкам табеля: иначе одна и
    // та же выработка сложится столько раз, сколько в колонне людей.
    meters: [...crews.values()].reduce((s, v) => s + v, 0),
  };
}

/** Табель текстом — его вставляют в письмо и в расчёт. */
export function timesheetToText(rows: TimesheetRow[]): string {
  const head = ['ФИО', 'Должность', 'Колонна', 'Подрядчик', 'Смен', 'Дней', 'Метры колонны'];
  const body = rows.map((r) => [
    r.name, r.role ?? '', r.crew, r.contractor ?? '',
    String(r.shifts), String(r.days), String(Math.round(r.crewMeters)),
  ].join('\t'));
  return [head.join('\t'), ...body].join('\n');
}
