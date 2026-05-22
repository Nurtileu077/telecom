'use client';
import dynamic from 'next/dynamic';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNetwork } from '@/hooks/useNetwork';
import Sidebar from '@/components/Sidebar/Sidebar';
import ImportModal, { ImportMode, NetworkImportMode, OltLocations } from '@/components/Import/ImportModal';
import { Subscriber, ProjectSettings, AnnotationType, Project, ProjectStatus, PROJECT_STATUS_LABELS, CABLE_SIZES, CableType } from '@/types/network';
import type { DrawingTool } from '@/components/Sidebar/NotesTab';
import AppHeader from '@/components/Layout/AppHeader';
import EmptyState from '@/components/Layout/EmptyState';
import { exportPDF } from '@/components/Export/ExportPDF';
import { calculateCost } from '@/components/Network/CostCalc';
import ProjectListModal from '@/components/Projects/ProjectListModal';
import CatalogModal from '@/components/Catalog/CatalogModal';
import EntityEditor, { EntitySelection } from '@/components/Map/EntityEditor';
import CableEditor from '@/components/Map/CableEditor';
import SplicePlan from '@/components/Map/SplicePlan';
import ChatPanel from '@/components/AI/ChatPanel';
import AddCamerasModal from '@/components/Import/AddCamerasModal';
import { bboxOfPolygon, filterByBBox } from '@/components/Network/Selection';
import { computeBranchCables } from '@/components/Network/Branch';
import { recalcLengthM } from '@/components/Network/cableWaypoints';
import { compatibleTargetsForCable } from '@/components/Network/SnapConnect';
import { validateForExport, formatValidationSummary } from '@/components/Network/ExportValidation';
import type { CableLinkEnd } from '@/hooks/useNetwork';
import type { InteriorView } from '@/components/Network/entityInterior';
import { findEntityCoords, findSubscriber } from '@/components/Network/entityInterior';
import { parseDeepLinkOpen, type SearchHit } from '@/lib/entitySearch';
import EntityIdSearch from '@/components/Search/EntityIdSearch';
import ReadOnlyBanner from '@/components/Layout/ReadOnlyBanner';
import { parseAppViewMode, buildShareViewUrl, buildShareFieldUrl, isMutationAllowed } from '@/lib/viewMode';
import type { AppViewMode, UserRole } from '@/types/network';
import {
  getStoredRole, setStoredRole, parseUserRole, resolveEffectiveMode, roleAllowsStatusChange,
} from '@/lib/appRole';
import { diffScenarioCables, highlightCurrentCableIds } from '@/lib/scenarioDiff';
import AuthButton from '@/components/Auth/AuthButton';
import { dbLoadProject } from '@/lib/supabase';
import SaveConflictModal from '@/components/Projects/SaveConflictModal';
import { isProjectSaveConflict } from '@/lib/projectConflict';
import { isOfflineTilesEnabled, syncOfflineTileWorker } from '@/lib/offlineMap';
import MobileDock from '@/components/Layout/MobileDock';
import MobileActionSheet from '@/components/Layout/MobileActionSheet';
import PwaInstallBanner from '@/components/Layout/PwaInstallBanner';
import RoutingProgressOverlay from '@/components/Layout/RoutingProgressOverlay';

const LeafletMap = dynamic(() => import('@/components/Map/MapContainer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[var(--bg-canvas)]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-xs text-[var(--text-muted)]">Загрузка карты...</p>
      </div>
    </div>
  ),
});

