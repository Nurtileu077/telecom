'use client';
import type { AppViewMode } from '@/types/network';

interface Props {
  mode: AppViewMode;
  onCopyShareLink?: () => void;
}

export default function ReadOnlyBanner({ mode, onCopyShareLink }: Props) {
  if (mode === 'edit') return null;
  const label = mode === 'view'
    ? 'Режим просмотра — изменения отключены'
    : 'Полевой режим — чеклист и фото';

  return (
    <div
      className="shrink-0 px-3 py-1.5 text-center text-[11px] border-b z-40"
      style={{
        background: mode === 'view' ? 'color-mix(in srgb, #38bdf8 12%, var(--bg-surface))' : 'color-mix(in srgb, #fbbf24 12%, var(--bg-surface))',
        borderColor: mode === 'view' ? '#38bdf844' : '#fbbf2444',
        color: mode === 'view' ? '#38bdf8' : '#fbbf24',
      }}
    >
      <span>{label}</span>
      {mode === 'view' && onCopyShareLink && (
        <button
          type="button"
          onClick={onCopyShareLink}
          className="ml-2 underline hover:no-underline"
        >
          Скопировать ссылку
        </button>
      )}
    </div>
  );
}
