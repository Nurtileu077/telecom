/**
 * Закладки, недавнее и сохранённые фильтры.
 *
 * За один объект отвечают три-четыре участка, и на них смотрят каждый
 * день. Сейчас до них добираются одинаково: поиск, прокрутка, ещё раз
 * поиск. А путь всегда один и тот же.
 *
 * Всё это — настройки устройства: закладки прораба не должны появляться
 * у снабженца, а «недавнее» вообще личное.
 */

export type ShortcutKind = 'snp' | 'route' | 'object' | 'section';

export interface Shortcut {
  kind: ShortcutKind;
  /** Чем это открывается: КАТО, id трассы, название участка. */
  id: string;
  label: string;
  sublabel?: string;
  lat?: number;
  lon?: number;
  zoom?: number;
  /** Когда открывали последний раз — ISO. */
  at: string;
}

/** Сколько «недавнего» помним: длинный список перестаёт быть коротким путём. */
export const RECENT_LIMIT = 8;
export const BOOKMARK_LIMIT = 40;

const BOOKMARKS_KEY = 'optiq-bookmarks-v1';
const RECENT_KEY = 'optiq-recent-v1';
const FILTERS_KEY = 'optiq-saved-filters-v1';

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим */ }
}

function sameShortcut(a: Shortcut, b: Shortcut): boolean {
  return a.kind === b.kind && a.id === b.id;
}

// ── Закладки ─────────────────────────────────────────────────────────────────

export function loadBookmarks(): Shortcut[] {
  return read<Shortcut[]>(BOOKMARKS_KEY, []);
}

export function isBookmarked(list: Shortcut[], s: Pick<Shortcut, 'kind' | 'id'>): boolean {
  return list.some((x) => x.kind === s.kind && x.id === s.id);
}

/**
 * Поставить или снять закладку.
 *
 * Одно действие на оба случая: отдельная кнопка «убрать» на том же
 * месте, где стояла «добавить», — это лишний повод промахнуться.
 */
export function toggleBookmark(list: Shortcut[], s: Shortcut): Shortcut[] {
  if (isBookmarked(list, s)) return list.filter((x) => !sameShortcut(x, s));
  return [s, ...list].slice(0, BOOKMARK_LIMIT);
}

export function saveBookmarks(list: Shortcut[]): void {
  write(BOOKMARKS_KEY, list);
}

// ── Недавнее ─────────────────────────────────────────────────────────────────

export function loadRecent(): Shortcut[] {
  return read<Shortcut[]>(RECENT_KEY, []);
}

/**
 * Запомнить, что сюда заходили.
 *
 * Повторный заход поднимает запись наверх, а не добавляет вторую: в
 * «недавнем» важен порядок, а не история посещений.
 */
export function pushRecent(list: Shortcut[], s: Shortcut): Shortcut[] {
  return [s, ...list.filter((x) => !sameShortcut(x, s))].slice(0, RECENT_LIMIT);
}

export function saveRecent(list: Shortcut[]): void {
  write(RECENT_KEY, list);
}

// ── Сохранённые фильтры ──────────────────────────────────────────────────────

export interface SavedFilter {
  id: string;
  /** Как человек его назвал: «Акмолинская, Дозер, июль». */
  name: string;
  /** Что именно сохранено — разбирает тот, кто применяет. */
  value: Record<string, string | undefined>;
  at: string;
}

export function loadFilters(): SavedFilter[] {
  return read<SavedFilter[]>(FILTERS_KEY, []);
}

export function saveFilters(list: SavedFilter[]): void {
  write(FILTERS_KEY, list);
}

/**
 * Имя фильтра по умолчанию.
 *
 * Человек почти всегда соглашается с предложенным, если оно описывает
 * то, что он видит. «Фильтр 3» не описывает ничего.
 */
export function describeFilter(value: Record<string, string | undefined>): string {
  const parts = Object.entries(value)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([, v]) => v as string);
  return parts.length ? parts.join(', ') : 'Всё';
}

export function upsertFilter(list: SavedFilter[], f: SavedFilter): SavedFilter[] {
  const exists = list.some((x) => x.id === f.id);
  return exists ? list.map((x) => (x.id === f.id ? f : x)) : [f, ...list].slice(0, 20);
}

export function removeFilter(list: SavedFilter[], id: string): SavedFilter[] {
  return list.filter((f) => f.id !== id);
}
