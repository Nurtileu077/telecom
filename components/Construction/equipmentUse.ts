import type { DailyWorkEntry, DrillLogEntry } from '@/types/construction';
import { entryMeters } from './entriesTable';

/**
 * Техника: где была, сколько отработала и чем это кончилось.
 *
 * В дневном отчёте техника уже перечислена — её пишут каждую смену. Но
 * спрашивают о ней иначе: «где сейчас второй кабелеукладчик», «сколько
 * простояла установка», «почему на Щучинске неделю нет ГНБ». Ответы
 * складываются из тех же строк, просто с другой стороны.
 *
 * Моточасов в журнале нет и не будет — их никто не пишет. Поэтому
 * считаем сменами: это то, что действительно записано, и врать оно не
 * может.
 */

export interface EquipmentUse {
  name: string;
  /** Смен, в которых техника выходила. */
  shifts: number;
  /** Смен, в которых её записали как невышедшую, и почему. */
  offShifts: number;
  offReasons: string[];
  /** Метры смен, в которых она участвовала. */
  meters: number;
  /** Где была в последний раз. */
  lastUchastok?: string;
  lastDate?: string;
  /** Кто ею работал. */
  contractors: string[];
}

export interface UsePeriod {
  from?: string;
  to?: string;
}

function inPeriod(e: DailyWorkEntry, p: UsePeriod): boolean {
  if (p.from && (e.date || '') < p.from) return false;
  if (p.to && (e.date || '') > p.to) return false;
  return true;
}

/**
 * Наработка по технике.
 *
 * «Не вышла» считаем отдельно от «не упоминалась»: молчание — это не
 * простой, а отсутствие записи, и путать их нельзя.
 */
export function equipmentUse(rows: DailyWorkEntry[], period: UsePeriod = {}): EquipmentUse[] {
  const acc = new Map<string, EquipmentUse>();
  const take = (name: string): EquipmentUse => {
    const found = acc.get(name);
    if (found) return found;
    const fresh: EquipmentUse = {
      name, shifts: 0, offShifts: 0, offReasons: [], meters: 0, contractors: [],
    };
    acc.set(name, fresh);
    return fresh;
  };

  for (const e of rows) {
    if (!inPeriod(e, period)) continue;
    const meters = entryMeters(e);

    for (const [name, count] of Object.entries(e.equipment ?? {})) {
      if (!name.trim() || (count ?? 0) <= 0) continue;
      const u = take(name.trim());
      u.shifts += 1;
      u.meters += meters;
      if (e.contractor && !u.contractors.includes(e.contractor)) u.contractors.push(e.contractor);
      if (!u.lastDate || (e.date || '') > u.lastDate) {
        u.lastDate = e.date;
        u.lastUchastok = e.uchastok;
      }
    }

    for (const [name, why] of Object.entries(e.equipmentOff ?? {})) {
      if (!name.trim()) continue;
      const u = take(name.trim());
      u.offShifts += 1;
      const reason = (why || '').trim();
      if (reason && !u.offReasons.includes(reason)) u.offReasons.push(reason);
    }
  }

  return [...acc.values()].sort((a, b) => b.shifts - a.shifts
    || a.name.localeCompare(b.name, 'ru'));
}

/** Доля смен, которые техника простояла: по ней и разговаривают с подрядчиком. */
export function idleShare(u: EquipmentUse): number {
  const total = u.shifts + u.offShifts;
  return total > 0 ? u.offShifts / total : 0;
}

// ── Топливо ──────────────────────────────────────────────────────────────────

export interface FuelNorm {
  /** Литров на смену — так его и списывают. */
  perShift: number;
  why: string;
}

/**
 * Нормы расхода.
 *
 * Это ориентир, а не приказ: расход зависит от грунта, возраста машины и
 * того, кто за рычагами. Нужен он для одного — заметить, что списали
 * вдвое больше, чем обычно.
 */
