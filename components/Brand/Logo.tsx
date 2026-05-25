'use client';
import { APP_NAME, APP_TAGLINE } from '@/lib/branding';

export default function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div className="relative w-9 h-9 rounded-[10px] flex items-center justify-center bg-[var(--accent-dim)] border border-[color-mix(in_srgb,var(--accent)_28%,transparent)]">
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
          <path d="M6 8c8 0 8 16 16 16" stroke="url(#og)" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M26 8c-8 0-8 16-16 16" stroke="url(#og)" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
          <circle cx="16" cy="16" r="3" fill="#2dd4bf" />
          <defs>
            <linearGradient id="og" x1="6" y1="8" x2="26" y2="24">
              <stop stopColor="#2dd4bf" />
              <stop offset="1" stopColor="#818cf8" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      {!compact && (
        <div className="hidden sm:block min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-[var(--text)] leading-none">{APP_NAME}</div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate max-w-[160px] hidden lg:block">{APP_TAGLINE}</div>
        </div>
      )}
    </div>
  );
}
