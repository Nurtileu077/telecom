import type { PlanRoute, DailyWorkEntry } from '@/types/construction';
import { placeTokens, containsRun } from './routeStyle';
import { routeForSection } from './routeProgress';
import { entriesOfSection } from './sectionAct';

/**
 * Участок и трасса.
 *
 * Участок пишут как придётся: в смене — «сущ. ОМ - Акбеит», в карточке
 * муфты — «Акбеит», а в KML трасса лежит без папки под именем
 * «ОМ — Акбеит». Это один участок. Раньше каждое место сверяло по-своему:
 * схема — точным совпадением с участком или именем трассы, форма смены —
 * подстрокой. Муфта с участком «Акбеит» на трассе «ОМ — Акбеит» без папки
 * не попадала в схему ни своей, ни «без участка» и молча пропадала, а
 * подстрока путала «Аксу» с «Аксуат». Здесь одно правило на всех.
 */

type RouteNaming = Pick<PlanRoute, 'name' | 'uchastok' | 'folder'>;

/**
 * Относится ли участок к трассе.
 *
 * Сверяем слова места с участком трассы, папкой KML и её именем: слова
 * одного должны идти подряд внутри другого. «Акбеит» — внутри «ОМ —
 * Акбеит», «ОМ — Акбеит» — внутри «сущ. ОМ - Акбеит» (служебные слова и
 * «ОМ» местом не считаются), а «Аксу» и «Аксуат» — разные слова.
 */
export function sectionMatchesRoute(section: string | undefined, route: RouteNaming): boolean {
  const s = placeTokens(section);
  if (s.length === 0) return false;
  return [route.uchastok, route.folder, route.name].some((field) => {
    const t = placeTokens(field);
    return containsRun(t, s) || containsRun(s, t);
  });
}

/** Сколько слов места совпало у участка с трассой; 0 — участок не её. */
function matchScore(section: string | undefined, route: RouteNaming): number {
  const s = placeTokens(section);
  let best = 0;
  for (const field of [route.uchastok, route.folder, route.name]) {
    const t = placeTokens(field);
    if (containsRun(s, t)) best = Math.max(best, t.length);
    else if (containsRun(t, s)) best = Math.max(best, s.length);
  }
  return best;
}

/**
 * Трасса участка — та, вдоль которой идут его смены.
 *
 * Подходит несколько — самая длинная: короткие обычно заезды и
 * альтернативные куски. Так выбирает и форма смены, и приложение к акту:
 * метры участка и его схема должны лечь на одну линию.
 */
export function routeOfSection(routes: PlanRoute[], section: string | undefined): PlanRoute | null {
  if (placeTokens(section).length === 0) return null;
  return routeForSection(routes, (r) => sectionMatchesRoute(section, r));
}

/** Чья какая трасса — по привязке к сёлам (routeStyle.routeViews → routeVillage). */
export interface RouteBinding {
  /** id трассы → КАТО её села. */
  katoByRouteId: Map<string, string>;
  /** Трассы сёл-тёзок, чьё село не решено: они ничьи. */
  namesakeIds: Set<string>;
}

export function routeBinding(
  views: { id: string; kato?: string; namesakes?: unknown[] }[],
): RouteBinding {
  return {
    katoByRouteId: new Map(views.filter((v) => v.kato).map((v) => [v.id, v.kato as string])),
    namesakeIds: new Set(views.filter((v) => v.namesakes?.length).map((v) => v.id)),
  };
}

/**
 * Трассы, которые участку годятся по имени.
 *
 * Акбулак не один, и по имени участка подходят линии обоих. Линия,
 * привязанная к другому селу, не годится; ничья линия тёзок — тоже: чья
 * она, скажет человек на её карточке. `katos` — сёла смен участка; пусто —
 * село смен не известно, и годится любая привязанная.
 */
