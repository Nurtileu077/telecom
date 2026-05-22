'use client';
import type { AuditEntry } from '@/types/network';

interface Props {
  entries: AuditEntry[];
  max?: number;
}

export default function AuditLogPanel({ entries, max = 25 }: Props) {
  const list = entries.slice(0, max);
  if (list.length === 0) {
    return (
      <div className="text-[10px] text-[#64748b] text-center py-4 border border-dashed border-[#1e3a5f] rounded-lg">
        Журнал действий пуст
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">
        Журнал ({entries.length})
      </h3>
      <ul className="space-y-1 max-h-48 overflow-y-auto text-[10px]">
        {list.map((e) => (
          <li key={e.id} className="border-b border-[#1e3a5f]/40 pb-1">
            <div className="flex justify-between gap-2">
              <span className="text-[#e2e8f0] font-medium">{e.action}</span>
              <time className="text-[#64748b] shrink-0 font-mono">
                {new Date(e.at).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </time>
            </div>
            {e.detail && <div className="text-[#94a3b8] truncate">{e.detail}</div>}
            {e.actor && <div className="text-[#64748b]">👤 {e.actor}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
