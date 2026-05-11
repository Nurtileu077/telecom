'use client';
import { District, LayerVisibility } from '@/types/network';

interface Props {
  districts: District[];
  layers: LayerVisibility;
  toggleLayer: (key: keyof LayerVisibility) => void;
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-[#94a3b8]">{label}</span>
      <button
        onClick={onChange}
        className={`w-8 h-4 rounded-full transition-colors duration-200 relative overflow-hidden ${on ? 'bg-[#38bdf8]' : 'bg-[#1e3a5f]'}`}
        style={{ minWidth: '2rem' }}
      >
        <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform duration-200 ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

const CABLE_COLORS: Record<string, string> = {
  'ОК-4':  '#99d499', 'ОК-8':  '#4ade80',
  'ОК-12': '#3a92fb', 'ОК-16': '#60a5fa',
  'ОК-24': '#f59e0b', 'ОК-32': '#fbbf24',
  'ОК-48': '#ec8a00', 'ОК-96': '#f87171',
};

export default function LayersTab({ districts, layers, toggleLayer }: Props) {
  return (
    <div className="p-3 space-y-4 overflow-y-auto h-full">
      {/* Object Types */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Типы объектов</h3>
        <div className="space-y-0.5">
          <Toggle on={layers.olt} onChange={() => toggleLayer('olt')} label="📡 OLT — узлы связи" />
          <Toggle on={layers.tb} onChange={() => toggleLayer('tb')} label="🔷 Муфта (транзит.)" />
          <Toggle on={layers.ork} onChange={() => toggleLayer('ork')} label="📦 Бокс (распред.)" />
          <Toggle on={layers.subscribers} onChange={() => toggleLayer('subscribers')} label="🏠 Абоненты" />
          <Toggle on={layers.cables} onChange={() => toggleLayer('cables')} label="〰 Кабели (все)" />
        </div>
      </section>

      {/* Cable Types */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Типы кабелей</h3>
        <div className="space-y-0.5">
          {([
            ['cableOK4',  'ОК-4 дроп'],
            ['cableOK8',  'ОК-8 абон.'],
            ['cableOK12', 'ОК-12 распред.'],
            ['cableOK16', 'ОК-16 распред.'],
            ['cableOK24', 'ОК-24 питающ.'],
            ['cableOK32', 'ОК-32 питающ.'],
            ['cableOK48', 'ОК-48 магистр.'],
            ['cableOK96', 'ОК-96 магистр.'],
          ] as [keyof LayerVisibility, string][]).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <span className="inline-block w-8 h-1 rounded" style={{ background: CABLE_COLORS[label.split(' ')[0]] }} />
                <span className="text-xs text-[#94a3b8]">{label}</span>
              </div>
              <button
                onClick={() => toggleLayer(key)}
                className={`w-8 h-4 rounded-full transition-colors duration-200 relative overflow-hidden ${layers[key] ? 'bg-[#38bdf8]' : 'bg-[#1e3a5f]'}`}
                style={{ minWidth: '2rem' }}
              >
                <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform duration-200 ${layers[key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Districts */}
      {districts.length > 0 && (
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Районы</h3>
          <div className="space-y-1">
            {districts.map((d) => {
              const subCount = d.subscribers.length;
              return (
                <div key={d.name} className="flex items-center gap-2 py-1">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-[#94a3b8] flex-1 truncate">{d.name}</span>
                  <span className="text-[10px] text-[#64748b] font-mono">{subCount}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Legend */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Легенда</h3>
        <div className="space-y-1">
          {[
            { label: 'OLT', color: '#f59e0b', shape: 'square' },
            { label: 'Транзитная муфта', color: '#38bdf8', shape: 'square' },
            { label: 'ОРК шкаф', color: '#f59e0b', shape: 'circle' },
            { label: 'Абонент', color: '#34d399', shape: 'circle' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span
                className={`w-3 h-3 flex-shrink-0 ${item.shape === 'circle' ? 'rounded-full' : 'rounded-sm'}`}
                style={{ background: 'transparent', border: `2px solid ${item.color}` }}
              />
              <span className="text-xs text-[#64748b]">{item.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
