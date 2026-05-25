'use client';
import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { geocode, GeocodeResult } from './Geocoder';

interface Props {
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
  className?: string;
}

export default function GeocodeSearch({ flyTo, className }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim() || query.length < 3) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const r = await geocode(query);
      setResults(r);
      setLoading(false);
      setOpen(true);
    }, 400);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handlePick = (r: GeocodeResult) => {
    flyTo?.(r.lat, r.lon, 16);
    setOpen(false);
    setQuery(r.displayName.split(',').slice(0, 2).join(','));
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && results[0]) handlePick(results[0]);
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div ref={containerRef} className={className ?? 'relative hidden md:block'}>
      <div className="search-pill max-md:min-w-0 max-md:w-full">
        <Search size={14} className="text-[var(--text-muted)] shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Адрес или место…"
          className="flex-1 bg-transparent border-none outline-none text-xs text-[var(--text)] placeholder-[var(--text-muted)] min-w-0"
        />
        {loading && <span className="text-[10px] text-[var(--text-muted)]">…</span>}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 panel max-h-72 overflow-y-auto z-[1000]">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handlePick(r)}
              className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] border-b border-[var(--border)] last:border-b-0"
            >
              <div className="text-xs text-[var(--text)] truncate">{r.displayName}</div>
              <div className="text-[10px] text-[var(--text-muted)] font-mono">{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
