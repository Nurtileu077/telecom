'use client';
import { useState, useMemo } from 'react';
import { OpticalBudgetInputs } from '@/types/network';
import { calculateOpticalBudget } from '@/components/Network/OpticalBudget';

const DEFAULT_INPUTS: OpticalBudgetInputs = {
  txPowerDbm: 3,
  distanceKm: 5,
  splitter1: '1:4',
  splitter2: '1:8',
  connectors: 4,
  splices: 6,
  reserveDb: 3,
};

interface Props {
  onShowHeatmap: () => void;
  heatmapEnabled: boolean;
  onExportPDF: () => void;
  onPrintMap: () => void;
  onRerouteOSRM: () => void;
  onReconsolidate: () => void;
  osrmStatus: 'idle' | 'routing' | 'done' | 'error' | string;
  hasCables: boolean;
  budgetColoring: boolean;
  onToggleBudgetColoring: () => void;
}

export default function ToolsTab({ onShowHeatmap, heatmapEnabled, onExportPDF, onPrintMap, onRerouteOSRM, onReconsolidate, osrmStatus, hasCables, budgetColoring, onToggleBudgetColoring }: Props) {
  const [inputs, setInputs] = useState<OpticalBudgetInputs>(DEFAULT_INPUTS);
  const result = useMemo(() => calculateOpticalBudget(inputs), [inputs]);

  return (
    <div className="overflow-y-auto h-full p-3 space-y-4">
      {/* OSRM routing */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Маршрутизация кабелей</h3>
        <button
          onClick={onRerouteOSRM}
          disabled={!hasCables || osrmStatus === 'routing'}
          className="w-full py-2 px-3 text-xs font-semibold rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[#38bdf8]/10 border-[#38bdf8]/50 text-[#38bdf8] hover:bg-[#38bdf8]/20"
        >
          {osrmStatus === 'routing' ? '⏳ Маршрутизация...' : '🛣 Проложить по дорогам (OSRM)'}
        </button>
        <p className="text-[9px] text-[#64748b] mt-1">
          Перестраивает все кабели по дорогам через router.project-osrm.org. Занимает 1–2 мин.
        </p>
        <button
          onClick={onReconsolidate}
          disabled={!hasCables}
          className="mt-2 w-full py-2 px-3 text-xs font-semibold rounded-lg border transition-all disabled:opacity-40 bg-[#a78bfa]/10 border-[#a78bfa]/50 text-[#a78bfa] hover:bg-[#a78bfa]/20"
        >
          🔁 Объединить кабели на общих дорогах
        </button>
        <p className="text-[9px] text-[#64748b] mt-1">
          Снэп вершин к сетке 25м, объединение параллельных кабелей, муфты в развилках.
          Используй после ручных правок.
        </p>
      </section>

      {/* Visualization tools */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Визуализация</h3>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={onShowHeatmap}
            className={`py-1.5 px-2 text-[10px] rounded border transition-colors ${heatmapEnabled ? 'bg-[#f87171]/15 border-[#f87171] text-[#f87171]' : 'border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
          >
            🔥 Heatmap
          </button>
          <button
            onClick={onToggleBudgetColoring}
            className={`py-1.5 px-2 text-[10px] rounded border transition-colors ${budgetColoring ? 'bg-[#34d399]/15 border-[#34d399] text-[#34d399]' : 'border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
          >
            📉 Бюджет dB
          </button>
          <button
            onClick={onPrintMap}
            className="py-1.5 px-2 text-[10px] rounded border border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0] transition-colors col-span-2"
          >
            🖨 Печать карты
          </button>
        </div>
      </section>

      {/* Exports */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Документация</h3>
        <button
          onClick={onExportPDF}
          className="w-full py-1.5 px-2 text-xs bg-[#f59e0b]/15 hover:bg-[#f59e0b]/25 text-[#f59e0b] border border-[#f59e0b]/40 rounded transition-colors"
        >
          📄 Экспорт PDF отчёта
        </button>
      </section>

      {/* Optical budget calculator */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Оптический бюджет</h3>
        <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 space-y-2">
          <Row label="TX мощность OLT (дБм)">
            <input type="number" value={inputs.txPowerDbm} step={0.5}
                   onChange={(e) => setInputs({ ...inputs, txPowerDbm: parseFloat(e.target.value) || 0 })}
                   className="num-input" />
          </Row>
          <Row label="Длина линии (км)">
            <input type="number" value={inputs.distanceKm} step={0.1}
                   onChange={(e) => setInputs({ ...inputs, distanceKm: parseFloat(e.target.value) || 0 })}
                   className="num-input" />
          </Row>
          <Row label="Сплиттер L1">
            <select value={inputs.splitter1}
                    onChange={(e) => setInputs({ ...inputs, splitter1: e.target.value as any })}
                    className="num-input">
              <option value="none">нет</option>
              <option value="1:4">1:4</option>
              <option value="1:8">1:8</option>
              <option value="1:16">1:16</option>
            </select>
          </Row>
          <Row label="Сплиттер L2">
            <select value={inputs.splitter2}
                    onChange={(e) => setInputs({ ...inputs, splitter2: e.target.value as any })}
                    className="num-input">
              <option value="none">нет</option>
              <option value="1:4">1:4</option>
              <option value="1:8">1:8</option>
              <option value="1:16">1:16</option>
            </select>
          </Row>
          <Row label="Разъёмов">
            <input type="number" value={inputs.connectors}
                   onChange={(e) => setInputs({ ...inputs, connectors: parseInt(e.target.value) || 0 })}
                   className="num-input" />
          </Row>
          <Row label="Сварок">
            <input type="number" value={inputs.splices}
                   onChange={(e) => setInputs({ ...inputs, splices: parseInt(e.target.value) || 0 })}
                   className="num-input" />
          </Row>
          <Row label="Запас (дБ)">
            <input type="number" value={inputs.reserveDb} step={0.5}
                   onChange={(e) => setInputs({ ...inputs, reserveDb: parseFloat(e.target.value) || 0 })}
                   className="num-input" />
          </Row>
        </div>

        {/* Result */}
        <div className={`mt-2 rounded-lg p-2 border ${
          result.status === 'ok' ? 'bg-[#34d399]/10 border-[#34d399]/40' :
          result.status === 'warning' ? 'bg-[#fbbf24]/10 border-[#fbbf24]/40' :
          'bg-[#f87171]/10 border-[#f87171]/40'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[#94a3b8]">Мощность на ONT</span>
            <span className={`text-sm font-mono font-bold ${
              result.status === 'ok' ? 'text-[#34d399]' :
              result.status === 'warning' ? 'text-[#fbbf24]' :
              'text-[#f87171]'
            }`}>{result.rxPowerDbm.toFixed(1)} дБм</span>
          </div>
          <div className="text-[10px] text-[#94a3b8] mb-1">
            Запас: <b className="font-mono">{result.margin.toFixed(1)} дБ</b>
            {result.status === 'ok' && ' ✅ норма'}
            {result.status === 'warning' && ' ⚠️ на пределе'}
            {result.status === 'fail' && ' ❌ недостаточно'}
          </div>
          <div className="text-[9px] text-[#64748b] mb-1">Чувствительность ONT: −27 дБм</div>
          <details className="text-[10px]">
            <summary className="cursor-pointer text-[#64748b] hover:text-[#94a3b8]">Детали потерь: {result.totalLossDb.toFixed(1)} дБ</summary>
            <div className="mt-1 space-y-0.5">
              {result.breakdown.map((b, i) => (
                <div key={i} className="flex justify-between text-[#94a3b8]">
                  <span>{b.name}</span>
                  <span className="font-mono">−{b.lossDb.toFixed(2)} дБ</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      </section>

      <style jsx>{`
        :global(.num-input) {
          width: 80px;
          background: #0a0e1a;
          border: 1px solid #1e3a5f;
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 10px;
          color: #e2e8f0;
          font-family: monospace;
          text-align: right;
        }
        :global(.num-input:focus) { outline: none; border-color: #38bdf8; }
      `}</style>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-[#94a3b8]">{label}</span>
      {children}
    </div>
  );
}
