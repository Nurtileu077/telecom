'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import type { District, Cable, InlineJoint } from '@/types/network';
import { searchNetwork, type SearchHit, type SearchHitKind } from '@/lib/entitySearch';

const KIND_ICON: Record<SearchHitKind, string> = {
  sub: '📷', ork: '📦', tb: '🔗', olt: '📡', cable: '〰', joint: '◆',
};

interface Props {
  districts: District[];
  cables: Cable[];
  joints?: InlineJoint[];
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
  onSelectHit: (hit: SearchHit) => void;
  className?: string;
}

export default function EntityIdSearch({ districts, cables, joints = [], flyTo, onSelectHit, className }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(
    () => searchNetwork(q, districts, cables, joints),
    [q, districts, cables, joints],
  );

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (h: SearchHit) => {
    setOpen(false);
    setQ('');
    onSelectHit(h);
    flyTo?.(h.lat, h.lon, h.kind === 'sub' ? 19 : 17);
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <div className="search-pill min-w-[140px] max-w-[220px]">
        <Search size={14} className="text-[var(--text-muted)] shrink-0" />
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="ID / камера…"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
          aria-label="Поиск по ID камеры или объекта"
        />
      </div>
      {open && hits.length > 0 && (
        <ul className="absolute top-full left-0 right-0 mt-1 z-[600] max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl py-1">
          {hits.map((h) => (
            <li key={`${h.kind}-${h.id}`}>
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--bg-canvas)] text-xs"
                onClick={() => pick(h)}
              >
                <span className="mr-1">{KIND_ICON[h.kind]}</span>
                <span className="text-[var(--text)] truncate">{h.label}</span>
                {h.sublabel && (
                  <span className="block text-[10px] text-[var(--text-muted)] truncate font-mono">{h.sublabel}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
