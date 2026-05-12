'use client';
import dynamic from 'next/dynamic';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useNetwork } from '@/hooks/useNetwork';
import Sidebar from '@/components/Sidebar/Sidebar';
import ImportModal, { ImportMode } from '@/components/Import/ImportModal';
import { Subscriber, ProjectSettings, AnnotationType } from '@/types/network';
import type { DrawingTool } from '@/components/Sidebar/NotesTab';
import GeocodeSearch from '@/components/Geocoding/GeocodeSearch';
import { exportPDF } from '@/components/Export/ExportPDF';
import { calculateCost } from '@/components/Network/CostCalc';

const LeafletMap = dynamic(() => import('@/components/Map/MapContainer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#0a0e1a]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-xs text-[#64748b]">Загрузка карты...</p>
      </div>
    </div>
  ),
});

export default function HomePage() {
  const net = useNetwork();
  const [showImport, setShowImport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAddSub, setShowAddSub] = useState<{ lat: number; lon: number } | null>(null);
  const [newSubDistrict, setNewSubDistrict] = useState('');
  const [newSubDesc, setNewSubDesc] = useState('');
  const [activeTool, setActiveTool] = useState<DrawingTool>(null);
  const [activeAnnotationType, setActiveAnnotationType] = useState<AnnotationType>('village');
  const [measureMode, setMeasureMode] = useState(false);
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const flyToRef = useRef<((lat: number, lon: number, zoom?: number) => void) | null>(null);
  const mapElRef = useRef<HTMLElement | null>(null);

  const onExportPDF = useCallback(async () => {
    if (!net.materials) { alert('Сначала постройте сеть'); return; }
    const cost = calculateCost(net.materials, net.prices);
    await exportPDF(net.projectName, net.districts, net.cables, net.materials, cost, mapElRef.current);
  }, [net.projectName, net.districts, net.cables, net.materials, net.prices]);

  const onPrintMap = useCallback(() => window.print(), []);

  const handleBuild = useCallback(async (subs: Subscriber[], s: ProjectSettings, source: string, mode: ImportMode) => {
    net.setSettings(s);
    setShowImport(false);
    if (mode === 'append') {
      await net.appendSubscribers(subs, source);
    } else {
      await net.buildFromSubscribers(subs, source);
    }
  }, [net]);

  const handleMapClickAddSub = useCallback((lat: number, lon: number) => {
    setShowAddSub({ lat, lon });
    // Pre-fill district from last one used
    const existing = Array.from(new Set(net.districts.map((d) => d.name)));
    if (existing.length === 1) setNewSubDistrict(existing[0]);
  }, [net.districts]);

  const submitNewSubscriber = useCallback(async () => {
    if (!showAddSub) return;
    const district = newSubDistrict.trim() || 'Без района';
    const desc = newSubDesc.trim() || `Абонент ${net.totalSubscribers + 1}`;
    await net.addSubscriberAt(showAddSub.lat, showAddSub.lon, district, desc);
    setShowAddSub(null);
    setNewSubDesc('');
  }, [showAddSub, newSubDistrict, newSubDesc, net]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') { e.preventDefault(); net.saveProject(); }
        if (e.key === 'i') { e.preventDefault(); setShowImport(true); }
        if (e.key === 'n') { e.preventDefault(); if (confirm('Новый проект? Несохранённые данные пропадут.')) net.newProject(); }
      } else {
        if (e.key === '?' || (e.shiftKey && e.key === '/')) { setShowHelp(true); }
        if (e.key === 'e') net.setEditMode(!net.editMode);
        if (e.key === 'm') setMeasureMode((m) => !m);
        if (e.key === 'Escape') {
          setShowImport(false);
          setShowHelp(false);
          setShowAddSub(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [net]);

  const osrmPercent = net.osrmProgress.total > 0
    ? Math.round((net.osrmProgress.done / net.osrmProgress.total) * 100)
    : 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="h-12 flex items-center px-3 gap-3 border-b border-[#1e3a5f] bg-[#0d1b2a] flex-shrink-0 z-10">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-lg">📡</span>
          <span className="text-sm font-bold text-[#38bdf8] font-mono tracking-wide">GPON</span>
          <span className="text-[#1e3a5f]">|</span>
          <input
            type="text"
            value={net.projectName}
            onChange={(e) => net.setProjectName(e.target.value)}
            className="bg-transparent text-sm text-[#e2e8f0] border-none outline-none w-44 focus:text-[#38bdf8] transition-colors"
          />
        </div>

        <GeocodeSearch flyTo={flyToRef.current} />

        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          <span className="px-2 py-0.5 bg-[#38bdf8]/10 border border-[#38bdf8]/30 text-[#38bdf8] rounded-md">👥 {net.totalSubscribers}</span>
          <span className="px-2 py-0.5 bg-[#34d399]/10 border border-[#34d399]/30 text-[#34d399] rounded-md">〰 {net.totalCableKm} км</span>
          <span className="px-2 py-0.5 bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b] rounded-md">📦 {net.totalOrks}</span>
          <span className="px-2 py-0.5 bg-[#a78bfa]/10 border border-[#a78bfa]/30 text-[#a78bfa] rounded-md">📝 {net.annotations.length}</span>
          {net.status === 'routing' && (
            <span className="px-2 py-0.5 bg-[#a78bfa]/10 border border-[#a78bfa]/30 text-[#a78bfa] rounded-md animate-pulse">🛣 OSRM {osrmPercent}%</span>
          )}
          {net.status === 'clustering' && (
            <span className="px-2 py-0.5 bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b] rounded-md animate-pulse">⚙ Кластеризация...</span>
          )}
          {net.lastSavedAt && net.status === 'done' && (
            <span className="px-2 py-0.5 bg-[#34d399]/10 border border-[#34d399]/30 text-[#34d399] rounded-md">💾 {new Date(net.lastSavedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => net.setEditMode(!net.editMode)}
            className={`px-2 py-1 text-xs rounded-lg transition-colors ${net.editMode ? 'bg-[#34d399]/15 border border-[#34d399]/50 text-[#34d399]' : 'border border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
            title="Режим редактирования (E)"
          >
            🛠 {net.editMode ? 'Ред.' : 'Просм.'}
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="px-2 py-1 text-xs border border-[#1e3a5f] rounded-lg text-[#94a3b8] hover:text-[#e2e8f0] transition-colors"
            title="Справка (?)"
          >
            ?
          </button>
          <button
            onClick={() => net.saveProject()}
            disabled={net.districts.length === 0 && net.annotations.length === 0}
            className="px-3 py-1 text-xs border border-[#1e3a5f] rounded-lg text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#38bdf8]/40 transition-colors disabled:opacity-40"
            title="Сохранить (Ctrl+S)"
          >
            💾 Сохранить
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1 text-xs bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#0a0e1a] font-semibold rounded-lg transition-colors"
            title="Импорт (Ctrl+I)"
          >
            📂 Импорт
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          districts={net.districts}
          cables={net.cables}
          materials={net.materials}
          layers={net.layers}
          toggleLayer={net.toggleLayer}
          validationIssues={net.validationIssues}
          flyTo={flyToRef.current}
          annotations={net.annotations}
          updateAnnotation={net.updateAnnotation}
          deleteAnnotation={net.deleteAnnotation}
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          activeAnnotationType={activeAnnotationType}
          setActiveAnnotationType={setActiveAnnotationType}
          projectId={net.projectId}
          projectName={net.projectName}
          lastSavedAt={net.lastSavedAt}
          autoSaveEnabled={net.autoSaveEnabled}
          setAutoSaveEnabled={net.setAutoSaveEnabled}
          saveProject={net.saveProject}
          loadProject={net.loadProject}
          deleteProject={net.deleteProject}
          newProject={net.newProject}
          listProjects={net.listProjects}
          exportProjectJSON={net.exportProjectJSON}
          importProjectJSON={net.importProjectJSON}
          importHistory={net.importHistory}
          prices={net.prices}
          setPrices={net.setPrices}
          heatmapEnabled={heatmapEnabled}
          setHeatmapEnabled={setHeatmapEnabled}
          onExportPDF={onExportPDF}
          onPrintMap={onPrintMap}
          onRerouteOSRM={net.rerouteWithOSRM}
          osrmStatus={net.status}
        />

        <main className="flex-1 relative overflow-hidden">
          <LeafletMap
            districts={net.districts}
            cables={net.cables}
            splitPoints={net.splitPoints}
            layers={net.layers}
            flyToRef={flyToRef}
            mapElRef={mapElRef}
            annotations={net.annotations}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            activeAnnotationType={activeAnnotationType}
            addAnnotation={net.addAnnotation}
            deleteAnnotation={net.deleteAnnotation}
            editMode={net.editMode}
            onMapClick={handleMapClickAddSub}
            moveEntity={net.moveEntity}
            deleteSubscriber={net.deleteSubscriber}
            measureMode={measureMode}
            setMeasureMode={setMeasureMode}
            heatmapEnabled={heatmapEnabled}
          />

          {net.status === 'routing' && (
            <div className="absolute inset-0 flex items-end justify-center pb-8 z-[500] pointer-events-none">
              <div className="bg-[#0d1b2a]/98 border border-[#38bdf8]/40 rounded-2xl p-5 shadow-2xl min-w-[340px] max-w-[420px] pointer-events-auto animate-fade-in">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-5 h-5 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span className="text-sm font-semibold text-[#e2e8f0]">Прокладка кабелей по дорогам</span>
                </div>
                {net.osrmProgress.total > 0 && (
                  <>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-[#94a3b8] truncate mr-3">{net.osrmProgress.current || 'Запрос к OSRM...'}</span>
                      <span className="text-xs font-mono text-[#38bdf8] flex-shrink-0">{net.osrmProgress.done} / {net.osrmProgress.total}</span>
                    </div>
                    <div className="h-2 bg-[#1e3a5f] rounded-full overflow-hidden mb-2">
                      <div className="progress-bar h-full" style={{ width: `${osrmPercent}%` }} />
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#64748b]">router.project-osrm.org — бесплатный сервер</span>
                  <button onClick={net.stopOSRM} className="text-xs text-[#f87171] hover:text-[#fca5a5] transition-colors border border-[#f87171]/30 rounded px-2 py-0.5 ml-3">
                    ✕ Стоп
                  </button>
                </div>
              </div>
            </div>
          )}

          {net.districts.length === 0 && net.annotations.length === 0 && net.status === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center bg-[#0d1b2a]/90 backdrop-blur-sm border border-[#1e3a5f] rounded-2xl p-8 pointer-events-auto shadow-2xl">
                <div className="text-5xl mb-4">📡</div>
                <h2 className="text-lg font-semibold text-[#e2e8f0] mb-2">GPON Network Designer</h2>
                <p className="text-sm text-[#94a3b8] mb-4 max-w-xs">
                  Загружайте Excel/KMZ файлы — карта будет накапливаться. Делайте заметки прямо на ней.
                </p>
                <div className="flex gap-2 justify-center">
                  <button onClick={() => setShowImport(true)} className="px-5 py-2 bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#0a0e1a] font-semibold rounded-xl text-sm transition-colors">
                    📂 Импорт
                  </button>
                  <button onClick={() => setShowHelp(true)} className="px-5 py-2 border border-[#1e3a5f] hover:border-[#38bdf8] text-[#94a3b8] hover:text-[#e2e8f0] rounded-xl text-sm transition-colors">
                    ? Справка
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onBuild={handleBuild}
          currentSettings={net.settings}
          hasExistingData={net.totalSubscribers > 0}
        />
      )}

      {/* Add subscriber dialog */}
      {showAddSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl w-[360px] p-4">
            <h2 className="text-sm font-semibold text-[#e2e8f0] mb-3">➕ Новый абонент</h2>
            <div className="space-y-2 mb-4">
              <div className="text-[10px] text-[#64748b]">
                Координаты: {showAddSub.lat.toFixed(6)}, {showAddSub.lon.toFixed(6)}
              </div>
              <input
                value={newSubDistrict}
                onChange={(e) => setNewSubDistrict(e.target.value)}
                placeholder="Район / город"
                className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]"
                autoFocus
              />
              <input
                value={newSubDesc}
                onChange={(e) => setNewSubDesc(e.target.value)}
                placeholder="Адрес / описание"
                className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAddSub(null)} className="flex-1 py-1.5 border border-[#1e3a5f] rounded text-xs text-[#94a3b8]">
                Отмена
              </button>
              <button onClick={submitNewSubscriber} className="flex-1 py-1.5 bg-[#34d399]/15 hover:bg-[#34d399]/25 text-[#34d399] rounded text-xs font-semibold">
                Добавить и перестроить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help modal */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in" onClick={() => setShowHelp(false)}>
          <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl w-[520px] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[#1e3a5f]">
              <h2 className="text-sm font-semibold text-[#e2e8f0]">📖 Справка и горячие клавиши</h2>
              <button onClick={() => setShowHelp(false)} className="text-[#64748b] hover:text-[#e2e8f0]">✕</button>
            </div>
            <div className="p-4 space-y-4 text-xs">
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-[#64748b] mb-2">Горячие клавиши</h3>
                <div className="grid grid-cols-2 gap-2 text-[#94a3b8]">
                  <div><kbd className="bg-[#1a2744] px-1.5 py-0.5 rounded text-[#e2e8f0] font-mono">Ctrl+S</kbd> Сохранить</div>
                  <div><kbd className="bg-[#1a2744] px-1.5 py-0.5 rounded text-[#e2e8f0] font-mono">Ctrl+I</kbd> Импорт</div>
                  <div><kbd className="bg-[#1a2744] px-1.5 py-0.5 rounded text-[#e2e8f0] font-mono">Ctrl+N</kbd> Новый проект</div>
                  <div><kbd className="bg-[#1a2744] px-1.5 py-0.5 rounded text-[#e2e8f0] font-mono">E</kbd> Реж. редактирования</div>
                  <div><kbd className="bg-[#1a2744] px-1.5 py-0.5 rounded text-[#e2e8f0] font-mono">M</kbd> Линейка</div>
                  <div><kbd className="bg-[#1a2744] px-1.5 py-0.5 rounded text-[#e2e8f0] font-mono">Esc</kbd> Отмена/закрыть</div>
                  <div><kbd className="bg-[#1a2744] px-1.5 py-0.5 rounded text-[#e2e8f0] font-mono">?</kbd> Эта справка</div>
                </div>
              </section>
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-[#64748b] mb-2">Работа с картой</h3>
                <ul className="space-y-1 text-[#94a3b8] list-disc list-inside">
                  <li><b>Импорт «Добавить»</b> — накапливает несколько городов в одном проекте</li>
                  <li><b>4 базовые карты</b> — тёмная, светлая, спутник, гибрид (правый верхний угол)</li>
                  <li><b>Заметки</b> — выбери тип/инструмент во вкладке «Заметки», кликай по карте</li>
                  <li><b>Полигоны/линии</b> — клик = точка, ПКМ = завершить</li>
                  <li><b>Линейка 📏</b> — клик-клик измерение, ПКМ = сброс</li>
                  <li><b>Режим редакт.</b> — клик по карте добавляет абонента и перестраивает сеть</li>
                  <li><b>Автосохранение</b> — каждые 30 сек (вкл. во вкладке «Проекты»)</li>
                </ul>
              </section>
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-[#64748b] mb-2">Формат Excel</h3>
                <pre className="bg-[#0a0e1a] border border-[#1e3a5f] rounded p-2 text-[10px] text-[#94a3b8] font-mono">
{`Лист = район/город
A1: Latitude  B1: Longitude  C1: Description
A2: 40.777    B2: 68.320     C2: Жетісай қ., ул...
A3: ...`}
                </pre>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
