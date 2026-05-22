'use client';

import { useState } from 'react';
import { LogIn, Mail, Cloud } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { authSignInOtp } from '@/lib/authSession';

interface Props {
  /** Открыть выпадашку «Вход» в шапке (дополнительно) */
  onOpenHeaderAuth?: () => void;
}

export default function AuthRequiredBanner({ onOpenHeaderAuth }: Props) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const signIn = async () => {
    if (!supabase) {
      setMsg({ type: 'err', text: 'Supabase не настроен на сервере (URL и anon key)' });
      return;
    }
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setMsg({ type: 'err', text: 'Введите корректный email' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await authSignInOtp(trimmed);
      setMsg({ type: 'ok', text: 'Ссылка для входа отправлена на почту — откройте письмо' });
    } catch (e) {
      setMsg({
        type: 'err',
        text: e instanceof Error ? e.message : 'Не удалось отправить письмо',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 z-50 border-b border-[#38bdf8]/25 bg-gradient-to-r from-[#0d1b2a] via-[#0f2847] to-[#0d1b2a] px-3 py-2.5">
      <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-[#38bdf8]/15 border border-[#38bdf8]/30 flex items-center justify-center">
            <Cloud size={16} className="text-[#38bdf8]" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-[#e2e8f0] leading-snug">
              Войдите, чтобы сохранять проекты в облако и работать в команде
            </p>
            <p className="text-[10px] text-[#64748b] mt-0.5">
              Magic link на email · без пароля
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 w-full sm:w-auto sm:min-w-[280px]">
          <div className="relative flex-1">
            <Mail size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#64748b] pointer-events-none" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && signIn()}
              placeholder="email@company.kz"
              className="input-optiq w-full h-9 pl-8 text-xs rounded-lg border-[#1e3a5f] bg-[#0a0e1a]/80"
              autoComplete="email"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={signIn}
            className="btn h-9 px-3 text-[11px] font-semibold shrink-0 bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#0a0e1a] border-0 rounded-lg disabled:opacity-50"
          >
            <LogIn size={14} className="inline mr-1 -mt-px" />
            {busy ? 'Отправка…' : 'Войти'}
          </button>
        </div>
      </div>

      {msg && (
        <p
          className={`max-w-3xl mx-auto mt-2 text-[10px] text-center ${
            msg.type === 'ok' ? 'text-[#34d399]' : 'text-[#f87171]'
          }`}
        >
          {msg.text}
        </p>
      )}

      {onOpenHeaderAuth && (
        <p className="max-w-3xl mx-auto mt-1 text-[9px] text-center text-[#64748b]">
          Или{' '}
          <button type="button" className="text-[#38bdf8] hover:underline" onClick={onOpenHeaderAuth}>
            форма входа в шапке справа
          </button>
        </p>
      )}
    </div>
  );
}
