'use client';

interface Props {
  onOpenAuth?: () => void;
}

export default function AuthRequiredBanner({ onOpenAuth }: Props) {
  return (
    <div
      className="shrink-0 px-3 py-2 text-center text-[11px] border-b z-50"
      style={{
        background: 'color-mix(in srgb, #f87171 14%, var(--bg-surface))',
        borderColor: '#f8717144',
        color: '#f87171',
      }}
    >
      Вход обязателен для работы с облаком (
      <code className="text-[10px]">NEXT_PUBLIC_OPTIQ_REQUIRE_AUTH</code>
      ).
      {onOpenAuth && (
        <button type="button" className="ml-2 underline hover:no-underline" onClick={onOpenAuth}>
          Войти
        </button>
      )}
    </div>
  );
}
