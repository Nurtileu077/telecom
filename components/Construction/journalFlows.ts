import { JournalState, loadJournal, mergeJournal } from './journalStore';
import { commitUploaded } from './photoStore';
import type { SyncOutcome } from './journalRemote';
import type { MergeStats } from './journalSync';
import type { JournalImportResult } from './JournalImport';

/**
 * Обмен с облаком и загрузка книги — то, что идёт через await.
 *
 * Пока по слабой связи уходят снимки или разбирается книга на тысячу
 * строк, человек успевает переключиться на Гипертрассу. Журнал на экране
 * при этом пересоздаётся, а начатое продолжает работать — и всё, что оно
 * возьмёт «из открытого проекта» после ожидания, возьмёт из чужого:
 * сёльские строки ложатся в ведомость магистрали, а время обмена «СНП» —
 * Гипертрассе, и она показывает «синхронизировано», хотя её не
 * отправляли. Поэтому проект здесь называют один раз, в начале, и дальше
 * работают только с ним.
 */

/** Итог отправки файлов одного вида. keys — локальные копии, которые можно стереть. */
export interface FilesSent {
  state: JournalState;
  sent: number;
  failed: number;
  changed: boolean;
  keys: string[];
}

export interface SyncSteps {
  load: (projectId: string) => JournalState;
  save: (state: JournalState) => boolean;
  photos: (base: JournalState) => Promise<FilesSent>;
  otdr: (base: JournalState) => Promise<FilesSent>;
  /** Стереть локальную копию отправленного файла. */
  dropLocal: (key: string) => Promise<unknown>;
  exchange: (local: JournalState) => Promise<SyncOutcome>;
  markSynced: (at: string, projectId: string) => void;
}

export type SyncRun =
  | {
    ok: false;
    text: string;
    /** Слитый журнал, который пришёл, но не записался: показать его можно. */
    shown?: JournalState;
  }
  | {
    ok: true;
    merged: JournalState;
    stats: MergeStats;
    at: string;
    firstPush: boolean;
    photos: { sent: number; failed: number };
    otdr: { sent: number; failed: number };
  };

/**
 * Обмен журнала проекта: снимки, рефлектограммы, потом сам журнал.
 *
 * Сначала файлы, потом журнал: карточка со ссылкой уйдёт в том же обмене,
 * и у соседа фото откроется сразу, а не «в следующий раз». Локальную
 * копию файла стираем только после того, как журнал со ссылкой на него
 * записан. Не записался (память браузера кончилась) — копия остаётся на
 * телефоне, и следующий обмен отправит её снова: лишний файл в облаке
 * лучше потерянного снимка или рефлектограммы.
 *
 * Каждый шаг берёт журнал заново — после отправки снимков в нём уже
 * ссылки, — но всегда журнал `projectId`, а не открытого проекта.
 */
export async function runJournalSync(projectId: string, steps: SyncSteps): Promise<SyncRun> {
  const commit = { save: steps.save, del: steps.dropLocal };

  const withPhotos = await steps.photos(steps.load(projectId));
  if (withPhotos.changed && !(await commitUploaded(withPhotos.state, withPhotos.keys, commit))) {
    return {
      ok: false,
      text: 'Фото отправлены, но журнал не сохранился: переполнено хранилище браузера. '
        + 'Снимки остались на устройстве — освободите место и синхронизируйте ещё раз.',
    };
  }

  const withOtdr = await steps.otdr(steps.load(projectId));
  if (withOtdr.changed && !(await commitUploaded(withOtdr.state, withOtdr.keys, commit))) {
    return {
      ok: false,
      text: 'Рефлектограммы отправлены, но журнал не сохранился: переполнено хранилище браузера. '
        + 'Файлы остались на устройстве — освободите место и синхронизируйте ещё раз.',
    };
  }

  const res = await steps.exchange(steps.load(projectId));
  if (!res.ok) return { ok: false, text: res.message };

  // Слитое с сервера тоже проверяем: не записалось — следующий обмен
  // принесёт чужие правки заново, а человек думает, что всё сошлось.
  if (!steps.save(res.merged)) {
    return {
      ok: false,
      text: 'Журнал получен из облака, но на устройстве не сохранился: переполнено хранилище браузера. '
        + 'Освободите место и синхронизируйте ещё раз.',
      shown: res.merged,
    };
  }
  steps.markSynced(res.at, projectId);
  return {
    ok: true,
    merged: res.merged,
    stats: res.stats,
    at: res.at,
    firstPush: res.firstPush,
    photos: { sent: withPhotos.sent, failed: withPhotos.failed },
    otdr: { sent: withOtdr.sent, failed: withOtdr.failed },
  };
}

export interface BookImport {
  /** Журнал проекта с загруженными строками — его и записать. */
  next: JournalState;
  /** Чего и сколько пришло — в историю загрузок. */
  counts: Record<string, number>;
  stats: JournalImportResult['stats'];
}

/**
 * Книга Excel — в журнал проекта, где её выбрали.
 *
 * Журнал берём после разбора, а не до: пока книга читалась, в этом же
 * проекте могли записать смену, и затирать её старым снимком журнала
 * нельзя. Но берём именно `projectId` — открытым к этому моменту может
 * быть уже другой проект.
 *
 * null — наших листов в книге нет: это чужая таблица прораба, её
 * разбирают по колонкам вместе с человеком.
 */
export async function importBookInto(
  projectId: string,
  read: () => Promise<JournalImportResult>,
  load: (projectId: string) => JournalState = loadJournal,
): Promise<BookImport | null> {
  const res = await read();
  const known = res.ground.length + res.aerial.length + res.drills.length + res.orders.length;
  if (known === 0) return null;
  return {
    next: mergeJournal(load(projectId), res),
    counts: {
      смены: res.ground.length,
      подвес: res.aerial.length,
      проколы: res.drills.length,
      заказ: res.orders.length,
    },
    stats: res.stats,
  };
}
