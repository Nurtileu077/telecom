import type {
  PlanRoute, SnpProgress, MapArea, DrillLogEntry,
} from '@/types/construction';
import { normName, normRegion, areaKindOf } from './areaImport';
import { nearestOnRoute } from './measureTool';

/**
 * Чья это трасса — какого села.
 *
 * КАТО в KML не бывает, и трассу к селу привязывали по имени. Но
 * одноимённых сёл много — Акбулак не один, — и по имени без района два
 * таких села сливались: карта ставила их в одну точку посередине между
 * ними, а смены одного двигали колонну по линии другого.
 *
 * Поэтому имя только предлагает, а выбирает то, что знает место:
 *
 * 1. человек — «это трасса села …» на карточке трассы (`PlanRoute.kato`);
 * 2. имя, если такое село одно;
 * 3. среди тёзок — обводка села из KML, связанная с реестром, в которой
 *    лежит линия;
 * 4. район: папка KML («Зерендинский район / Акбулак») или обводка района,
 *    в которой лежит линия;
 * 5. проколы ГНБ тёзки, снятые с поля рядом с линией.
 *
 * Не решилось — трасса остаётся ничьей, и её карточка спрашивает, чья
 * она. Неверная привязка хуже отсутствия: по ней красят чужие метры.
 */

export interface VillageRef {
  kato: string;
  snp: string;
  oblast?: string;
  rayon?: string;
}

export type BindHow = 'manual' | 'name' | 'outline' | 'rayon' | 'drills';

export interface RouteVillage {
  village?: VillageRef;
  how?: BindHow;
  /** Тёзки, между которыми выбрать не вышло, — спросить человека. */
  namesakes?: VillageRef[];
  /**
   * Все сёла с именем трассы, когда их больше одного, — даже если выбор
   * сделан: человек должен видеть, из чего выбрали, и мочь поправить.
   */
  choices?: VillageRef[];
}

/** Как узнали село — словами для карточки трассы. */
export const BIND_HOW_TEXT: Record<BindHow, string> = {
  manual: 'указано вручную',
  name: 'по имени',
  outline: 'по обводке села из KML',
  rayon: 'по району — папке KML или обводке района',
  drills: 'по проколам ГНБ рядом с линией',
};

/** Подпись тёзки: «Акбулак (Зерендинский р-н)». */
export function villageLabel(v: VillageRef): string {
  const where = v.rayon ? `${v.rayon.replace(/\s*район$/i, '')} р-н` : v.oblast;
  return where ? `${v.snp} (${where})` : v.snp;
}

interface Outline {
  ring: [number, number][];
  minLat: number; maxLat: number; minLon: number; maxLon: number;
}

