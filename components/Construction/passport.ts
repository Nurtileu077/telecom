import {
  SiteObject, SpliceRecord, FiberSplice, SPLICE_LOSS_LIMIT_DB, badSplices,
} from '@/types/construction';

/**
 * Паспорт сети — Слой 3, «как построено».
 *
 * Стройка кончается, а сеть остаётся. Через три года на неё приедет
 * аварийная бригада, и вопросы у неё будут другие: что это за муфта, с
 * какой стороны в неё приходит свет, сколько волокон занято и куда они
 * уходят, на какой глубине лежит труба. Ни один из этих вопросов не
 * задают на стройке, и ни на один из них дневной отчёт не отвечает.
 *
 * Поэтому паспорт собирается не из отчётов, а из объектов и протоколов
 * сварки: муфта с её кабелем и волокнами, протокол с затуханием по
 * каждому стыку. То, чего не записали, здесь так и остаётся пустым —
 * выдуманный паспорт хуже отсутствующего: по нему поедут искать.
 */

export interface FiberRow {
  fiber: number;
  /** Куда заведено — из паспорта муфты или из протокола сварки. */
  to?: string;
  lossDb?: number;
  /** Затухание выше нормы. */
  bad?: boolean;
}

export interface MuftaPassport {
  object: SiteObject;
  /** Последний протокол сварки по этой муфте. */
  splice?: SpliceRecord;
  /** Все протоколы — муфту могут переваривать. */
  splices: SpliceRecord[];
  fibers: FiberRow[];
  /** Сколько волокон занято из скольких. */
  usedFibers: number;
  totalFibers: number;
  /** Стыки выше нормы. */
  bad: FiberSplice[];
  /** Чего не хватает, чтобы паспорт был полным. */
  missing: string[];
}

/** Волокна муфты: из её собственной разметки и из протокола сварки. */
export function fiberRows(o: SiteObject, splice?: SpliceRecord): FiberRow[] {
  const byFiber = new Map<number, FiberRow>();

  for (const [k, to] of Object.entries(o.fiberUse ?? {})) {
    const n = Number(k);
    if (!Number.isFinite(n)) continue;
    byFiber.set(n, { fiber: n, to: to || undefined });
  }
  for (const f of splice?.fibers ?? []) {
    const prev = byFiber.get(f.fiber);
    byFiber.set(f.fiber, {
      fiber: f.fiber,
      to: f.to || prev?.to,
      lossDb: f.lossDb,
      bad: f.lossDb !== undefined && f.lossDb > SPLICE_LOSS_LIMIT_DB,
    });
  }
  return [...byFiber.values()].sort((a, b) => a.fiber - b.fiber);
}

/**
 * Чего не хватает паспорту.
 *
 * Список короткий и по делу: это то, за чем придётся ехать обратно, если
 * не записать сейчас. Молчать об этом — значит обнаружить пропуск через
 * три года, когда спросят.
 */
export function missingFields(o: SiteObject, splice?: SpliceRecord): string[] {
  const out: string[] = [];
  if (!o.cable) out.push('тип кабеля');
  if (!o.fibers) out.push('число волокон');
  if (!o.feedFrom && !o.feedTo) out.push('откуда и куда питается');
  if (o.kind === 'mufta' && o.state === 'spliced' && !splice) out.push('протокол сварки');
  if (!o.depthM) out.push('глубина заложения');
  return out;
}

export function muftaPassport(o: SiteObject, splices: SpliceRecord[]): MuftaPassport {
  const mine = splices
    .filter((s) => s.objectId === o.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const last = mine[0];
  const fibers = fiberRows(o, last);
  return {
    object: o,
    splice: last,
    splices: mine,
    fibers,
    usedFibers: fibers.filter((f) => f.to || f.lossDb !== undefined).length,
    totalFibers: o.fibers ?? fibers.length,
    bad: last ? badSplices(last) : [],
    missing: missingFields(o, last),
  };
}

export function passports(objects: SiteObject[], splices: SpliceRecord[]): MuftaPassport[] {
  return objects
    .filter((o) => o.kind === 'mufta' || o.kind === 'endpoint')
    .map((o) => muftaPassport(o, splices))
    // Сначала то, где чего-то не хватает: паспорт нужен полным, а не длинным.
    .sort((a, b) => b.missing.length - a.missing.length
      || (a.object.name ?? '').localeCompare(b.object.name ?? '', 'ru'));
}

export interface PassportSummary {
  muftas: number;
  spliced: number;
  endpoints: number;
  /** Сколько объектов с неполным паспортом. */
  incomplete: number;
  /** Сколько стыков выше нормы. */
  badSplices: number;
  fibersUsed: number;
}

export function passportSummary(rows: MuftaPassport[]): PassportSummary {
  let muftas = 0; let spliced = 0; let endpoints = 0;
  let incomplete = 0; let bad = 0; let fibersUsed = 0;
  for (const r of rows) {
    if (r.object.kind === 'mufta') {
      muftas += 1;
      if (r.object.state === 'spliced') spliced += 1;
    }
    if (r.object.kind === 'endpoint') endpoints += 1;
    if (r.missing.length > 0) incomplete += 1;
    bad += r.bad.length;
    fibersUsed += r.usedFibers;
  }
  return { muftas, spliced, endpoints, incomplete, badSplices: bad, fibersUsed };
}