export default function HomePage() {
  const net = useNetwork();
  const [urlMode] = useState<AppViewMode>(() =>
    typeof window !== 'undefined' ? parseAppViewMode(window.location.search) : 'edit',
  );
  const [userRole, setUserRole] = useState<UserRole>(() =>
    typeof window !== 'undefined' ? getStoredRole() : 'engineer',
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const r = parseUserRole(window.location.search);
    if (r) {
      setStoredRole(r);
      setUserRole(r);
    }
  }, []);

  const appMode = useMemo(() => resolveEffectiveMode(urlMode, userRole), [urlMode, userRole]);
  const readOnly = !isMutationAllowed(appMode);
  const canChangeStatus = roleAllowsStatusChange(userRole);
  const [showImport, setShowImport] = useState(false);
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
  const [moveEntityTarget, setMoveEntityTarget] = useState<{ kind: 'olt' | 'tb' | 'ork'; id: string } | null>(null);
  const [snapHighlightId, setSnapHighlightId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const [editingCableId, setEditingCableId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<'olt' | 'tb' | 'ork' | null>(null);
  /** Кабель: allowMap=false только узлы; A→B: allowMap=true узлы + карта */
  const [cableLink, setCableLink] = useState<{ allowMap: boolean; from?: CableLinkEnd } | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectCableId, setConnectCableId] = useState<string | null>(null);
  const [interiorView, setInteriorView] = useState<InteriorView | null>(null);
  const [pendingCable, setPendingCable] = useState<
    | { a: [number, number]; b: [number, number] }
    | { fromId: string; toId: string }
    | { link: { from: CableLinkEnd; to: CableLinkEnd } }
    | null
  >(null);
  const [budgetColoring, setBudgetColoring] = useState(false);
  const [splicePlanTbId, setSplicePlanTbId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ lat: number; lon: number; x: number; y: number } | null>(null);
  const [coordInput, setCoordInput] = useState<{ kind: 'sub' | 'olt' | 'tb' | 'ork' } | null>(null);
  const [coordText, setCoordText] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [showAddCameras, setShowAddCameras] = useState(false);
  // Two-click rectangle selection for "export only this area".
  // Лассо-выделение: каждым кликом ставим вершину полигона, «Готово» замыкает.
  // selectionBBox держим производным от полигона — его ждут reroute/reconsolidate.
  const [selecting, setSelecting] = useState(false);
  const [selectionPoints, setSelectionPoints] = useState<[number, number][]>([]);
  const [selectionPoly, setSelectionPoly] = useState<[number, number][] | null>(null);
  const [selectionBBox, setSelectionBBox] = useState<{ latMin: number; lonMin: number; latMax: number; lonMax: number } | null>(null);
  const [scenarioDiffOn, setScenarioDiffOn] = useState(false);
  const [saveConflict, setSaveConflict] = useState<{ serverUpdatedAt: string; serverName: string } | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  const handleSaveProject = useCallback(async (opts?: { audit?: boolean; force?: boolean }) => {
    try {
      await net.saveProject(opts);
    } catch (e) {
      if (isProjectSaveConflict(e)) {
        setSaveConflict({ serverUpdatedAt: e.serverUpdatedAt, serverName: e.serverName });
      }
    }
  }, [net]);

  useEffect(() => {
    syncOfflineTileWorker().catch(() => {});
  }, []);

  const finishSelection = useCallback(() => {
    setSelectionPoints((pts) => {
      if (pts.length >= 3) {
        setSelectionPoly(pts);
        setSelectionBBox(bboxOfPolygon(pts));
      }
      return [];
    });
    setSelecting(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelecting(false);
    setSelectionPoints([]);
    setSelectionPoly(null);
    setSelectionBBox(null);
  }, []);

  // «Показать ветку»: подсветить кабели выбранного OLT/муфты/ОРКСП/камеры.
  const [branchSel, setBranchSel] = useState<{ kind: 'olt' | 'tb' | 'ork' | 'sub'; id: string } | null>(null);
  const scenarioMapDiff = useMemo(() => {
    if (!scenarioDiffOn || !net.scenarios.a || !net.scenarios.b) return null;
    return diffScenarioCables(net.scenarios.a, net.scenarios.b);
  }, [scenarioDiffOn, net.scenarios]);

  const highlightCableIds = useMemo(() => {
    const branch = branchSel
      ? computeBranchCables(net.cables, net.districts, branchSel.kind, branchSel.id)
      : null;
    if (scenarioMapDiff) {
      const diffHl = highlightCurrentCableIds(net.cables, scenarioMapDiff);
      if (branch) {
        const merged = new Set(branch);
        diffHl.forEach((id) => merged.add(id));
        return merged;
      }
      return diffHl.size > 0 ? diffHl : null;
    }
    return branch;
  }, [branchSel, net.cables, net.districts, scenarioMapDiff]);

  const snapHighlightIds = useMemo(() => {
    const ids = new Set<string>();
    if (snapHighlightId) ids.add(snapHighlightId);
    if (connectCableId) {
      const c = net.cables.find((x) => x.id === connectCableId);
      if (c) {
        for (const id of compatibleTargetsForCable(c, 'from', net.districts)) ids.add(id);
        for (const id of compatibleTargetsForCable(c, 'to', net.districts)) ids.add(id);
      }
    }
    return ids.size > 0 ? ids : null;
  }, [snapHighlightId, connectCableId, net.cables, net.districts]);

  const finishCableLink = useCallback((from: CableLinkEnd, to: CableLinkEnd) => {
    if (from.type === 'entity' && to.type === 'entity') {
      if (from.id === to.id) return;
      setPendingCable({ fromId: from.id, toId: to.id });
    } else if (from.type === 'map' && to.type === 'map') {
      setPendingCable({ a: from.coord, b: to.coord });
    } else {
      setPendingCable({ link: { from, to } });
    }
    setCableLink(null);
  }, []);

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
    const issues = validateForExport(net.districts, net.cables);
    if (issues.length > 0) {
      const preview = issues.slice(0, 8).map((i) => `• ${i.message}`).join('\n');
      const more = issues.length > 8 ? `\n…и ещё ${issues.length - 8}` : '';
      const ok = confirm(
        `Перед экспортом: ${formatValidationSummary(issues)}\n\n${preview}${more}\n\nВсё равно экспортировать?`,
      );
      if (!ok) return;
    }
    let districts = net.districts;
    let cables = net.cables;
    if (selectionBBox) {
      const f = filterByBBox(net.districts, net.cables, net.joints, selectionBBox, selectionPoly);
      districts = f.districts;
      cables = f.cables;
      if (cables.length === 0) {
        alert('В выделении нет кабелей для экспорта');
        return;
      }
    }
    const cost = calculateCost(net.materials, net.prices);
    await exportPDF(net.projectName, districts, cables, net.materials, cost, mapElRef.current);
  }, [net, selectionBBox, selectionPoly]);

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
    source: string,
  ) => {
    setShowImport(false);
    await net.loadStructured(districts, cables, source);
  }, [net]);

  // Drag-drop reassignment: when an ORK is dropped near a different TB (≤80m), reassign it.
  // For subscribers: if dropped near another ORK (≤120m), reassign.
  const SNAP_TB_M = 80;
  const SNAP_ORK_M = 120;
  const handleMoveEntity = useCallback(async (kind: 'tb' | 'ork' | 'olt', id: string, lat: number, lon: number) => {
    const { nearestEntity, SNAP_ENTITY_M } = await import('@/components/Network/SnapConnect');
    const snap = nearestEntity(lat, lon, net.districts, SNAP_ENTITY_M, id);
    const placeLat = snap?.lat ?? lat;
    const placeLon = snap?.lon ?? lon;
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
        net.moveEntity('ork', id, placeLat, placeLon);
        net.reassignORK(id, bestTbId);
        return;
      }
    }
    net.moveEntity(kind, id, placeLat, placeLon);
  }, [net]);

  const handleImportNetwork = useCallback(async (project: Project, mode: NetworkImportMode) => {
    setShowImport(false);
    if (mode === 'replace') {
      net.importNetworkReplace(project);
    } else {
      await net.mergeNetworkDistricts(project);
    }
  }, [net]);

  const goHomeMobile = useCallback(() => {
    setMobileMenuOpen(false);
    setMobileSheetOpen(false);
    setEntitySelection(null);
    setSelectedCableId(null);
    setEditingCableId(null);
    setInteriorView(null);
    setSplicePlanTbId(null);
    setShowChat(false);
    setConnectMode(false);
    setConnectCableId(null);
    setCableLink(null);
    setPlacing(null);
    setBranchSel(null);
    setMoveEntityTarget(null);
    setPendingCable(null);
  }, []);

  const shareProject = useCallback(async () => {
    const title = net.projectName || 'OPTIQ';
    const text = `${title} · ${net.totalSubscribers} аб. · ${net.totalCableKm} км`;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${title}\n${url}`);
      alert('Ссылка скопирована');
    } catch {
      prompt('Ссылка на проект:', url);
    }
  }, [net.projectName, net.totalSubscribers, net.totalCableKm]);

  const handleMapClickAddSub = useCallback((lat: number, lon: number) => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileMenuOpen(false);
      setMobileSheetOpen(false);
    }
    // Лассо-выделение: каждый клик — вершина полигона (замыкаем кнопкой «Готово»).
    if (selecting) {
      setSelectionPoints((pts) => [...pts, [lat, lon]]);
      return;
    }
    // Ручной кабель A→B: первый клик — точка A, второй — B → выбор типа ОК.
    if (cableLink?.allowMap) {
      const end: CableLinkEnd = { type: 'map', coord: [lat, lon] };
      if (!cableLink.from) setCableLink({ ...cableLink, from: end });
      else finishCableLink(cableLink.from, end);
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
      const s = net.snapPlaceTB(lat, lon);
      net.addTBAt(s.lat, s.lon);
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
  }, [net, placing, selecting, cableLink, finishCableLink]);

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
      const s = net.snapPlaceTB(lat, lon);
      net.addTBAt(s.lat, s.lon);
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
        if (e.key === 's') { e.preventDefault(); handleSaveProject({ audit: true }); }
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
          setCableLink(null);
          setConnectMode(false);
          setEntitySelection(null);
          setSelectedCableId(null);
          clearSelection();
          setBranchSel(null);
          setPendingCable(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [net]);

  const osrmPercent = net.osrmProgress.total > 0
    ? Math.round((net.osrmProgress.done / net.osrmProgress.total) * 100)
    : 0;

  useEffect(() => {
    const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
    return () => window.clearTimeout(t);
  }, [mobileMenuOpen]);

  const openMobileMenu = useCallback(() => {
    setMobileSheetOpen(false);
    setMobileMenuOpen(true);
  }, []);

  const handleNavigateInterior = useCallback((kind: InteriorView['kind'], id: string) => {
    let k = kind;
    let i = id;
    if (kind === 'tb' && !net.districts.some((d) => d.olt.transitBoxes.some((t) => t.id === id))) {
      if (net.joints.some((j) => j.id === id)) {
        k = 'joint';
      }
    }
    setInteriorView({ kind: k, id: i });
    setEntitySelection(k === 'joint' ? { kind: 'joint', id: i } : { kind: k as 'olt' | 'tb' | 'ork', id: i });
    setSelectedCableId(null);
  }, [net.districts, net.joints]);

  const handleFlyToEntity = useCallback((kind: InteriorView['kind'], id: string) => {
    const c = findEntityCoords(kind, id, net.districts, net.joints);
    if (c && flyToRef.current) flyToRef.current(c.lat, c.lon, 17);
  }, [net.districts, net.joints]);

  const handleFlyToSubscriber = useCallback((subId: string) => {
    const sub = findSubscriber(subId, net.districts);
    if (sub && flyToRef.current) flyToRef.current(sub.lat, sub.lon, 19);
  }, [net.districts]);

  const handleJointClick = useCallback((jointId: string) => {
    setInteriorView({ kind: 'joint', id: jointId });
    setEntitySelection({ kind: 'joint', id: jointId });
    setSelectedCableId(null);
    handleFlyToEntity('joint', jointId);
  }, [handleFlyToEntity]);

  const handleSearchHit = useCallback((hit: SearchHit) => {
    if (hit.kind === 'sub') {
      handleFlyToSubscriber(hit.id);
      return;
    }
    if (hit.kind === 'cable') {
      setSelectedCableId(hit.id);
      setEntitySelection(null);
      setInteriorView(null);
      return;
    }
    if (hit.kind === 'joint') {
      handleJointClick(hit.id);
      return;
    }
    handleNavigateInterior(hit.kind, hit.id);
    handleFlyToEntity(hit.kind, hit.id);
  }, [handleFlyToSubscriber, handleJointClick, handleNavigateInterior, handleFlyToEntity]);

  useEffect(() => {
    if (readOnly) net.setEditMode(false);
  }, [readOnly, net]);

  const urlProjectLoaded = useRef(false);
  useEffect(() => {
    if (urlProjectLoaded.current || typeof window === 'undefined') return;
    const pid = new URLSearchParams(window.location.search).get('project');
    if (!pid) return;
    urlProjectLoaded.current = true;
    (async () => {
      try {
        const fromDb = await dbLoadProject(pid);
        if (fromDb) {
          await net.loadProject(fromDb);
          return;
        }
        const list = await net.listProjects();
        const p = list.find((x) => x.id === pid);
        if (p) await net.loadProject(p);
      } catch { /* ignore */ }
    })();
  }, [net]);

  const copyShareViewLink = useCallback(() => {
    const url = buildShareViewUrl(net.projectId);
    navigator.clipboard?.writeText(url).catch(() => {});
  }, [net.projectId]);

  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || typeof window === 'undefined' || net.districts.length === 0) return;
    const open = parseDeepLinkOpen(new URLSearchParams(window.location.search).get('open'));
    if (!open) return;
    deepLinkHandled.current = true;
    if (open.kind === 'sub') {
      handleFlyToSubscriber(open.id);
      return;
    }
    if (open.kind === 'joint') {
      handleJointClick(open.id);
      return;
    }
    handleNavigateInterior(open.kind, open.id);
    handleFlyToEntity(open.kind, open.id);
  }, [net.districts.length, handleFlyToSubscriber, handleJointClick, handleNavigateInterior, handleFlyToEntity]);

  return (
    <div className="app-shell flex flex-col overflow-hidden">
      <ReadOnlyBanner mode={appMode} role={userRole} onCopyShareLink={readOnly ? copyShareViewLink : undefined} />
      <AppHeader
        projectName={net.projectName}
        onProjectNameChange={net.setProjectName}
        projectStatus={net.projectStatus}
        onProjectStatusChange={canChangeStatus ? net.setProjectStatus : undefined}
        userRole={userRole}
        onUserRoleChange={setUserRole}
        authSlot={<AuthButton onRoleFromAuth={(r) => { if (r) { setStoredRole(r); setUserRole(r); } }} />}
        flyTo={flyToRef.current}
        totalSubscribers={net.totalSubscribers}
        totalCableKm={net.totalCableKm}
        totalOrks={net.totalOrks}
        annotationsCount={net.annotations.length}
        status={net.status}
        osrmPercent={osrmPercent}
        lastSavedAt={net.lastSavedAt}
        editMode={!readOnly && net.editMode}
        onToggleEditMode={() => !readOnly && net.setEditMode(!net.editMode)}
        canUndo={net.canUndo}
        canRedo={net.canRedo}
        onUndo={() => net.undo()}
        onRedo={() => net.redo()}
        placing={placing}
        onSetPlacing={setPlacing}
        cableDrawActive={!!cableLink && !cableLink.allowMap}
        pointCableActive={!!cableLink && cableLink.allowMap}
        connectModeActive={connectMode}
        undoHint={net.undoLabel}
        onToggleConnectMode={() => {
          setConnectMode((v) => !v);
          setConnectCableId(null);
          setCableLink(null);
          setPlacing(null);
        }}
        onToggleCableDraw={() => {
          setCableLink(cableLink && !cableLink.allowMap ? null : { allowMap: false });
          setConnectMode(false);
          setPlacing(null);
        }}
        onTogglePointCable={() => {
          setCableLink(cableLink?.allowMap ? null : { allowMap: true });
          setConnectMode(false);
          setPlacing(null);
        }}
        dbEnabled={net.dbEnabled}
        onCatalog={() => setShowCatalog(true)}
        onProjects={() => setShowProjects(true)}
        onSave={() => handleSaveProject({ audit: true })}
        canSave={!readOnly && (net.districts.length > 0 || net.annotations.length > 0)}
        showBuild={net.allSubscribers.length > 0 && net.districts.length === 0}
        onBuild={() => net.rebuildFromCurrent()}
        branchActive={!!branchSel}
        onClearBranch={() => setBranchSel(null)}
        selectionPoly={!!selectionPoly}
        selecting={selecting}
        selectionCount={selectionPoints.length}
        onStartSelection={() => { setSelecting(true); setSelectionPoints([]); setPlacing(null); setCableLink(null); setConnectMode(false); }}
        onFinishSelection={finishSelection}
        onClearSelection={clearSelection}
        showAddCameras={net.districts.length > 0}
        onAddCameras={() => setShowAddCameras(true)}
        onImport={() => !readOnly && setShowImport(true)}
        onHelp={() => setShowHelp(true)}
        chatOpen={showChat}
        onToggleChat={() => setShowChat((v) => !v)}
        onMenuToggle={() => setMobileMenuOpen((v) => !v)}
        mobileMenuOpen={mobileMenuOpen}
        districts={net.districts}
        cables={net.cables}
        joints={net.joints}
        onSearchHit={handleSearchHit}
      />

      <div className="flex flex-1 overflow-hidden relative min-h-0">
        {mobileMenuOpen && (
          <button
            type="button"
            className="drawer-backdrop md:hidden"
            aria-label="Закрыть меню"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        <div className={`sidebar-drawer shrink-0 h-full md:relative md:translate-x-0 ${mobileMenuOpen ? 'is-open' : ''}`}>
        <Sidebar
          onMobileClose={goHomeMobile}
          mobilePersist
          districts={net.districts}
          cables={net.cables}
          joints={net.joints}
          selectionBBox={selectionBBox}
          selectionPoly={selectionPoly}
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
          saveProject={async () => {
            try {
              return await net.saveProject({ audit: true });
            } catch (e) {
              if (isProjectSaveConflict(e)) {
                setSaveConflict({ serverUpdatedAt: e.serverUpdatedAt, serverName: e.serverName });
              }
            }
          }}
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
          onRerouteOSRM={() => net.rerouteWithOSRM(selectionBBox, selectionPoly)}
          onReconsolidate={() => net.reconsolidate(selectionBBox, selectionPoly)}
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
          hasNetwork={net.districts.length > 0}
          settings={net.settings}
          onSearchHit={handleSearchHit}
          scenarios={net.scenarios}
          saveScenarioSlot={net.saveScenarioSlot}
          restoreScenarioSlot={net.restoreScenarioSlot}
          readOnly={readOnly}
          onCopyShareViewLink={copyShareViewLink}
          onCopyShareFieldLink={() => {
            navigator.clipboard?.writeText(buildShareFieldUrl(net.projectId)).catch(() => {});
          }}
          auditLog={net.auditLog}
          scenarioDiffOn={scenarioDiffOn}
          onToggleScenarioDiff={() => setScenarioDiffOn((v) => !v)}
        />
        </div>

        <main className={`flex-1 relative overflow-hidden isolate min-w-0 max-md:pb-[calc(var(--mobile-dock-h)+max(8px,var(--sab)))] md:pb-0 ${(entitySelection || interiorView) ? 'md:pr-[min(400px,42vw)]' : ''}`}>
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
            editMode={!readOnly && net.editMode}
            placingMode={!!placing}
            selectingMode={selecting || !!cableLink?.allowMap}
            onMapClick={handleMapClickAddSub}
            onMapContextMenu={(lat, lon, x, y) => setContextMenu({ lat, lon, x, y })}
            selectionBBox={selectionBBox}
            selectionPoints={selectionPoints}
            selectionPoly={selectionPoly}
            highlightCableIds={highlightCableIds}
            scenarioMapDiff={scenarioMapDiff}
            onShowBranchSub={(id) => setBranchSel({ kind: 'sub', id })}
            moveEntity={handleMoveEntity}
            deleteSubscriber={net.deleteSubscriber}
            moveEntityTarget={moveEntityTarget}
            onEntityDoubleClick={(kind, id) => {
              handleNavigateInterior(kind, id);
              setSelectedCableId(null);
              setMoveEntityTarget((prev) =>
                prev?.kind === kind && prev.id === id ? null : { kind, id },
              );
            }}
            onJointClick={handleJointClick}
            onEntityClick={(kind, id) => {
              if (connectMode && connectCableId) {
                net.recordAction('Соединить кабель');
                net.connectCableToEntity(connectCableId, id);
                setConnectCableId(null);
                return;
              }
              if (cableLink) {
                const end: CableLinkEnd = { type: 'entity', id };
                if (!cableLink.from) setCableLink({ ...cableLink, from: end });
                else finishCableLink(cableLink.from, end);
                return;
              }
              handleNavigateInterior(kind, id);
              handleFlyToEntity(kind, id);
            }}
            onCableClick={(id) => {
              if (connectMode) {
                setConnectCableId(id);
                setSelectedCableId(id);
                setEntitySelection(null);
                return;
              }
              setSelectedCableId(id);
              setEntitySelection(null);
            }}
            snapHighlightIds={snapHighlightIds}
            editingCableId={editingCableId}
            onUpdateCableCoords={(id, coords) => net.updateCable(id, { coords, lengthM: recalcLengthM(coords) })}
            onCableEndpointSnap={(id, end, entityId) => net.connectCableEndpoint(id, end, entityId)}
            onSnapHighlight={setSnapHighlightId}
            snapHighlightId={snapHighlightId}
            measureMode={measureMode}
            setMeasureMode={setMeasureMode}
            heatmapEnabled={heatmapEnabled}
            budgetMap={budgetMap.current}
            budgetColoring={budgetColoring}
          />

          {moveEntityTarget && (
            <div className="map-hint absolute top-2 md:top-3 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[500] bg-[#0d1b2a]/97 border border-[#a78bfa]/50 rounded-lg px-3 py-1.5 text-xs text-[#a78bfa] shadow-2xl flex items-center gap-2 animate-fade-in max-w-none md:max-w-lg">
              <span>
                ↔ Перетащите {moveEntityTarget.kind === 'olt' ? 'OLT' : moveEntityTarget.kind === 'tb' ? 'муфту' : 'ОРК'} на карте
                <span className="text-[#64748b] ml-1">({moveEntityTarget.id})</span>
              </span>
              <button
                onClick={() => setMoveEntityTarget(null)}
                className="text-[#94a3b8] hover:text-white border border-[#a78bfa]/30 rounded px-1.5 py-0.5 text-[10px]"
              >
                Готово
              </button>
            </div>
          )}

          <EntityEditor
            selection={entitySelection}
            interiorView={interiorView}
            projectId={net.projectId}
            appMode={appMode}
            onAudit={net.recordAudit}
            districts={net.districts}
            cables={net.cables}
            joints={net.joints}
            powerBudgets={net.powerBudgets}
            onClose={() => {
              setEntitySelection(null);
              setInteriorView(null);
              setMoveEntityTarget(null);
            }}
            onNavigateInterior={handleNavigateInterior}
            onFlyToEntity={handleFlyToEntity}
            onFlyToSubscriber={handleFlyToSubscriber}
            moveActive={
              !!moveEntityTarget
              && !!entitySelection
              && moveEntityTarget.kind === entitySelection.kind
              && moveEntityTarget.id === entitySelection.id
            }
            onStartMove={() => {
              if (!entitySelection || entitySelection.kind === 'joint') return;
              setMoveEntityTarget({ kind: entitySelection.kind, id: entitySelection.id });
            }}
            onStopMove={() => setMoveEntityTarget(null)}
            onUpdateOLT={net.updateOLT}
            onUpdateTB={net.updateTB}
            onUpdateORK={net.updateORK}
            onDeleteOLT={net.deleteOLT}
            onDeleteTB={net.deleteTB}
            onDeleteORK={net.deleteORK}
            onReassignORK={net.reassignORK}
            onOpenSplicePlan={(tbId) => { setSplicePlanTbId(tbId); }}
            onShowBranch={(kind, id) => setBranchSel({ kind, id })}
          />

          <SplicePlan
            tbId={splicePlanTbId}
            districts={net.districts}
            cables={net.cables}
            onClose={() => setSplicePlanTbId(null)}
          />

          <CableEditor
            cable={selectedCableId ? (net.cables.find((c) => c.id === selectedCableId) ?? null) : null}
            districts={net.districts}
            onClose={() => { setSelectedCableId(null); setEditingCableId(null); }}
            onUpdateType={(id, type) => net.updateCable(id, { type })}
            onUpdateMeta={(id, patch) => net.updateCable(id, patch)}
            onRerouteOSRM={(id) => net.rerouteSingleCable(id)}
            onToggleWaypoints={(id) => setEditingCableId(id)}
            onDelete={net.deleteCable}
            waypointEditing={editingCableId === selectedCableId && !!editingCableId}
            rerouteStatus={net.status}
            onStartConnect={(id) => {
              setConnectMode(true);
              setConnectCableId(id);
              setCableLink(null);
            }}
          />

          {scenarioDiffOn && scenarioMapDiff && (
            <div className="map-hint absolute top-12 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[500] bg-[#0d1b2a]/97 border border-[#fbbf24]/50 rounded-lg px-2 py-1.5 text-[11px] text-[#fbbf24] shadow-2xl">
              A↔B: <span className="text-[#34d399]">+{scenarioMapDiff.added.length}</span>
              {' · '}
              <span className="text-[#f87171]">−{scenarioMapDiff.removed.length}</span>
              {' · '}
              <span className="text-[#fbbf24]">Δ{scenarioMapDiff.modified.length}</span>
              <span className="text-[#64748b] ml-1">— выкл. в Инструменты</span>
            </div>
          )}

          {placing && (
            <div className="map-hint absolute top-2 md:top-3 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[500] bg-[#0d1b2a]/97 border border-[#a78bfa]/50 rounded-lg px-2 py-1.5 text-[11px] md:text-xs text-[#a78bfa] shadow-2xl flex items-center gap-2 animate-fade-in">
              <span>
                🎯 {placing === 'tb'
                  ? 'Муфта на перекрёстке — клик по кабелю (магнит ~35 м), без автокабеля к OLT'
                  : `Клик по карте — поставить ${placing === 'olt' ? 'OLT' : 'ОРК'}`}
              </span>
              <button onClick={() => setPlacing(null)} className="text-[#94a3b8] hover:text-white border border-[#a78bfa]/30 rounded px-1.5 py-0.5 text-[10px]">Esc</button>
            </div>
          )}

          {connectMode && (
            <div className="map-hint absolute top-2 md:top-3 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[500] bg-[#0d1b2a]/97 border border-[#34d399]/50 rounded-lg px-2 py-1.5 text-[11px] md:text-xs text-[#34d399] shadow-2xl flex items-center gap-2 animate-fade-in">
              <span>
                🔗 {connectCableId
                  ? 'Клик по OLT / муфте / ОРК — привязать конец (зелёная подсветка)'
                  : 'Клик по кабелю на карте, затем по узлу'}
              </span>
              <button type="button" onClick={() => { setConnectMode(false); setConnectCableId(null); }} className="text-[#94a3b8] hover:text-white border border-[#34d399]/30 rounded px-1.5 py-0.5 text-[10px]">Esc</button>
            </div>
          )}

          {cableLink && (
            <div className="map-hint absolute top-2 md:top-3 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[500] bg-[#0d1b2a]/97 border border-[#34d399]/50 rounded-lg px-2 py-1.5 text-[11px] md:text-xs text-[#34d399] shadow-2xl flex items-center gap-2 animate-fade-in">
              <span>
                〰 {!cableLink.from
                  ? (cableLink.allowMap
                    ? 'Точка A или OLT/муфта/ОРК'
                    : 'Первый узел (OLT / муфта / ОРК)')
                  : (cableLink.allowMap
                    ? 'Точка B или второй узел на карте'
                    : 'Второй узел — кабель будет создан')}
              </span>
              <button type="button" onClick={() => setCableLink(null)} className="text-[#94a3b8] hover:text-white border border-[#34d399]/30 rounded px-1.5 py-0.5 text-[10px]">Esc</button>
            </div>
          )}

          {pendingCable && (
            <div className="map-hint absolute top-2 md:top-3 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[600] bg-[#0d1b2a]/98 border border-[#38bdf8]/50 rounded-xl px-3 md:px-4 py-3 shadow-2xl animate-fade-in max-h-[50vh] overflow-y-auto">
              <div className="text-xs text-[#e2e8f0] mb-2 text-center">Выбери тип кабеля ОК</div>
              <div className="flex flex-wrap gap-1.5 max-w-[320px] justify-center">
                {CABLE_SIZES.filter((t) => t !== 'ОК-96').map((t: CableType) => (
                  <button
                    key={t}
                    onClick={() => {
                      if ('fromId' in pendingCable) {
                        net.recordAction('Кабель между узлами');
                        void net.addCableBetween(pendingCable.fromId, pendingCable.toId, t);
                      } else if ('link' in pendingCable) {
                        void net.addCableLink(pendingCable.link.from, pendingCable.link.to, t);
                      } else {
                        net.recordAction('Кабель A→B');
                        void net.addCableByPoints(pendingCable.a, pendingCable.b, t);
                      }
                      setPendingCable(null);
                    }}
                    className="px-2.5 py-1 text-[11px] rounded-lg border border-[#1e3a5f] text-[#e2e8f0] hover:bg-[#38bdf8]/20 hover:border-[#38bdf8]/50 transition-colors"
                  >
                    {t}
                  </button>
                ))}
                <button onClick={() => setPendingCable(null)} className="px-2.5 py-1 text-[11px] rounded-lg text-[#94a3b8] hover:text-white">Отмена</button>
              </div>
            </div>
          )}

          {net.districts.length === 0 && net.annotations.length === 0 && net.status === 'idle' && (
            <EmptyState onImport={() => setShowImport(true)} onHelp={() => setShowHelp(true)} />
          )}
        </main>
      </div>

      {(net.status === 'routing' || net.status === 'clustering' || net.status === 'importing' || net.status === 'calculating') && (
        <RoutingProgressOverlay
          status={net.status}
          progress={net.osrmProgress}
          percent={osrmPercent}
          onStop={net.status === 'routing' ? net.stopOSRM : undefined}
        />
      )}

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
                setCableLink({ allowMap: true });
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

      {/* Brownfield Excel → add cameras to existing network */}
      {showAddCameras && (
        <AddCamerasModal
          onClose={() => setShowAddCameras(false)}
          onAdd={async (rows) => {
            // Use existing addSubscriberAt — it finds the nearest ORK, attaches
            // the camera with its kind/side/bandwidth, and OSRM-routes the
            // drop cable.  Sequential so the public OSRM server doesn't 429.
            const district = net.districts[0]?.name ?? 'Импорт';
            for (const r of rows) {
              await net.addSubscriberAt(r.lat, r.lon, district, r.desc, r.kind);
            }
          }}
        />
      )}

      <PwaInstallBanner />

      <MobileActionSheet
        open={mobileSheetOpen}
        onClose={() => setMobileSheetOpen(false)}
        actions={[
          { id: 'import', label: 'Импорт', icon: '📥', onClick: () => setShowImport(true) },
          { id: 'olt', label: 'OLT', icon: '📡', onClick: () => { setPlacing('olt'); net.setEditMode(true); } },
          { id: 'tb', label: 'Муфта', icon: '🔷', onClick: () => { setPlacing('tb'); net.setEditMode(true); } },
          { id: 'ork', label: 'ОРК', icon: '📦', onClick: () => { setPlacing('ork'); net.setEditMode(true); } },
          { id: 'cable', label: 'Кабель', icon: '〰', onClick: () => { setCableLink({ allowMap: false }); setConnectMode(false); } },
          { id: 'ab', label: 'A→B', icon: '✏️', onClick: () => { setCableLink({ allowMap: true }); setConnectMode(false); } },
        ]}
      />

      <MobileDock
        menuOpen={mobileMenuOpen}
        onHome={goHomeMobile}
        onMenu={() => {
          setMobileSheetOpen(false);
          setMobileMenuOpen((v) => !v);
        }}
        onAdd={() => {
          setMobileMenuOpen(false);
          setMobileSheetOpen(true);
        }}
        onShare={shareProject}
      />

      {saveConflict && (
        <SaveConflictModal
          serverName={saveConflict.serverName}
          serverUpdatedAt={saveConflict.serverUpdatedAt}
          mergeBusy={mergeBusy}
          onMerge={net.dbEnabled ? async (strategy) => {
            setMergeBusy(true);
            try {
              await net.mergeProjectWithServer(strategy);
              setSaveConflict(null);
            } finally {
              setMergeBusy(false);
            }
          } : undefined}
          onLoadServer={async () => {
            await net.reloadProjectFromServer();
            setSaveConflict(null);
          }}
          onOverwrite={async () => {
            await handleSaveProject({ audit: true, force: true });
            setSaveConflict(null);
          }}
          onCancel={() => setSaveConflict(null)}
        />
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
            selectionBBox,
          }}
          flyTo={flyToRef.current}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}