function outlineOf(coords: [number, number][]): Outline {
  let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity;
  for (const [lat, lon] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { ring: coords, minLat, maxLat, minLon, maxLon };
}

function inside(o: Outline, [lat, lon]: [number, number]): boolean {
  if (lat < o.minLat || lat > o.maxLat || lon < o.minLon || lon > o.maxLon) return false;
  let hit = false;
  const ring = o.ring;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Начало, середина и конец линии: по ним и смотрим, где она лежит. */
function probes(coords: [number, number][]): [number, number][] {
  if (coords.length === 0) return [];
  return [coords[0], coords[Math.floor(coords.length / 2)], coords[coords.length - 1]];
}

/** Как близко прокол должен лежать к линии, чтобы считаться её проколом. */
const DRILL_NEAR_M = 300;

export interface VillageIndex {
  byName: Map<string, VillageRef[]>;
  byKato: Map<string, VillageRef>;
  outlinesByKato: Map<string, Outline[]>;
  rayonOutlines: { key: string; outline: Outline }[];
  drillsByKato: Map<string, { lat: number; lon: number }[]>;
}

export interface VillageContext {
  progress: SnpProgress[];
  areas?: MapArea[];
  drills?: DrillLogEntry[];
}

export function villageIndex(ctx: VillageContext): VillageIndex {
  const byName = new Map<string, VillageRef[]>();
  const byKato = new Map<string, VillageRef>();
  for (const p of ctx.progress) {
    const key = normName(p.snp);
    if (!key || !p.kato || byKato.has(p.kato)) continue;
    const ref: VillageRef = { kato: p.kato, snp: p.snp, oblast: p.oblast, rayon: p.rayon };
    byKato.set(p.kato, ref);
    const list = byName.get(key);
    if (list) list.push(ref); else byName.set(key, [ref]);
  }
  const outlinesByKato = new Map<string, Outline[]>();
  const rayonOutlines: { key: string; outline: Outline }[] = [];
  for (const a of ctx.areas ?? []) {
    if (a.coords.length < 3) continue;
    if (a.kind === 'snp' && a.kato) {
      const list = outlinesByKato.get(a.kato) ?? [];
      list.push(outlineOf(a.coords));
      outlinesByKato.set(a.kato, list);
    } else if (a.kind === 'rayon') {
      const key = normRegion(a.name);
      if (key) rayonOutlines.push({ key, outline: outlineOf(a.coords) });
    }
  }
  const drillsByKato = new Map<string, { lat: number; lon: number }[]>();
  for (const d of ctx.drills ?? []) {
    if (!d.kato || !d.points?.length) continue;
    const list = drillsByKato.get(d.kato) ?? [];
    for (const pt of d.points) if (Number.isFinite(pt.lat) && Number.isFinite(pt.lon)) list.push(pt);
    drillsByKato.set(d.kato, list);
  }
  return { byName, byKato, outlinesByKato, rayonOutlines, drillsByKato };
}

/** Из тёзок остался ровно один — он; иначе null. */
function onlyOne(list: VillageRef[], keep: (v: VillageRef) => boolean): VillageRef | null {
  const hits = list.filter(keep);
  return hits.length === 1 ? hits[0] : null;
}

/** Районы, которые называет сама линия: путь папок, папка, имя, файл. */
function rayonWords(r: Pick<PlanRoute, 'path' | 'folder' | 'name' | 'source'>): Set<string> {
  const out = new Set<string>();
  const parts = [
    ...(r.path ?? []), r.folder ?? '', r.name ?? '',
    (r.source ?? '').replace(/\.(kmz|kml)$/i, ''),
  ];
  for (const raw of parts) {
    // Район в папке называют словом «район»: «Зерендинский район». Без
    // этого слова папка может оказаться селом, и «Акбулак» в пути принялся
    // бы за район «Акбулакский».
    for (const piece of raw.split(/[/\\|;,()]+/)) {
      if (areaKindOf(piece) === 'rayon') {
        const key = normRegion(piece);
        if (key) out.add(key);
      }
    }
  }
  return out;
}

/**
 * Село трассы.
 *
 * `names` — чем трасса себя называет, по порядку доверия: концы из
 * названия, участок, папка. Первое имя, под которым есть сёла, и решает.
 */
export function routeVillage(
  r: Pick<PlanRoute, 'kato' | 'coords' | 'path' | 'folder' | 'name' | 'source'>,
  names: (string | undefined)[],
  idx: VillageIndex,
): RouteVillage {
  let candidates: VillageRef[] = [];
  for (const n of names) {
    if (!n) continue;
    const hits = idx.byName.get(normName(n));
    if (hits?.length) { candidates = hits; break; }
  }
  const choices = candidates.length > 1 ? candidates : undefined;

  if (r.kato) {
    const v = idx.byKato.get(r.kato);
    // Село из реестра убрали — привязка ничего не значит, но и молча
    // подставлять тёзку нельзя: дальше решаем, как без неё.
    if (v) return { village: v, how: 'manual', choices };
  }

  if (candidates.length === 0) return {};
  if (candidates.length === 1) return { village: candidates[0], how: 'name' };

  const at = probes(r.coords);

  const byOutline = onlyOne(candidates, (v) => (idx.outlinesByKato.get(v.kato) ?? [])
    .some((o) => at.some((p) => inside(o, p))));
  if (byOutline) return { village: byOutline, how: 'outline', choices };

  const named = rayonWords(r);
  const inRayon = new Set(idx.rayonOutlines
    .filter((x) => at.some((p) => inside(x.outline, p)))
    .map((x) => x.key));
  const byRayon = onlyOne(candidates, (v) => {
    const key = v.rayon ? normRegion(v.rayon) : '';
    return !!key && (named.has(key) || inRayon.has(key));
  });
  if (byRayon) return { village: byRayon, how: 'rayon', choices };

  const byDrills = onlyOne(candidates, (v) => (idx.drillsByKato.get(v.kato) ?? [])
    .some((p) => {
      const hit = nearestOnRoute(p, r.coords);
      return !!hit && hit.deviationM <= DRILL_NEAR_M;
    }));
  if (byDrills) return { village: byDrills, how: 'drills', choices };

  return { namesakes: candidates, choices };
}

/** Что сказать после загрузки: какие трассы легли на сёла-тёзки. */
export function namesakeNote(
  list: { name: string; namesakes?: VillageRef[] }[],
): string {
  const hit = list.filter((x) => x.namesakes?.length);
  if (hit.length === 0) return '';
  const first = hit.slice(0, 3).map((x) => `«${x.name}» — ${x.namesakes!.map(villageLabel).join(' или ')}`);
  const rest = hit.length - first.length;
  return ` Сёла-тёзки: ${first.join('; ')}${rest > 0 ? `; и ещё ${rest}` : ''}. `
    + 'Чья трасса — не понять ни по папкам, ни по обводкам: укажите село на карточке трассы, '
    + 'до тех пор смены сёл по имени на неё не ложатся.';
}
