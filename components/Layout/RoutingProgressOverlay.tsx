'use client';
import type { BuildStatus } from '@/hooks/useNetwork';

interface OSRMProgress {
  done: number;
  total: number;
  current: string;
}

const LABELS: Partial<Record<BuildStatus, { title: string; sub: string }>> = {
  routing: { title: 'Прокладка по дорогам', sub: 'OSRM · Night Fiber' },
  clustering: { title: 'Построение сети', sub: 'Группировка и размещение узлов' },
  importing: { title: 'Импорт данных', sub: 'Чтение файла…' },
  calculating: { title: 'Расчёт', sub: 'Материалы и смета' },
};

interface Props {
  status: BuildStatus;
  progress: OSRMProgress;
  percent: number;
  onStop?: () => void;
}

export default function RoutingProgressOverlay({ status, progress, percent, onStop }: Props) {
  const meta = LABELS[status];
  if (!meta) return null;

  const hasTotal = progress.total > 0;
  const pct = hasTotal ? percent : undefined;

  return (
    <div className="routing-overlay" role="status" aria-live="polite">
      <div className="routing-overlay__card glass animate-fade-in">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text)]">{meta.title}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{meta.sub}</p>
          </div>
          {hasTotal && (
            <span className="text-lg font-mono font-bold text-[var(--accent)] shrink-0">
              {pct}%
            </span>
          )}
        </div>

        <div className="h-2.5 bg-[var(--bg-canvas)] rounded-full overflow-hidden mb-2">
          {hasTotal ? (
            <div className="progress-bar h-full transition-[width] duration-300" style={{ width: `${pct}%` }} />
          ) : (
            <div className="routing-overlay__indeterminate h-full w-1/3 rounded-full" />
          )}
        </div>

        <div className="flex justify-between gap-2 text-[11px] text-[var(--text-2)] mb-3 min-h-[16px]">
          <span className="truncate flex-1">{progress.current || 'Подготовка…'}</span>
          {hasTotal && (
            <span className="font-mono text-[var(--accent)] shrink-0">
              {progress.done}/{progress.total}
            </span>
          )}
        </div>

        {status === 'routing' && onStop && (
          <button
            type="button"
            className="btn btn-ghost w-full text-[var(--danger)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)]"
            onClick={onStop}
          >
            Остановить
          </button>
        )}
      </div>
    </div>
  );
}
