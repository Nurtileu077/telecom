import { supabase } from '@/lib/supabase';
import { getDefaultOrgId } from '@/lib/orgId';
import { assertSupabaseAccess } from '@/lib/supabaseAccess';
import { JournalState, emptyJournal } from './journalStore';
import { mergeJournalStates, MergeStats } from './journalSync';

/**
 * Облачная сторона журнала стройки.
 *
 * Весь журнал лежит одним документом на организацию. Для дневных отчётов
 * этого достаточно: объёмы небольшие, а разрешение расхождений делает
 * клиент — см. journalSync.ts.
 *
 * Оффлайн — нормальный режим работы, а не сбой: в СНП связи нет по
 * определению. Поэтому запись всегда идёт сначала в localStorage, а обмен
 * с сервером выполняется отдельно и может не получиться. Ни одна функция
 * здесь не бросает исключение наружу при отсутствии сети — вызывающий код
 * получает результат с признаком неудачи и показывает его человеку.
 */

const TABLE = 'optiq_journal';

/** Ключ строки: организация текстом или 'default' для установки без орг. */
function orgKey(): string {
  return getDefaultOrgId() ?? 'default';
}

export function journalCloudEnabled(): boolean {
  return !!supabase;
}

export interface RemoteJournal {
  state: JournalState;
  updatedAt: string;
  updatedBy?: string;
}

/** Чтение журнала с сервера. null — строки ещё нет (первая синхронизация). */
export async function fetchRemoteJournal(): Promise<RemoteJournal | null> {
  if (!supabase) return null;
  await assertSupabaseAccess();
  const { data, error } = await supabase
    .from(TABLE)
    .select('data, updated_at, updated_by')
    .eq('org_key', orgKey())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    state: { ...emptyJournal(), ...(data.data as Partial<JournalState>) },
    updatedAt: data.updated_at as string,
    updatedBy: (data.updated_by as string) ?? undefined,
  };
}

/** Запись журнала на сервер целиком. */
export async function pushRemoteJournal(state: JournalState, by: string): Promise<string> {
  if (!supabase) throw new Error('Облако не настроено');
  await assertSupabaseAccess();
  const now = new Date().toISOString();
  const org = getDefaultOrgId();
  const { error } = await supabase.from(TABLE).upsert({
    org_key: orgKey(),
    org_id: org ?? null,
    data: state,
    updated_at: now,
    updated_by: by,
  }, { onConflict: 'org_key' });
  if (error) throw error;
  return now;
}

export type SyncOutcome =
  | { ok: true; merged: JournalState; stats: MergeStats; at: string; firstPush: boolean }
  | { ok: false; reason: 'disabled' | 'auth' | 'network'; message: string };

/**
 * Обмен с сервером: забрать, слить, вернуть обратно.
 *
 * Возвращает слитое состояние — вызывающий код обязан его сохранить локально,
 * иначе при следующем обмене чужие правки придут заново.
 */
export async function syncJournal(local: JournalState, by: string): Promise<SyncOutcome> {
  if (!supabase) {
    return { ok: false, reason: 'disabled', message: 'Облако не настроено: журнал живёт только в этом браузере.' };
  }
  try {
    const remote = await fetchRemoteJournal();
    const { merged, stats } = remote
      ? mergeJournalStates(local, remote.state)
      : { merged: local, stats: { pulled: 0, pushed: local.ground.length, conflicts: 0, removed: 0 } };
    const at = await pushRemoteJournal(merged, by);
    return { ok: true, merged, stats, at, firstPush: !remote };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Требование авторизации — отдельный случай: человеку надо войти,
    // а не «попробовать ещё раз».
    if (msg.includes('AUTH_REQUIRED')) {
      return { ok: false, reason: 'auth', message: 'Нужен вход: облачные операции закрыты для гостей.' };
    }
    if (/relation .*optiq_journal.* does not exist|schema cache/i.test(msg)) {
      return {
        ok: false, reason: 'network',
        message: 'Таблица журнала не создана. Выполните docs/supabase-journal.sql в SQL Editor.',
      };
    }
    return { ok: false, reason: 'network', message: `Не удалось синхронизировать: ${msg}` };
  }
}

// ── Отметка о последней успешной синхронизации ──────────────────────────────

const LAST_SYNC_KEY = 'optiq-journal-synced-at';

export function loadLastSyncAt(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(LAST_SYNC_KEY); } catch { return null; }
}

export function saveLastSyncAt(iso: string): void {
  try { localStorage.setItem(LAST_SYNC_KEY, iso); } catch { /* приватный режим */ }
}
