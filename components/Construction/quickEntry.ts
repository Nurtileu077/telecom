import {
  LayMethod, LAY_METHODS, WorkTech, WORK_TECHS,
} from '@/types/construction';
import { normName } from './areaImport';

/**
 * Смена одной строкой.
 *
 * Отчёт с объекта приходит текстом: «25.07 Дозер 480 м кабелеукладчик,
 * Зеренда — Серафимовка, ГНБ 72». Его переписывают в форму руками —
 * десять полей ради одной строки, которую человек уже написал. А форму
 * на морозе в перчатках не заполняют вовсе: пишут в чат.
 *
 * Здесь строка разбирается на поля. Что не разобралось — называется
 * прямо: угадывать молча хуже, чем не угадать.
 */

export interface QuickParse {
  date?: string;
  contractor?: string;
  column?: string;
  smu?: string;
  uchastok?: string;
  tech?: WorkTech;
  byMethod: Partial<Record<LayMethod, number>>;
  drillM?: number;
  drillCount?: number;
  blowingM?: number;
  note?: string;
  /** Что именно поняли — чтобы показать человеку до сохранения. */
  matched: string[];
  /** Куски, оставшиеся без смысла. */
  leftover: string[];
}

export interface QuickContext {
  /** Известные подрядчики — их имена в тексте и ищем. */
  contractors?: string[];
  /** Известные участки: названия из журнала и из KML. */
  uchastki?: string[];
  /** Колонны и бригады. */
  columns?: string[];
  /** От какой даты считать «вчера». */
  today?: Date;
}

/** Слова, которыми называют способ прокладки в переписке. */
const METHOD_WORDS: [LayMethod, string[]][] = [
  ['кабелеукладчик', ['кабелеукладчик', 'кабелеукладчиком', 'ку', 'плуг']],
  ['экскаватор', ['экскаватор', 'экскаватором', 'мех', 'механизированно', 'траншея']],
  ['сущ_канализация', ['канализация', 'канализации', 'колодцы', 'колодцам', 'кск', 'тк']],
  ['бар', ['бар', 'баром', 'баровой', 'баровая']],
  ['вручную', ['вручную', 'ручной', 'ручным', 'лопата', 'лопатой', 'кирка']],
];

const DRILL_WORDS = ['гнб', 'гнп', 'прокол', 'прокола', 'проколов', 'бурение'];
const BLOW_WORDS = ['задувка', 'задули', 'задув', 'продувка'];
const DOWNTIME_HINTS = ['простой', 'стояли', 'дождь', 'ремонт', 'нет кабеля', 'не пускают'];

/**
 * Слова строки.
 *
 * Точку и запятую внутри слова оставляем — «25.07» одно слово, — а по
 * краям срезаем: иначе «кабелеукладчик,» не совпадёт ни с чем.
 */
function words(s: string): string[] {
  return s.toLowerCase().replace(/ё/g, 'е')
    .split(/[^0-9a-zа-я/.\-,]+/)
    .map((w) => w.replace(/^[.,/-]+/, '').replace(/[.,/-]+$/, ''))
    .filter(Boolean);
}

/**
 * Границы слова (\b) в JavaScript считаются только по латинице, поэтому
 * «\bвчера\b» не найдёт «вчера» никогда. Ищем среди слов.
 */
function hasWord(list: string[], word: string): boolean {
  return list.includes(word);
}

/**
 * Дата из строки.
 *
 * В переписке её пишут коротко — «25.07», «25.07.26», «вчера». Год без
 * подсказки не угадать, поэтому берём текущий: отчёт приходит в тот же
 * сезон, в котором его пишут.
 */
