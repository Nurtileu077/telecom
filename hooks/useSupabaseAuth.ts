'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { authOnStateChange, authGetSession } from '@/lib/authSession';

/** Сессия Supabase: после magic link и при обновлении страницы. */
export function useSupabaseAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!cancelled) setUser(session?.user ?? null);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    const unsub = authOnStateChange((u) => {
      setUser(u);
      setReady(true);
      if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
        const clean = `${window.location.pathname}${window.location.search}`;
        window.history.replaceState(null, '', clean);
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return { user, ready, signedIn: !!user };
}
