'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ProjectHistoryEntry } from '@/lib/supabase';

interface Props {
  listProjectHistory: () => Promise<ProjectHistoryEntry[]>;
  restoreHistoryVersion: (id: string) => Promise<void>;
  /** меняется при каждом сохранении — повод обновить список */
  refreshKey?: unknown;
}

export default function ServerHistoryPanel({ listProjectHistory, restoreHistoryVersion, refreshKey }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ProjectHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listProjectHistory());
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [listProjectHistory]);

  useEffect(() => {
    if (open) load();
  }, [open, load, refreshKey]);

  const handleRestore = async (e: ProjectHistoryEntry) => {
    const who = e.saved_by_email ? ` (${e.saved_by_email})` : '';
    if (!confirm(`Восстановить версию от ${new Date(e.created_at).toLocaleString('ru-RU')}${who}?\nТекущее состояние будет заменено.`)) return;
    setBusyId(e.id);
    try {
      await restoreHistoryVersion(e.id);
      await load();
    } catch (err) {
      alert('Ошибка восстановления: ' + (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="border-t border-[#1e3a5f] mt-3 pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-[10px] uppercase tracking-widest text-[#64748b] mb-2 hover:text-[#94a3b8]"
      >
        <span>🕓 История изменений (облако)</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          {loading && <p className="text-[10px] text-[#64748b] italic text-center py-2">Загрузка…</p>}
          {!loading && entries.length === 0 && (
            <p className="text-[10px] text-[#64748b] italic text-center py-2">Пока нет сохранённых версий</p>
          )}
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {entries.map((e, i) => (
              <div key={e.id} className="bg-[#0a0e1a] border border-[#1e3a5f]/50 rounded px-2 py-1.5 group hover:border-[#34d399]/40 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-[#e2e8f0] truncate">
                      {e.saved_by_email || 'неизвестно'}
                      {i === 0 && <span className="ml-1 text-[9px] text-[#34d399]">текущая</span>}
                    </div>
                    <div className="text-[9px] text-[#64748b]">
                      {new Date(e.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(e)}
                    disabled={busyId === e.id}
                    title="Восстановить эту версию"
                    className="text-[10px] px-1.5 py-0.5 bg-[#34d399]/15 text-[#34d399] rounded hover:bg-[#34d399]/25 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {busyId === e.id ? '…' : '↺ Восстановить'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
