'use client';

import { useState, useMemo } from 'react';
import { District } from '@/types/network';
import { List, GitBranch, LayoutGrid } from 'lucide-react';

type SchemaView = 'tree' | 'list' | 'diagram';

interface Props {
  districts: District[];
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
}

export default function SchemaTab({ districts, flyTo }: Props) {
  const [view, setView] = useState<SchemaView>('tree');

  const flat = useMemo(() => {
    const rows: { kind: string; id: string; name: string; parent?: string; lat: number; lon: number; extra?: string }[] = [];
    for (const d of districts) {
      rows.push({ kind: 'OLT', id: d.olt.id, name: d.olt.displayName || d.olt.id, lat: d.olt.lat, lon: d.olt.lon, extra: d.name });
      for (const tb of d.olt.transitBoxes) {
        rows.push({ kind: 'Муфта', id: tb.id, name: tb.displayName || tb.id, parent: d.olt.id, lat: tb.lat, lon: tb.lon });
        for (const ork of tb.orks) {
          rows.push({ kind: 'ОРК', id: ork.id, name: ork.displayName || ork.id, parent: tb.id, lat: ork.lat, lon: ork.lon, extra: `${ork.subscribers.length} кам.` });
          for (const sub of ork.subscribers) {
            rows.push({ kind: 'Бокс', id: sub.id, name: sub.desc || sub.id, parent: ork.id, lat: sub.lat, lon: sub.lon, extra: sub.desc });
          }
        }
      }
    }
    return rows;
  }, [districts]);

  if (districts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">🌳</div>
        <p className="text-sm text-[#94a3b8]">Постройте сеть для просмотра топологии</p>
      </div>
    );
  }

  const tab = (v: SchemaView, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] rounded-md border transition-colors ${
        view === v
          ? 'bg-[#38bdf8]/15 border-[#38bdf8]/40 text-[#38bdf8]'
          : 'border-[#1e3a5f] text-[#64748b] hover:text-[#94a3b8]'
      }`}
    >
      {icon}{label}
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 p-2 border-b border-[#1e3a5f] flex gap-1">
        {tab('tree', <GitBranch size={12} />, 'Дерево')}
        {tab('list', <List size={12} />, 'Список')}
        {tab('diagram', <LayoutGrid size={12} />, 'Схема')}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {view === 'tree' && (
          <div className="p-3 font-mono text-xs">
            {districts.map((d) => (
              <div key={d.name} className="mb-4">
                <button
                  type="button"
                  onClick={() => flyTo?.(d.olt.lat, d.olt.lon, 13)}
                  className="flex items-center gap-2 mb-1 hover:text-[#38bdf8] text-left w-full"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-[#e2e8f0] font-semibold">{d.name}</span>
                </button>
                <div className="ml-3 text-[#f59e0b]">📡 {d.olt.displayName || d.olt.id}</div>
                {d.olt.transitBoxes.map((tb, ti) => (
                  <div key={tb.id} className="ml-3">
                    <button type="button" onClick={() => flyTo?.(tb.lat, tb.lon, 15)} className="text-[#38bdf8] hover:text-[#7dd3fc] text-left">
                      {ti < d.olt.transitBoxes.length - 1 ? '├─' : '└─'} 🔷 {tb.displayName || tb.id}
                    </button>
                    {tb.orks.map((ork, oi) => (
                      <div key={ork.id} className="ml-5">
                        <button type="button" onClick={() => flyTo?.(ork.lat, ork.lon, 17)} className="text-[#a78bfa] hover:text-[#c4b5fd] text-left">
                          {oi < tb.orks.length - 1 ? '├─' : '└─'} 📦 {ork.displayName || ork.id}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {view === 'list' && (
          <div className="p-2">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[#64748b] text-left border-b border-[#1e3a5f]">
                  <th className="py-1 pr-1">Тип</th>
                  <th className="py-1 pr-1">ID</th>
                  <th className="py-1">Внутри</th>
                </tr>
              </thead>
              <tbody>
                {flat.map((r) => (
                  <tr
                    key={`${r.kind}-${r.id}`}
                    className="border-b border-[#1e3a5f]/50 hover:bg-[#1e3a5f]/30 cursor-pointer"
                    onClick={() => flyTo?.(r.lat, r.lon, r.kind === 'Бокс' ? 18 : 15)}
                  >
                    <td className="py-1.5 text-[#94a3b8]">{r.kind}</td>
                    <td className="py-1.5 text-[#e2e8f0] font-mono truncate max-w-[110px]" title={r.id}>{r.name}</td>
                    <td className="py-1.5 text-[#64748b] truncate max-w-[80px]">{r.parent ?? r.extra ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'diagram' && (
          <div className="p-3 space-y-4">
            {districts.map((d) => (
              <div key={d.name} className="rounded-lg border border-[#1e3a5f] p-2 bg-[#0a0e1a]/60">
                <p className="text-[10px] font-semibold text-[#e2e8f0] mb-2" style={{ borderLeft: `3px solid ${d.color}`, paddingLeft: 6 }}>
                  {d.name}
                </p>
                <div className="flex flex-col items-center gap-1">
                  <DiagNode label="OLT" id={d.olt.displayName || d.olt.id} color="#f59e0b" onClick={() => flyTo?.(d.olt.lat, d.olt.lon, 14)} />
                  {d.olt.transitBoxes.map((tb) => (
                    <div key={tb.id} className="flex flex-col items-center w-full">
                      <div className="w-px h-2 bg-[#38bdf8]/50" />
                      <DiagNode label="Муфта" id={tb.displayName || tb.id} color="#38bdf8" onClick={() => flyTo?.(tb.lat, tb.lon, 15)} />
                      <div className="flex flex-wrap justify-center gap-2 mt-1 w-full">
                        {tb.orks.map((ork) => (
                          <div key={ork.id} className="flex flex-col items-center">
                            <div className="w-px h-1.5 bg-[#a78bfa]/50" />
                            <DiagNode label="ОРК" id={ork.displayName || ork.id} color="#a78bfa" small onClick={() => flyTo?.(ork.lat, ork.lon, 16)} />
                            <span className="text-[8px] text-[#64748b]">{ork.subscribers.length} бокс.</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DiagNode({
  label, id, color, small, onClick,
}: {
  label: string; id: string; color: string; small?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 text-center transition-opacity hover:opacity-90 ${small ? 'py-1 min-w-[72px]' : 'py-1.5 min-w-[88px]'}`}
      style={{ borderColor: `${color}66`, background: `${color}18`, color }}
    >
      <div className="text-[8px] uppercase opacity-80">{label}</div>
      <div className={`font-mono truncate ${small ? 'text-[9px]' : 'text-[10px]'}`}>{id}</div>
    </button>
  );
}
