import { supabase } from '@/lib/supabase';
import { getDefaultOrgId } from '@/lib/orgId';
import { assertSupabaseAccess } from '@/lib/supabaseAccess';
import { JournalState, emptyJournal } from './journalStore';
import { mergeJournalStates, MergeStats } from './journalSync';
import {
  SNP_PROJECT_ID, cloudRowKey, pickProjectRow, projectsFromRows, currentProjectId, scopedKey,
  type BuildProject,
} from './projects';

/**
 * Облачная сторона журнала стройки.
 *
 * Журнал проекта лежит одним документом: «СНП» — строкой организации, как
 * было до деления на проекты, остальные — строкой «организация:проект»
 * (см. cloudRowKey). Для дневных отчётов этого достаточно: объёмы
 * небольшие, а разрешение расхождений делает клиент — см. journalSync.ts.
 *
 * Оффлайн — нормальный режим работы, а не сбой: в СНП связи нет по
 * определению. Поэтому запись всегда идёт сначала в localStorage, а обмен
 * с сервером выполняется отдельно и может не получиться. Ни одна функция
 * здесь не бросает исключение наружу при отсутствии сети — вызывающий код
 * получает результат с признаком неудачи и показывает его человеку.
 */

const TABLE = 'optiq_journal';

/** Организация текстом или 'default' для установки без орг. */
function orgKey(): string {
  return getDefaultOrgId() ?? 'default';
}

/** Ключ строки журнала проекта. */
function rowKey(projectId: string): string {
  return cloudRowKey(orgKey(), projectId);
}

/** Чей журнал: без отметки — заведённый до деления, то есть «СНП». */
function projectOf(state: JournalState): string {
  return state.project?.id ?? SNP_PROJECT_ID;
}

export function journalCloudEnabled(): boolean {
  return !!supabase;
}

export interface RemoteJournal {
  state: JournalState;
  updatedAt: string;
  updatedBy?: string;
}

/**
 * Субподрядчику стол закрыт.
 *
 * Отбор по подрядчику раньше делал экран: журнал приходил целиком, а
 * фильтровался в браузере. Для удобства этого хватало, для доступа —
 * нет: аккаунт субподрядчика читал через API весь журнал, включая чужие
 * объёмы и расчёты с другими подрядчиками.
 *
 * Теперь чужое отрезает сервер, а субподрядчик читает свой срез
 * функцией. Писать он не может — и это не ограничение, а их порядок
 * работы: смены закрывает генподрядчик, субподрядчик смотрит, что ему
 * насчитали.
 */
export async function isSubcontractorAccount(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.app_metadata?.role === 'sub';
}

/** Чтение журнала проекта с сервера. null — строки ещё нет (первая синхронизация). */
export async function fetchRemoteJournal(projectId: string = SNP_PROJECT_ID): Promise<RemoteJournal | null> {
  if (!supabase) return null;
  await assertSupabaseAccess();

  if (await isSubcontractorAccount()) {
    const { data, error } = await supabase.rpc('optiq_journal_mine');
    if (error) throw error;
    const rows = (data as Record<string, unknown>[] | null) ?? [];
    const row = pickProjectRow(rows, projectId);
    if (row === 'ambiguous') throw new Error('SLICE_AMBIGUOUS');
    if (!row) return null;
    return {
      state: { ...emptyJournal(), ...(row.data as Partial<JournalState>) },
      updatedAt: String(row.updated_at ?? ''),
      updatedBy: (row.updated_by as string) ?? undefined,
    };
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select('data, updated_at, updated_by')
    .eq('org_key', rowKey(projectId))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    state: { ...emptyJournal(), ...(data.data as Partial<JournalState>) },
    updatedAt: data.updated_at as string,
    updatedBy: (data.updated_by as string) ?? undefined,
  };
}

