/**
 * Что из журнала стройки показывать на карте.
 *
 * Слоёв стало много — проколы, колонны, этапы, отклонения, проект. Вместе
 * они дают полную картину, но на общем плане области превращаются в кашу.
 * Поэтому каждый слой выключается отдельно, а выбор запоминается: человек
 * настраивает карту под свою работу один раз, а не каждое утро.
 */

export interface ConstructionLayers {
  /** Проколы ГНБ/ГНП. */
  drills: boolean;
  /** Колонны — где стоит бригада. */
  crews: boolean;
  /** Этапы по населённым пунктам: кто ждёт фронт, где закрыто. */
  snp: boolean;
  /** Отклонения по глубине и трассе. */
  deviations: boolean;
  /** Проектная трасса из KML. */
  plan: boolean;
  /** Обведённые районы и сёла. */
  areas: boolean;
  /** Муфты, столбы, конечные точки, ККС. */
  objects: boolean;
  /** Аварии: открытые и места, где рвётся не в первый раз. */
  incidents: boolean;
  /** Поток по кабелю — там, где он уже задут и сварен. */
  flow: boolean;
}

export const CONSTRUCTION_LAYER_LABELS: Record<keyof ConstructionLayers, string> = {
  drills: '⬦ Проколы ГНБ / ГНП',
  crews: '👷 Колонны',
  snp: '🏘 Этапы по сёлам',
  deviations: '⚠ Отклонения',
  plan: '┈ Проектная трасса',
  areas: '▦ Районы и сёла',
  objects: '🔗 Муфты и столбы',
  incidents: '🚨 Аварии',
  flow: '✨ Поток по кабелю',
};

export const DEFAULT_CONSTRUCTION_LAYERS: ConstructionLayers = {
  // Контуры районов и сёл по умолчанию выключены: в рабочем файле их
  // восемь десятков, они закрывают трассу и отвечают на вопрос, который
  // на стройке никто не задаёт. Включить можно тумблером.
  drills: true, crews: true, snp: true, deviations: true, plan: true,
  areas: false, objects: true, incidents: true,
  // Поток — украшение, а не работа: включается по желанию.
  flow: false,
};

/**
 * Чем красить трассу: пройденным этапом или способом прокладки.
 *
 * Два смысла на одной линии одновременно не читаются, поэтому это
 * переключатель, а не второй слой.
 */
export type RouteColorMode = 'stage' | 'method';

export const ROUTE_COLOR_LABEL: Record<RouteColorMode, string> = {
  stage: 'По этапу',
  method: 'По способу',
};

const COLOR_KEY = 'optiq-route-color-v1';

export function loadRouteColorMode(): RouteColorMode {
  if (typeof window === 'undefined') return 'stage';
  try {
    const v = window.localStorage.getItem(COLOR_KEY);
    return v === 'method' ? 'method' : 'stage';
  } catch {
    return 'stage';
  }
}

export function saveRouteColorMode(v: RouteColorMode): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(COLOR_KEY, v); } catch { /* приватный режим */ }
}

const KEY = 'optiq-construction-layers-v1';

export function loadConstructionLayers(): ConstructionLayers {
  if (typeof window === 'undefined') return { ...DEFAULT_CONSTRUCTION_LAYERS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_CONSTRUCTION_LAYERS };
    const saved = JSON.parse(raw) as Partial<ConstructionLayers>;
    // Новый слой появляется включённым: иначе люди его просто не заметят.
    return { ...DEFAULT_CONSTRUCTION_LAYERS, ...saved };
  } catch {
    return { ...DEFAULT_CONSTRUCTION_LAYERS };
  }
}

export function saveConstructionLayers(v: ConstructionLayers): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Настройка вида — не та вещь, ради которой стоит падать.
  }
}

// ── Слои по источникам ───────────────────────────────────────────────────────

/**
 * Какие загруженные файлы сейчас показаны.
 *
 * В Google Earth у прораба это слои: один файл — один слой, и его можно
 * погасить, не удаляя. Здесь так же. Видимость — настройка вида, а не
 * данные: она живёт на устройстве и не уезжает в общий журнал, иначе
 * погашенный у одного слой пропал бы у всех.
 */
const SOURCES_KEY = 'optiq-hidden-sources-v1';

export function loadHiddenSources(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SOURCES_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveHiddenSources(list: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SOURCES_KEY, JSON.stringify(list));
  } catch {
    // Настройка вида — не та вещь, ради которой стоит падать.
  }
}

export function toggleHiddenSource(list: string[], source: string): string[] {
  return list.includes(source) ? list.filter((s) => s !== source) : [...list, source];
}

/** Виден ли слой: спрятанным считается только тот, что погасили явно. */
export function sourceVisible(hidden: string[], source: string): boolean {
  return !hidden.includes(source);
}
