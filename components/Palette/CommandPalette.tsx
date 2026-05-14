'use client';
import { useState, useEffect, useMemo } from 'react';
import type { District } from '@/types/network';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  group: string;
  action: () => void;
  keywords?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  districts: District[];
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
  actions: PaletteAction[];
}

export default function CommandPalette({ open, onClose, districts, flyTo, actions }: Props) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  // Auto-clear query when closed
  useEffect(() => { if (!open) { setQ(''); setIdx(0); } }, [open]);

  // Build searchable index: actions + every OLT/TB/ORK/sub
  const items = useMemo(() => {
    const all: PaletteAction[] = [...actions];
    for (const d of districts) {
      const olt = d.olt;
      all.push({
        id: `olt:${olt.id}`, group: 'Объекты', icon: '📡',
        label: olt.id, hint: `OLT · ${d.name}`,
        keywords: `${olt.id} ${d.name} olt узел`,
        action: () => flyTo?.(olt.lat, olt.lon, 16),
      });
      for (const tb of olt.transitBoxes) {
        all.push({
          id: `tb:${tb.id}`, group: 'Объекты', icon: '🔷',
          label: tb.id, hint: `Муфта · ${d.name} · ОРК: ${tb.orks.length}`,
          keywords: `${tb.id} ${d.name} муфта tb`,
          action: () => flyTo?.(tb.lat, tb.lon, 17),
        });
        for (const ork of tb.orks) {
          all.push({
            id: `ork:${ork.id}`, group: 'Объекты', icon: '📦',
            label: ork.id, hint: `ОРК · ${d.name} · ${ork.subscribers.length} аб.`,
            keywords: `${ork.id} ${d.name} орк`,
            action: () => flyTo?.(ork.lat, ork.lon, 18),
          });
        }
      }
    }
    return all;
  }, [actions, districts, flyTo]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items.slice(0, 30);
    return items.filter((i) => {
      const hay = `${i.label} ${i.hint ?? ''} ${i.keywords ?? ''} ${i.group}`.toLowerCase();
      return query.split(/\s+/).every((tok) => hay.includes(tok));
    }).slice(0, 60);
  }, [items, q]);

  // Reset index when filter changes
  useEffect(() => { setIdx(0); }, [q]);

  // Keyboard nav while open
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const it = filtered[idx];
        if (it) { it.action(); onClose(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, idx, onClose]);

  if (!open) return null;

  // Group by section for display
  const grouped = new Map<string, PaletteAction[]>();
  filtered.forEach((f) => {
    if (!grouped.has(f.group)) grouped.set(f.group, []);
    grouped.get(f.group)!.push(f);
  });

  let runningIdx = -1;

  return (
    <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl w-[560px] max-h-[70vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#1e3a5f]">
          <span className="text-[#64748b]">⌘</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск действия, района, ОРК, муфты или OLT..."
            className="flex-1 bg-transparent text-sm text-[#e2e8f0] focus:outline-none placeholder:text-[#64748b]"
          />
          <kbd className="text-[9px] text-[#64748b] border border-[#1e3a5f] rounded px-1 py-0.5">Esc</kbd>
        </div>

        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-[#64748b]">Ничего не найдено</div>
          )}
          {Array.from(grouped.entries()).map(([group, gItems]) => (
            <div key={group}>
              <div className="sticky top-0 bg-[#0d1b2a]/95 backdrop-blur px-3 py-1 text-[9px] uppercase tracking-widest text-[#64748b] border-b border-[#1e3a5f]/30">
                {group}
              </div>
              {gItems.map((it) => {
                runningIdx++;
                const active = runningIdx === idx;
                return (
                  <button
                    key={it.id}
                    onClick={() => { it.action(); onClose(); }}
                    onMouseEnter={() => setIdx(runningIdx)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${active ? 'bg-[#38bdf8]/15' : 'hover:bg-[#1e293b]/50'}`}
                  >
                    <span className="text-base flex-shrink-0">{it.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-[#e2e8f0] truncate">{it.label}</div>
                      {it.hint && <div className="text-[10px] text-[#64748b] truncate">{it.hint}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="px-3 py-1.5 border-t border-[#1e3a5f] text-[9px] text-[#475569] flex items-center justify-between">
          <span>↑↓ навигация · ↵ выбрать · Esc закрыть</span>
          <span>{filtered.length} результатов</span>
        </div>
      </div>
    </div>
  );
}
