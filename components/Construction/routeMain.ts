import type { PlanRoute, DailyWorkEntry } from '@/types/construction';
import { normName } from './areaImport';

/**
 * Основная линия села.
 *
 * У села редко одна трасса: основная линия, отвод к школе, альтернативный
 * вариант, который проектировщик оставил в том же файле. Смены пишутся по
 * селу, а не по линии, и пока каждая трасса села брала себе все его смены,
 * метры одной смены закрашивали все три — карта показывала вдвое больше
 * сделанного. Смена без своей отметки ложится на одну линию: туда, где её
 * колонна в этом селе стояла в последний раз, а если колонна здесь места
 * ещё не называла — на основную.
 *
 * Основную выбирает человек (флаг на трассе, кнопка на её карточке). Пока
 * не выбрал — самая длинная из тех, что не названы вариантом или отводом:
 * альтернативный вариант бывает и длиннее основной линии.
 */

/** Слова, по которым в названии видно, что линия не основная. */
const SIDE_STEMS = ['альтернатив', 'вариант', 'резерв', 'отвод', 'ответвл', 'заезд'];

type Naming = Pick<PlanRoute, 'name' | 'uchastok' | 'folder'>;

/**
 * Названа ли линия вариантом или отводом.
 *
 * Сравниваем по словам, а не регуляркой с границей слова: `\b` в JS не
 * видит кириллицу, и «альтернативный» не нашёлся бы никогда.
 */
export function sideByName(r: Naming): boolean {
  const words = `${r.name ?? ''} ${r.folder ?? ''}`
    .toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean);
  return words.some((w) => SIDE_STEMS.some((s) => w.startsWith(s)));
}

type Choosable = Naming & Pick<PlanRoute, 'id' | 'lengthM' | 'main'>;

function longest<T extends Choosable>(list: T[]): T {
  return list.reduce((best, r) => (r.lengthM > best.lengthM ? r : best), list[0]);
}

/** Основная из линий одного села; null — линий нет. */
export function pickMainRoute<T extends Choosable>(routes: T[]): T | null {
  if (routes.length === 0) return null;
  const marked = routes.filter((r) => r.main);
  if (marked.length) return longest(marked);
  const plain = routes.filter((r) => !sideByName(r));
  return longest(plain.length ? plain : routes);
}

/**
 * Имя линии без номеров половин.
 *
 * «Разрезать» делит линию на «ОМ — Еленовка (1)» и «ОМ — Еленовка (2)», а
 * повторный разрез — на «(1) (1)» и «(1) (2)»: это одна линия, порезанная
 * по стыку бригад или границе СМУ. Так же одна трасса бывает нарисована
 * в KML несколькими кусками под одним именем.
 */
export function lineStem(name: string | undefined): string {
  let s = (name ?? '').toLowerCase().replace(/ё/g, 'е').trim();
  for (;;) {
    const t = s.replace(/\s*\(\d+\)\s*$/, '');
    if (t === s) break;
    s = t;
  }
  return s.replace(/\s+/g, ' ');
}

/**
 * Основная линия села целиком — все её куски, первой та, на которую
 * ложатся смены без отметки (`pickMainRoute`).
 *
 * Пока основной могла быть одна линия, разрезанная пополам трасса села
 * отдавала основную длинной половине, а вторая синела «не основная линия
 * — работ не отмечено», хотя это та же линия. Не основной линию делает
 * название («вариант», «отвод») или выбор человека, а не то, что её
 * разрезали. Назначил человек — основная ровно то, что он назначил:
 * половины назначенной линии метку наследуют, а одноимённые разные линии
 * он разведёт той же кнопкой.
 */
export function mainGroup<T extends Choosable>(routes: T[]): T[] {
  const primary = pickMainRoute(routes);
  if (!primary) return [];
  const marked = routes.filter((r) => r.main);
  if (marked.length) return [primary, ...marked.filter((r) => r !== primary)];
  const stem = lineStem(primary.name);
  if (!stem) return [primary];
  const side = sideByName(primary);
  return [primary, ...routes.filter((r) => r !== primary
    && sideByName(r) === side && lineStem(r.name) === stem)];
}

