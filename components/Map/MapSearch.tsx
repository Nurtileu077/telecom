'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  searchJournal, JournalHit, JournalSearchSources,
  JOURNAL_HIT_ICON, JOURNAL_HIT_LABEL,
} from '@/components/Construction/journalSearch';

/**
 * Поиск по карте.
 *
 * Чтобы посмотреть Серафимовку, карту мотали руками: сначала на область,
 * потом на район, потом глазами вдоль трассы. Название села человек
 * знает с самого начала — и часто это единственное, что он знает.
 *
 * Ищем по всему сразу и открываем найденное: село — издали, муфту —
 * вплотную, трассу — рамкой по всей линии.
 */

interface Props {
  sources: JournalSearchSources;
  onPick: (hit: JournalHit) => void;
  className?: string;
}

export default function MapSearch({ sources, onPick, className }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchJournal(q, sources), [q, sources]);

  useEffect(() => { setCursor(0); }, [q]);

  // Ctrl+K и «/» — то, чем открывают поиск везде, и объяснять это не надо.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (((e.key === 'k' || e.key === 'к') && (e.metaKey || e.ctrlKey))
          || (e.key === '/' && !typing)) {
        e.preventDefault();
        setOpen(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Клик мимо закрывает список, но не стирает набранное.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(hit: JournalHit) {
    onPick(hit);
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % hits.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + hits.length) % hits.length); }
    if (e.key === 'Enter') { e.preventDefault(); pick(hits[Math.min(cursor, hits.length - 1)]); }
  }

  return (
    <div className={className} ref={boxRef}>
      <div className="flex items-center gap-1.5 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a]/95
                      backdrop-blur shadow-lg px-2 py-1.5 w-[190px] md:w-[240px]">
        <Search size={14} className="text-[#64748b] shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Село, трасса, ККС…"
          aria-label="Поиск по карте"
          className="flex-1 min-w-0 bg-transparent text-[12px] text-[#e2e8f0]
                     placeholder:text-[#64748b] focus:outline-none"
        />
        {q ? (
          <button
            type="button"
            onClick={() => { setQ(''); inputRef.current?.focus(); }}
            aria-label="Очистить"
            className="text-[#64748b] hover:text-[#e2e8f0] shrink-0"
          >
            <X size={13} />
          </button>
        ) : (
          <kbd className="text-[9px] text-[#64748b] border border-[#1e3a5f] rounded px-1 shrink-0">
            /
          </kbd>
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="mt-1 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a]/98 backdrop-blur
                        shadow-2xl overflow-hidden w-[190px] md:w-[240px] max-h-[50vh] overflow-y-auto">
          {hits.length === 0 ? (
            <div className="px-2.5 py-2 text-[11px] text-[#64748b]">
              Ничего не нашлось. Ищем по сёлам, трассам, ККС, муфтам, колоннам и авариям.
            </div>
          ) : hits.map((h, i) => (
            <button
              key={`${h.kind}-${h.id}`}
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(h)}
              className={`w-full px-2.5 py-1.5 text-left flex items-baseline gap-2 ${
                i === cursor ? 'bg-[#2dd4bf]/10' : 'hover:bg-white/5'}`}
            >
              <span className="text-[11px] shrink-0">{JOURNAL_HIT_ICON[h.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-[#e2e8f0] truncate">{h.label}</span>
                {h.sublabel && (
                  <span className="block text-[10px] text-[#64748b] truncate">{h.sublabel}</span>
                )}
              </span>
              <span className="text-[9px] text-[#475569] shrink-0">
                {JOURNAL_HIT_LABEL[h.kind]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
