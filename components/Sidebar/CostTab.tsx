'use client';
import { useState, useMemo } from 'react';
import { Materials, PriceCatalog, District, Cable, InlineJoint, ProjectSettings } from '@/types/network';
import { calculateCost, formatMoney } from '@/components/Network/CostCalc';
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
  const [showEditor, setShowEditor] = useState(false);

  if (!materials) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">💰</div>
        <p className="text-sm text-[#94a3b8]">Постройте сеть для расчёта стоимости</p>
      </div>
    );
  }

  const cost = calculateCost(materials, prices);
  const districtRows = useMemo(() => {
    if (!districts.length || !settings) return [];
    return districtCostRows(districts, cables, joints, settings, prices);
  }, [districts, cables, joints, settings, prices]);

  const updatePrice = (path: string, value: number) => {
    const next = { ...prices };
    if (path.startsWith('cables.')) {
      const k = path.split('.')[1] as keyof typeof prices.cables;
      next.cables = { ...prices.cables, [k]: value };
    } else {
      (next as any)[path] = value;
    }
    setPrices(next);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3">
        {/* Grand total */}
        <div className="bg-gradient-to-r from-[#34d399]/15 to-[#38bdf8]/15 border border-[#34d399]/40 rounded-xl p-4 mb-3 text-center">
          <div className="text-[10px] text-[#94a3b8] uppercase tracking-wider mb-1">Итоговая стоимость</div>
          <div className="text-2xl font-mono font-bold text-[#34d399]">
            {formatMoney(cost.grandTotal, cost.currency)}
          </div>
        </div>

        {districtRows.length > 1 && (
          <DistrictCostChart rows={districtRows} currency={cost.currency} />
        )}

        {/* Subtotals */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded p-2 text-center">
            <div className="text-[9px] text-[#64748b]">Кабели</div>
            <div className="text-sm font-mono text-[#38bdf8]">{formatMoney(cost.subtotalCables, cost.currency)}</div>
          </div>
          <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded p-2 text-center">
            <div className="text-[9px] text-[#64748b]">Оборудование</div>
            <div className="text-sm font-mono text-[#f59e0b]">{formatMoney(cost.subtotalEquipment, cost.currency)}</div>
          </div>
        </div>

        {/* Cables */}
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-1 mt-3">Кабели</h3>
        <div className="space-y-0.5 mb-3">
          {cost.cables.map((c) => (
            <div key={c.type} className="flex items-center justify-between text-[10px] py-0.5">
              <span className="text-[#e2e8f0] flex-1 truncate">{c.type}</span>
              <span className="font-mono text-[#64748b] w-16 text-right">{c.qty.toLocaleString('ru')} {c.unit}</span>
              <span className="font-mono text-[#94a3b8] w-24 text-right">{formatMoney(c.total, cost.currency)}</span>
            </div>
          ))}
        </div>

        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-1">Оборудование</h3>
        <div className="space-y-0.5">
          {cost.equipment.filter((e) => e.qty > 0).map((e) => (
            <div key={e.name} className="flex items-center justify-between text-[10px] py-0.5">
              <span className="text-[#e2e8f0] flex-1 truncate">{e.name}</span>
              <span className="font-mono text-[#64748b] w-12 text-right">{e.qty}</span>
              <span className="font-mono text-[#94a3b8] w-24 text-right">{formatMoney(e.total, cost.currency)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3 border-t border-[#1e3a5f]">
        <button
          onClick={() => setShowEditor(!showEditor)}
          className="w-full py-1.5 text-xs border border-[#1e3a5f] rounded text-[#94a3b8] hover:text-[#e2e8f0] transition-colors"
        >
          {showEditor ? '▲ Скрыть' : '⚙ Редактировать цены'}
        </button>
      </div>

      {showEditor && (
        <div className="absolute inset-0 bg-[#0d1b2a]/95 backdrop-blur z-50 overflow-y-auto p-3 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#e2e8f0]">⚙ Прайс-каталог</h3>
            <button onClick={() => setShowEditor(false)} className="text-[#64748b] hover:text-[#e2e8f0]">✕</button>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block">
                <span className="text-[10px] text-[#64748b]">Валюта</span>
                <input
                  value={prices.currency}
                  onChange={(e) => setPrices({ ...prices, currency: e.target.value })}
                  className="w-20 bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] mt-0.5"
                />
              </label>
            </div>

            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-[#64748b] mb-1">Кабели (за метр)</h4>
              {(Object.keys(prices.cables) as (keyof typeof prices.cables)[]).map((k) => (
                <PriceInput key={k} label={k} value={prices.cables[k]} onChange={(v) => updatePrice(`cables.${k}`, v)} />
              ))}
            </div>

            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-[#64748b] mb-1">Оборудование (за шт)</h4>
              <PriceInput label="OLT" value={prices.olt} onChange={(v) => updatePrice('olt', v)} />
              <PriceInput label="Сплиттер 1:4" value={prices.splitter_1x4} onChange={(v) => updatePrice('splitter_1x4', v)} />
              <PriceInput label="Сплиттер 1:8" value={prices.splitter_1x8} onChange={(v) => updatePrice('splitter_1x8', v)} />
              <PriceInput label="Сплиттер 1:16" value={prices.splitter_1x16} onChange={(v) => updatePrice('splitter_1x16', v)} />
              <PriceInput label="Муфта МТОК-96А" value={prices.mufta} onChange={(v) => updatePrice('mufta', v)} />
              <PriceInput label="Бокс распределительный" value={prices.boks} onChange={(v) => updatePrice('boks', v)} />
              <PriceInput label="ONT ZTE F601" value={prices.ont} onChange={(v) => updatePrice('ont', v)} />
              <PriceInput label="Пигтейл" value={prices.pigtail} onChange={(v) => updatePrice('pigtail', v)} />
              <PriceInput label="Патч-корд" value={prices.patchcord} onChange={(v) => updatePrice('patchcord', v)} />
              <PriceInput label="КДЗС" value={prices.kdzs} onChange={(v) => updatePrice('kdzs', v)} />
              <PriceInput label="Анкер" value={prices.clamp} onChange={(v) => updatePrice('clamp', v)} />
            </div>

            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-[#64748b] mb-1">Монтаж</h4>
              <PriceInput label="Прокладка кабеля (за метр)" value={prices.installLabor} onChange={(v) => updatePrice('installLabor', v)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between py-1 gap-2">
      <span className="text-[10px] text-[#94a3b8] flex-1 truncate">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-24 bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-0.5 text-[10px] text-[#e2e8f0] font-mono text-right focus:outline-none focus:border-[#38bdf8]"
      />
    </div>
  );
}