export const FUEL_NORMS: Record<string, FuelNorm> = {
  'Кабелеукладчик': { perShift: 120, why: 'полная смена с тяговой лебёдкой' },
  'Экскаватор': { perShift: 90, why: 'смена на траншее' },
  'Бар': { perShift: 110, why: 'баровая машина по мёрзлому грунту' },
  'ГНБ': { perShift: 140, why: 'установка с буровым раствором' },
  'Манипулятор': { perShift: 45, why: 'подвоз и разгрузка' },
  'Самосвал': { perShift: 60, why: 'подвоз песка' },
};

export interface FuelLine {
  name: string;
  shifts: number;
  /** Сколько должно уйти по норме. */
  expectedL: number;
  norm?: FuelNorm;
}

/**
 * Сколько топлива нужно на эти смены.
 *
 * Фактическую заправку журнал не знает — её ведут в путевых листах.
 * Поэтому не сравниваем, а считаем потребность: с ней приходят к
 * снабжению, и она уже не по памяти.
 */
export function fuelNeed(use: EquipmentUse[], norms = FUEL_NORMS): FuelLine[] {
  return use.map((u) => {
    // Название в отчёте пишут по-разному: «ГНБ», «ГНБ-2», «гнб вермеер».
    const key = Object.keys(norms).find(
      (n) => u.name.toLowerCase().startsWith(n.toLowerCase()),
    );
    const norm = key ? norms[key] : undefined;
    return {
      name: u.name,
      shifts: u.shifts,
      expectedL: norm ? norm.perShift * u.shifts : 0,
      norm,
    };
  }).sort((a, b) => b.expectedL - a.expectedL);
}

export function fuelTotal(lines: FuelLine[]): number {
  return lines.reduce((s, l) => s + l.expectedL, 0);
}

// ── График ГНБ ───────────────────────────────────────────────────────────────

export interface DrillSlot {
  date: string;
  uchastok: string;
  meters: number;
  count: number;
  contractor?: string;
}

export interface DrillQueue {
  /** Что уже сделано — по дням. */
  done: DrillSlot[];
  /** Участки, где ГНБ ждут: работы идут, а проколов нет. */
  waiting: { uchastok: string; sinceDate: string; days: number }[];
}

/**
 * Очередь на ГНБ.
 *
 * Установка одна, а переходов много, и кто когда её получит — решают
 * голосом. Видно при этом только то, где она уже была; где её ждут,
 * приходится держать в голове.
 */
export function drillQueue(
  drills: DrillLogEntry[],
  rows: DailyWorkEntry[],
  today = new Date().toISOString().slice(0, 10),
): DrillQueue {
  const done: DrillSlot[] = drills
    .filter((d) => !!d.date)
    .map((d) => ({
      date: d.date,
      uchastok: d.uchastok,
      meters: d.meters ?? 0,
      count: d.count ?? 1,
      contractor: d.contractor,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const lastDrill = new Map<string, string>();
  for (const d of done) {
    const key = d.uchastok.trim().toLowerCase();
    if (!lastDrill.has(key)) lastDrill.set(key, d.date);
  }

  // Участок ждёт ГНБ, если по нему идут работы, а проколов давно не было.
  const lastWork = new Map<string, { date: string; name: string }>();
  for (const e of rows) {
    if (!e.uchastok || !e.date) continue;
    const key = e.uchastok.trim().toLowerCase();
    const prev = lastWork.get(key);
    if (!prev || e.date > prev.date) lastWork.set(key, { date: e.date, name: e.uchastok });
  }

  const waiting: DrillQueue['waiting'] = [];
  for (const [key, work] of lastWork) {
    const drilled = lastDrill.get(key);
    const since = drilled && drilled > work.date ? drilled : work.date;
    const days = Math.round(
      (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${since}T00:00:00Z`).getTime())
      / 86_400_000,
    );
    if (!Number.isFinite(days) || days < 0) continue;
    waiting.push({ uchastok: work.name, sinceDate: since, days });
  }

  return {
    done,
    waiting: waiting.sort((a, b) => b.days - a.days),
  };
}
