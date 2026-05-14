'use client';
import { useState, useMemo } from 'react';
import type { SubBudget, BudgetStats } from '@/components/Network/PowerBudget';
import {
  OLT_TX_DBM, BUDGET_DB, SAFE_LOSS_DB, WARN_LOSS_DB, ENGINEERING_MARGIN_DB,
  LOSS_PER_KM_DB,
} from '@/components/Network/PowerBudget';
import type { District } from '@/types/network';

interface Props {
  budgets: SubBudget[];
  stats: BudgetStats;
  districts: District[];
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
}

function statusColor(s: SubBudget['status']) {
  return s === 'ok' ? '#34d399' : s === 'warn' ? '#f59e0b' : '#f87171';
}
function statusBg(s: SubBudget['status']) {
  return s === 'ok' ? '#34d39920' : s === 'warn' ? '#f59e0b20' : '#f8717120';
}

export default function BudgetTab({ budgets, stats, districts, flyTo }: Props) {
  const [filter, setFilter] = useState<'all' | 'warn' | 'fail'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const subInfo = useMemo(() => {
    const map = new Map<string, { desc: string; lat: number; lon: number; district: string }>();
    for (const d of districts)
      for (const s of d.subscribers)
        map.set(s.id, { desc: s.desc, lat: s.lat, lon: s.lon, district: d.name });
    return map;
  }, [districts]);

  const sorted = useMemo(() => {
    const arr = [...budgets].sort((a, b) => b.totalLossDB - a.totalLossDB);
    if (filter === 'all') return arr;
    return arr.filter((b) => filter === 'fail' ? b.status === 'fail' : b.status !== 'ok');
  }, [budgets, filter]);

  if (budgets.length === 0) {
    return (
      <div className="p-3 text-center text-xs text-[#64748b]">
        Бюджет затухания появится после построения сети.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats summary */}
      <div className="p-3 border-b border-[#1e3a5f] bg-[#0a0e1a]/50">
        <div className="grid grid-cols-3 gap-2 mb-2">
          <Stat label="OK" value={stats.ok} color="#34d399" />
          <Stat label="WARN" value={stats.warn} color="#f59e0b" />
          <Stat label="FAIL" value={stats.fail} color="#f87171" />
        </div>
        <div className="text-[10px] text-[#64748b] space-y-0.5">
          <div>Среднее затухание: <span className="text-[#e2e8f0] font-mono">{stats.averageLossDB.toFixed(2)} dB</span></div>
          <div>Бюджет Class B+: <span className="text-[#e2e8f0] font-mono">{BUDGET_DB} dB</span> (запас {ENGINEERING_MARGIN_DB} dB)</div>
          <div>Зелёная зона: ≤ <span className="font-mono text-[#34d399]">{WARN_LOSS_DB.toFixed(0)} dB</span> · Жёлтая: до <span className="font-mono text-[#f59e0b]">{SAFE_LOSS_DB.toFixed(0)} dB</span></div>
          <div>Параметры: <span className="font-mono">{LOSS_PER_KM_DB} dB/км @ 1310 nm · сварка 0.1 · конн. 0.5</span></div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-[#1e3a5f] bg-[#0d1b2a]">
        {(['all', 'warn', 'fail'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 py-0.5 text-[10px] rounded transition-colors ${
              filter === f
                ? 'bg-[#38bdf8]/20 text-[#38bdf8]'
                : 'text-[#64748b] hover:text-[#94a3b8]'
            }`}
          >
            {f === 'all' ? `Все (${stats.total})` : f === 'warn' ? `Зона риска (${stats.warn + stats.fail})` : `Превышен (${stats.fail})`}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1e3a5f]">
        {sorted.length === 0 && (
          <div className="text-center text-[#64748b] text-xs py-8">
            Нет абонентов в этой зоне
          </div>
        )}
        {sorted.map((b) => {
          const info = subInfo.get(b.subId);
          const expanded = openId === b.subId;
          return (
            <div key={b.subId} className="hover:bg-[#1e293b]/30 transition-colors">
              <div
                className="px-3 py-2 cursor-pointer flex items-center gap-2"
                onClick={() => setOpenId(expanded ? null : b.subId)}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: statusColor(b.status) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-[#e2e8f0] truncate" title={info?.desc}>{info?.desc ?? b.subId}</div>
                  <div className="text-[9px] text-[#64748b] truncate">{info?.district} · {b.orkId}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-mono text-[11px]" style={{ color: statusColor(b.status) }}>{b.totalLossDB.toFixed(1)} dB</div>
                  <div className="text-[9px] text-[#64748b] font-mono">{b.rxPowerDBm.toFixed(1)} dBm</div>
                </div>
                {info && flyTo && (
                  <button
                    onClick={(e) => { e.stopPropagation(); flyTo(info.lat, info.lon, 18); }}
                    className="text-[#64748b] hover:text-[#38bdf8] text-xs px-1"
                    title="Перейти к абоненту"
                  >📍</button>
                )}
              </div>
              {expanded && (
                <div
                  className="px-4 pb-3 pt-1 text-[10px] space-y-0.5 font-mono"
                  style={{ background: statusBg(b.status) }}
                >
                  <Line label="Длина оптики" value={`${b.breakdown.cableKm.toFixed(2)} км`} loss={`${b.breakdown.cableLoss.toFixed(2)} dB`} />
                  <Line label={`Сварки × ${b.breakdown.splices}`} value="" loss={`${b.breakdown.spliceLoss.toFixed(2)} dB`} />
                  <Line label={`Коннекторы × ${b.breakdown.connectors}`} value="" loss={`${b.breakdown.connectorLoss.toFixed(2)} dB`} />
                  <Line label="L1 сплиттер (OLT)" value="" loss={`${b.breakdown.l1Splitter.toFixed(2)} dB`} />
                  <Line label="L2 сплиттер (ОРК)" value="" loss={`${b.breakdown.l2Splitter.toFixed(2)} dB`} />
                  <div className="flex justify-between border-t border-[#1e3a5f] pt-1 mt-1 text-[#e2e8f0]">
                    <span>Итого</span>
                    <span>{b.totalLossDB.toFixed(2)} dB · ONT RX = {b.rxPowerDBm.toFixed(2)} dBm</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[#0d1b2a] rounded-md px-2 py-1.5 text-center" style={{ borderLeft: `2px solid ${color}` }}>
      <div className="font-mono text-base font-bold" style={{ color }}>{value}</div>
      <div className="text-[9px] text-[#64748b]">{label}</div>
    </div>
  );
}

function Line({ label, value, loss }: { label: string; value: string; loss: string }) {
  return (
    <div className="flex items-center justify-between text-[#94a3b8]">
      <span>{label}</span>
      <span className="text-[#e2e8f0]">{value && <span className="text-[#64748b] mr-2">{value}</span>}{loss}</span>
    </div>
  );
}
