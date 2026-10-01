import type { PlanRoute } from '@/types/construction';
import { placeTokens, containsRun } from './routeStyle';
import { routeForSection } from './routeProgress';

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
