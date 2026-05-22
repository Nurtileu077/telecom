'use client';

import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { authSignOut, authOnStateChange, roleFromUser, authGetSession } from '@/lib/authSession';
import type { UserRole } from '@/types/network';
import { USER_ROLE_LABELS } from '@/types/network';
import AuthLoginForm from '@/components/Auth/AuthLoginForm';

interface Props {
  onRoleFromAuth?: (role: UserRole | null) => void;
  onUserChange?: (user: User | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function AuthButton({ onRoleFromAuth, onUserChange, open: openControlled, onOpenChange }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [openInternal, setOpenInternal] = useState(false);
  const open = openControlled ?? openInternal;
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    onOpenChange?.(next);
    if (openControlled === undefined) setOpenInternal(next);
  };

  useEffect(() => {
    if (!supabase) return;
    authGetSession().then(({ user: u }) => {
      setUser(u);
      onUserChange?.(u);
      onRoleFromAuth?.(roleFromUser(u));
    });
    return authOnStateChange((u) => {
      setUser(u);
      onUserChange?.(u);
      onRoleFromAuth?.(roleFromUser(u));
    });
  }, [onRoleFromAuth, onUserChange]);

  if (!supabase) {
    return (
      <span className="text-[10px] text-[#64748b] px-2" title="Задайте NEXT_PUBLIC_SUPABASE_URL и ANON_KEY">
        Нет облака
      </span>
    );
  }

  const signOut = async () => {
    await authSignOut();
    setUser(null);
    onUserChange?.(null);
    onRoleFromAuth?.(null);
    setOpen(false);
  };

  const authRole = roleFromUser(user);

  return (
    <div className="relative">
      <button
        type="button"
        className={`btn text-[10px] h-8 px-2.5 ${
          user
            ? 'btn-ghost text-[#34d399]'
            : 'border border-[#38bdf8]/40 text-[#38bdf8] bg-[#38bdf8]/10 hover:bg-[#38bdf8]/20'
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        {user ? `✓ ${user.email?.split('@')[0]}` : 'Вход'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-[700] w-[min(100vw-24px,320px)] p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl">
          {user ? (
            <>
              <p className="text-xs text-[var(--text-muted)] truncate mb-1">{user.email}</p>
              {authRole && (
                <p className="text-[10px] mb-2">Роль: <span className="text-[var(--accent)]">{USER_ROLE_LABELS[authRole]}</span></p>
              )}
              <button type="button" className="btn btn-secondary w-full text-[10px]" onClick={signOut}>
                Выйти
              </button>
            </>
          ) : (
            <AuthLoginForm
              compact
              onSuccess={() => {
                setOpen(false);
                authGetSession().then(({ user: u }) => {
                  setUser(u);
                  onUserChange?.(u);
                });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
