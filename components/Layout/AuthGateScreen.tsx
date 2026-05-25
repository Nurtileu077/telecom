'use client';

import Logo from '@/components/Brand/Logo';
import AuthLoginForm from '@/components/Auth/AuthLoginForm';

interface Props {
  requireCloud?: boolean;
}

/** Полноэкранный вход при заходе на сайт (если включён REQUIRE_AUTH). */
export default function AuthGateScreen({ requireCloud = true }: Props) {
  return (
    <div className="fixed inset-0 z-[900] flex flex-col bg-[#060a14]">
      <div className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 20% 30%, #38bdf822 0%, transparent 45%), radial-gradient(circle at 80% 70%, #a78bfa18 0%, transparent 40%)',
        }}
      />
      <div className="relative flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo />
          <h1 className="text-xl font-semibold text-[#e2e8f0] tracking-tight">OPTIQ</h1>
          <p className="text-sm text-[#64748b] text-center max-w-sm">
            Планирование GPON-сети · карта · смета · полевой режим
          </p>
        </div>

        <div className="w-full max-w-[400px] rounded-2xl border border-[#1e3a5f] bg-[#0d1b2a]/90 p-7 shadow-2xl backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-[#e2e8f0] mb-1.5">Вход в систему</h2>
          <p className="text-xs leading-relaxed text-[#64748b] mb-5">
            {requireCloud
              ? 'Для работы с облачными проектами нужен аккаунт вашей организации'
              : 'Войдите, чтобы продолжить'}
          </p>
          <AuthLoginForm onSuccess={() => {}} />
        </div>

        <p className="mt-6 text-[10px] text-[#475569] text-center max-w-md">
          Нет аккаунта? Попросите администратора создать пользователя в Supabase
          (Authentication → Users) с паролем и ролью engineer.
        </p>
      </div>
    </div>
  );
}
