'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { Route, Merge, Flame, Activity, Printer, FileDown } from 'lucide-react';
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

import ScenarioPanel from './ScenarioPanel';
import type { ProjectScenarios, ProjectSettings, PriceCatalog } from '@/types/network';
import {
  isOfflineTilesEnabled, setOfflineTilesEnabled, syncOfflineTileWorker,
} from '@/lib/offlineMap';
import { bboxFromProject } from '@/lib/projectBounds';
import { preloadTilesForBBox, type TilePreloadProgress } from '@/lib/tilePreload';
import { OSRM_HOST_LS_KEY, OSRM_PROFILE_LS_KEY } from '@/components/Network/OSRMRouter';
import type { District, Cable, MapAnnotation } from '@/types/network';

interface Props {
  scenarios?: ProjectScenarios;
  settings?: ProjectSettings;
  prices?: PriceCatalog;
  onSaveScenarioA?: () => void;
  onSaveScenarioB?: () => void;
  onRestoreScenarioA?: () => void;
  onRestoreScenarioB?: () => void;
  scenarioDiffOn?: boolean;
  onToggleScenarioDiff?: () => void;
  readOnly?: boolean;
  projectId?: string;
  districts?: District[];
  cables?: Cable[];
  annotations?: MapAnnotation[];
  onCopyShareViewLink?: () => void;
  onCopyShareFieldLink?: () => void;
  onShowHeatmap: () => void;
  heatmapEnabled: boolean;
  onExportPDF: () => void;
  onPrintMap: () => void;
  onRerouteOSRM: () => void;
  onReconsolidate: () => void;
  selectionBBox?: { latMin: number; lonMin: number; latMax: number; lonMax: number } | null;
  osrmStatus: 'idle' | 'routing' | 'done' | 'error' | string;
  hasCables: boolean;
  budgetColoring: boolean;
  onToggleBudgetColoring: () => void;
}

