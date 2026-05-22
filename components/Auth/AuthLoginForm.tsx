'use client';

import { useState } from 'react';
import { LogIn, Mail, Lock, Link2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { authSignInOtp, authSignInPassword } from '@/lib/authSession';

type Mode = 'password' | 'magic';

interface Props {
  compact?: boolean;
  onSuccess?: () => void;
}

export default function AuthLoginForm({ compact, onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const submit = async () => {
    if (!supabase) {
      setMsg({ type: 'err', text: 'Облако не настроено (URL и anon key в Vercel)' });
      return;
    }
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setMsg({ type: 'err', text: 'Введите email, например name@company.kz' });
      return;
    }
    if (mode === 'password' && password.length < 6) {
      setMsg({ type: 'err', text: 'Пароль не короче 6 символов' });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'password') {
        await authSignInPassword(trimmed, password);
        setMsg({ type: 'ok', text: 'Вы вошли' });
        onSuccess?.();
      } else {
        await authSignInOtp(trimmed);
        setMsg({ type: 'ok', text: 'Ссылка отправлена на почту' });
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Ошибка входа';
      setMsg({
        type: 'err',
        text: text.includes('Invalid login')
          ? 'Неверный email или пароль'
          : text,
      });
    } finally {
      setBusy(false);
    }
  };

  const tabCls = (m: Mode) =>
    `px-2.5 py-1 text-[10px] rounded-md transition-colors ${
      mode === m
        ? 'bg-[#38bdf8]/20 text-[#38bdf8] font-semibold'
        : 'text-[#64748b] hover:text-[#94a3b8]'
    }`;

  return (
    <div className={compact ? 'w-full' : 'w-full max-w-md'}>
      <div className="flex gap-1 mb-2">
        <button type="button" className={tabCls('password')} onClick={() => { setMode('password'); setMsg(null); }}>
          Пароль
        </button>
        <button type="button" className={tabCls('magic')} onClick={() => { setMode('magic'); setMsg(null); }}>
          Ссылка на email
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label className="block">
          <span className="sr-only">Email</span>
          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.kz"
              autoComplete="email"
              className="input-optiq w-full min-w-[200px] h-10 pl-9 pr-3 text-sm rounded-lg border-[#1e3a5f] bg-[#0a0e1a]"
            />
          </div>
        </label>

        {mode === 'password' && (
          <label className="block">
            <span className="sr-only">Пароль</span>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль"
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className="input-optiq w-full min-w-[200px] h-10 pl-9 pr-3 text-sm rounded-lg border-[#1e3a5f] bg-[#0a0e1a]"
              />
            </div>
          </label>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="btn h-10 w-full text-sm font-semibold bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#0a0e1a] border-0 rounded-lg disabled:opacity-50"
        >
          {mode === 'password' ? (
            <><LogIn size={16} className="inline mr-1.5 -mt-0.5" />{busy ? 'Вход…' : 'Войти'}</>
          ) : (
            <><Link2 size={16} className="inline mr-1.5 -mt-0.5" />{busy ? 'Отправка…' : 'Отправить ссылку'}</>
          )}
        </button>
      </div>

      {msg && (
        <p className={`mt-2 text-[11px] ${msg.type === 'ok' ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
