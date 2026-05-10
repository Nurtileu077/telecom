'use client';
import { useState } from 'react';
import { District } from '@/types/network';

interface Props {
  districts: District[];
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
}

export default function GroupsTab({ districts, flyTo }: Props) {
  const [expandedOrk, setExpandedOrk] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  if (districts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">👥</div>
        <p className="text-sm text-[#94a3b8]">Постройте сеть для просмотра групп</p>
      </div>
    );
  }

  const allOrks = districts.flatMap((d) =>
    d.olt.transitBoxes.flatMap((tb) =>
      tb.orks.map((ork) => ({ ork, district: d, tb }))
    )
  );

  const filtered = search
    ? allOrks.filter((x) =>
        x.ork.id.toLowerCase().includes(search.toLowerCase()) ||
        x.district.name.toLowerCase().includes(search.toLowerCase()) ||
        x.ork.subscribers.some((s) => s.desc.toLowerCase().includes(search.toLowerCase()))
      )
    : allOrks;

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-[#1e3a5f]">
        <input
          type="text"
          placeholder="Поиск ОРК, района, адреса..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] placeholder-[#64748b] focus:outline-none focus:border-[#38bdf8]"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.map(({ ork, district, tb }) => {
          const maxSub = ork.splitter === '1:4' ? 4 : ork.splitter === '1:8' ? 8 : 16;
          const load = ork.subscribers.length / maxSub;
          const isExpanded = expandedOrk === ork.id;

          return (
            <div key={ork.id} className="border-b border-[#1e3a5f]/50">
              <button
                onClick={() => {
                  setExpandedOrk(isExpanded ? null : ork.id);
                  flyTo?.(ork.lat, ork.lon, 17);
                }}
                className="w-full px-3 py-2 text-left hover:bg-[#1a2744]/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: district.color }} />
                  <span className="text-xs font-mono text-[#e2e8f0] font-medium">{ork.id}</span>
                  <span className="text-[10px] text-[#64748b] ml-auto">
                    {ork.subscribers.length}/{maxSub} | PLC {ork.splitter}
                  </span>
                </div>
                <div className="mt-1 ml-4">
                  <div className="h-1 bg-[#1e3a5f] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, load * 100)}%`,
                        background: load >= 1 ? '#f87171' : load >= 0.75 ? '#f59e0b' : '#34d399',
                      }}
                    />
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="bg-[#0a0e1a]/50 border-t border-[#1e3a5f]/30">
                  {ork.subscribers.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => flyTo?.(sub.lat, sub.lon, 18)}
                      className="w-full px-4 py-1.5 text-left text-[11px] text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1a2744]/30 transition-colors truncate"
                    >
                      • {sub.desc}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
