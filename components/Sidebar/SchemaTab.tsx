'use client';
import { District } from '@/types/network';

interface Props {
  districts: District[];
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
}

export default function SchemaTab({ districts, flyTo }: Props) {
  if (districts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">🌳</div>
        <p className="text-sm text-[#94a3b8]">Постройте сеть для просмотра топологии</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full p-3 font-mono text-xs">
      {districts.map((d) => (
        <div key={d.name} className="mb-4">
          <button
            onClick={() => flyTo?.(d.olt.lat, d.olt.lon, 13)}
            className="flex items-center gap-2 mb-1 hover:text-[#38bdf8] transition-colors text-left w-full"
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
            <span className="text-[#e2e8f0] font-semibold">{d.name}</span>
            <span className="text-[#64748b] text-[10px]">({d.subscribers.length} або.)</span>
          </button>

          <div className="ml-3">
            <div className="text-[#f59e0b]">
              📡 Узел связи · {d.name}
            </div>
            <div className="ml-3 text-[#64748b]">
              └─ L1 SPL {d.olt.l1Splitter}
            </div>

            {d.olt.transitBoxes.map((tb, ti) => (
              <div key={tb.id} className="ml-3">
                <button
                  onClick={() => flyTo?.(tb.lat, tb.lon, 15)}
                  className="text-[#38bdf8] hover:text-[#7dd3fc] transition-colors text-left"
                >
                  {ti < d.olt.transitBoxes.length - 1 ? '├─' : '└─'} 🔷 Муфта {tb.muftaType}
                </button>

                {tb.orks.map((ork, oi) => (
                  <div key={ork.id} className="ml-5">
                    <button
                      onClick={() => flyTo?.(ork.lat, ork.lon, 17)}
                      className="text-[#f59e0b] hover:text-[#fcd34d] transition-colors text-left"
                    >
                      {oi < tb.orks.length - 1 ? '├─' : '└─'} 📦 ОРКСП {oi + 1}
                      <span className="text-[#64748b] ml-1">({ork.subscribers.length}/{ork.splitter === '1:4' ? '4' : ork.splitter === '1:8' ? '8' : '16'})</span>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
