'use client';
import { useState, useMemo } from 'react';
import { OpticalBudgetInputs, ProjectSettings } from '@/types/network';
import { calculateOpticalBudget } from '@/components/Network/OpticalBudget';
import { clearOSRMCache, getOSRMCacheStats } from '@/components/Network/OSRMRouter';

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
  onRetryFailedOSRM: () => void;
  onRouteUntilDone: () => void;
  unroutedCount: number;
  trunkTotal: number;
  trunkRouted: number;
  osrmStatus: 'idle' | 'routing' | 'done' | 'error' | string;
  hasCables: boolean;
  budgetColoring: boolean;
  onToggleBudgetColoring: () => void;
  settings: ProjectSettings;
  setSettings: (patch: Partial<ProjectSettings>) => void;
}

export default function ToolsTab({ onShowHeatmap, heatmapEnabled, onExportPDF, onPrintMap, onRerouteOSRM, onReconsolidate, onRetryFailedOSRM, onRouteUntilDone, unroutedCount, trunkTotal, trunkRouted, osrmStatus, hasCables, budgetColoring, onToggleBudgetColoring, settings, setSettings }: Props) {
  const [showProviderConfig, setShowProviderConfig] = useState(false);
  const [cacheStats, setCacheStats] = useState(() => getOSRMCacheStats());
  const [inputs, setInputs] = useState<OpticalBudgetInputs>(DEFAULT_INPUTS);
  const result = useMemo(() => calculateOpticalBudget(inputs), [inputs]);

  return (
    <div className="overflow-y-auto h-full p-3 space-y-4">
      {/* OSRM routing */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] uppercase tracking-widest text-[#64748b]">Маршрутизация кабелей</h3>
          {trunkTotal > 0 && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
              trunkRouted === trunkTotal ? 'bg-[#34d399]/15 text-[#34d399]' :
              trunkRouted >= trunkTotal * 0.9 ? 'bg-[#fbbf24]/15 text-[#fbbf24]' :
              'bg-[#f87171]/15 text-[#f87171]'
            }`}>
              {trunkRouted}/{trunkTotal} по дорогам
            </span>
          )}
        </div>
        <button
          onClick={onRouteUntilDone}
          disabled={!hasCables || osrmStatus === 'routing'}
          className="w-full py-2.5 px-3 text-xs font-semibold rounded-lg border transition-all disabled:opacity-40 bg-gradient-to-br from-[#34d399]/20 to-[#10b981]/20 border-[#34d399]/50 text-[#34d399] hover:from-[#34d399]/30 hover:to-[#10b981]/30 mb-2"
        >
          {osrmStatus === 'routing' ? '⏳ Маршрутизация...' : '🚀 Маршрутизировать всё до конца'}
        </button>
        <p className="text-[9px] text-[#64748b] mb-2">
          Маршрутизирует, ждёт при рейт-лимите, авто-повторяет пока все кабели не лягут на дороги. Можно оставить и забыть.
        </p>
        <button
          onClick={onRerouteOSRM}
          disabled={!hasCables || osrmStatus === 'routing'}
          className="w-full py-2 px-3 text-xs font-semibold rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[#38bdf8]/10 border-[#38bdf8]/50 text-[#38bdf8] hover:bg-[#38bdf8]/20"
        >
          {osrmStatus === 'routing' ? '⏳ Маршрутизация...' : '🛣 Один проход OSRM'}
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
        {unroutedCount > 0 && (
          <>
            <button
              onClick={onRetryFailedOSRM}
              disabled={osrmStatus === 'routing'}
              className="mt-2 w-full py-2 px-3 text-xs font-semibold rounded-lg border transition-all disabled:opacity-40 bg-[#f59e0b]/10 border-[#f59e0b]/50 text-[#f59e0b] hover:bg-[#f59e0b]/20"
            >
              ↻ Повторить упавшие ({unroutedCount})
            </button>
            <p className="text-[9px] text-[#64748b] mt-1">
              Маршрутизирует только прямые кабели. Подожди 30–60 сек после рейт-лимита и нажми.
            </p>
          </>
        )}

        <button
          onClick={() => { setShowProviderConfig(!showProviderConfig); setCacheStats(getOSRMCacheStats()); }}
          className="mt-2 w-full py-1.5 px-3 text-[10px] rounded border border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#38bdf8]/40 transition-all flex items-center justify-between"
        >
          <span>⚙ Сервер маршрутизации</span>
          <span className="text-[9px] text-[#64748b]">
            {settings.customOsrmUrl ? 'свой OSRM' : settings.orsApiKey ? 'ORS' : 'demo'}
            {' · '}кэш {cacheStats.size}
          </span>
        </button>

        {showProviderConfig && (
          <div className="mt-2 p-2.5 border border-[#1e3a5f] rounded space-y-2 bg-[#0a0e1a]">
            <div>
              <label className="text-[9px] text-[#64748b] block mb-1">OpenRouteService API key (2000/день бесплатно)</label>
              <input
                type="password"
                value={settings.orsApiKey || ''}
                onChange={(e) => setSettings({ orsApiKey: e.target.value || undefined })}
                placeholder="eyJvcmciOiI1Yj…"
                className="w-full bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-[10px] text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8] font-mono"
              />
              <p className="text-[8px] text-[#64748b] mt-0.5">
                <a href="https://openrouteservice.org/dev/#/signup" target="_blank" className="underline hover:text-[#38bdf8]">openrouteservice.org/dev</a> — регистрация, бесплатно
              </p>
            </div>
            <div>
              <label className="text-[9px] text-[#64748b] block mb-1">Свой OSRM URL (если развернул сам)</label>
              <input
                type="text"
                value={settings.customOsrmUrl || ''}
                onChange={(e) => setSettings({ customOsrmUrl: e.target.value || undefined })}
                placeholder="https://my-osrm.example.com/route/v1/driving"
                className="w-full bg-[#0d1b2a] border border-[#1e3a5f] rounded px-2 py-1 text-[10px] text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8] font-mono"
              />
              <p className="text-[8px] text-[#64748b] mt-0.5">
                Инструкция: docs/osrm-selfhost.md в репозитории
              </p>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-[#1e3a5f]">
              <span className="text-[9px] text-[#94a3b8]">
                Кэш: {cacheStats.size} маршрутов · {(cacheStats.bytes / 1024).toFixed(0)} KB
              </span>
              <button
                onClick={() => { clearOSRMCache(); setCacheStats(getOSRMCacheStats()); }}
                className="text-[9px] text-[#f87171] hover:text-[#fca5a5] border border-[#f87171]/30 rounded px-1.5 py-0.5"
              >
                Очистить кэш
              </button>
            </div>
          </div>
        )}
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
