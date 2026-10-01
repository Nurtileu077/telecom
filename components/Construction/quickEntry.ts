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
  /** Причина простоя — то, что в строке сказано про «почему не работали». */
  downtime?: string;
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

/**
 * Как в переписке говорят о простое.
 *
 * Целыми словами — то, что кусками сидит в других словах: «простой»
 * начинает «просто», «снег» — «Снегирёвку». Началами слов — то, что
 * склоняют: «дождь», «дождя», «после дождей». Сочетаниями — то, что по
 * отдельности ничего не значит: «нет» и «кабеля».
 */
const DOWNTIME_WORDS = new Set([
  'простой', 'простоя', 'простои', 'простоем', 'стояли', 'стоим', 'стоял', 'стояла',
  'снег', 'снега', 'снегом', 'снегопад', 'метель', 'метели', 'буран', 'бурана',
  'мороз', 'мороза', 'морозы', 'ветер', 'ветра', 'ветром', 'грязь', 'распутица',
  'ждали', 'ждем', 'ожидали', 'ожидание',
]);
const DOWNTIME_STEMS = ['дожд', 'ремонт', 'поломк', 'сломал'];
const DOWNTIME_PHRASES: string[][] = [
  ['нет', 'кабеля'], ['нет', 'трубы'], ['нет', 'мкт'], ['нет', 'материала'],
  ['нет', 'топлива'], ['нет', 'солярки'], ['нет', 'разрешения'], ['без', 'разрешения'],
  ['нет', 'согласования'], ['не', 'пускают'], ['не', 'пустили'], ['не', 'вышли'],
];
/** Ярлык перед причиной: «простой — дождь», «простой: ждём разрешения». */
const DOWNTIME_LABEL = new Set(['простой', 'простоя', 'простои']);
/** Слова, которые сами по себе причины не называют: «стояли весь день» — и всё. */
const DOWNTIME_GENERIC = new Set([...DOWNTIME_LABEL, 'стояли', 'стоим', 'весь', 'целый', 'день']);

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

  /**
   * «25.07» — это дата, а «1.5» в «1.5 км баром» — это длина. Отличить
   * их можно по соседям: за числом с точкой, если это длина, почти
   * всегда стоит единица измерения. Даты единицами не меряют.
   */
  for (let i = 0; i < ws.length; i += 1) {
    const d = dottedDate(ws[i], ws[i + 1], today);
    if (d) return d;
  }
  return undefined;
}

const LENGTH_UNITS = new Set(['м', 'метр', 'метра', 'метров', 'км', 'километр', 'километра', 'километров']);

