/**
 * Незаконченные записи.
 *
 * День закрывают в поле, с телефона, между делом: позвонили, приехала
 * машина, села батарея. Форма при этом закрывается, и всё набранное
 * пропадает — а это полчаса работы и цифры, которые второй раз никто
 * точно не вспомнит.
 *
 * Черновик живёт на устройстве и только до сохранения: это не вторая
 * копия журнала, а страховка от закрытой вкладки.
 */

const PREFIX = 'optiq-draft-';

/** Через сколько черновик считается протухшим. */
export const DRAFT_TTL_HOURS = 72;

export interface Draft<T> {
  at: string;
  data: T;
}

export function saveDraft<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ at: new Date().toISOString(), data } satisfies Draft<T>),
    );
  } catch {
    // Переполненное хранилище не повод ронять форму: человек и так
    // сейчас её заполняет.
  }
}

export function loadDraft<T>(key: string, now = new Date()): Draft<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft<T>;
    if (!parsed || typeof parsed.at !== 'string') return null;
    const age = now.getTime() - new Date(parsed.at).getTime();
    if (!Number.isFinite(age) || age > DRAFT_TTL_HOURS * 3600 * 1000) {
      // Трёхдневный черновик — это не «продолжить», а «что это вообще».
      clearDraft(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(PREFIX + key); } catch { /* приватный режим */ }
}

/** Насколько давно черновик — словами, для вопроса «продолжить?». */
export function draftAge(at: string, now = new Date()): string {
  const ms = now.getTime() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'только что';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

/**
 * Стоит ли вообще предлагать продолжить.
 *
 * Черновик из одной подставленной области — это не работа, а следствие
 * того, что форму открыли и закрыли. Предлагать вернуться к нему —
 * значит спрашивать ни о чём.
 */
export function draftWorthKeeping(data: Record<string, unknown>): boolean {
  let filled = 0;
  for (const [key, v] of Object.entries(data)) {
    if (key === 'date') continue;
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object' && Object.keys(v as object).length === 0) continue;
    filled += 1;
  }
  return filled >= 3;
}