function groupsByKato(
  routes: Choosable[],
  katoByRouteId: Map<string, string>,
): Map<string, Choosable[]> {
  const groups = new Map<string, Choosable[]>();
  for (const r of routes) {
    const kato = katoByRouteId.get(r.id);
    if (!kato) continue;
    const list = groups.get(kato);
    if (list) list.push(r); else groups.set(kato, [r]);
  }
  return groups;
}

/**
 * Основная линия каждого села — по привязке трасс к сёлам (`routeViews`).
 *
 * Ключ — КАТО, значение — id линии.
 */
export function mainRouteByKato(
  routes: Choosable[],
  katoByRouteId: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [kato, list] of groupsByKato(routes, katoByRouteId)) {
    const main = pickMainRoute(list);
    if (main) out.set(kato, main.id);
  }
  return out;
}

/** Куски основной линии каждого села (см. mainGroup): КАТО → id, первой — основная. */
export function mainGroupByKato(
  routes: Choosable[],
  katoByRouteId: Map<string, string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [kato, list] of groupsByKato(routes, katoByRouteId)) {
    const group = mainGroup(list);
    if (group.length) out.set(kato, group.map((r) => r.id));
  }
  return out;
}

/** Чья смена — как в shiftPlace.crewOf; продублировано, чтобы не тянуть цикл модулей. */
function crewKey(e: Pick<DailyWorkEntry, 'contractor' | 'column'>): string {
  return `${normName(e.contractor ?? '')}|${normName(e.column ?? '')}`;
}

function chronological(a: DailyWorkEntry, b: DailyWorkEntry): number {
  return (a.date ?? '').localeCompare(b.date ?? '')
    || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    || a.id.localeCompare(b.id);
}

/**
 * Линия каждой смены без своей отметки.
 *
 * Смена без отметки продолжает свою колонну — так же, как в закраске: та
 * идёт вдоль той линии, на которой в этом селе ставила отметку в последний
 * раз. Колонна места здесь ещё не называла — основная линия села. Села без
 * привязанных трасс в ответе нет: такие смены по-прежнему ищут трассу по
 * селу.
 *
 * Ключ — id смены, значение — id линии.
 */
export function lineOfUnmarked(
  ground: DailyWorkEntry[],
  mainByKato: Map<string, string>,
  liveRouteIds?: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  const crewLine = new Map<string, string>();
  for (const e of [...ground].sort(chronological)) {
    const own = e.stop?.routeId;
    if (own && (!liveRouteIds || liveRouteIds.has(own))) {
      if (e.kato) crewLine.set(`${crewKey(e)}#${e.kato}`, own);
      continue;
    }
    if (!e.kato) continue;
    const line = crewLine.get(`${crewKey(e)}#${e.kato}`) ?? mainByKato.get(e.kato);
    if (line) out.set(e.id, line);
  }
  return out;
}

/**
 * На какой линии эта колонна сейчас в этом селе — для формы смены.
 *
 * Последняя отметка колонны в этом селе на живой линии; не было — null,
 * и форма берёт основную.
 */
export function crewLineIn(
  ground: DailyWorkEntry[],
  crew: Pick<DailyWorkEntry, 'contractor' | 'column'>,
  kato: string | undefined,
  liveRouteIds: Set<string>,
  beforeDate?: string,
): string | null {
  if (!kato) return null;
  const key = crewKey(crew);
  let best: DailyWorkEntry | null = null;
  for (const e of ground) {
    if (e.kato !== kato || !e.stop?.routeId || !liveRouteIds.has(e.stop.routeId)) continue;
    if (crewKey(e) !== key) continue;
    if (beforeDate && (e.date ?? '') > beforeDate) continue;
    if (!best || chronological(best, e) < 0) best = e;
  }
  return best?.stop?.routeId ?? null;
}

/** Какая смена на какой линии — одним расчётом для карты и формы смены. */
export interface LineIndex {
  live: Set<string>;
  /** КАТО → основная линия села. */
  mainByKato: Map<string, string>;
  /** id смены без отметки → её линия. */
  lineOf: Map<string, string>;
}

export function lineIndex(
  routes: Choosable[],
  katoByRouteId: Map<string, string>,
  ground: DailyWorkEntry[],
): LineIndex {
  const live = new Set(routes.map((r) => r.id));
  const mainByKato = mainRouteByKato(routes, katoByRouteId);
  return { live, mainByKato, lineOf: lineOfUnmarked(ground, mainByKato, live) };
}
