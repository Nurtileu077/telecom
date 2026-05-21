'use client';

interface Action {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  actions: Action[];
}

export default function MobileActionSheet({ open, onClose, actions }: Props) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[480] bg-black/50 md:hidden"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div className="mobile-sheet md:hidden animate-fade-in">
        <div className="w-10 h-1 rounded-full bg-[var(--border-strong)] mx-auto mb-3" />
        <p className="text-xs font-semibold text-[var(--text-muted)] text-center mb-3">Добавить на карте</p>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { a.onClick(); onClose(); }}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-canvas)] hover:border-[var(--accent)]/40 active:scale-[0.98]"
            >
              <span className="text-xl">{a.icon}</span>
              <span className="text-[11px] font-medium text-[var(--text)]">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
