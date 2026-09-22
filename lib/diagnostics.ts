/**
 * Что происходит с системой прямо сейчас.
 *
 * Когда у прораба «не сохраняется» или «пропали данные», разбираться
 * приходится по телефону и на ощупь: какой браузер, сколько места,
 * ушли ли фотографии, была ли связь. Всё это система знает про себя
 * сама — надо только спросить.
 *
 * Ошибки тоже копим здесь: без них сообщение «сломалось» не
 * расследуется, а с ними чинится за один заход.
 */

export interface ErrorNote {
  at: string;
  message: string;
  /** Где случилось — файл и строка, если браузер их дал. */
  where?: string;
}

const ERRORS_KEY = 'optiq-errors-v1';
export const ERROR_LIMIT = 30;

export function loadErrors(): ErrorNote[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(window.localStorage.getItem(ERRORS_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveErrors(list: ErrorNote[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ERRORS_KEY, JSON.stringify(list.slice(0, ERROR_LIMIT)));
  } catch { /* приватный режим или переполнено */ }
}

export function noteError(list: ErrorNote[], note: ErrorNote): ErrorNote[] {
  // Одна и та же ошибка подряд не копится: иначе цикл в отрисовке
  // вытеснит из журнала всё остальное за секунду.
  if (list[0]?.message === note.message) return list;
  return [note, ...list].slice(0, ERROR_LIMIT);
}

/**
 * Ловим то, что иначе останется только в консоли.
 *
 * Возвращает функцию отписки: слушатель на window переживает
 * перерисовку, и снимать его должен тот, кто ставил.
 */
export function watchErrors(onError: (n: ErrorNote) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onWindowError = (e: ErrorEvent) => {
    onError({
      at: new Date().toISOString(),
      message: e.message || 'Неизвестная ошибка',
      where: e.filename ? `${e.filename}:${e.lineno}` : undefined,
    });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    onError({
      at: new Date().toISOString(),
      message: reason instanceof Error ? reason.message : String(reason ?? 'Обещание отклонено'),
    });
  };

  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export interface StorageInfo {
  /** Сколько занято, байты. Пусто — браузер не сказал. */
  usedBytes?: number;
  quotaBytes?: number;
  /** Доля занятого, 0..1. */
  share?: number;
}

/** Сколько места осталось. Переполненное хранилище — частая причина «не сохраняется». */
export async function storageInfo(): Promise<StorageInfo> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return {};
  try {
    const est = await navigator.storage.estimate();
    const usedBytes = est.usage;
    const quotaBytes = est.quota;
    return {
      usedBytes,
      quotaBytes,
      share: usedBytes && quotaBytes ? usedBytes / quotaBytes : undefined,
    };
  } catch {
    return {};
  }
}

export function fmtBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

export interface Diagnostics {
  version: string;
  online: boolean;
  /** Название браузера — из строки агента, как есть. */
  agent: string;
  screen: string;
  storage: StorageInfo;
  /** Сколько записей не ушло на сервер. */
  pendingEntries: number;
  pendingPhotos: number;
  lastSyncAt?: string;
  errors: ErrorNote[];
}

/**
 * Отчёт о проблеме.
 *
 * То, что человек написал, плюс то, что система знает про себя. Без
 * второго сообщение «не работает» не расследуется.
 */
export function problemReport(d: Diagnostics, whatHappened: string): string {
  const lines = [
    'Сообщение о проблеме — Optiq',
    '',
    whatHappened.trim() || '(описание не заполнено)',
    '',
    `Версия: ${d.version}`,
    `Связь: ${d.online ? 'есть' : 'нет'}`,
    `Браузер: ${d.agent}`,
    `Экран: ${d.screen}`,
    `Хранилище: ${fmtBytes(d.storage.usedBytes)} из ${fmtBytes(d.storage.quotaBytes)}`,
    `Не отправлено: записей ${d.pendingEntries}, фотографий ${d.pendingPhotos}`,
    d.lastSyncAt ? `Последний обмен: ${new Date(d.lastSyncAt).toLocaleString('ru')}` : 'Обмена не было',
  ];
  if (d.errors.length > 0) {
    lines.push('', 'Последние ошибки:');
    for (const e of d.errors.slice(0, 5)) {
      lines.push(`  ${new Date(e.at).toLocaleString('ru')} — ${e.message}`
        + (e.where ? ` (${e.where})` : ''));
    }
  }
  return lines.join('\n');
}

/** Коротко о состоянии — для строки в шапке. */
export function statusLine(d: Diagnostics): string {
  const parts = [d.online ? 'связь есть' : 'связи нет'];
  if (d.pendingEntries > 0) parts.push(`не отправлено ${d.pendingEntries}`);
  if (d.storage.share !== undefined && d.storage.share > 0.8) {
    parts.push(`хранилище занято на ${Math.round(d.storage.share * 100)}%`);
  }
  if (d.errors.length > 0) parts.push(`ошибок ${d.errors.length}`);
  return parts.join(' · ');
}
