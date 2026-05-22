'use client';
import type { FieldChecklist } from '@/types/network';
import { checklistProgress, toggleChecklistItem } from '@/lib/fieldChecklist';

interface Props {
  checklist: FieldChecklist;
  onChange: (next: FieldChecklist) => void;
}

export default function FieldChecklistPanel({ checklist, onChange }: Props) {
  const { done, total, pct } = checklistProgress(checklist);

  return (
    <div className="rounded-lg border border-[#1e3a5f] bg-[#0a0e1a]/80 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[#64748b]">Чеклист монтажа</span>
        <span className="text-[10px] font-mono text-[#34d399]">{done}/{total} · {pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-[#1e3a5f] overflow-hidden">
        <div className="h-full bg-[#34d399] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-1">
        {checklist.items.map((item) => (
          <li key={item.id}>
            <label className="flex items-start gap-2 cursor-pointer text-[11px] text-[#e2e8f0]">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(e) => onChange(toggleChecklistItem(checklist, item.id, e.target.checked))}
                className="mt-0.5 shrink-0"
              />
              <span className={item.done ? 'line-through text-[#64748b]' : ''}>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
