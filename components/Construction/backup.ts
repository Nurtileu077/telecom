import type { JournalState } from './journalStore';
import { emptyJournal, fixList, fixWorkEntry, fixDrillEntry } from './journalStore';

/**
 * Забрать своё и вернуть обратно.
 *
 * Журнал живёт в браузере. Браузер чистят, телефон меняют, вкладку
 * закрывают «чтобы не мешала» — и сезон работы исчезает без следа.
 * Выгрузка в Excel спасает цифры, но не спасает структуру: обводки,
 * объекты, расценки, фотографии в неё не помещаются.
 *
 * Поэтому отдельная копия: один файл, в котором лежит всё, и который
 * разворачивается обратно без потерь.
 */

/** Версия формата копии. Меняется, когда старый файл перестаёт читаться. */
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: 'optiq-journal';
  version: number;
  /** Когда сняли — ISO. */
  at: string;
  /** Кто снял — чтобы понимать, чей это файл. */
  author?: string;
  /** Что внутри — видно не открывая. */
  counts: Record<string, number>;
  journal: JournalState;
}

/**
 * Сколько чего в журнале — по этому и узнают файл.
 *
 * Здесь должно быть перечислено всё, что копия и восстановление реально
 * переносят. Пропущенная коллекция не просто не показывается в списке:
 * по этим же числам предупреждают, что восстановление сотрёт, — и о
 * пропущенном оно промолчит.
 */
export function journalCounts(j: JournalState): Record<string, number> {
  /**
   * Копию могли снять версией, которая половины этих списков не знала.
   * Длину отсутствующего списка спрашивать нельзя: разворачивание
   * падает молча, и человек видит просто не открывшийся файл.
   */
  const n = (list: unknown): number => (Array.isArray(list) ? list.length : 0);
  const keys = (obj: unknown): number => (
    obj && typeof obj === 'object' ? Object.keys(obj).length : 0
  );
  return {
    'реестр СНП': n(j.orders),
    смены: n(j.ground),
    подвес: n(j.aerial),
    проколы: n(j.drills),
    отклонения: n(j.deviations),
    колонны: n(j.crews),
    трассы: n(j.planRoutes),
    контуры: n(j.areas),
    объекты: n(j.objects),
    фотографии: n(j.photos),
    аварии: n(j.incidents),
    поставки: n(j.deliveries),
    барабаны: n(j.drums),
    сварки: n(j.splices),
    'заявки на исправление': n(j.corrections),
    расценки: n(j.rates),
    платежи: n(j.payments),
    заявки: n(j.requests),
    план: n(j.plans),
    допуски: n(j.records),
    'этапы по сёлам': n(j.progress),
    подрядчики: n(j.contractors),
    'поля актов': keys(j.actFields),
    // Цены и продвижение по трассе тоже стираются при развороте —
    // значит, и в описи им место.
    'цены материалов': keys(j.prices),
    'продвижение по участкам': keys(j.sectionProgress),
  };
}

export function makeBackup(j: JournalState, author?: string): BackupFile {
  return {
    format: 'optiq-journal',
    version: BACKUP_VERSION,
    at: new Date().toISOString(),
    author,
    counts: journalCounts(j),
    journal: j,
  };
}

export function backupFileName(at = new Date()): string {
  return `optiq-журнал-${at.toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}.json`;
}

export interface BackupCheck {
  ok: boolean;
  /** Что не так — человеческим языком. */
  problem?: string;
  file?: BackupFile;
}

/**
 * Проверка файла до разворачивания.
 *
 * Чужой или битый файл нельзя «попробовать открыть»: если он заменит
 * журнал наполовину, восстанавливать будет нечего. Поэтому сначала
 * проверяем, а уже потом спрашиваем.
 */
