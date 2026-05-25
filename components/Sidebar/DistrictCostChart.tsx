'use client';
import type { DistrictCostRow } from '@/components/Network/districtCost';
import { formatMoney } from '@/components/Network/CostCalc';

interface Props {
  rows: DistrictCostRow[];
  currency?: string;
}

export default function DistrictCostChart({ rows, currency = '₸' }: Props) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.total), 1);

  return (
    <div className="mb-4">
      <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Стоимость по районам</h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="text-[10px]">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="flex items-center gap-1.5 min-w-0 truncate text-[#e2e8f0]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                {r.name}
              </span>
              <span className="font-mono text-[#34d399] shrink-0">{formatMoney(r.total, currency)}</span>
            </div>
            <div className="h-2 rounded bg-[#1e3a5f] overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${(r.total / max) * 100}%`, background: r.color }}
              />
            </div>
            <div className="text-[9px] text-[#64748b] mt-0.5">
              {r.subscribers} кам. · {r.cableKm} км кабеля
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
