import {
  DailyWorkEntry, MaterialKind, MATERIAL_KINDS, MATERIAL_UNIT,
} from '@/types/construction';
import { entryMeters } from './entriesTable';

/**
 * Расход материала против нормы.
 *
 * Перерасход замечают на складе, когда материал кончился раньше срока —
 * то есть тогда, когда сделать уже ничего нельзя. А видно его заранее:
 * трубы уходит примерно столько же, сколько метров траншеи, ленты — на
 * длину траншеи, фитингов — по числу стыков. Расхождение в полтора раза
 * означает либо потери, либо ошибку в записи, и оба случая надо ловить
 * в тот же месяц.
 *
 * Нормы здесь — не приказ, а ориентир: их правят под свой объект, и
 * система нигде не утверждает, что знает правильную цифру.
 */

export interface MaterialNorm {
  /** Сколько единиц материала на один метр трассы. */
  perMeter: number;
  /** Пояснение — откуда взялась цифра. */
  why: string;
}

export const MATERIAL_NORMS: Partial<Record<MaterialKind, MaterialNorm>> = {
  'МКТ': { perMeter: 1.02, why: 'труба идёт по траншее плюс провис и заводки' },
  'Лента': { perMeter: 1.0, why: 'сигнальная лента на всю длину траншеи' },
  'ПЭТ': { perMeter: 0.05, why: 'защита только на переходах' },
  'ФИТИНГ': { perMeter: 1 / 1000, why: 'стык примерно на каждую тысячу метров' },
  'Муфта': { perMeter: 1 / 2000, why: 'муфта примерно на два километра' },
  'КОД': { perMeter: 1 / 1000, why: 'комплект на строительную длину' },
};

export interface OveruseRow {
  material: MaterialKind;
  unit: 'м' | 'шт';
  /** Сколько списали по журналу. */
  used: number;
  /** Сколько должно было уйти по норме. */
  expected: number;
  /** Разница: плюс — ушло больше нормы. */
  diff: number;
  /** Во сколько раз больше нормы: 1,5 — в полтора. */
  ratio: number;
  norm: MaterialNorm;
}

export interface OveruseOptions {
  from?: string;
  to?: string;
  /** С какого расхождения считать это новостью. */
  tolerance?: number;
  /** Свои нормы вместо умолчаний. */
  norms?: Partial<Record<MaterialKind, MaterialNorm>>;
}

/**
 * Где ушло больше нормы.
 *
 * Считаем по метрам той же выборки, в которой списывали материал: делить
 * расход за июль на длину всей трассы бессмысленно.
 */
export function materialOveruse(
  rows: DailyWorkEntry[],
  opts: OveruseOptions = {},
): OveruseRow[] {
  const list = rows.filter((e) => {
    if (opts.from && (e.date || '') < opts.from) return false;
    if (opts.to && (e.date || '') > opts.to) return false;
    return true;
  });

  const meters = list.reduce((s, e) => s + entryMeters(e), 0);
  if (meters <= 0) return [];

  const norms = { ...MATERIAL_NORMS, ...(opts.norms ?? {}) };
  const tolerance = opts.tolerance ?? 0.15;

  const out: OveruseRow[] = [];
  for (const m of MATERIAL_KINDS) {
    const norm = norms[m];
    if (!norm || norm.perMeter <= 0) continue;
    const used = list.reduce((s, e) => s + (e.materials[m] ?? 0), 0);
    if (used <= 0) continue;
    const expected = meters * norm.perMeter;
    const ratio = expected > 0 ? used / expected : 0;
    if (Math.abs(ratio - 1) < tolerance) continue;
    out.push({
      material: m,
      unit: MATERIAL_UNIT[m],
      used,
      expected,
      diff: used - expected,
      ratio,
      norm,
    });
  }
  return out.sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1));
}

/** Строка для карточки: «МКТ: 4 200 м при норме 3 060 м — в 1,4 раза». */
export function overuseText(r: OveruseRow): string {
  const n = (v: number) => Math.round(v).toLocaleString('ru');
  const times = r.ratio.toFixed(2).replace('.', ',');
  return `${r.material}: ${n(r.used)} ${r.unit} при норме ${n(r.expected)} ${r.unit}`
    + ` — ${r.ratio > 1 ? `в ${times} раза больше` : `в ${(1 / r.ratio).toFixed(2).replace('.', ',')} раза меньше`}`;
}

// ── Заявки на материал ───────────────────────────────────────────────────────

export type RequestStatus = 'открыта' | 'отгружена' | 'закрыта' | 'отклонена';

export const REQUEST_STATUS_LIST: RequestStatus[] = [
  'открыта', 'отгружена', 'закрыта', 'отклонена',
];

/**
 * Заявка на материал.
 *
 * Сейчас её передают голосом: бригадир звонит снабженцу, снабженец
 * записывает на листке. Через неделю никто не помнит, просили трубу или
 * ленту, и сколько. Заявка — это та же запись, только у неё есть
 * состояние.
 */
export interface MaterialRequest {
  id: string;
  date: string;
  material: MaterialKind;
  qty: number;
  /** Куда везти. */
  uchastok?: string;
  oblast?: string;
  /** Кто просит. */
  crew?: string;
  author?: string;
  status: RequestStatus;
  /** Когда нужно — по этому и торопят. */
  needBy?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  sync?: 'local' | 'synced';
}

/** Заявки, о которых пора напомнить: срок подошёл, а материал не отгружен. */
export function overdueRequests(
  list: MaterialRequest[],
  today = new Date().toISOString().slice(0, 10),
): MaterialRequest[] {
  return list
    .filter((r) => r.status === 'открыта' && !!r.needBy && r.needBy <= today)
    .sort((a, b) => (a.needBy || '').localeCompare(b.needBy || ''));
}

/** Сколько всего ждут по открытым заявкам — по материалам. */
export function requestedTotals(list: MaterialRequest[]): Map<MaterialKind, number> {
  const out = new Map<MaterialKind, number>();
  for (const r of list) {
    if (r.status !== 'открыта' && r.status !== 'отгружена') continue;
    out.set(r.material, (out.get(r.material) ?? 0) + Math.max(0, r.qty));
  }
  return out;
}
