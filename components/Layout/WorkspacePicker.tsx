'use client';
import { Workspace, WORKSPACE_SPECS } from '@/lib/workspace';

/**
 * Первый экран: кто вы сегодня.
 *
 * Спрашиваем один раз и запоминаем. Выбор не запирает — переключатель
 * остаётся в шапке, и данные у обоих рабочих мест общие.
 */

interface Props {
  onPick: (w: Workspace) => void;
}

const ORDER: Workspace[] = ['construction', 'design'];

export default function WorkspacePicker({ onPick }: Props) {
  return (
    <div className="fixed inset-0 z-[10000] bg-[var(--bg-canvas)] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div className="text-center flex flex-col gap-1.5">
          <h1 className="text-[22px] font-semibold text-[var(--text)]">OPTIQ</h1>
          <p className="text-[13px] text-[var(--text-muted)]">
            С чем сегодня работаем? Выбор запомнится, переключиться можно в любой момент.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ORDER.map((w) => {
            const s = WORKSPACE_SPECS[w];
            return (
              <button
                key={w}
                type="button"
                onClick={() => onPick(w)}
                className="group text-left rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]
                           p-5 flex flex-col gap-2 transition-colors
                           hover:border-[var(--accent)] hover:bg-[var(--accent-dim)]"
              >
                <span className="text-[30px] leading-none">{s.icon}</span>
                <span className="text-[16px] font-semibold text-[var(--text)]">{s.label}</span>
                <span className="text-[12.5px] text-[var(--text-muted)] leading-snug">{s.tagline}</span>
              </button>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-[var(--text-muted)]">
          Проект сети и журнал стройки хранятся отдельно — переключение ничего не теряет.
        </p>
      </div>
    </div>
  );
}
