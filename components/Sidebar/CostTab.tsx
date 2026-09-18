'use client';
import { useState, useMemo } from 'react';
import { Materials, PriceCatalog, District, Cable, InlineJoint, ProjectSettings } from '@/types/network';
import { calculateCost, formatMoney, type CostLine } from '@/components/Network/CostCalc';
import { districtCostRows } from '@/components/Network/districtCost';
import DistrictCostChart from '@/components/Sidebar/DistrictCostChart';

interface Props {
  materials: Materials | null;
  prices: PriceCatalog;
  setPrices: (p: PriceCatalog) => void;
  districts?: District[];
  cables?: Cable[];
  joints?: InlineJoint[];
  settings?: ProjectSettings;
}

export default function CostTab({ materials, prices, setPrices, districts = [], cables = [], joints = [], settings }: Props) {
  const cost = useMemo(() => (materials ? calculateCost(materials, prices) : null), [materials, prices]);
  const districtRows = useMemo(() => {
    if (!districts.length || !settings || !materials) return [];
    return districtCostRows(districts, cables, joints, settings, prices);
  }, [districts, cables, joints, settings, prices, materials]);

  if (!materials || !cost) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">💰</div>
        <p className="text-sm text-[#94a3b8]">Постройте сеть для расчёта стоимости</p>
      </div>
    );
  }

  const updatePrice = (priceKey: string, value: number) => {
    const next: PriceCatalog = { ...prices };
    if (priceKey.startsWith('cables.')) {
      const k = priceKey.split('.')[1] as keyof typeof prices.cables;
      next.cables = { ...prices.cables, [k]: value };
    } else {
      (next as unknown as Record<string, number>)[priceKey] = value;
    }
    setPrices(next);
  };

  const updateQty = (id: string, value: number) => {
    const next: PriceCatalog = { ...prices, qtyOverrides: { ...(prices.qtyOverrides ?? {}), [id]: value } };
    setPrices(next);
  };

  const hasOverrides = !!prices.qtyOverrides && Object.keys(prices.qtyOverrides).length > 0;
  const resetQty = () => {
    const next = { ...prices };
    delete next.qtyOverrides;
    setPrices(next);
  };

  const pct = (v: number) => (cost.grandTotal > 0 ? Math.round((v / cost.grandTotal) * 100) : 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3">
        {/* Grand total */}
        <div className="bg-gradient-to-r from-[#34d399]/15 to-[#38bdf8]/15 border border-[#34d399]/40 rounded-xl p-4 mb-3 text-center">
          <div className="text-[10px] text-[#94a3b8] uppercase tracking-wider mb-1">Итоговая стоимость</div>
          <div className="text-2xl font-mono font-bold text-[#34d399]">
            {formatMoney(cost.grandTotal, cost.currency)}
          </div>
          {hasOverrides && (
            <div className="text-[9px] text-[#fbbf24] mt-1">⚠ количества изменены вручную</div>
          )}
        </div>

        {districtRows.length > 1 && (
          <DistrictCostChart rows={districtRows} currency={cost.currency} />
        )}

        {/* Subtotals */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <SubtotalCard label="Кабели" value={cost.subtotalCables} pct={pct(cost.subtotalCables)} currency={cost.currency} color="#38bdf8" />
          <SubtotalCard label="Оборуд." value={cost.subtotalEquipment} pct={pct(cost.subtotalEquipment)} currency={cost.currency} color="#f59e0b" />
          <SubtotalCard label="Монтаж" value={cost.subtotalLabor} pct={pct(cost.subtotalLabor)} currency={cost.currency} color="#a78bfa" />
        </div>

        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] text-[#64748b] uppercase tracking-wider">Валюта</span>
          <input
            value={prices.currency}
            onChange={(e) => setPrices({ ...prices, currency: e.target.value })}
            className="w-16 bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-0.5 text-[10px] text-[#e2e8f0] text-center focus:outline-none focus:border-[#38bdf8]"
          />
        </div>

        {/* Editable detailed table — секции раскрываются по клику */}
        <CostSection title="Кабели" lines={cost.cables} currency={cost.currency}
          onQty={updateQty} onPrice={updatePrice} defaultOpen={false} />
        <CostSection title="Оборудование" lines={cost.equipment} currency={cost.currency}
          onQty={updateQty} onPrice={updatePrice} defaultOpen={false} />
        <CostSection title="Монтаж" lines={[cost.labor]} currency={cost.currency}
          onQty={updateQty} onPrice={updatePrice} defaultOpen={false} />
      </div>

      {hasOverrides && (
        <div className="p-3 border-t border-[#1e3a5f]">
          <button
            onClick={resetQty}
            className="w-full py-1.5 text-xs border border-[#fbbf24]/40 text-[#fbbf24] rounded hover:bg-[#fbbf24]/10 transition-colors"
          >
            ↺ Сбросить количества к расчётным
          </button>
        </div>
      )}
    </div>
  );
}