/** Запись журнала проекта на сервер целиком — в строку его проекта. */
export async function pushRemoteJournal(state: JournalState, by: string): Promise<string> {
  if (!supabase) throw new Error('Облако не настроено');
  await assertSupabaseAccess();
  const now = new Date().toISOString();
  const org = getDefaultOrgId();
  const { error } = await supabase.from(TABLE).upsert({
    org_key: rowKey(projectOf(state)),
    org_id: org ?? null,
    data: state,
    updated_at: now,
    updated_by: by,
  }, { onConflict: 'org_key' });
  if (error) throw error;
  return now;
}

/**
 * Какие проекты заведены в облаке.
 *
 * Берём только отметку проекта, без журналов: список нужен, чтобы
 * телефон узнал о Гипертрассе, заведённой в конторе, а тянуть ради этого
 * сезон смен по слабой связи незачем. null — облака нет или это
 * субподрядчик: стол ему закрыт, и проекты ему откроет п. 222.
 */
export async function listRemoteProjects(): Promise<BuildProject[] | null> {
  if (!supabase) return null;
  await assertSupabaseAccess();
  if (await isSubcontractorAccount()) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select('org_key, project:data->project');
  if (error) throw error;
  return projectsFromRows(orgKey(), (data ?? []) as { org_key?: unknown; project?: unknown }[]);
}

export type SyncOutcome =
  | { ok: true; merged: JournalState; stats: MergeStats; at: string; firstPush: boolean }
  | { ok: false; reason: 'disabled' | 'auth' | 'network' | 'readonly'; message: string };

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
  const projectId = projectOf(local);
  try {
    /**
     * Срез субподрядчику режет сервер, и пока он режет его по
     * организации, а не по проекту (п. 222). Отдать в журнал магистрали
     * срез сёл — значит показать подрядчику чужой договор под своим
     * названием, поэтому, кроме «СНП», ему пока не показываем ничего.
     */
    if (projectId !== SNP_PROJECT_ID && await isSubcontractorAccount()) {
      return {
        ok: false, reason: 'readonly',
        message: 'Этот проект субподрядчику пока не открыт: сервер отдаёт срез только по «СНП».',
      };
    }

    const remote = await fetchRemoteJournal(projectId);

    // Под ключом проекта должен лежать его журнал. Если там другой —
    // не сливаем: два договора, смешанные в одном журнале, назад не
    // разделить.
    const theirs = remote?.state.project?.id;
    if (theirs && theirs !== projectId) {
      return {
        ok: false, reason: 'network',
        message: `В облаке на месте этого проекта лежит журнал проекта «${remote!.state.project!.name}». `
          + 'Обмен остановлен, чтобы не смешать договоры.',
      };
    }

    /**
     * Субподрядчик журнал читает, но не пишет: смены закрывает
     * генподрядчик. Забрать свежее ему надо — иначе он не увидит, что
     * ему насчитали, — а отправлять нечего.
     */
    if (await isSubcontractorAccount()) {
      if (!remote) {
        return {
          ok: false, reason: 'readonly',
          message: 'Пока нечего показать: генподрядчик ещё не отправлял журнал.',
        };
      }
      const { merged, stats } = mergeJournalStates(local, remote.state);
      return { ok: true, merged, stats, at: remote.updatedAt, firstPush: false };
    }

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
    if (msg.includes('SLICE_AMBIGUOUS')) {
      return {
        ok: false, reason: 'readonly',
        message: 'Сервер отдал журналы нескольких проектов, не назвав их. Обмен остановлен, '
          + 'чтобы не смешать договоры: срез по проектам для субподрядчика ещё не настроен.',
      };
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

/**
 * Когда обменивался открытый проект.
 *
 * «Синхронизировано в 9:40» на Гипертрассе, которую не отправляли ни
 * разу, потому что в 9:40 обменивался «СНП», — ровно то, после чего
 * смены неделю живут на одном телефоне.
 */
function lastSyncKey(): string {
  return scopedKey(LAST_SYNC_KEY, currentProjectId());
}

export function loadLastSyncAt(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(lastSyncKey()); } catch { return null; }
}

export function saveLastSyncAt(iso: string): void {
  try { localStorage.setItem(lastSyncKey(), iso); } catch { /* приватный режим */ }
}
