'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Star, Clock } from 'lucide-react';
import {
  searchJournal, JournalHit, JournalSearchSources,
  JOURNAL_HIT_ICON, JOURNAL_HIT_LABEL,
} from '@/components/Construction/journalSearch';
import {
  loadBookmarks, saveBookmarks, toggleBookmark, isBookmarked,
  loadRecent, saveRecent, pushRecent, type Shortcut,
} from '@/lib/shortcuts';

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

  /**
   * Закладки и недавнее.
   *
   * За объект отвечают три-четыре участка, и на них смотрят каждый день.
   * Путь до них всегда один и тот же — поиск, прокрутка, ещё раз поиск.
   */
  const [bookmarks, setBookmarks] = useState<Shortcut[]>([]);
  const [recent, setRecent] = useState<Shortcut[]>([]);
  useEffect(() => {
    setBookmarks(loadBookmarks());
    setRecent(loadRecent());
  }, []);

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

  function shortcutOf(hit: JournalHit): Shortcut {
    return {
      kind: hit.kind === 'snp' ? 'snp' : hit.kind === 'route' ? 'route' : 'object',
      id: hit.id,
      label: hit.label,
      sublabel: hit.sublabel,
      lat: hit.lat,
      lon: hit.lon,
      zoom: hit.zoom,
      at: new Date().toISOString(),
    };
  }

  function pick(hit: JournalHit) {
    onPick(hit);
    setRecent((prev) => {
      const next = pushRecent(prev, shortcutOf(hit));
      saveRecent(next);
      return next;
    });
    setOpen(false);
    inputRef.current?.blur();
  }

  function goTo(s: Shortcut) {
    onPick({
      kind: s.kind === 'snp' ? 'snp' : s.kind === 'route' ? 'route' : 'object',
      id: s.id,
      label: s.label,
      sublabel: s.sublabel,
      lat: s.lat ?? 0,
      lon: s.lon ?? 0,
      zoom: s.zoom ?? 14,
      rank: 0,
    });
    setOpen(false);
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

      {/* Пока не набрали — показываем то, куда и так ходят каждый день. */}
      {open && q.trim().length < 2 && (bookmarks.length > 0 || recent.length > 0) && (
        <div className="mt-1 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a]/98 backdrop-blur
                        shadow-2xl overflow-hidden w-[190px] md:w-[240px] max-h-[50vh] overflow-y-auto">
          {bookmarks.length > 0 && (
            <>
              <div className="px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wide text-[#64748b]">
                Закладки
              </div>
              {bookmarks.map((b) => (
                <button key={`b-${b.kind}-${b.id}`} type="button" onClick={() => goTo(b)}
                        className="w-full px-2.5 py-1.5 text-left hover:bg-white/5 flex items-baseline gap-2">
                  <Star size={11} className="text-[#fbbf24] shrink-0" />
                  <span className="min-w-0 flex-1 text-[12px] text-[#e2e8f0] truncate">{b.label}</span>
                </button>
              ))}
            </>
          )}
          {recent.length > 0 && (
            <>
              <div className="px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wide text-[#64748b]">
                Недавнее
              </div>
              {recent.map((r) => (
                <button key={`r-${r.kind}-${r.id}`} type="button" onClick={() => goTo(r)}
                        className="w-full px-2.5 py-1.5 text-left hover:bg-white/5 flex items-baseline gap-2">
                  <Clock size={11} className="text-[#64748b] shrink-0" />
                  <span className="min-w-0 flex-1 text-[12px] text-[#e2e8f0] truncate">{r.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {open && q.trim().length >= 2 && (
        <div className="mt-1 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a]/98 backdrop-blur
                        shadow-2xl overflow-hidden w-[190px] md:w-[240px] max-h-[50vh] overflow-y-auto">
          {hits.length === 0 ? (
            <div className="px-2.5 py-2 text-[11px] text-[#64748b]">
              Ничего не нашлось. Ищем по сёлам, трассам, ККС, муфтам, колоннам и авариям.
            </div>
          ) : hits.map((h, i) => (
            // Кнопка в кнопку вкладываться не может, поэтому строка —
            // это ряд из двух кнопок: перейти и в закладки.
            <div
              key={`${h.kind}-${h.id}`}
              onMouseEnter={() => setCursor(i)}
              className={`w-full px-2.5 py-1.5 flex items-baseline gap-2 ${
                i === cursor ? 'bg-[#2dd4bf]/10' : 'hover:bg-white/5'}`}
            >
              <button
                type="button"
                onClick={() => pick(h)}
                className="min-w-0 flex-1 text-left flex items-baseline gap-2"
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
              <button
                type="button"
                aria-label={isBookmarked(bookmarks, shortcutOf(h)) ? 'Убрать из закладок' : 'В закладки'}
                title={isBookmarked(bookmarks, shortcutOf(h)) ? 'Убрать из закладок' : 'В закладки'}
                onClick={() => setBookmarks((prev) => {
                  const next = toggleBookmark(prev, shortcutOf(h));
                  saveBookmarks(next);
                  return next;
                })}
                className="shrink-0"
              >
                <Star
                  size={12}
                  className={isBookmarked(bookmarks, shortcutOf(h))
                    ? 'text-[#fbbf24]' : 'text-[#475569] hover:text-[#fbbf24]'}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
