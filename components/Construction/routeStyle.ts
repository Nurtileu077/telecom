import {
  PlanRoute, SnpProgress, SnpStage, SNP_STAGES, MapArea,
} from '@/types/construction';
import { stageStatus } from './stageTasks';
import { normName, PLACE_PREFIX } from './areaImport';
import { effectiveProgress, type DeriveContext } from './stageDerive';

/**
 * Как выглядит трасса на карте.
 *
 * Тонкая синяя говорит «так задумано», толстая цветная — «так лежит».
 * Пока по участку не было ни одной записи, трасса остаётся синей: это
 * ещё проект. Появились метры — линия толстеет и красится по тому, как
 * далеко зашли: труба проложена — один цвет, кабель задут — другой.
 *
 * Название разбирается на «откуда — куда»: в файле так и подписано —
 * «Шортанды Камышенка», «Путь до Школы». Читать это человеку понятнее,
 * чем «Трасса 137».
 */

/** Цвет по самому дальнему пройденному этапу. */
export const STAGE_LINE_COLOR: Record<SnpStage, string> = {
  mkt: '#fbbf24',      // труба проложена
  gnb: '#fbbf24',      // проколы идут по той же трубе
  zaduvka: '#38bdf8',  // кабель задут
  podves: '#a78bfa',   // подвес
  svarka: '#4ade80',   // сварено
  sdacha: '#2dd4bf',   // сдано
};

/**
 * Ещё не начинали — это проект, а не факт.
 *
 * Серый пунктир читался как обводка района: на спутнике серые штрихи —
 * это граница, а не трасса. Синий отличается и от контуров, и от цветов
 * этапов: янтарная труба, голубая задувка, фиолетовый подвес — все они
 * светлее и в другую сторону.
 */
export const PLAN_LINE_COLOR = '#3b82f6';

export interface RouteView {
  id: string;
  name: string;
  coords: [number, number][];
  lengthM: number;
  source: string;
  /** Откуда и куда — разобрано из названия. */
  from?: string;
  to?: string;
  /** Связанный населённый пункт, если название удалось узнать. */
  kato?: string;
  snp?: string;
  /** Самый дальний этап, до которого дошли. null — работ не было. */
  stage: SnpStage | null;
  color: string;
  /** true — проект: тонкая синяя. false — построено: толстая цветная. */
  dashed: boolean;
  /** Счёт с другого конца, чем в файле. */
  reversed?: boolean;
  /** Подписи концов поставлены наоборот названию. */
  endsSwapped?: boolean;
  /** Село, в обводке которого лежит первая точка линии, — по контурам из KML. */
  startIn?: string;
  /** То же для последней точки. */
  endIn?: string;
}

/**
 * Самый дальний пройденный этап.
 *
 * Именно он задаёт цвет: если кабель уже задут, линия должна быть цветом
 * задувки, даже когда следующий этап ещё не начат.
 */
export function furthestStage(p: SnpProgress): SnpStage | null {
  let last: SnpStage | null = null;
  for (const s of SNP_STAGES) {
    const st = stageStatus(p, s);
    if (st === 'done' || st === 'in_progress') last = s;
  }
  return last;
}

/** Слова, которые в названии трассы не являются именем места. */
const STOP_WORDS = new Set([
  'путь', 'дорога', 'до', 'от', 'к', 'по', 'как', 'на', 'акте', 'акту',
  'альтернативный', 'альтернатива', 'связи', 'с', 'в', 'и', 'без', 'названия',
  'существующий', 'сущ', 'трасса', 'участок', 'новый', 'новая',
]);

/**
 * Концы, которые не село, но тоже место.
 *
 * «ОМ» — магистраль, от которой отходит линия к селу: «сущ. ОМ - Акбеит».
 * Пока это слово считалось служебным, карта по названию «ОМ — Акбеит»
 * ставила подпись «Акбеит» на начало линии, а схема — «ОМ», и после
 * разворота одна из них всегда называла конец неправильно.
 */
const LINE_END_WORDS = new Set(['ом']);

function isLineEnd(word: string): boolean {
  return LINE_END_WORDS.has(normName(word));
}

const HAS_LETTER = /[a-zA-Zа-яА-ЯёЁ0-9]/;

/**
 * Слова названия.
 *
 * Дефис остаётся внутри слова: «Кызыл-Жар» — одно село, и резать его по
 * дефису значило бы подписать конец трассы «Жар». Но «ОМ-Акбеит» без
 * пробелов — это два конца. Отличаем по тому, что узнаём: слово целиком
 * не село, а часть до или после дефиса — магистраль или известное село.
 */
