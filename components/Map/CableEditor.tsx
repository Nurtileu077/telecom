'use client';
import { useState, useEffect } from 'react';
import { Cable, CABLE_SIZES, CABLE_COLORS, CableInstallType, CABLE_INSTALL_LABELS } from '@/types/network';
import { suggestCableDisplayName, defaultPoleCount } from '@/lib/cableNaming';
import { TIA_598_COLORS, tubeCount, fibersPerTube } from '@/components/Network/FiberColors';
import { endpointLabel } from '@/components/Network/entityInterior';
import type { PeerKind } from '@/components/Network/entityInterior';

interface Props {
  cable: Cable | null;
  districts?: import('@/types/network').District[];
  joints?: import('@/types/network').InlineJoint[];
  onClose: () => void;
  onUpdateType: (id: string, type: Cable['type']) => void;
  onUpdateMeta?: (id: string, patch: Partial<Pick<Cable, 'displayName' | 'installType' | 'poleCount'>>) => void;
  onRerouteOSRM: (id: string) => void;
  onToggleWaypoints: (id: string | null) => void;
  onDelete: (id: string) => void;
  waypointEditing: boolean;
  rerouteStatus: 'idle' | 'routing' | 'done' | string;
  onStartConnect?: (cableId: string) => void;
  /** Переход к объекту на конце кабеля (ОРК/муфта/OLT/камера). */
  onNavigate?: (kind: PeerKind, id: string) => void;
  /** Подсветить ТОЛЬКО этот кабель на карте (остальные приглушаются). */
  onFocusCable?: (id: string) => void;
  /** Этот кабель сейчас в фокусе (подсвечен). */
  focusActive?: boolean;
}

// color dot for cable type
function Dot({ type }: { type: string }) {
  const color = (CABLE_COLORS as Record<string, string>)[type] ?? '#888';
  return <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ background: color }} />;
}

const INSTALL_TYPES: CableInstallType[] = ['aerial', 'duct', 'ground'];

