'use client';

interface Props {
  serverName: string;
  serverUpdatedAt: string;
  onLoadServer: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
}

export default function SaveConflictModal({
  serverName, serverUpdatedAt, onLoadServer, onOverwrite, onCancel,
}: Props) {
  const when = new Date(serverUpdatedAt).toLocaleString('ru');

  return (
    <div className="fixed inset-0 z-[800] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#f87171]/50 bg-[var(--bg-surface)] p-4 shadow-2xl animate-fade-in">
        <h2 className="text-sm font-semibold text-[#f87171] mb-2">Конфликт версий</h2>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Пока вы редактировали, проект <strong className="text-[var(--text)]">{serverName}</strong> был
          сохранён на сервере ({when}). Ваши локальные правки не записаны в Supabase.
        </p>
        <div className="flex flex-col gap-2">
          <button type="button" className="btn btn-secondary w-full text-xs" onClick={onLoadServer}>
            Загрузить версию с сервера
          </button>
          <button type="button" className="btn btn-ghost w-full text-xs text-[#fbbf24] border border-[#fbbf24]/40" onClick={onOverwrite}>
            Перезаписать сервер моей версией
          </button>
          <button type="button" className="btn btn-ghost w-full text-xs" onClick={onCancel}>
            Отмена (остаться локально)
          </button>
        </div>
      </div>
    </div>
  );
}