export default function ToolsTab({
  scenarios = {}, settings, prices, onSaveScenarioA, onSaveScenarioB, onRestoreScenarioA, onRestoreScenarioB,
  scenarioDiffOn, onToggleScenarioDiff,
  readOnly, projectId, districts = [], cables = [], annotations = [],
  onCopyShareViewLink, onCopyShareFieldLink,
  onShowHeatmap, heatmapEnabled, onExportPDF, onPrintMap, onRerouteOSRM, onReconsolidate, selectionBBox, osrmStatus, hasCables, budgetColoring, onToggleBudgetColoring,
}: Props) {
  const [inputs, setInputs] = useState<OpticalBudgetInputs>(DEFAULT_INPUTS);
  const [offlineTiles, setOfflineTiles] = useState(false);
  const [tilePreload, setTilePreload] = useState<TilePreloadProgress | null>(null);
  const [preloading, setPreloading] = useState(false);
  const preloadAbort = useRef<AbortController | null>(null);
  const [osrmHost, setOsrmHost] = useState('');
  const [osrmProfile, setOsrmProfile] = useState('foot');
  const [osrmSaved, setOsrmSaved] = useState(false);
  useEffect(() => {
    setOfflineTiles(isOfflineTilesEnabled());
    setOsrmHost(localStorage.getItem(OSRM_HOST_LS_KEY) ?? '');
    setOsrmProfile(localStorage.getItem(OSRM_PROFILE_LS_KEY) ?? 'foot');
  }, []);

  const saveOsrm = () => {
    const h = osrmHost.trim().replace(/\/$/, '');
    if (h) localStorage.setItem(OSRM_HOST_LS_KEY, h);
    else localStorage.removeItem(OSRM_HOST_LS_KEY);
    localStorage.setItem(OSRM_PROFILE_LS_KEY, osrmProfile);
    setOsrmHost(h);
    setOsrmSaved(true);
    setTimeout(() => setOsrmSaved(false), 1500);
  };

  const result = useMemo(() => calculateOpticalBudget(inputs), [inputs]);

  const projectBbox = useMemo(
    () => bboxFromProject(districts, cables, annotations),
    [districts, cables, annotations],
  );

  const startTilePreload = async () => {
    if (!projectBbox || preloading) return;
    if (!offlineTiles) {
      setOfflineTiles(true);
      setOfflineTilesEnabled(true);
      await syncOfflineTileWorker();
      setOfflineTiles(true);
    }
    preloadAbort.current?.abort();
    const ac = new AbortController();
    preloadAbort.current = ac;
    setPreloading(true);
    setTilePreload({ done: 0, total: 0, failed: 0 });
    try {
      await preloadTilesForBBox(projectBbox, {
        signal: ac.signal,
        onProgress: setTilePreload,
      });
    } finally {
      setPreloading(false);
    }
  };

  const toggleOfflineTiles = async () => {
    const next = !offlineTiles;
    setOfflineTiles(next);
    setOfflineTilesEnabled(next);
    await syncOfflineTileWorker();
  };

  return (
    <div className="overflow-y-auto h-full p-3 space-y-4">
      <section>
        <h3 className="section-title mb-2">Офлайн-карта</h3>
        <button
          type="button"
          onClick={toggleOfflineTiles}
          className={`w-full py-1.5 text-[10px] rounded border ${
            offlineTiles ? 'border-[#34d399]/50 bg-[#34d399]/15 text-[#34d399]' : 'border-[#1e3a5f] text-[#94a3b8]'
          }`}
        >
          {offlineTiles ? '✓ Кэш тайлов включён' : 'Кэшировать тайлы карты'}
        </button>
        <p className="text-[9px] text-[#64748b] mt-1">
          Прокрутите нужный район онлайн — тайлы сохранятся для просмотра без сети (Carto/Esri).
        </p>
        <button
          type="button"
          onClick={startTilePreload}
          disabled={!projectBbox || preloading}
          className="w-full mt-2 py-1.5 text-[10px] rounded border border-[#38bdf8]/40 text-[#38bdf8] disabled:opacity-40"
        >
          {preloading
            ? `Предзагрузка… ${tilePreload?.done ?? 0}/${tilePreload?.total ?? '…'}`
            : 'Предзагрузить тайлы проекта'}
        </button>
        {!projectBbox && (
          <p className="text-[9px] text-[#64748b] mt-1">Нужны объекты на карте (OLT, кабели, заметки).</p>
        )}
        {tilePreload && !preloading && tilePreload.total > 0 && (
          <p className="text-[9px] text-[#64748b] mt-1">
            Готово: {tilePreload.done - tilePreload.failed} из {tilePreload.total}
            {tilePreload.failed > 0 ? `, ошибок: ${tilePreload.failed}` : ''}.
          </p>
        )}
      </section>

      {onSaveScenarioA && onSaveScenarioB && (
        <ScenarioPanel
          scenarios={scenarios}
          settings={settings}
          prices={prices}
          onSaveA={onSaveScenarioA}
          onSaveB={onSaveScenarioB}
          onRestoreA={onRestoreScenarioA ?? (() => {})}
          onRestoreB={onRestoreScenarioB ?? (() => {})}
          readOnly={readOnly}
          scenarioDiffOn={scenarioDiffOn}
          onToggleScenarioDiff={onToggleScenarioDiff}
        />
      )}
      {projectId && !readOnly && (onCopyShareViewLink || onCopyShareFieldLink) && (
        <section>
          <h3 className="section-title mb-2">Ссылки для команды</h3>
          {onCopyShareViewLink && (
            <button type="button" className="btn btn-secondary w-full text-[10px] mb-1.5" onClick={onCopyShareViewLink}>
              🔗 Просмотр (read-only)
            </button>
          )}
          {onCopyShareFieldLink && (
            <button type="button" className="btn btn-secondary w-full text-[10px]" onClick={onCopyShareFieldLink}>
              📷 Поле (чеклист + фото)
            </button>
          )}
          <p className="text-[9px] text-[#64748b] mt-1">С параметрами <code>project</code> и <code>role</code>.</p>
        </section>
      )}
      {/* OSRM routing */}
      <section>
        <h3 className="section-title mb-2">Маршрутизация кабелей</h3>
        {selectionBBox && (
          <div className="mb-2 p-1.5 bg-[#fbbf24]/10 border border-[#fbbf24]/40 rounded text-[10px] text-[#fbbf24]">
            🔲 Операции применятся только в выделенной области.
          </div>
        )}
        <button
          type="button"
          onClick={onRerouteOSRM}
          disabled={readOnly || !hasCables || osrmStatus === 'routing'}
          className="btn btn-secondary w-full"
        >
          <Route size={14} />
          {osrmStatus === 'routing'
            ? 'Маршрутизация…'
            : selectionBBox
              ? 'Проложить (выделение)'
              : 'Проложить по дорогам (OSRM)'}
        </button>
        <p className="text-[9px] text-[#64748b] mt-1">
          {selectionBBox
            ? 'Перемаршрутизирует только кабели, попадающие в выделенный прямоугольник.'
            : 'Перестраивает все кабели по дорогам через router.project-osrm.org. Занимает 1–2 мин.'}
        </p>
        <button
          type="button"
          onClick={onReconsolidate}
          disabled={readOnly || !hasCables}
          className="btn btn-secondary w-full mt-2 text-[var(--accent-2)]"
        >
          <Merge size={14} />
          {selectionBBox ? 'Объединить (выделение)' : 'Объединить на общих дорогах'}
        </button>
        <p className="text-[9px] text-[#64748b] mt-1">
          {selectionBBox
            ? 'Консолидация и муфты только в выбранной области, остальная сеть не трогается.'
            : 'Слияние узлов в радиусе 30м (оборудование защищено), объединение параллельных кабелей одной дороги, муфты в развилках. Используй после ручных правок.'}
        </p>
        <div className="mt-3 pt-2 border-t border-[#1e3a5f]">
          <label className="text-[9px] uppercase tracking-widest text-[#64748b]">OSRM-сервер</label>
          <input
            type="text"
            value={osrmHost}
            onChange={(e) => setOsrmHost(e.target.value)}
            placeholder="https://xxxx.trycloudflare.com"
            disabled={readOnly}
            className="w-full mt-1 px-2 py-1 text-[10px] bg-[#0b1e34] border border-[#1e3a5f] rounded text-[#e2e8f0] disabled:opacity-50"
          />
          <div className="flex gap-1.5 mt-1.5">
            <select
              value={osrmProfile}
              onChange={(e) => setOsrmProfile(e.target.value)}
              disabled={readOnly}
              className="flex-1 px-2 py-1 text-[10px] bg-[#0b1e34] border border-[#1e3a5f] rounded text-[#e2e8f0] disabled:opacity-50"
            >
              <option value="foot">foot (пешеход)</option>
              <option value="driving">driving (авто)</option>
            </select>
            <button type="button" onClick={saveOsrm} disabled={readOnly} className="btn btn-secondary px-3">
              {osrmSaved ? '✓ Сохранено' : 'Сохранить'}
            </button>
          </div>
          <p className="text-[9px] text-[#64748b] mt-1">
            Свой OSRM (например, Cloudflare-туннель к локальному Docker). Пусто = публичный demo (driving). Применяется при следующей прокладке, без пересборки.
          </p>
        </div>
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
