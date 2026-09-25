import { supabase } from '@/lib/supabase';
import { assertSupabaseAccess } from '@/lib/supabaseAccess';

/**
 * Кто когда заходил.
 *
 * Записи об этом ведёт сам Supabase. Берём их оттуда, а не пишем с
 * клиента: запись, сделанную браузером, браузер и подделает, а смысл
 * журнала входов ровно в том, чтобы ей верить.
 *
 * Список короткий по своей природе: Supabase чистит старое сам, и это
 * не потеря, а его устройство. Пустой список — нормальный ответ, а не
 * поломка: значит, с последней чистки никто не заходил.
 */

export interface LoginEntry {
  email: string;
  event: string;
  at: string;
  ip: string;
}

export function loginLogEnabled(): boolean {
  return !!supabase;
}

export async function fetchLoginLog(limit = 200): Promise<LoginEntry[]> {
  if (!supabase) return [];
  await assertSupabaseAccess();
  const { data, error } = await supabase.rpc('optiq_login_log', { limit_rows: limit });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    email: String(r.email ?? ''),
    event: String(r['событие'] ?? ''),
    at: String(r['когда'] ?? ''),
    ip: String(r['откуда'] ?? '—'),
  }));
}

/** Событие одной строкой — как его читают глазами. */
export function loginLine(e: LoginEntry): string {
  const when = new Date(e.at);
  const stamp = Number.isNaN(when.getTime()) ? e.at : when.toLocaleString('ru');
  const where = e.ip && e.ip !== '—' ? ` · ${e.ip}` : '';
  return `${stamp} · ${e.email} · ${e.event}${where}`;
}

/**
 * Сколько разных людей заходило и когда был последний вход.
 *
 * Это и спрашивают в первую очередь: «все ли пользуются» и «когда кто-то
 * был последний раз».
 */
export function loginSummary(list: LoginEntry[]): { people: number; last?: string } {
  const people = new Set(list.map((e) => e.email.toLowerCase()).filter(Boolean)).size;
  const times = list.map((e) => e.at).filter(Boolean).sort();
  return { people, last: times[times.length - 1] };
}