function nameWords(s: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (const w of s.split(/[^a-zA-Zа-яА-ЯёЁ0-9-]+/)) {
    if (!HAS_LETTER.test(w)) continue;
    const parts = w.split('-').filter((p) => HAS_LETTER.test(p));
    const twoEnds = parts.length > 1 && !known.has(normName(w))
      && parts.some((p) => isLineEnd(p) || known.has(normName(p)));
    if (twoEnds) out.push(...parts);
    else out.push(w.replace(/^-+|-+$/g, ''));
  }
  return out;
}

/**
 * Разбор названия на «откуда — куда».
 *
 * Сначала ищем известные сёла: «Шортанды Камышенка» — это два села, и
 * порядок в названии и есть направление. Магистраль («ОМ») — тоже
 * конец, хоть и не село. Если нашлось одно и рядом стоит «до», это
 * конец пути; иначе — начало.
 */
export function parseEndpoints(
  name: string,
  known: Set<string>,
): { from?: string; to?: string } {
  const raw = name.trim();
  if (!raw) return {};

  const words = nameWords(raw, known);
  const hits: { word: string; index: number }[] = [];
  words.forEach((w, i) => {
    if (isLineEnd(w)) { hits.push({ word: w, index: i }); return; }
    const key = normName(w);
    if (!key || STOP_WORDS.has(w.toLowerCase())) return;
    if (known.has(key)) hits.push({ word: w, index: i });
  });

  if (hits.length >= 2) {
    return { from: hits[0].word, to: hits[hits.length - 1].word };
  }

  if (hits.length === 1) {
    const before = words[hits[0].index - 1]?.toLowerCase();
    if (before === 'до' || before === 'к') return { to: hits[0].word };

    // «Сауыншы Школа»: село известно, а конец — нет, но он назван следом.
    // Берём последнее содержательное слово, если оно идёт после села.
    const after = words
      .map((w, i) => ({ w, i }))
      .filter(({ w, i }) => i > hits[0].index && !STOP_WORDS.has(w.toLowerCase()));
    const tail = after[after.length - 1]?.w;
    return tail ? { from: hits[0].word, to: tail } : { from: hits[0].word };
  }

  // Ни одного известного села: «Путь до Школы» — конец всё равно назван.
  const doIdx = words.findIndex((w) => w.toLowerCase() === 'до');
  if (doIdx >= 0 && words[doIdx + 1]) return { to: words[doIdx + 1] };
  return {};
}

/**
 * Явный разделитель «откуда — куда»: тире, стрелка, косая черта между
 * пробелами. Дефис без пробелов сюда не входит — он внутри названий.
 */
const END_SEPARATOR = /\s*[—–]\s*|\s+-+\s+|\s*(?:→|->)\s*|\s+\/\s+/;

/**
 * Конец из части названия: «сущ. ОМ» → «ОМ», «Путь до Акбеит» → «Акбеит».
 * Узнали в части ровно одно место — оно и есть конец; иначе часть идёт
 * как написана, а не обрезается наугад.
 */
function endName(part: string, known: Set<string>): string {
  const named = nameWords(part, known).filter((w) => isLineEnd(w)
    || (!STOP_WORDS.has(w.toLowerCase()) && known.has(normName(w))));
  return named.length === 1 ? named[0] : part;
}

/**
 * «Откуда — куда» из любой подписи: названия трассы или участка смены.
 *
 * Тире — прямое слово автора, оно важнее догадок: «Акбеит — Кенжеколь»
 * читается и тогда, когда ни одного из сёл в журнале ещё нет. Без тире
 * разбираем по узнанным сёлам.
 */
export function labelEnds(label: string, known: Set<string>): { from?: string; to?: string } {
  const raw = label.trim();
  if (!raw) return {};
  const pieces = raw.split(END_SEPARATOR).map((p) => p.trim()).filter((p) => HAS_LETTER.test(p));
  if (pieces.length < 2) return parseEndpoints(raw, known);

  // «Еленовка — альтернативный путь»: часть из одних служебных слов или
  // цифр — пояснение, а не конец; подписывать ею конец линии нельзя.
  const parts = pieces.filter((p) => nameWords(p, known)
    .some((w) => isLineEnd(w) || (!STOP_WORDS.has(w.toLowerCase()) && !/^\d+$/.test(w))));
  if (parts.length >= 2) {
    return { from: endName(parts[0], known), to: endName(parts[parts.length - 1], known) };
  }
  if (parts.length === 0) return {};
  // Осталось одно место — разбираем его само. Не узнали, начало это или
  // конец, — считаем началом, как одно село в названии без тире.
  const one = parseEndpoints(parts[0], known);
  return one.from || one.to ? one : { from: endName(parts[0], known) };
}

