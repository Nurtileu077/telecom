import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/types/network';

export function roleFromUser(user: User | null): UserRole | null {
  if (!user) return null;
  const meta = user.user_metadata?.role ?? user.app_metadata?.role;
  if (meta === 'engineer' || meta === 'field' || meta === 'viewer') return meta;
  return null;
}

export async function authGetSession() {
  if (!supabase) return { user: null as User | null };
  const { data } = await supabase.auth.getSession();
  return { user: data.session?.user ?? null };
}

export async function authSignInOtp(email: string) {
  if (!supabase) throw new Error('Supabase не настроен — задайте NEXT_PUBLIC_SUPABASE_URL и ANON_KEY');
  const redirectTo = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : undefined;
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function authSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export function authOnStateChange(cb: (user: User | null) => void) {
  if (!supabase) return () => {};
  const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
    cb(session?.user ?? null);
  });
  return () => sub.subscription.unsubscribe();
}
