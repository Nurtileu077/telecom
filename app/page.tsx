'use client';
import dynamic from 'next/dynamic';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useNetwork } from '@/hooks/useNetwork';
import Sidebar from '@/components/Sidebar/Sidebar';
import ImportModal, { ImportMode, NetworkImportMode, OltLocations } from '@/components/Import/ImportModal';
import AddCamerasModal from '@/components/Import/AddCamerasModal';
import { Subscriber, ProjectSettings, AnnotationType, Project, ProjectStatus, PROJECT_STATUS_LABELS } from '@/types/network';
import type { DrawingTool } from '@/components/Sidebar/NotesTab';
import GeocodeSearch from '@/components/Geocoding/GeocodeSearch';
import { exportPDF } from '@/components/Export/ExportPDF';
import { calculateCost } from '@/components/Network/CostCalc';
import ProjectListModal from '@/components/Projects/ProjectListModal';
import CatalogModal from '@/components/Catalog/CatalogModal';
import EntityEditor, { EntitySelection } from '@/components/Map/EntityEditor';
import CableEditor from '@/components/Map/CableEditor';
import SplicePlan from '@/components/Map/SplicePlan';
import ChatPanel from '@/components/AI/ChatPanel';
import type { SelectionPolygon } from '@/components/Network/Selection';

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
  const [showAddCameras, setShowAddCameras] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showAddSub, setShowAddSub] = useState<{ lat: number; lon: number } | null>(null);
  const [newSubDistrict, setNewSubDistrict] = useState('');
  const [newSubDesc, setNewSubDesc] = useState('');
  const [activeTool, setActiveTool] = useState<DrawingTool>(null);
  const [activeAnnotationType, setActiveAnnotationType] = useState<AnnotationType>('village');
  const [measureMode, setMeasureMode] = useState(false);
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [entitySelection, setEntitySelection] = useState<EntitySelection | null>(null);
  const [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const [editingCableId, setEditingCableId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<'olt' | 'tb' | 'ork' | null>(null);
  const [cableDraw, setCableDraw] = useState<{ stage: 'from' | 'to'; fromId?: string } | null>(null);
  const [budgetColoring, setBudgetColoring] = useState(false);
  const [splicePlanTbId, setSplicePlanTbId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ lat: number; lon: number; x: number; y: number } | null>(null);
  const [coordInput, setCoordInput] = useState<{ kind: 'sub' | 'olt' | 'tb' | 'ork' } | null>(null);
  const [coordText, setCoordText] = useState('');
  const [showChat, setShowChat] = useState(false);
  // Click on map to build a polygon for export / scoped tools (right-click or «Готово» to finish).
  const [selectionDrawActive, setSelectionDrawActive] = useState(false);
  const [selectionVertices, setSelectionVertices] = useState<SelectionPolygon>([]);
  const [selectionPolygon, setSelectionPolygon] = useState<SelectionPolygon | null>(null);

  const budgetMap = useRef<Map<string, 'ok' | 'warn' | 'fail'>>(new Map());
  useEffect(() => {
    const m = new Map<string, 'ok' | 'warn' | 'fail'>();
    for (const b of net.powerBudgets) m.set(b.subId, b.status);
    budgetMap.current = m;
  }, [net.powerBudgets]);
  const flyToRef = useRef<((lat: number, lon: number, zoom?: number) => void) | null>(null);
  const mapElRef = useRef<HTMLElement | null>(null);

  const onExportPDF = useCallback(async () => {
    if (!net.materials) { alert('Сначала постройте сеть'); return; }
    const cost = calculateCost(net.materials, net.prices);
    await exportPDF(net.projectName, net.districts, net.cables, net.materials, cost, mapElRef.current);
  }, [net.projectName, net.districts, net.cables, net.materials, net.prices]);

  const onPrintMap = useCallback(() => window.print(), []);

  const handleBuild = useCallback(async (subs: Subscriber[], s: ProjectSettings, source: string, mode: ImportMode, oltLocations?: OltLocations) => {
    net.setSettings(s);
    setShowImport(false);
    if (mode === 'append') {
      await net.appendSubscribers(subs, source, oltLocations);
    } else {
      await net.buildFromSubscribers(subs, source, oltLocations);
    }
  }, [net]);

  const handleLoadRaw = useCallback(async (
    subs: Subscriber[],
    lines: { coords: [number, number][]; name: string; folder: string }[],
    source: string,
  ) => {
    setShowImport(false);
    await net.loadRaw(subs, lines, source);
  }, [net]);

  const handleLoadStructured = useCallback(async (
    districts: import('@/types/network').District[],
    cables: import('@/types/network').Cable[],
    joints: import('@/types/network').InlineJoint[],
    source: string,
  ) => {
    setShowImport(false);
    await net.loadStructured(districts, cables, joints, source);
  }, [net]);

  // Drag-drop reassignment: when an ORK is dropped near a different TB (≤80m), reassign it.
  // For subscribers: if dropped near another ORK (≤120m), reassign.
  const SNAP_TB_M = 80;
  const SNAP_ORK_M = 120;
  const handleMoveEntity = useCallback((kind: 'tb' | 'ork' | 'olt', id: string, lat: number, lon: number) => {
    // Compute haversine inline
    const dist = (a: [number, number], b: [number, number]) => {
      const R = 6371000;
      const dLat = ((b[0] - a[0]) * Math.PI) / 180;
      const dLon = ((b[1] - a[1]) * Math.PI) / 180;
      const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    };

    if (kind === 'ork') {
      // Find current TB parent of this ORK
      let currentTbId: string | null = null;
      let bestTbId: string | null = null;
      let bestTbDist = Infinity;
      for (const d of net.districts) {
        for (const tb of d.olt.transitBoxes) {
          if (tb.orks.some((o) => o.id === id)) currentTbId = tb.id;
          const dd = dist([lat, lon], [tb.lat, tb.lon]);
          if (dd < bestTbDist) { bestTbDist = dd; bestTbId = tb.id; }
        }
      }
      if (bestTbId && currentTbId && bestTbId !== currentTbId && bestTbDist <= SNAP_TB_M) {
        net.moveEntity('ork', id, lat, lon);
        net.reassignORK(id, bestTbId);
        return;
      }
    }
    net.moveEntity(kind, id, lat, lon);
  }, [net]);

  const handleImportNetwork = useCallback(async (project: Project, mode: NetworkImportMode) => {
    setShowImport(false);
    if (mode === 'replace') {
      net.importNetworkReplace(project);
    } else {
      await net.mergeNetworkDistricts(project);
    }
  }, [net]);

  const finishSelectionPolygon = useCallback(() => {
    if (selectionVertices.length >= 3) {
      setSelectionPolygon([...selectionVertices]);
      setSelectionVertices([]);
      setSelectionDrawActive(false);
    }
  }, [selectionVertices]);

  const handleMapClickAddSub = useCallback((lat: number, lon: number) => {
    if (selectionDrawActive) {
      setSelectionVertices((v) => [...v, [lat, lon]]);
      return;
    }
    // Placement mode takes priority over add-subscriber
    if (placing === 'olt') {
      const name = window.prompt('Название района для нового OLT:', 'Новый район');
      if (name === null) { setPlacing(null); return; }
      net.addOLTAt(lat, lon, name);
      setPlacing(null);
      return;
    }
    if (placing === 'tb') {
      if (net.districts.length === 0) { alert('Сначала создай OLT'); setPlacing(null); return; }
      net.addTBAt(lat, lon);
      setPlacing(null);
      return;
    }
    if (placing === 'ork') {
      const hasTB = net.districts.some((d) => d.olt.transitBoxes.length > 0);
      if (!hasTB) { alert('Сначала создай Муфту (TB)'); setPlacing(null); return; }
      net.addORKAt(lat, lon);
      setPlacing(null);
      return;
    }
    setShowAddSub({ lat, lon });
    const existing = Array.from(new Set(net.districts.map((d) => d.name)));
    if (existing.length === 1) setNewSubDistrict(existing[0]);
  }, [net, placing, selectionDrawActive]);

  const handleSaveProject = useCallback(async () => {
    const r = await net.saveProject();
    alert(r.message);
  }, [net]);

  // Drop a point of the requested kind at (lat, lon) — used by the right-click
  // context menu and by the manual-coordinate dialog.  Bypasses placing/edit mode.
  const dropEntityAt = useCallback((kind: 'sub' | 'olt' | 'tb' | 'ork', lat: number, lon: number) => {
    if (kind === 'olt') {
      const name = window.prompt('Название района для нового OLT:', 'Новый район');
      if (name === null) return;
      net.addOLTAt(lat, lon, name);
      return;
    }
    if (kind === 'tb') {
      if (net.districts.length === 0) { alert('Сначала создай OLT'); return; }
      net.addTBAt(lat, lon);
      return;
    }
    if (kind === 'ork') {
      const hasTB = net.districts.some((d) => d.olt.transitBoxes.length > 0);
      if (!hasTB) { alert('Сначала создай Муфту (TB)'); return; }
      net.addORKAt(lat, lon);
      return;
    }
    // subscriber
    setShowAddSub({ lat, lon });
    const existing = Array.from(new Set(net.districts.map((d) => d.name)));
    if (existing.length === 1) setNewSubDistrict(existing[0]);
  }, [net]);

  const submitCoordInput = useCallback(() => {
    if (!coordInput) return;
    const m = coordText.trim().match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    if (!m) { alert('Формат: lat, lng (например: 40.78, 68.32)'); return; }
    const lat = parseFloat(m[1].replace(',', '.'));
    const lon = parseFloat(m[2].replace(',', '.'));
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      alert('Неверные координаты'); return;
    }
    const k = coordInput.kind;
    setCoordInput(null);
    setCoordText('');
    dropEntityAt(k, lat, lon);
  }, [coordInput, coordText, dropEntityAt]);

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
        if (e.key === 's') { e.preventDefault(); handleSaveProject(); }
        if (e.key === 'i') { e.preventDefault(); setShowImport(true); }
        if (e.key === 'n') { e.preventDefault(); if (confirm('Новый проект? Несохранённые данные пропадут.')) net.newProject(); }
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); net.undo(); }
        if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); net.redo(); }
      } else {
        if (e.key === '?' || (e.shiftKey && e.key === '/')) { setShowHelp(true); }
        if (e.key === 'e') net.setEditMode(!net.editMode);
        if (e.key === 'm') setMeasureMode((m) => !m);
        if (e.key === 'Escape') {
          setShowImport(false);
          setShowHelp(false);
          setShowAddSub(null);
          setPlacing(null);
          setCableDraw(null);
          setEntitySelection(null);
          setSelectedCableId(null);
          setSelectionDrawActive(false);
          setSelectionVertices([]);
          setSelectionPolygon(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [net, handleSaveProject]);

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
          <select
            value={net.projectStatus}
            onChange={(e) => net.setProjectStatus(e.target.value as ProjectStatus)}
            className="bg-transparent text-[10px] font-medium border rounded px-1.5 py-0.5 cursor-pointer focus:outline-none"
            style={{
              color: PROJECT_STATUS_LABELS[net.projectStatus].color,
              borderColor: `${PROJECT_STATUS_LABELS[net.projectStatus].color}55`,
              background: `${PROJECT_STATUS_LABELS[net.projectStatus].color}10`,
            }}
            title="Статус проекта"
          >
            {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((s) => (
              <option key={s} value={s} className="bg-[#0d1b2a] text-[#e2e8f0]">
                {PROJECT_STATUS_LABELS[s].icon} {PROJECT_STATUS_LABELS[s].label}
              </option>
            ))}
          </select>
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
          {net.status === 'calculating' && (
            <span className="px-2 py-0.5 bg-[#34d399]/10 border border-[#34d399]/30 text-[#34d399] rounded-md animate-pulse">🔁 Слияние…</span>
          )}
          {net.status === 'clustering' && (
            <span className="px-2 py-0.5 bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b] rounded-md animate-pulse">⚙ Кластеризация...</span>
          )}
          {net.status === 'done' && net.cables.length > 0 && net.joints.length === 0 && (
            <span className="px-2 py-0.5 bg-[#fbbf24]/10 border border-[#fbbf24]/30 text-[#fbbf24] rounded-md" title="Инструменты: ① OSRM, затем ② слияние">
              ①→②
            </span>
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
          <div className="flex items-center gap-0.5 border border-[#1e3a5f] rounded-lg px-0.5 py-0.5">
            <button
              onClick={() => net.undo()}
              disabled={!net.canUndo}
              className="px-2 py-0.5 text-[11px] rounded text-[#94a3b8] hover:text-[#e2e8f0] disabled:opacity-30"
              title="Отмена (Ctrl+Z)"
            >
              ↶
            </button>
            <button
              onClick={() => net.redo()}
              disabled={!net.canRedo}
              className="px-2 py-0.5 text-[11px] rounded text-[#94a3b8] hover:text-[#e2e8f0] disabled:opacity-30"
              title="Повтор (Ctrl+Shift+Z)"
            >
              ↷
            </button>
          </div>
          <div className="flex items-center gap-0.5 border border-[#1e3a5f] rounded-lg px-0.5 py-0.5">
            <button
              onClick={() => setPlacing(placing === 'olt' ? null : 'olt')}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${placing === 'olt' ? 'bg-[#f59e0b]/20 text-[#f59e0b]' : 'text-[#94a3b8] hover:text-[#e2e8f0]'}`}
              title="Поставить OLT по клику"
            >
              +OLT
            </button>
            <button
              onClick={() => setPlacing(placing === 'tb' ? null : 'tb')}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${placing === 'tb' ? 'bg-[#38bdf8]/20 text-[#38bdf8]' : 'text-[#94a3b8] hover:text-[#e2e8f0]'}`}
              title="Поставить Муфту (TB) — подключится к ближайшему OLT"
            >
              +Муфта
            </button>
            <button
              onClick={() => setPlacing(placing === 'ork' ? null : 'ork')}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${placing === 'ork' ? 'bg-[#f59e0b]/20 text-[#f59e0b]' : 'text-[#94a3b8] hover:text-[#e2e8f0]'}`}
              title="Поставить ОРК — подключится к ближайшей Муфте"
            >
              +ОРК
            </button>
            <button
              onClick={() => { setCableDraw(cableDraw ? null : { stage: 'from' }); setPlacing(null); }}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${cableDraw ? 'bg-[#34d399]/20 text-[#34d399]' : 'text-[#94a3b8] hover:text-[#e2e8f0]'}`}
              title="Нарисовать кабель: клик по первой точке, потом по второй"
            >
              +Кабель
            </button>
          </div>
          <button
            onClick={() => setShowCatalog(true)}
            disabled={!net.dbEnabled}
            className="px-2 py-1 text-xs border border-[#1e3a5f] rounded-lg text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#38bdf8]/40 transition-colors disabled:opacity-30"
            title="Каталог оборудования"
          >
            📦 Каталог
          </button>
          <button
            onClick={() => setShowProjects(true)}
            className="px-2 py-1 text-xs border border-[#1e3a5f] rounded-lg text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#38bdf8]/40 transition-colors"
            title="Список проектов"
          >
            {net.dbEnabled ? '☁' : '🗂'} Проекты
          </button>
          <button
            onClick={handleSaveProject}
            disabled={net.districts.length === 0 && net.annotations.length === 0}
            className="px-3 py-1 text-xs border border-[#1e3a5f] rounded-lg text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#38bdf8]/40 transition-colors disabled:opacity-40"
            title="Сохранить (Ctrl+S)"
          >
            💾 Сохранить
          </button>
          {/* «Построить» — кластеризация подгруженных абонентов в OLT/Муфты/ОРК.
              Видимо только когда есть «сырые» подписчики без сети (raw-import). */}
          {net.allSubscribers.length > 0 && net.districts.length === 0 && (
            <button
              onClick={() => net.rebuildFromCurrent()}
              className="px-3 py-1 text-xs bg-[#fbbf24] hover:bg-[#fde68a] text-[#0a0e1a] font-semibold rounded-lg transition-colors animate-pulse"
              title="Запустить авто-построение сети (kmeans → OSRM → консолидация)"
            >
              🔨 Построить
            </button>
          )}
          {/* Selection polygon: click vertices, right-click or «Готово» to finish. */}
          {selectionPolygon && selectionPolygon.length >= 3 ? (
            <button
              onClick={() => { setSelectionPolygon(null); setSelectionVertices([]); setSelectionDrawActive(false); }}
              className="px-2 py-1 text-[11px] bg-[#fbbf24]/20 border border-[#fbbf24]/60 text-[#fbbf24] font-mono rounded-lg transition-colors hover:bg-[#fbbf24]/30"
              title="Снять выделение"
            >
              🔷 Выделено ({selectionPolygon.length} точ.) ✕
            </button>
          ) : selectionDrawActive ? (
            <>
              <button
                onClick={finishSelectionPolygon}
                disabled={selectionVertices.length < 3}
                className="px-2 py-1 text-[11px] bg-[#34d399]/20 border border-[#34d399]/60 text-[#34d399] rounded-lg disabled:opacity-40"
                title="Завершить полигон (или ПКМ на карте)"
              >
                ✓ Готово ({selectionVertices.length})
              </button>
              <button
                onClick={() => { setSelectionDrawActive(false); setSelectionVertices([]); }}
                className="px-2 py-1 text-[11px] text-[#94a3b8] border border-[#1e3a5f] rounded-lg"
              >
                Отмена
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setSelectionDrawActive(true);
                setSelectionVertices([]);
                setPlacing(null);
                setCableDraw(null);
              }}
              className="px-2 py-1 text-[11px] rounded-lg transition-colors text-[#94a3b8] border border-[#1e3a5f] hover:text-[#e2e8f0] hover:border-[#fbbf24]/50"
              title="Кликайте по карте — вершины полигона; ПКМ или «Готово» — завершить"
            >
              🔷 Выделить
            </button>
          )}
          {/* Brownfield: добавить камеры на существующую сеть. */}
          {net.districts.length > 0 && (
            <button
              onClick={() => setShowAddCameras(true)}
              className="px-3 py-1 text-xs text-[#94a3b8] border border-[#1e3a5f] hover:text-[#e2e8f0] hover:border-[#38bdf8]/50 rounded-lg transition-colors"
              title="Добавить новые камеры Excel-ом к существующей сети"
            >
              📷 Камеры
            </button>
          )}
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
          joints={net.joints}
          ontBoxes={net.ontBoxes}
          selectionPolygon={selectionPolygon}
          cableReserve={net.settings.cableReserve}
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
          onPass1={() => net.runPass1Osrm(selectionPolygon)}
          onPass2={() => net.runPass2Consolidate(selectionPolygon)}
          osrmStatus={net.status}
          powerBudgets={net.powerBudgets}
          powerBudgetStats={net.powerBudgetStats}
          budgetColoring={budgetColoring}
          setBudgetColoring={setBudgetColoring}
          projectStatus={net.projectStatus}
          setProjectStatus={net.setProjectStatus}
          snapshots={net.snapshots}
          takeSnapshot={net.takeSnapshot}
          restoreSnapshot={net.restoreSnapshot}
          deleteSnapshot={net.deleteSnapshot}
          settings={net.settings}
          setSettings={net.setSettings}
        />

        <main className="flex-1 relative overflow-hidden isolate">
          <LeafletMap
            districts={net.districts}
            cables={net.cables}
            joints={net.joints}
            unassignedSubscribers={net.allSubscribers}
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
            placingMode={!!placing}
            selectionDrawActive={selectionDrawActive}
            selectionVertices={selectionVertices}
            selectionPolygon={selectionPolygon}
            onMapClick={handleMapClickAddSub}
            onMapContextMenu={(lat, lon, x, y) => {
              if (selectionDrawActive && selectionVertices.length >= 3) {
                finishSelectionPolygon();
                return;
              }
              setContextMenu({ lat, lon, x, y });
            }}
            moveEntity={handleMoveEntity}
            deleteSubscriber={net.deleteSubscriber}
            onEntityClick={(kind, id) => {
              // Cable-drawing flow takes priority
              if (cableDraw) {
                if (cableDraw.stage === 'from') {
                  setCableDraw({ stage: 'to', fromId: id });
                } else if (cableDraw.stage === 'to' && cableDraw.fromId) {
                  if (cableDraw.fromId !== id) net.addCableBetween(cableDraw.fromId, id);
                  setCableDraw(null);
                }
                return;
              }
              setEntitySelection({ kind, id } as EntitySelection);
              setSelectedCableId(null);
            }}
            onCableClick={(id) => { setSelectedCableId(id); setEntitySelection(null); }}
            editingCableId={editingCableId}
            onUpdateCableCoords={(id, coords) => net.updateCable(id, { coords })}
            measureMode={measureMode}
            setMeasureMode={setMeasureMode}
            heatmapEnabled={heatmapEnabled}
            budgetMap={budgetMap.current}
            budgetColoring={budgetColoring}
          />

          <EntityEditor
            selection={entitySelection}
            districts={net.districts}
            onClose={() => setEntitySelection(null)}
            onUpdateOLT={net.updateOLT}
            onUpdateTB={net.updateTB}
            onUpdateORK={net.updateORK}
            onDeleteOLT={net.deleteOLT}
            onDeleteTB={net.deleteTB}
            onDeleteORK={net.deleteORK}
            onReassignORK={net.reassignORK}
            onOpenSplicePlan={(tbId) => { setSplicePlanTbId(tbId); setEntitySelection(null); }}
          />

          <SplicePlan
            tbId={splicePlanTbId}
            districts={net.districts}
            cables={net.cables}
            onClose={() => setSplicePlanTbId(null)}
          />

          <CableEditor
            cable={selectedCableId ? (net.cables.find((c) => c.id === selectedCableId) ?? null) : null}
            onClose={() => { setSelectedCableId(null); setEditingCableId(null); }}
            onUpdateType={(id, type) => net.updateCable(id, { type })}
            onRerouteOSRM={(id) => net.rerouteSingleCable(id)}
            onToggleWaypoints={(id) => setEditingCableId(id)}
            onDelete={net.deleteCable}
            waypointEditing={editingCableId === selectedCableId && !!editingCableId}
            rerouteStatus={net.status}
          />

          {placing && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-[#0d1b2a]/97 border border-[#a78bfa]/50 rounded-lg px-3 py-1.5 text-xs text-[#a78bfa] shadow-2xl flex items-center gap-2 animate-fade-in">
              <span>🎯 Клик по карте — поставить {placing === 'olt' ? 'OLT' : placing === 'tb' ? 'Муфту' : 'ОРК'}</span>
              <button onClick={() => setPlacing(null)} className="text-[#94a3b8] hover:text-white border border-[#a78bfa]/30 rounded px-1.5 py-0.5 text-[10px]">Esc</button>
            </div>
          )}

          {cableDraw && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-[#0d1b2a]/97 border border-[#34d399]/50 rounded-lg px-3 py-1.5 text-xs text-[#34d399] shadow-2xl flex items-center gap-2 animate-fade-in">
              <span>
                〰 {cableDraw.stage === 'from'
                    ? 'Клик на первой точке (OLT/Муфта/ОРК)'
                    : 'Клик на второй точке — кабель будет создан'}
              </span>
              <button onClick={() => setCableDraw(null)} className="text-[#94a3b8] hover:text-white border border-[#34d399]/30 rounded px-1.5 py-0.5 text-[10px]">Esc</button>
            </div>
          )}

          {selectionDrawActive && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-[#0d1b2a]/97 border border-[#fbbf24]/50 rounded-lg px-3 py-1.5 text-xs text-[#fbbf24] shadow-2xl flex items-center gap-2 animate-fade-in">
              <span>🔲 Зажмите мышь на карте и потяните — выделить область</span>
              <button type="button" onClick={() => setSelectionDrawActive(false)} className="text-[#94a3b8] hover:text-white border border-[#fbbf24]/30 rounded px-1.5 py-0.5 text-[10px]">Esc</button>
            </div>
          )}

          {(net.status === 'routing' || net.status === 'calculating') && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[9100] pointer-events-none flex justify-center w-full max-w-[min(100vw-2rem,420px)] px-4">
              <div className="bg-[#0d1b2a]/97 border border-[#38bdf8]/40 rounded-xl p-3 shadow-2xl w-full pointer-events-auto animate-fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-4 h-4 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span className="text-xs font-semibold text-[#e2e8f0]">
                    {net.status === 'calculating'
                      ? '2-й проход: объединение кабелей и муфт…'
                      : '1-й проход: прокладка по дорогам (OSRM)'}
                  </span>
                </div>
                {net.status === 'routing' && net.osrmProgress.total > 0 && (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[#94a3b8] truncate mr-2">{net.osrmProgress.current || 'OSRM…'}</span>
                      <span className="text-[10px] font-mono text-[#38bdf8]">{net.osrmProgress.done}/{net.osrmProgress.total}</span>
                    </div>
                    <div className="h-1.5 bg-[#1e3a5f] rounded-full overflow-hidden mb-2">
                      <div className="progress-bar h-full" style={{ width: `${osrmPercent}%` }} />
                    </div>
                  </>
                )}
                {net.status === 'calculating' && (
                  <p className="text-[10px] text-[#94a3b8] mb-2">Счётчик 1/N — только для OSRM; слияние идёт сразу после маршрутизации.</p>
                )}
                {net.status === 'routing' && (
                  <button type="button" onClick={net.stopOSRM} className="text-[10px] text-[#f87171] hover:text-[#fca5a5] border border-[#f87171]/30 rounded px-2 py-0.5">
                    ✕ Остановить
                  </button>
                )}
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
          onLoadRaw={handleLoadRaw}
          onLoadStructured={handleLoadStructured}
          onImportNetwork={handleImportNetwork}
          currentSettings={net.settings}
          hasExistingData={net.totalSubscribers > 0}
        />
      )}

      {showAddCameras && (
        <AddCamerasModal
          onClose={() => setShowAddCameras(false)}
          onAdd={async (rows) => {
            for (const r of rows) {
              const district = r.district || net.districts[0]?.name || 'Камеры';
              await net.addSubscriberAt(r.lat, r.lon, district, r.desc, r.cameraType);
            }
          }}
        />
      )}

      {showCatalog && <CatalogModal onClose={() => setShowCatalog(false)} />}

      {showProjects && (
        <ProjectListModal
          onClose={() => setShowProjects(false)}
          onLoad={(p) => { net.loadProject(p); }}
          onNew={() => { net.newProject(); setShowProjects(false); }}
          listProjects={net.listProjects}
          deleteProject={net.deleteProject}
          currentProjectId={net.projectId}
          dbEnabled={net.dbEnabled}
        />
      )}

      {/* Right-click context menu on map */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            className="fixed z-[9999] bg-[#0d1b2a] border border-[#1e3a5f] rounded-md shadow-2xl py-1 min-w-[220px] animate-fade-in text-[12px]"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 240),
              top: Math.min(contextMenu.y, window.innerHeight - 280),
            }}
          >
            <div className="px-3 py-1.5 text-[10px] text-[#64748b] font-mono border-b border-[#1e3a5f]/50">
              {contextMenu.lat.toFixed(6)}, {contextMenu.lon.toFixed(6)}
            </div>
            <button
              onClick={() => { dropEntityAt('sub', contextMenu.lat, contextMenu.lon); setContextMenu(null); }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#34d399]/10 text-[#e2e8f0] flex items-center gap-2"
            >
              <span>🏠</span><span>Добавить абонента</span>
            </button>
            <button
              onClick={() => { dropEntityAt('ork', contextMenu.lat, contextMenu.lon); setContextMenu(null); }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#38bdf8]/10 text-[#e2e8f0] flex items-center gap-2"
            >
              <span>📦</span><span>Поставить ОРК</span>
            </button>
            <button
              onClick={() => { dropEntityAt('tb', contextMenu.lat, contextMenu.lon); setContextMenu(null); }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#38bdf8]/10 text-[#e2e8f0] flex items-center gap-2"
            >
              <span>🔷</span><span>Поставить Муфту (TB)</span>
            </button>
            <button
              onClick={() => { dropEntityAt('olt', contextMenu.lat, contextMenu.lon); setContextMenu(null); }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#38bdf8]/10 text-[#e2e8f0] flex items-center gap-2"
            >
              <span>📡</span><span>Поставить OLT</span>
            </button>
            <div className="my-1 border-t border-[#1e3a5f]/50" />
            <button
              onClick={() => {
                setCableDraw({ stage: 'from' });
                setPlacing(null);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#a78bfa]/10 text-[#e2e8f0] flex items-center gap-2"
            >
              <span>🔗</span><span>Протянуть кабель А→Б…</span>
            </button>
            <button
              onClick={() => { setCoordInput({ kind: 'sub' }); setContextMenu(null); }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#fbbf24]/10 text-[#e2e8f0] flex items-center gap-2"
            >
              <span>⌨</span><span>Ввести координаты вручную…</span>
            </button>
          </div>
        </>
      )}

      {/* Manual coordinate-entry dialog */}
      {coordInput && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl w-[360px] p-4">
            <h2 className="text-sm font-semibold text-[#e2e8f0] mb-3">⌨ По координатам</h2>
            <div className="space-y-2 mb-4">
              <div className="grid grid-cols-4 gap-1">
                {(['sub', 'ork', 'tb', 'olt'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setCoordInput({ kind: k })}
                    className={`py-1.5 text-[11px] rounded transition-colors ${coordInput.kind === k ? 'bg-[#38bdf8]/20 border border-[#38bdf8] text-[#38bdf8]' : 'border border-[#1e3a5f] text-[#94a3b8]'}`}
                  >
                    {k === 'sub' ? '🏠 Аб.' : k === 'ork' ? '📦 ОРК' : k === 'tb' ? '🔷 TB' : '📡 OLT'}
                  </button>
                ))}
              </div>
              <input
                value={coordText}
                onChange={(e) => setCoordText(e.target.value)}
                placeholder="40.78, 68.32"
                className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1.5 text-xs text-[#e2e8f0] font-mono focus:outline-none focus:border-[#38bdf8]"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') submitCoordInput(); }}
              />
              <div className="text-[10px] text-[#64748b]">
                Формат: <code className="text-[#94a3b8]">lat, lng</code> — десятичные градусы.
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setCoordInput(null); setCoordText(''); }} className="flex-1 py-1.5 border border-[#1e3a5f] rounded text-xs text-[#94a3b8]">
                Отмена
              </button>
              <button onClick={submitCoordInput} className="flex-1 py-1.5 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 text-[#38bdf8] rounded text-xs font-semibold">
                Поставить точку
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add subscriber dialog */}
      {showAddSub && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in" onClick={() => setShowHelp(false)}>
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

      {/* AI assistant — floating button + side panel */}
      {!showChat && (
        <button
          onClick={() => setShowChat(true)}
          className={`fixed right-4 z-[8999] w-12 h-12 rounded-full bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#0a0e1a] text-xl font-bold shadow-2xl flex items-center justify-center transition-colors ${
            net.status === 'routing' || net.status === 'calculating' ? 'bottom-28' : 'bottom-4'
          }`}
          title="ИИ-ассистент"
        >
          🤖
        </button>
      )}
      {showChat && (
        <ChatPanel
          net={{
            districts: net.districts,
            cables: net.cables,
            validationIssues: net.validationIssues,
            addSubscriberAt: net.addSubscriberAt,
            addOLTAt: net.addOLTAt,
            addTBAt: net.addTBAt,
            addORKAt: net.addORKAt,
            addCableBetween: net.addCableBetween,
            reconsolidate: net.reconsolidate,
            deleteSubscriber: net.deleteSubscriber,
            deleteCable: net.deleteCable,
            rebuildFromCurrent: net.rebuildFromCurrent,
            autoRepair: net.autoRepair,
            selectionPolygon,
          }}
          flyTo={flyToRef.current}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}
