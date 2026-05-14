'use client';
import { useState } from 'react';
import type { ProjectSnapshot } from '@/types/network';

interface Props {
  snapshots: ProjectSnapshot[];
  takeSnapshot: (name: string) => ProjectSnapshot;
  restoreSnapshot: (id: string) => void;
  deleteSnapshot: (id: string) => void;
}

export default function SnapshotsPanel({ snapshots, takeSnapshot, restoreSnapshot, deleteSnapshot }: Props) {
  const [name, setName] = useState('');

  const handleTake = () => {
    const finalName = name.trim() || `Снимок ${new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    takeSnapshot(finalName);
    setName('');
  };

  return (
    <div className="border-t border-[#1e3a5f] mt-3 pt-3">
      <h4 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">📸 Снимки версий</h4>
      <div className="flex gap-1 mb-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleTake(); }}
          placeholder="Название снимка"
          className="flex-1 bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#a78bfa]"
        />
        <button
          onClick={handleTake}
          className="px-2 py-1 bg-[#a78bfa]/15 text-[#a78bfa] text-xs rounded hover:bg-[#a78bfa]/25 transition-colors"
          title="Сохранить текущее состояние"
        >
          + Снять
        </button>
      </div>
      {snapshots.length === 0 && (
        <p className="text-[10px] text-[#64748b] italic text-center py-2">Нет снимков</p>
      )}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {snapshots.map((s) => {
          const subs = s.snapshot.districts.reduce((acc, d) => acc + d.subscribers.length, 0);
          return (
            <div key={s.id} className="bg-[#0a0e1a] border border-[#1e3a5f]/50 rounded px-2 py-1.5 group hover:border-[#a78bfa]/40 transition-colors">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-[#e2e8f0] truncate">{s.name}</div>
                  <div className="text-[9px] text-[#64748b]">
                    {new Date(s.takenAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{s.snapshot.districts.length} р · {subs} або · {s.snapshot.cables.length} каб
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => restoreSnapshot(s.id)}
                    title="Восстановить"
                    className="text-[#34d399] hover:text-[#6ee7b7] text-xs px-1"
                  >↺</button>
                  <button
                    onClick={() => { if (confirm(`Удалить снимок «${s.name}»?`)) deleteSnapshot(s.id); }}
                    title="Удалить"
                    className="text-[#f87171] hover:text-red-400 text-xs px-1"
                  >×</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