function dottedDate(token: string, next: string | undefined, today: Date): string | undefined {
  const m = token.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (!m) return undefined;
  // Год написан — значит это точно дата, и единица после неё ничего не
  // меняет. Без года «1.5 км» надёжнее прочесть как полтора километра.
  if (!m[3] && next && LENGTH_UNITS.has(next)) return undefined;

  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = today.getUTCFullYear();
  if (m[3]) {
    const raw = Number(m[3]);
    year = raw < 100 ? 2000 + raw : raw;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  // 31 апреля не бывает: это опечатка, а не дата.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return d.toISOString().slice(0, 10);
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
    // «25.07 бар 480»: дата стоит перед словом и выглядит числом. Взять
    // её за метры значит записать смену в 25 метров и потерять
    // настоящие 480.
    if (/^\d{1,2}[./]\d{1,2}([./]\d{2,4})?$/.test(s)) return undefined;
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

/** «25.07», «25.07.26», «2026-07-25», «вчера» — дата, а не число и не причина. */
function isDateWord(w: string): boolean {
  return /^\d{1,2}[./]\d{1,2}([./]\d{2,4})?$/.test(w) || /^20\d{2}-\d{2}-\d{2}$/.test(w)
    || w === 'сегодня' || w === 'вчера' || w === 'позавчера';
}

/** Слова с сохранённым регистром — причину показываем так, как написали. */
function rawWords(s: string): string[] {
  return s.split(/[^0-9a-zа-яё/.\-,]+/i)
    .map((w) => w.replace(/^[.,/-]+/, '').replace(/[.,/-]+$/, ''))
    .filter(Boolean);
}

const lowWord = (w: string) => w.toLowerCase().replace(/ё/g, 'е');

function downtimeAt(low: string[], i: number): boolean {
  const w = low[i];
  if (DOWNTIME_WORDS.has(w)) return true;
  if (DOWNTIME_STEMS.some((s) => w.startsWith(s))) return true;
  return DOWNTIME_PHRASES.some((p) => p.every((x, k) => low[i + k] === x));
}

const WORK_WORDS = new Set([
  ...METHOD_WORDS.flatMap(([, list]) => list), ...DRILL_WORDS, ...BLOW_WORDS, ...LENGTH_UNITS,
]);

/**
 * Убрать название из слов куска — по словам, а не по буквам: тире,
 * двойной пробел, регистр и «ё» в названии участка набирают как придётся.
 */
function cutName(ws: string[], name: string | undefined): string[] {
  const target = rawWords(name ?? '').map(lowWord);
  if (target.length === 0) return ws;
  const low = ws.map(lowWord);
  for (let i = 0; i + target.length <= low.length; i += 1) {
    if (target.every((t, k) => low[i + k] === t)) {
      return [...ws.slice(0, i), ...ws.slice(i + target.length)];
    }
  }
  return ws;
}

/**
 * Причина простоя из строки.
 *
 * «25.07 Дозер, Зеренда — Серафимовка, дождь, простой» — причина здесь
 * «дождь», а не вся строка: дата, бригада и участок — это «когда», «кто»
 * и «где», и в отчёте «простои: дождь — 3 дн» они лишние. Берём куски
 * между запятыми, где сказано про простой, и вынимаем из них названия,
 * дату и метры с видом работ. Голое «простой» причиной не считаем, если
 * рядом названа настоящая; если не названа — так и пишем: «простой».
 */
export function downtimeOf(raw: string, known: (string | undefined)[] = []): string | undefined {
  const parts: string[] = [];
  let said = false;
  for (const clause of raw.split(/[,;\n]+|\.(?=\s|$)/)) {
    let ws = rawWords(clause.replace(/сму[\s-]?\d/i, ' '))
      .filter((w) => !isDateWord(lowWord(w)));
    // Длинные названия первыми: «Зеренда — Серафимовка» целиком, а не «Зеренда».
    for (const name of [...known].sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))) {
      ws = cutName(ws, name);
    }
    const low = ws.map(lowWord);
    const hit = low.findIndex((_, i) => downtimeAt(low, i));
    if (hit < 0) continue;
    said = true;

    // Метры с видом работ — выработка, а не причина: «480 баром дождь
    // после обеда» — причина «дождь после обеда».
    let from = 0;
    let to = ws.length;
    const nums = low.map((w, i) => (/^\d+([.,]\d+)?(м|км)?$/.test(w) ? i : -1)).filter((i) => i >= 0);
    if (nums.length) {
      let a = nums[0];
      let b = nums[nums.length - 1];
      while (a > 0 && WORK_WORDS.has(low[a - 1])) a -= 1;
      while (b < low.length - 1 && WORK_WORDS.has(low[b + 1])) b += 1;
      if (hit > b) from = b + 1;
      else if (hit < a) to = a;
    }
    let piece = ws.slice(from, to);
    // «Простой — дождь»: ярлык перед причиной ничего не добавляет.
    let lead = 0;
    while (lead < piece.length - 1 && DOWNTIME_LABEL.has(lowWord(piece[lead]))) lead += 1;
    piece = piece.slice(lead);
    if (piece.every((w) => DOWNTIME_GENERIC.has(lowWord(w)))) continue;
    parts.push(piece.join(' '));
  }
  if (parts.length) return parts.join(', ');
  return said ? 'простой' : undefined;
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
  // Дату за такое число не считаем: «25.07 дождь» — понятная строка.
  const anyMeters = Object.keys(out.byMethod).length > 0
    || out.drillM !== undefined || out.blowingM !== undefined;
  if (!anyMeters && tokens.some((w) => /\d{2,}/.test(w) && !isDateWord(w))) {
    out.leftover.push('число есть, но неясно, каким способом');
  }
  if (!out.uchastok && ctx.uchastki?.length) out.leftover.push('участок');
  if (!out.date) out.leftover.push('дата');

  const downtime = downtimeOf(raw, [out.uchastok, out.contractor, out.column]);
  if (downtime) {
    out.downtime = downtime;
    // Строка целиком остаётся в примечании: в причине — суть, а как это
    // сказали на объекте, пусть будет видно.
    out.note = raw;
    out.matched.push(`простой: ${downtime}`);
  }

  return out;
}

/**
 * Можно ли уже сохранять: нужен участок и либо выработка, либо причина
 * простоя. Дождь — тоже день стройки, и строкой его сдать должно быть
 * так же просто, как метры.
 */
export function quickEntryReady(p: QuickParse): boolean {
  const meters = Object.values(p.byMethod).reduce((s, v) => s + (v ?? 0), 0);
  return !!p.uchastok && (meters > 0 || (p.drillM ?? 0) > 0 || (p.blowingM ?? 0) > 0
    || !!p.downtime?.trim());
}

/** Все способы, которые нашлись, — в том порядке, в каком их считают. */
export function parsedMethods(p: QuickParse): LayMethod[] {
  return LAY_METHODS.filter((m) => (p.byMethod[m] ?? 0) > 0);
}
