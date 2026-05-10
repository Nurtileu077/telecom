'use client';
import dynamic from 'next/dynamic';
import { useState, useRef, useCallback } from 'react';
import { useNetwork } from '@/hooks/useNetwork';
import Sidebar from '@/components/Sidebar/Sidebar';
import ImportModal from '@/components/Import/ImportModal';
import { Subscriber, ProjectSettings } from '@/types/network';

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
  const flyToRef = useRef<((lat: number, lon: number, zoom?: number) => void) | null>(null);

  const handleBuild = useCallback(async (subs: Subscriber[], s: ProjectSettings) => {
    net.setSettings(s);
    setShowImport(false);
    await net.buildFromSubscribers(subs);
  }, [net]);

  const osrmPercent = net.osrmProgress.total > 0
    ? Math.round((net.osrmProgress.done / net.osrmProgress.total) * 100)
    : 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="h-12 flex items-center px-4 gap-4 border-b border-[#1e3a5f] bg-[#0d1b2a] flex-shrink-0 z-10">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-lg">📡</span>
          <span className="text-sm font-bold text-[#38bdf8] font-mono tracking-wide">GPON</span>
          <span className="text-[#1e3a5f]">|</span>
          <input
            type="text"
            value={net.projectName}
            onChange={(e) => net.setProjectName(e.target.value)}
            className="bg-transparent text-sm text-[#e2e8f0] border-none outline-none w-40 focus:text-[#38bdf8] transition-colors"
          />
        </div>

        {/* Stats badges */}
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="px-2 py-0.5 bg-[#38bdf8]/10 border border-[#38bdf8]/30 text-[#38bdf8] rounded-md">
            👥 {net.totalSubscribers}
          </span>
          <span className="px-2 py-0.5 bg-[#34d399]/10 border border-[#34d399]/30 text-[#34d399] rounded-md">
            〰 {net.totalCableKm} км
          </span>
          <span className="px-2 py-0.5 bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b] rounded-md">
            📦 {net.totalOrks} ОРК
          </span>
          {net.status === 'routing' && (
            <span className="px-2 py-0.5 bg-[#a78bfa]/10 border border-[#a78bfa]/30 text-[#a78bfa] rounded-md animate-pulse">
              🛣 OSRM {osrmPercent}%
            </span>
          )}
          {net.status === 'clustering' && (
            <span className="px-2 py-0.5 bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b] rounded-md animate-pulse">
              ⚙ Кластеризация...
            </span>
          )}
          {net.status === 'done' && (
            <span className="px-2 py-0.5 bg-[#34d399]/10 border border-[#34d399]/30 text-[#34d399] rounded-md">
              ✓ Готово
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => net.saveProject()}
            disabled={net.districts.length === 0}
            className="px-3 py-1 text-xs border border-[#1e3a5f] rounded-lg text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#38bdf8]/40 transition-colors disabled:opacity-40"
          >
            💾 Сохранить
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1 text-xs bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#0a0e1a] font-semibold rounded-lg transition-colors"
          >
            📂 Импорт
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          districts={net.districts}
          cables={net.cables}
          materials={net.materials}
          layers={net.layers}
          toggleLayer={net.toggleLayer}
          validationIssues={net.validationIssues}
          flyTo={flyToRef.current}
        />

        {/* Map area */}
        <main className="flex-1 relative overflow-hidden">
          <LeafletMap
            districts={net.districts}
            cables={net.cables}
            layers={net.layers}
            flyToRef={flyToRef}
          />

          {/* OSRM Progress overlay */}
          {net.status === 'routing' && net.osrmProgress.total > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl p-3 shadow-xl min-w-[280px] animate-fade-in">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#e2e8f0]">🛣 Прокладка маршрутов</span>
                <span className="text-xs font-mono text-[#38bdf8]">{net.osrmProgress.done}/{net.osrmProgress.total}</span>
              </div>
              <div className="h-1.5 bg-[#1e3a5f] rounded-full overflow-hidden mb-1">
                <div
                  className="progress-bar"
                  style={{ width: `${osrmPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#64748b] truncate max-w-[180px]">{net.osrmProgress.current}</span>
                <button
                  onClick={net.stopOSRM}
                  className="text-[10px] text-[#f87171] hover:text-[#fca5a5] transition-colors ml-2 flex-shrink-0"
                >
                  Остановить
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {net.districts.length === 0 && net.status === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center bg-[#0d1b2a]/80 backdrop-blur-sm border border-[#1e3a5f] rounded-2xl p-8 pointer-events-auto">
                <div className="text-5xl mb-4">📡</div>
                <h2 className="text-lg font-semibold text-[#e2e8f0] mb-2">GPON Network Designer</h2>
                <p className="text-sm text-[#94a3b8] mb-4 max-w-xs">
                  Загрузите Excel или KMZ файл с адресами абонентов для автоматического построения топологии FTTH сети
                </p>
                <button
                  onClick={() => setShowImport(true)}
                  className="px-6 py-2.5 bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#0a0e1a] font-semibold rounded-xl text-sm transition-colors"
                >
                  📂 Импорт данных
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Import modal */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onBuild={handleBuild}
          currentSettings={net.settings}
        />
      )}
    </div>
  );
}