export default function CableEditor({
  cable, districts = [], joints = [], onClose, onUpdateType, onUpdateMeta, onRerouteOSRM, onToggleWaypoints, onDelete, waypointEditing, rerouteStatus, onStartConnect, onNavigate, onFocusCable, focusActive,
}: Props) {
  const [type, setType] = useState<Cable['type']>(cable?.type ?? 'ОК-4');
  const [displayName, setDisplayName] = useState('');
  const [installType, setInstallType] = useState<CableInstallType | ''>('');
  const [poleCount, setPoleCount] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (cable) {
      setType(cable.type);
      setDisplayName(cable.displayName ?? '');
      setInstallType(cable.installType ?? '');
      setPoleCount(cable.poleCount != null ? String(cable.poleCount) : '');
      setDirty(false);
    }
  }, [cable?.id]);

  if (!cable) return null;

  const lengthKm = (cable.lengthM / 1000).toFixed(2);
  const isRouting = rerouteStatus === 'routing';
  const fromL = endpointLabel(districts, cable.fromId, joints);
  const toL = endpointLabel(districts, cable.toId, joints);
  const start = cable.coords[0];
  const end = cable.coords[cable.coords.length - 1];
  const fmtCoord = (p?: [number, number]) => (p ? `${p[0].toFixed(5)}, ${p[1].toFixed(5)}` : '—');

  const renderEndpoint = (
    caption: string,
    ep: { kind: PeerKind; label: string; shortId: string },
    id: string,
  ) => {
    const clickable = !!onNavigate && ep.kind !== 'unknown';
    const inner = (
      <>
        <div className="text-[9px] uppercase tracking-wide text-[#64748b]">{caption}</div>
        <div className={`text-sm font-semibold ${clickable ? 'text-[#38bdf8]' : 'text-[#94a3b8]'}`}>{ep.label}</div>
        <div className="font-mono text-[10px] text-[#64748b] truncate">{ep.shortId}</div>
      </>
    );
    return clickable ? (
      <button
        type="button"
        onClick={() => onNavigate!(ep.kind, id)}
        title="Перейти к объекту на карте"
        className="flex-1 min-w-0 text-left rounded-lg border border-[#1e3a5f] hover:border-[#38bdf8]/60 hover:bg-[#38bdf8]/5 px-2.5 py-2 transition-colors"
      >
        {inner}
      </button>
    ) : (
      <div className="flex-1 min-w-0 rounded-lg border border-[#1e3a5f] px-2.5 py-2">{inner}</div>
    );
  };

  return (
    <div className="absolute z-[510] left-2 right-2 bottom-[calc(58px+env(safe-area-inset-bottom))] max-h-[62dvh] w-auto max-w-lg mx-auto md:left-auto md:right-4 md:top-20 md:bottom-4 md:mx-0 md:w-[440px] md:max-w-[440px] md:max-h-[calc(100dvh-6rem)] bg-[#0d1b2a]/97 border border-[#1e3a5f] rounded-xl shadow-2xl backdrop-blur-sm animate-fade-in overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1e3a5f]">
        <div className="flex items-center gap-2">
          <Dot type={cable.type} />
          <span className="text-xs font-semibold text-[#e2e8f0]">Кабель</span>
          <span className="text-[10px] text-[#64748b] font-mono truncate max-w-[140px]">
            {cable.displayName || `${cable.fromId} → ${cable.toId}`}
          </span>
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

        {/* Маршрут: откуда → куда (кликабельно) + начало/конец */}
        <div className="bg-[#0a0e1a] rounded-lg p-3 space-y-2.5">
          <div className="text-[10px] uppercase tracking-wide text-[#64748b]">Маршрут</div>
          <div className="flex items-stretch gap-2">
            {renderEndpoint('Откуда', fromL, cable.fromId)}
            <div className="flex items-center text-[#38bdf8] text-lg shrink-0">→</div>
            {renderEndpoint('Куда', toL, cable.toId)}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] border-t border-[#1e3a5f] pt-2">
            <div>
              <div className="text-[#64748b] text-[10px]">Начало</div>
              <div className="font-mono text-[#94a3b8]">{fmtCoord(start)}</div>
            </div>
            <div className="text-right">
              <div className="text-[#64748b] text-[10px]">Конец</div>
              <div className="font-mono text-[#94a3b8]">{fmtCoord(end)}</div>
            </div>
          </div>
          {onFocusCable && (
            <button
              type="button"
              onClick={() => onFocusCable(cable.id)}
              className={`w-full py-2 text-xs rounded-lg border transition-colors ${
                focusActive
                  ? 'bg-[#38bdf8]/15 border-[#38bdf8]/50 text-[#38bdf8]'
                  : 'border-[#1e3a5f] text-[#94a3b8] hover:border-[#38bdf8]/40 hover:text-[#e2e8f0]'
              }`}
            >
              {focusActive ? '✓ Этот кабель подсвечен' : '◎ Показать только этот кабель'}
            </button>
          )}
        </div>

        {onUpdateMeta && (
          <div className="space-y-2">
            <div>
              <div className="text-[10px] text-[#64748b] mb-1">Название линии</div>
              <div className="flex gap-1">
                <input
                  value={displayName}
                  onChange={(e) => { setDisplayName(e.target.value); setDirty(true); }}
                  placeholder={suggestCableDisplayName(cable, districts)}
                  className="flex-1 bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]"
                />
                <button
                  type="button"
                  className="text-[10px] px-2 border border-[#1e3a5f] rounded text-[#94a3b8] hover:text-[#e2e8f0]"
                  onClick={() => { setDisplayName(suggestCableDisplayName(cable, districts)); setDirty(true); }}
                >
                  Авто
                </button>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#64748b] mb-1">Прокладка</div>
              <select
                value={installType}
                onChange={(e) => { setInstallType(e.target.value as CableInstallType | ''); setDirty(true); }}
                className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]"
              >
                <option value="">— не указано —</option>
                {INSTALL_TYPES.map((t) => (
                  <option key={t} value={t}>{CABLE_INSTALL_LABELS[t]}</option>
                ))}
              </select>
            </div>
            {installType === 'aerial' && (
              <div>
                <div className="text-[10px] text-[#64748b] mb-1">Опоры (шт.)</div>
                <input
                  type="number"
                  min={0}
                  value={poleCount}
                  onChange={(e) => { setPoleCount(e.target.value); setDirty(true); }}
                  placeholder={String(defaultPoleCount(cable.lengthM))}
                  className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]"
                />
              </div>
            )}
            <button
              type="button"
              disabled={!dirty}
              onClick={() => {
                onUpdateMeta(cable.id, {
                  displayName: displayName.trim() || undefined,
                  installType: installType || undefined,
                  poleCount: installType === 'aerial'
                    ? (parseInt(poleCount, 10) || defaultPoleCount(cable.lengthM))
                    : undefined,
                });
                setDirty(false);
              }}
              className="w-full py-1.5 bg-[#a78bfa]/15 disabled:opacity-30 text-[#a78bfa] text-xs rounded"
            >
              Сохранить свойства линии
            </button>
          </div>
        )}

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