export function parseDate(text: string, today = new Date()): string | undefined {
  const t = text.toLowerCase();
  const ws = words(text);

  const shifted = (days: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  if (hasWord(ws, 'сегодня')) return shifted(0);
  if (hasWord(ws, 'вчера')) return shifted(1);
  if (hasWord(ws, 'позавчера')) return shifted(2);

  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dotted = t.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;
    let year = today.getUTCFullYear();
    if (dotted[3]) {
      const raw = Number(dotted[3]);
      year = raw < 100 ? 2000 + raw : raw;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return undefined;
}

function findKnown(text: string, list: string[] | undefined): string | undefined {
  if (!list || list.length === 0) return undefined;
  const t = normName(text);
  // Длинные названия сначала: «Зеренда — Серафимовка» важнее «Зеренда».
  const sorted = [...list].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const item of sorted) {
    const key = normName(item);
    if (key.length >= 3 && t.includes(key)) return item;
  }
  return undefined;
}

/** Число перед словом или после него: «480 м бар» и «бар 480». */
function numberNear(tokens: string[], at: number): number | undefined {
  const asNum = (s: string | undefined): number | undefined => {
    if (!s) return undefined;
    const v = Number(s.replace(',', '.').replace(/м$/, ''));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  // «480 м бар»: между числом и словом стоит единица измерения.
  for (const back of [1, 2]) {
    const v = asNum(tokens[at - back]);
    if (v !== undefined) return v;
    if (tokens[at - back] !== 'м' && tokens[at - back] !== 'метров') break;
  }
  for (const fwd of [1, 2]) {
    const v = asNum(tokens[at + fwd]);
    if (v !== undefined) return v;
    if (tokens[at + fwd] !== 'м' && tokens[at + fwd] !== 'метров') break;
  }
  return undefined;
}

export function parseQuickEntry(text: string, ctx: QuickContext = {}): QuickParse {
  const raw = (text ?? '').trim();
  const out: QuickParse = { byMethod: {}, matched: [], leftover: [] };
  if (!raw) return out;

  const tokens = words(raw);

  const date = parseDate(raw, ctx.today ?? new Date());
  if (date) {
    out.date = date;
    out.matched.push(`дата ${new Date(`${date}T00:00:00Z`).toLocaleDateString('ru')}`);
  }

  const smu = raw.match(/сму[\s-]?(\d)/i);
  if (smu) {
    out.smu = `СМУ-${smu[1]}`;
    out.matched.push(out.smu);
  }

  const contractor = findKnown(raw, ctx.contractors);
  if (contractor) {
    out.contractor = contractor;
    out.matched.push(contractor);
  }

  const column = findKnown(raw, ctx.columns);
  if (column) {
    out.column = column;
    out.matched.push(column);
  }

  const uchastok = findKnown(raw, ctx.uchastki);
  if (uchastok) {
    out.uchastok = uchastok;
    out.matched.push(uchastok);
  }

  for (const [method, list] of METHOD_WORDS) {
    const at = tokens.findIndex((w) => list.includes(w));
    if (at < 0) continue;
    const meters = numberNear(tokens, at);
    if (meters === undefined) continue;
    out.byMethod[method] = Math.round(meters);
    out.matched.push(`${Math.round(meters)} м — ${method.replace('_', ' ')}`);
  }

  const drillAt = tokens.findIndex((w) => DRILL_WORDS.includes(w));
  if (drillAt >= 0) {
    const meters = numberNear(tokens, drillAt);
    if (meters !== undefined) {
      out.drillM = Math.round(meters);
      out.drillCount = 1;
      out.matched.push(`ГНБ ${Math.round(meters)} м`);
    }
  }

  const blowAt = tokens.findIndex((w) => BLOW_WORDS.includes(w));
  if (blowAt >= 0) {
    const meters = numberNear(tokens, blowAt);
    if (meters !== undefined) {
      out.blowingM = Math.round(meters);
      out.matched.push(`задувка ${Math.round(meters)} м`);
    }
  }

  const tech = WORK_TECHS.find((w) => hasWord(tokens, w.toLowerCase()));
  if (tech) {
    out.tech = tech;
    out.matched.push(tech);
  }

  // Числа без способа — самая частая ошибка разбора. Если метров нигде
  // не нашлось, а число в строке есть, честно говорим, что не поняли.
  const anyMeters = Object.keys(out.byMethod).length > 0
    || out.drillM !== undefined || out.blowingM !== undefined;
  if (!anyMeters && /\d{2,}/.test(raw)) {
    out.leftover.push('число есть, но неясно, каким способом');
  }
  if (!out.uchastok && ctx.uchastki?.length) out.leftover.push('участок');
  if (!out.date) out.leftover.push('дата');

  const hint = DOWNTIME_HINTS.find((h) => raw.toLowerCase().includes(h));
  if (hint) out.note = raw;

  return out;
}

/** Можно ли уже сохранять: без метров и участка запись бессмысленна. */
export function quickEntryReady(p: QuickParse): boolean {
  const meters = Object.values(p.byMethod).reduce((s, v) => s + (v ?? 0), 0);
  return !!p.uchastok && (meters > 0 || (p.drillM ?? 0) > 0 || (p.blowingM ?? 0) > 0);
}

/** Все способы, которые нашлись, — в том порядке, в каком их считают. */
export function parsedMethods(p: QuickParse): LayMethod[] {
  return LAY_METHODS.filter((m) => (p.byMethod[m] ?? 0) > 0);
}