/**
 * Концы трассы — одни на карту, карточку и исполнительную схему.
 *
 * Раньше схема резала название по тире сама, а карта разбирала его по
 * сёлам. На «ОМ — Акбеит» они расходились: карта ставила «Акбеит» на
 * начало линии, схема — «ОМ», и ни разворот, ни смена подписей не делали
 * правильными обе сразу. В подписываемом листе «Акбеит» вставал на
 * конец ОМ. Теперь концы считаются здесь, и обе стороны берут их отсюда.
 *
 * Подпись «откуда» стоит на первой точке линии — там, откуда идёт счёт
 * метров. Название написано против хода работ — подписи меняют местами
 * (`endsSwapped`), а не переименовывают трассу.
 */
export function routeEnds(
  route: Pick<PlanRoute, 'name' | 'uchastok' | 'folder' | 'endsSwapped'>,
  known: Set<string>,
): { from?: string; to?: string } {
  const parsed = labelEnds(route.name || route.uchastok || route.folder || '', known);
  return route.endsSwapped ? { from: parsed.to, to: parsed.from } : parsed;
}

/**
 * Сёла, которые узнаём в названиях: те, что есть в журнале.
 *
 * Карта и схема должны узнавать одни и те же — иначе одно и то же
 * название разберётся у них по-разному.
 */
export function placeNames(progress: SnpProgress[]): Set<string> {
  const out = new Set<string>();
  for (const p of progress) {
    const key = normName(p.snp);
    if (key) out.add(key);
  }
  return out;
}

/**
 * Сёла, по которым карта узнаёт концы трасс, — по всему журналу.
 *
 * Карта видит журнал целиком, а документы собираются по журналу,
 * суженному до выбранной области. Пока схема брала сёла из суженного,
 * при выбранной «СКО» трасса «Шортанды Камышенка» с Шортанды из
 * Акмолинской на карте шла от Шортанды, а в листе на ту же точку линии
 * вставала Камышенка — тот же спор концов, только через фильтр. Поэтому
 * подписи концов в документах узнают сёла здесь: так же, как карта, по
 * этапам всего журнала с выведенными из смен.
 */
export function journalPlaces(j: DeriveContext & { progress: SnpProgress[] }): Set<string> {
  return placeNames(effectiveProgress(j.progress, j));
}

/**
 * Слова, по которым узнают место: без служебных, без «с.» и без «ОМ».
 *
 * Сравнивать названия целиком нельзя: «сущ. ОМ - Акбеит», «Акбеит» и
 * «ОМ — Акбеит» — одно и то же место. Сравнивать подстрокой — тоже:
 * «Аксу» сидит внутри «Аксуат», а это разные сёла.
 */
export function placeTokens(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(/[^a-zA-Zа-яА-ЯёЁ0-9-]+/)
    .map((w) => normName(w))
    .filter((t) => !!t && !STOP_WORDS.has(t) && !LINE_END_WORDS.has(t) && !PLACE_PREFIX.has(t));
}

/**
 * Слова одного названия идут подряд внутри другого.
 *
 * Одни цифры места не называют: «Трасса 2» и «СМУ 2» — не одно и то же.
 */
export function containsRun(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  if (!needle.some((t) => /[a-zа-я]/.test(t))) return false;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    if (needle.every((t, k) => hay[i + k] === t)) return true;
  }
  return false;
}

/** Одно ли место названо: «с. Акбеит» и «Акбеит» — да, «Аксу» и «Аксуат» — нет. */
export function samePlace(a: string | undefined, b: string | undefined): boolean {
  const x = placeTokens(a);
  const y = placeTokens(b);
  return containsRun(x, y) || containsRun(y, x);
}

interface Outline {
  name: string;
  ring: [number, number][];
  minLat: number; maxLat: number; minLon: number; maxLon: number;
}

