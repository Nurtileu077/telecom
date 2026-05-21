'use client';
import { useState, useEffect } from 'react';
import { Cable, CABLE_SIZES, CABLE_COLORS } from '@/types/network';
import { TIA_598_COLORS, tubeCount, fibersPerTube } from '@/components/Network/FiberColors';

interface Props {
  cable: Cable | null;
  onClose: () => void;
  onUpdateType: (id: string, type: Cable['type']) => void;
  onRerouteOSRM: (id: string) => void;
  onToggleWaypoints: (id: string | null) => void;
  onDelete: (id: string) => void;
  waypointEditing: boolean;
  rerouteStatus: 'idle' | 'routing' | 'done' | string;
  onStartConnect?: (cableId: string) => void;
}

// color dot for cable type
function Dot({ type }: { type: string }) {
  const color = (CABLE_COLORS as Record<string, string>)[type] ?? '#888';
  return <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ background: color }} />;
}

export default function CableEditor({
  cable, onClose, onUpdateType, onRerouteOSRM, onToggleWaypoints, onDelete, waypointEditing, rerouteStatus, onStartConnect,
}: Props) {
  const [type, setType] = useState<Cable['type']>(cable?.type ?? 'ОК-4');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (cable) { setType(cable.type); setDirty(false); }
  }, [cable?.id]);

  if (!cable) return null;

  const lengthKm = (cable.lengthM / 1000).toFixed(2);
  const isRouting = rerouteStatus === 'routing';

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[500] w-80 bg-[#0d1b2a]/97 border border-[#1e3a5f] rounded-xl shadow-2xl backdrop-blur-sm animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1e3a5f]">
        <div className="flex items-center gap-2">
          <Dot type={cable.type} />
          <span className="text-xs font-semibold text-[#e2e8f0]">Кабель</span>
          <span className="text-[10px] text-[#64748b] font-mono">{cable.fromId} → {cable.toId}</span>
        </div>
        <button onClick={onClose} className="text-[#64748b] hover:text-white transition-colors px-1">×</button>
      </div>

      {/* Body */}
      <div className="p-3 space-y-3">
        {/* Stats row */}
        <div className="flex gap-3 text-[11px]">
          <div className="flex-1 bg-[#0a0e1a] rounded-lg px-2.5 py-2 text-center">
            <div className="font-mono font-bold text-[#38bdf8]">{lengthKm} км</div>
            <div className="text-[#64748b] mt-0.5">длина</div>
          </div>
          <div className="flex-1 bg-[#0a0e1a] rounded-lg px-2.5 py-2 text-center">
            <div className="font-mono font-bold text-[#34d399]">{cable.fibers}</div>
            <div className="text-[#64748b] mt-0.5">волокон</div>
          </div>
          <div className="flex-1 bg-[#0a0e1a] rounded-lg px-2.5 py-2 text-center">
            <div className="font-mono font-bold text-[#a78bfa]">{cable.coords.length}</div>
            <div className="text-[#64748b] mt-0.5">точек</div>
          </div>
        </div>

        {/* Type selector */}
        <div>
          <div className="text-[10px] text-[#64748b] mb-1.5">Тип кабеля</div>
          <div className="grid grid-cols-4 gap-1">
            {CABLE_SIZES.map((t) => (
              <button
                key={t}
                onClick={() => { setType(t); setDirty(t !== cable.type); }}
                className={`py-1 rounded text-[10px] font-mono transition-all ${
                  type === t
                    ? 'bg-[#1e3a5f] border border-[#38bdf8] text-[#e2e8f0]'
                    : 'border border-[#1e3a5f] text-[#64748b] hover:text-[#94a3b8]'
                }`}
              >
                <Dot type={t} />{t.replace('ОК-', '')}
              </button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { if (dirty) onUpdateType(cable.id, type); onClose(); }}
            disabled={!dirty}
            className="py-1.5 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 disabled:opacity-30 text-[#38bdf8] text-xs rounded transition-colors"
          >
            Применить тип
          </button>
          <button
            onClick={() => onRerouteOSRM(cable.id)}
            disabled={isRouting}
            className="py-1.5 bg-[#34d399]/15 hover:bg-[#34d399]/25 disabled:opacity-50 text-[#34d399] text-xs rounded transition-colors flex items-center justify-center gap-1"
          >
            {isRouting
              ? <><span className="w-3 h-3 border border-[#34d399] border-t-transparent rounded-full animate-spin" />OSRM...</>
              : '🛣 Маршрут OSRM'}
          </button>
        </div>

        {onStartConnect && (
          <button
            type="button"
            onClick={() => onStartConnect(cable.id)}
            className="w-full py-1.5 text-xs rounded border border-[#34d399]/40 text-[#34d399] hover:bg-[#34d399]/10 transition-colors"
          >
            🔗 Соединить конец с узлом
          </button>
        )}

        <button
          type="button"
          onClick={() => onToggleWaypoints(waypointEditing ? null : cable.id)}
          className={`w-full py-1.5 text-xs rounded transition-all border ${
            waypointEditing
              ? 'bg-[#a78bfa]/15 border-[#a78bfa]/50 text-[#a78bfa]'
              : 'border-[#1e3a5f] text-[#64748b] hover:text-[#e2e8f0] hover:border-[#a78bfa]/40'
          }`}
        >
          {waypointEditing
            ? '✓ Тяните точки; концы A/B — магнит к OLT/муфте/ОРК (~45 м)'
            : '✎ Редактировать форму кабеля'}
        </button>

        {/* Fiber color map (TIA-598) */}
        <div className="border-t border-[#1e3a5f] pt-2">
          <div className="text-[10px] text-[#64748b] mb-1.5">Волокна (TIA-598): {tubeCount(cable.fibers)} модуль × {fibersPerTube(cable.fibers)} вол.</div>
          <div className="grid grid-cols-12 gap-0.5">
            {Array.from({ length: cable.fibers }).map((_, i) => {
              const c = TIA_598_COLORS[i % 12];
              return (
                <div
                  key={i}
                  className="aspect-square rounded-sm border border-[#1e3a5f]/40"
                  title={`#${i + 1} — ${c.name}`}
                  style={{ background: c.hex }}
                />
              );
            })}
          </div>
        </div>

        {cable.routedByOSRM && (
          <div className="text-[10px] text-[#475569] text-center">
            ✓ Маршрутизирован через OSRM
          </div>
        )}

        <button
          onClick={() => { if (confirm('Удалить этот кабель?')) { onDelete(cable.id); onClose(); } }}
          className="w-full py-1.5 text-[11px] text-[#f87171] hover:bg-[#f87171]/10 border border-[#f87171]/30 rounded transition-colors"
        >
          🗑 Удалить кабель
        </button>
      </div>
    </div>
  );
}