export function readBackup(text: string): BackupCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'Это не файл копии: внутри не JSON' };
  }

  const f = parsed as Partial<BackupFile>;
  if (!f || f.format !== 'optiq-journal') {
    return { ok: false, problem: 'Файл не от этой системы' };
  }
  if (typeof f.version !== 'number' || f.version > BACKUP_VERSION) {
    return {
      ok: false,
      problem: `Копия сделана более новой версией (формат ${f.version}). Обновите систему.`,
    };
  }
  if (!f.journal || typeof f.journal !== 'object' || !Array.isArray(f.journal.ground)) {
    return { ok: false, problem: 'В файле нет журнала' };
  }
  return { ok: true, file: f as BackupFile };
}

/**
 * Развернуть копию.
 *
 * Недостающие поля добираем из пустого журнала: файл мог быть снят
 * версией, в которой ещё не было расценок или заявок, и падать из-за
 * этого он не должен.
 */
export function restoreBackup(file: BackupFile): JournalState {
  const j = { ...emptyJournal(), ...file.journal };
  // Копию могли снять полгода назад, когда поля ещё не было. Одна такая
  // запись роняет ведомость, акт и сводку — уже при отрисовке.
  return {
    ...j,
    ground: fixList(j.ground, fixWorkEntry),
    aerial: fixList(j.aerial, fixWorkEntry),
    drills: fixList(j.drills, fixDrillEntry),
  };
}

/** Насколько копия старая — по этому решают, разворачивать ли её. */
export function backupAge(at: string, now = new Date()): string {
  const ms = now.getTime() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'только что';
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return 'меньше часа назад';
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return `${d} дн назад`;
}

/**
 * Что потеряется при разворачивании.
 *
 * Копия заменяет журнал целиком. Если в текущем журнале записей больше,
 * чем в файле, об этом надо сказать до, а не после.
 */
export function restoreWarning(current: JournalState, file: BackupFile): string | null {
  const now = journalCounts(current);
  /**
   * Опись в файле могли снять до того, как в ней появились новые виды
   * записей. Тогда ключа в ней просто нет — а записи в самом журнале
   * копии есть.
   *
   * Считать отсутствие ключа за ноль значит пугать потерей всего, чего
   * прежняя опись не знала: «поставки: сейчас 40, в копии 0». Человек
   * отменяет разворачивание хорошей копии — ровно то, чего
   * предупреждение и должно было не допустить.
   */
  const stated = file.counts ?? {};
  // Файл могли подсунуть чужой или обрезанный: журнала в нём может не
  // быть вовсе, и тогда честный ответ — «в копии ноль», а не падение.
  const real = journalCounts((file.journal ?? {}) as JournalState);
  const losses: string[] = [];
  for (const [key, value] of Object.entries(now)) {
    const was = key in stated ? stated[key] : (real[key] ?? 0);
    if (value > was) losses.push(`${key}: сейчас ${value}, в копии ${was}`);
  }
  if (losses.length === 0) return null;
  return `В копии меньше записей, чем сейчас: ${losses.join('; ')}. `
    + 'Разворачивание заменит журнал целиком.';
}

// ── История импортов ─────────────────────────────────────────────────────────

export interface ImportRecord {
  id: string;
  at: string;
  /** Что загружали: имя файла. */
  file: string;
  /** Чего и сколько пришло. */
  counts: Record<string, number>;
  author?: string;
}

const IMPORTS_KEY = 'optiq-imports-v1';
export const IMPORT_HISTORY_LIMIT = 30;

export function loadImports(): ImportRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(window.localStorage.getItem(IMPORTS_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveImports(list: ImportRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(IMPORTS_KEY, JSON.stringify(list.slice(0, IMPORT_HISTORY_LIMIT)));
  } catch { /* приватный режим */ }
}

/** Записать, что загрузили. «Откуда это взялось» спрашивают через месяц. */
export function noteImport(list: ImportRecord[], rec: ImportRecord): ImportRecord[] {
  return [rec, ...list].slice(0, IMPORT_HISTORY_LIMIT);
}