function villageOutlines(areas: MapArea[]): Outline[] {
  const out: Outline[] = [];
  for (const a of areas) {
    if (a.kind !== 'snp' || a.coords.length < 3) continue;
    // Рамка контура: точку проверяем по многоугольнику, только если она
    // в рамке, — иначе сотня трасс на сотню сёл тормозит каждую перерисовку.
    let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity;
    for (const [lat, lon] of a.coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    out.push({ name: a.name, ring: a.coords, minLat, maxLat, minLon, maxLon });
  }
  return out;
}

/** Внутри ли контура точка: луч на восток пересекает границу нечётное число раз. */
function insideRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function villageAt(list: Outline[], at: [number, number] | undefined): string | undefined {
  if (!at) return undefined;
  const [lat, lon] = at;
  for (const o of list) {
    if (lat < o.minLat || lat > o.maxLat || lon < o.minLon || lon > o.maxLon) continue;
    if (insideRing(lat, lon, o.ring)) return o.name;
  }
  return undefined;
}

export interface RouteStyleContext {
  progress: SnpProgress[];
  /** Обводки сёл из KML: по ним видно, в каком селе лежит каждый конец линии. */
  areas?: MapArea[];
  /**
   * Сёла для подписей концов (`journalPlaces`), если `progress` сужен
   * областью: подписи должны совпасть с картой, а она видит весь журнал.
   * Без них сёла берутся из `progress`.
   */
  places?: Set<string>;
}

export function routeViews(routes: PlanRoute[], ctx: RouteStyleContext): RouteView[] {
  const byName = new Map<string, SnpProgress | null>();
  for (const p of ctx.progress) {
    const key = normName(p.snp);
    if (!key) continue;
    // Одноимённые сёла в индекс не берём: покрасить трассу по чужой
    // стройке хуже, чем оставить её серой.
    byName.set(key, byName.has(key) ? null : p);
  }
  const known = ctx.places ?? placeNames(ctx.progress);
  const villages = villageOutlines(ctx.areas ?? []);

  return routes.map((r) => {
    const label = r.name || r.uchastok || r.folder || '';
    const ends = routeEnds(r, known);

    // Село ищем по обоим концам: трасса принадлежит тому, куда её ведут.
    const candidates = [ends.to, ends.from, r.uchastok, r.folder]
      .filter((v): v is string => !!v);
    let snp: SnpProgress | null = null;
    for (const c of candidates) {
      const hit = byName.get(normName(c));
      if (hit) { snp = hit; break; }
    }

    const stage = snp ? furthestStage(snp) : null;
    return {
      id: r.id,
      name: label || 'Трасса',
      coords: r.coords,
      lengthM: r.lengthM,
      source: r.source,
      from: ends.from,
      to: ends.to,
      kato: snp?.kato,
      snp: snp?.snp,
      stage,
      color: stage ? STAGE_LINE_COLOR[stage] : PLAN_LINE_COLOR,
      dashed: stage === null,
      reversed: r.reversed,
      endsSwapped: r.endsSwapped,
      startIn: villageAt(villages, r.coords[0]),
      endIn: r.coords.length > 1 ? villageAt(villages, r.coords[r.coords.length - 1]) : undefined,
    };
  });
}

/** Подпись «Шортанды → Камышенка» или просто название. */
export function routeTitle(v: Pick<RouteView, 'from' | 'to' | 'name'>): string {
  if (v.from && v.to) return `${v.from} → ${v.to}`;
  if (v.to) return `→ ${v.to}`;
  if (v.from) return `${v.from} →`;
  return v.name;
}

/**
 * Откуда идёт счёт — словами, для карточки трассы.
 *
 * Стрелки на проектной линии не рисуются, и до первой смены не видно,
 * с какого конца система начнёт закрашивать метры. Спрашивать «с того
 * ли конца» надо до первой смены, а не после десятой.
 */
export function countFromText(v: Pick<RouteView, 'from' | 'to' | 'reversed'>): string {
  const base = v.from
    ? `Счёт метров от «${v.from}»${v.to ? ` к «${v.to}»` : ''}`
    : v.to
      ? `Счёт метров к «${v.to}»`
      : 'Счёт метров от первой точки линии';
  return v.reversed ? `${base} — развёрнут против файла` : base;
}

/**
 * Не нарисована ли линия от села.
 *
 * Подписи концов берутся из названия, а не из самой линии: название
 * говорит «ОМ — Акбеит», и карточка пишет «от ОМ», даже когда первая
 * точка лежит посреди села. Ради этого вопроса карточку и делали, а
 * ответить на него по названию нельзя. Обводки сёл из того же KML знают,
 * где село на самом деле: если начало счёта лежит в селе, куда трасса по
 * подписям ведёт, — линию, скорее всего, рисовали от села.
 *
 * Обводок нет — молчим: угадывать, где село, по названию нельзя. Оба
 * конца в одном селе — тоже молчим: это трасса внутри села, и где у неё
 * «начало», обводка не скажет.
 */
export function directionHint(
  v: Pick<RouteView, 'from' | 'to' | 'startIn' | 'endIn'>,
): string | null {
  const startAtEnd = !!v.startIn && samePlace(v.startIn, v.to)
    && !(v.endIn && samePlace(v.endIn, v.to));
  const endAtStart = !!v.endIn && samePlace(v.endIn, v.from)
    && !(v.startIn && samePlace(v.startIn, v.from));
  if (!startAtEnd && !endAtStart) return null;
  const where = startAtEnd
    ? `Счёт начинается в селе «${v.startIn}», а по подписям трасса туда ведёт`
    : `Линия кончается в селе «${v.endIn}», а по подписям трасса оттуда начинается`;
  const crew = v.from ? `от «${v.from}»` : 'к селу';
  return `${where}. Похоже, линию рисовали с другого конца: если бригада идёт ${crew}, `
    + 'нужен «⇄ Считать с другого конца»; если перепутано название — «Подписи концов наоборот».';
}