export function routesForVillages(
  routes: PlanRoute[],
  bind: RouteBinding,
  katos: Set<string>,
): PlanRoute[] {
  return routes.filter((r) => {
    const own = bind.katoByRouteId.get(r.id);
    if (own) return katos.size === 0 || katos.has(own);
    return !bind.namesakeIds.has(r.id);
  });
}

/**
 * Трасса участка с учётом сёл-тёзок — для схемы и приложения к акту.
 *
 * Схема к акту искала трассу по одному имени: к акту Акбулака-2 ложилась
 * линия Акбулака-1 со своей протяжённостью, а когда у одного из них
 * назначили основную линию, её получали акты обоих. Отбираем тем же
 * правилом, что форма смены (`routesForVillages`); подходящей нет — null,
 * и акт уходит без схемы, а не с чужой.
 */
export function routeOfSectionIn(
  routes: PlanRoute[],
  section: string | undefined,
  bind: RouteBinding,
  katos: Iterable<string | undefined>,
): PlanRoute | null {
  const set = new Set<string>();
  for (const k of katos) if (k?.trim()) set.add(k.trim());
  return routeOfSection(routesForVillages(routes, bind, set), section);
}

/**
 * Линия участка по имени — для смены без КАТО (магистраль между сёлами).
 *
 * Без КАТО не известно, какое это село, поэтому годится только линия,
 * которая по имени участка находится однозначно: подходящие линии
 * привязаны к двум разным сёлам (Акбулак не один) — не выбираем никакую,
 * смена остаётся без линии и видна в «Проверках». Ничьи линии тёзок не
 * годятся тоже.
 */
export function sectionLineFinder(
  routes: PlanRoute[],
  bind: RouteBinding,
): (uchastok: string) => string | null {
  const cache = new Map<string, string | null>();
  return (uchastok) => {
    const key = placeTokens(uchastok).join(' ');
    if (!key) return null;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    // «Магистраль Акбулак — Жалтыр» по словам подходит и линии «ОМ —
    // Акбулак»: берём только те, что совпали полнее всех.
    const scored = routesForVillages(routes, bind, new Set())
      .map((r) => ({ r, score: matchScore(uchastok, r) }))
      .filter((x) => x.score > 0);
    const top = Math.max(0, ...scored.map((x) => x.score));
    const fit = scored.filter((x) => x.score === top).map((x) => x.r);
    const katos = new Set(fit.map((r) => bind.katoByRouteId.get(r.id)).filter(Boolean));
    const id = katos.size > 1 ? null : routeForSection(fit, () => true)?.id ?? null;
    cache.set(key, id);
    return id;
  };
}

/** Трасса под схему акта участка: сёла — из смен этого участка. */
export function routeOfSectionAct(
  routes: PlanRoute[],
  ground: DailyWorkEntry[],
  uchastok: string | undefined,
  bind: RouteBinding,
): PlanRoute | null {
  if (!uchastok) return null;
  const katos = entriesOfSection(ground, uchastok).map((e) => e.kato);
  return routeOfSectionIn(routes, uchastok, bind, katos);
}

/**
 * Какой участок поставить объекту у этой трассы.
 *
 * Тот, под которым по ней чаще всего пишут смены: по нему же акт ищет
 * свои протоколы, и в карточке муфты он есть в подсказке. Смен нет —
 * участок или папка трассы, а без них её имя: с любым из них объект
 * попадёт в схему.
 */
export function sectionForRoute(route: RouteNaming, sections: (string | undefined)[]): string {
  const count = new Map<string, number>();
  for (const raw of sections) {
    const s = raw?.trim();
    if (s && sectionMatchesRoute(s, route)) count.set(s, (count.get(s) ?? 0) + 1);
  }
  let best = '';
  let most = 0;
  for (const [s, n] of count) {
    if (n > most) { best = s; most = n; }
  }
  return best || route.uchastok?.trim() || route.folder?.trim() || route.name.trim();
}
