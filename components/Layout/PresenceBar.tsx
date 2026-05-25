'use client';

import { useState } from 'react';
import type { PresenceCursor } from '@/hooks/useProjectPresence';

interface Props {
  onlineCount: number;
  peers: PresenceCursor[];
  selfName?: string;
}

export default function PresenceBar({ onlineCount, peers, selfName }: Props) {
  const [open, setOpen] = useState(false);
  if (onlineCount <= 1 && peers.length === 0) return null;

  return (
    <div className="shrink-0 px-3 py-1 flex items-center gap-2 text-[10px] border-b border-[#1e3a5f] bg-[#0d1b2a]/80 z-40 relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 flex items-center gap-1 text-[#94a3b8] hover:text-[#e2e8f0]"
        title="Кто в проекте"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-pulse" />
        В проекте: {onlineCount}
        <span className="text-[8px]">{open ? '▲' : '▼'}</span>
      </button>
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {peers.map((p) => (
          <span
            key={p.userId}
            className="shrink-0 px-1.5 py-0.5 rounded border"
            style={{ borderColor: `${p.color}66`, color: p.color }}
            title={p.email || p.name}
          >
            {p.email || p.name}{p.activity ? <span className="text-[#94a3b8]"> · {p.activity}</span> : null}
          </span>
        ))}
      </div>

      {open && (
        <div className="absolute left-2 top-full mt-1 z-50 min-w-[200px] bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg shadow-2xl p-2 space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-[#64748b] mb-1">Участники ({onlineCount})</div>
          {selfName && (
            <div className="flex items-center gap-2 text-[11px] text-[#e2e8f0]">
              <span className="w-2 h-2 rounded-full bg-[#34d399]" />
              {selfName} <span className="text-[9px] text-[#64748b]">(вы)</span>
            </div>
          )}
          {peers.map((p) => (
            <div key={p.userId} className="flex items-center gap-2 text-[11px]" style={{ color: p.color }}>
              <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
              <span className="truncate">{p.email || p.name}</span>
              {p.activity && <span className="text-[9px] text-[#64748b]">· {p.activity}</span>}
            </div>
          ))}
          {peers.length === 0 && (
            <div className="text-[10px] text-[#64748b] italic">Остальные участники появятся здесь</div>
          )}
        </div>
      )}
    </div>
  );
}
