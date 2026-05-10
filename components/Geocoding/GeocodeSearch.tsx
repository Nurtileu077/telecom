'use client';
import { useState, useEffect, useRef } from 'react';
import { geocode, GeocodeResult } from './Geocoder';

interface Props {
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
}

export default function GeocodeSearch({ flyTo }: Props) {
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
    <div ref={containerRef} className="relative">
      <div className="flex items-center bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg pl-2 pr-1 py-1 focus-within:border-[#38bdf8] transition-colors w-64">
        <span className="text-[#64748b] text-xs">🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Поиск адреса / места..."
          className="flex-1 bg-transparent border-none outline-none text-xs text-[#e2e8f0] placeholder-[#64748b] px-1.5"
        />
        {loading && <span className="text-[10px] text-[#64748b]">...</span>}
        {query && !loading && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }} className="text-[#64748b] hover:text-[#e2e8f0] text-xs px-1">×</button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg shadow-2xl max-h-72 overflow-y-auto z-[1000]">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => handlePick(r)}
              className="w-full text-left px-3 py-2 hover:bg-[#1a2744] border-b border-[#1e3a5f]/40 last:border-b-0 transition-colors"
            >
              <div className="text-xs text-[#e2e8f0] truncate">{r.displayName}</div>
              <div className="text-[9px] text-[#64748b] font-mono">{r.lat.toFixed(5)}, {r.lon.toFixed(5)} · {r.type}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