function SubtotalCard({ label, value, pct, currency, color }: { label: string; value: number; pct: number; currency: string; color: string }) {
  return (
    <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded p-2 text-center">
      <div className="text-[9px] text-[#64748b]">{label}</div>
      <div className="text-[11px] font-mono" style={{ color }}>{formatMoney(value, currency)}</div>
      <div className="text-[8px] text-[#64748b]">{pct}%</div>
    </div>
  );
}

function CostSection({
  title, lines, currency, onQty, onPrice, defaultOpen = true,
}: {
  title: string;
  lines: CostLine[];
  currency: string;
  onQty: (id: string, v: number) => void;
  onPrice: (priceKey: string, v: number) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const visible = lines.filter((l) => l.qty > 0 || l.autoQty > 0);
  if (visible.length === 0) return null;
  const sectionTotal = visible.reduce((s, l) => s + l.total, 0);
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-[10px] font-semibold text-[#cbd5e1] mb-1 px-1 py-1 rounded hover:bg-[#1e3a5f]/30"
      >
        <span className="text-[8px]">{open ? '▼' : '▸'}</span>
        <span className="flex-1 text-left uppercase tracking-wider">{title}</span>
        <span className="font-mono text-[#94a3b8]">{formatMoney(sectionTotal, currency)}</span>
      </button>
      {!open ? null : (
      <>
      <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-[#64748b] mb-1 px-0.5">
        <span className="flex-1" />
        <span className="w-14 text-right">кол-во</span>
        <span className="w-16 text-right">цена</span>
        <span className="w-20 text-right">сумма</span>
      </div>
      <div className="space-y-0.5">
        {visible.map((l) => {
          const edited = l.qty !== l.autoQty;
          return (
            <div key={l.id} className="flex items-center gap-2 text-[10px] py-0.5 border-b border-[#1e3a5f]/30">
              <span className="text-[#e2e8f0] flex-1 truncate" title={l.name}>{l.name}</span>
              <span className="w-14 flex items-center gap-0.5">
                <input
                  type="number"
                  value={l.qty}
                  onChange={(e) => onQty(l.id, parseFloat(e.target.value) || 0)}
                  className={`w-10 bg-[#0a0e1a] border rounded px-1 py-0.5 text-[10px] font-mono text-right focus:outline-none focus:border-[#38bdf8] ${edited ? 'border-[#fbbf24]/60 text-[#fbbf24]' : 'border-[#1e3a5f] text-[#94a3b8]'}`}
                  title={edited ? `Расчёт: ${l.autoQty} ${l.unit}` : undefined}
                />
                <span className="text-[8px] text-[#64748b] w-3">{l.unit}</span>
              </span>
              <input
                type="number"
                value={l.unitPrice}
                onChange={(e) => onPrice(l.priceKey, parseFloat(e.target.value) || 0)}
                className="w-16 bg-[#0a0e1a] border border-[#1e3a5f] rounded px-1 py-0.5 text-[10px] text-[#e2e8f0] font-mono text-right focus:outline-none focus:border-[#38bdf8]"
              />
              <span className="font-mono text-[#94a3b8] w-20 text-right">{formatMoney(l.total, currency)}</span>
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
