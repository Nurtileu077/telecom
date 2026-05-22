'use client';
import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { authGetSession, authSignInOtp, authSignOut, authOnStateChange, roleFromUser } from '@/lib/authSession';
import type { UserRole } from '@/types/network';
import { USER_ROLE_LABELS } from '@/types/network';

interface Props {
  onRoleFromAuth?: (role: UserRole | null) => void;
  onUserChange?: (user: User | null) => void;
}

export default function AuthButton({ onRoleFromAuth, onUserChange }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!supabase) return null;

  const signIn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await authSignInOtp(email);
      setMsg('Письмо со ссылкой отправлено');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  };

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
        className="btn btn-ghost text-[10px] h-8 px-2"
        onClick={() => setOpen((v) => !v)}
      >
        {user ? `✓ ${user.email?.split('@')[0]}` : 'Вход'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-[700] w-56 p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl text-xs">
          {user ? (
            <>
              <p className="text-[var(--text-muted)] truncate mb-1">{user.email}</p>
              {authRole && (
                <p className="text-[10px] mb-2">Роль: <span className="text-[var(--accent)]">{USER_ROLE_LABELS[authRole]}</span></p>
              )}
              <button type="button" className="btn btn-secondary w-full text-[10px]" onClick={signOut}>
                Выйти
              </button>
            </>
          ) : (
            <>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@company.kz"
                className="input-optiq w-full h-8 text-xs mb-2"
              />
              <button type="button" disabled={busy || !email.includes('@')} className="btn btn-secondary w-full text-[10px]" onClick={signIn}>
                {busy ? '…' : 'Magic link'}
              </button>
              <p className="text-[9px] text-[var(--text-muted)] mt-2">
                Роль в Supabase: <code>user_metadata.role</code> = engineer | field | viewer
              </p>
            </>
          )}
          {msg && <p className="text-[10px] mt-2 text-[var(--accent)]">{msg}</p>}
        </div>
      )}
    </div>
  );
}
