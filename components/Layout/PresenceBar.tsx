'use client';

import type { PresenceCursor } from '@/hooks/useProjectPresence';

interface Props {
  onlineCount: number;
  peers: PresenceCursor[];
}

export default function PresenceBar({ onlineCount, peers }: Props) {
  return (
    <div className="shrink-0 px-3 py-1 flex items-center gap-2 text-[10px] border-b border-[#1e3a5f] bg-[#0d1b2a]/80 z-40 overflow-x-auto">
      <span className="text-[#94a3b8] shrink-0">
        В проекте: <b className="text-[#e2e8f0]">{onlineCount}</b>
        {peers.length === 0 && onlineCount <= 1 && (
          <span className="text-[#64748b] font-normal ml-1">(ожидание коллег…)</span>
        )}
      </span>
      {peers.map((p) => (
        <span
          key={p.userId}
          className="shrink-0 px-1.5 py-0.5 rounded border"
          style={{ borderColor: `${p.color}66`, color: p.color }}
        >
          {p.name}
        </span>
      ))}
    </div>
  );
}
