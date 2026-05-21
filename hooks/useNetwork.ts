'use client';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  District, Cable, Subscriber, ProjectSettings, Materials, LayerVisibility,
  DEFAULT_SETTINGS, Project, MapAnnotation, ImportRecord, ValidationIssue,
  PriceCatalog, DEFAULT_PRICES, InlineJoint, OLT, TransitBox, ORK, CABLE_FIBERS, DISTRICT_COLORS,
  ProjectStatus, ProjectSnapshot,
  CameraKind, ProjectSide, CAMERA_MIN_BANDWIDTH_MBPS,
} from '@/types/network';
import { buildNetwork, OltLocationMap } from '@/components/Network/AutoBuild';
import { calculateMaterials, validateNetwork } from '@/components/Network/MaterialCalc';
import { routeCables, getRoute, snapBatch } from '@/components/Network/OSRMRouter';
import { planRepair, buildDropCable, type RepairReport } from '@/components/Network/NetworkRepair';
import { filterByBBox, polylineTouchesBBox, pointInBBox, type BBox } from '@/components/Network/Selection';
import { consolidateCables } from '@/components/Network/Consolidation';
import { haversineM } from '@/components/Network/KMeans';
import { calculateSubscriberBudgets, budgetStats } from '@/components/Network/PowerBudget';
import { dbListProjects, dbSaveProject, dbDeleteProject, dbLoadProject, supabase } from '@/lib/supabase';

export type BuildStatus = 'idle' | 'importing' | 'clustering' | 'routing' | 'calculating' | 'done' | 'error';

export interface OSRMProgress {
  done: number;
  total: number;
  current: string;
}

const DEFAULT_LAYERS: LayerVisibility = {
  olt: true, tb: true, ork: true, subscribers: true, cables: true,
  cableOK4: true, cableOK8: true, cableOK12: true, cableOK16: true,
  cableOK24: true, cableOK32: true, cableOK48: true, cableOK96: true,
};

const STORAGE_KEY = 'gpon-projects-v2';
const CURRENT_KEY = 'gpon-current-project';
const AUTOSAVE_INTERVAL_MS = 30000;

function newId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useNetwork() {
  const [projectId, setProjectId] = useState<string>(() => newId('proj'));
  const [projectName, setProjectName] = useState('Новый проект');
  const [districts, setDistricts] = useState<District[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [joints, setJoints] = useState<InlineJoint[]>([]);
  const [annotations, setAnnotations] = useState<MapAnnotation[]>([]);
  const [importHistory, setImportHistory] = useState<ImportRecord[]>([]);
  const [allSubscribers, setAllSubscribers] = useState<Subscriber[]>([]);
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [prices, setPrices] = useState<PriceCatalog>(() => {
    if (typeof window === 'undefined') return DEFAULT_PRICES;
    try {
      const saved = localStorage.getItem('gpon-prices');
      return saved ? { ...DEFAULT_PRICES, ...JSON.parse(saved) } : DEFAULT_PRICES;
    } catch { return DEFAULT_PRICES; }
  });
  const setPricesAndStore = useCallback((p: PriceCatalog) => {
    setPrices(p);
    try { localStorage.setItem('gpon-prices', JSON.stringify(p)); } catch {}
  }, []);
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [status, setStatus] = useState<BuildStatus>('idle');
  const [osrmProgress, setOsrmProgress] = useState<OSRMProgress>({ done: 0, total: 0, current: '' });
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [dbEnabled, setDbEnabled] = useState(false);
  const [status_, setProjectStatus] = useState<ProjectStatus>('draft');
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);

  // Undo/Redo: serialized history of (districts, cables, joints) snapshots
  type HistEntry = { districts: District[]; cables: Cable[]; joints: InlineJoint[] };
  const historyRef = useRef<HistEntry[]>([]);
  const historyCursor = useRef<number>(-1);
  const skipNextSnapshot = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const HISTORY_MAX = 40;

  const abortRef = useRef<AbortController | null>(null);

  // Check if Supabase is configured
  useEffect(() => {
    setDbEnabled(!!supabase);
  }, []);

  // History: push current state to stack on every change to districts/cables/joints
  useEffect(() => {
    if (skipNextSnapshot.current) { skipNextSnapshot.current = false; return; }
    const entry: HistEntry = { districts, cables, joints };
    const cur = historyCursor.current;
    // truncate future, push new
    historyRef.current = historyRef.current.slice(0, cur + 1).concat([entry]);
    if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift();
    historyCursor.current = historyRef.current.length - 1;
    setCanUndo(historyCursor.current > 0);
    setCanRedo(false);
  }, [districts, cables, joints]);

  const undo = useCallback(() => {
    if (historyCursor.current <= 0) return;
    historyCursor.current -= 1;
    const prev = historyRef.current[historyCursor.current];
    skipNextSnapshot.current = true;
    setDistricts(prev.districts);
    setCables(prev.cables);
    setJoints(prev.joints);
    setCanUndo(historyCursor.current > 0);
    setCanRedo(historyCursor.current < historyRef.current.length - 1);
  }, []);

  const redo = useCallback(() => {
    if (historyCursor.current >= historyRef.current.length - 1) return;
    historyCursor.current += 1;
    const next = historyRef.current[historyCursor.current];
    skipNextSnapshot.current = true;
    setDistricts(next.districts);
    setCables(next.cables);
    setJoints(next.joints);
    setCanUndo(historyCursor.current > 0);
    setCanRedo(historyCursor.current < historyRef.current.length - 1);
  }, []);

  // Named snapshots (persisted with the project)
  const takeSnapshot = useCallback((name: string) => {
    const snap: ProjectSnapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || `Снимок ${new Date().toLocaleString('ru')}`,
      takenAt: new Date().toISOString(),
      snapshot: {
        districts: JSON.parse(JSON.stringify(districts)),
        cables: JSON.parse(JSON.stringify(cables)),
        joints: JSON.parse(JSON.stringify(joints)),
        annotations: JSON.parse(JSON.stringify(annotations)),
      },
    };
    setSnapshots((prev) => [snap, ...prev].slice(0, 30));
    return snap;
  }, [districts, cables, joints, annotations]);

  const restoreSnapshot = useCallback((id: string) => {
    const snap = snapshots.find((s) => s.id === id);
    if (!snap) return;
    if (!confirm(`Восстановить «${snap.name}»? Текущее состояние пропадёт (но Undo доступен).`)) return;
    setDistricts(snap.snapshot.districts);
    setCables(snap.snapshot.cables);
    setJoints(snap.snapshot.joints ?? []);
    setAnnotations(snap.snapshot.annotations);
  }, [snapshots]);

  const deleteSnapshot = useCallback((id: string) => {
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Auto-load last project on mount
  useEffect(() => {
    (async () => {
      try {
        const lastId = localStorage.getItem(CURRENT_KEY);
        if (!lastId) return;
        // Try Supabase first, fall back to localStorage
        if (supabase) {
          const p = await dbLoadProject(lastId);
          if (p) { loadProjectInternal(p); return; }
        }
        const projects = loadProjects();
        const p = projects.find((x) => x.id === lastId);
        if (p) loadProjectInternal(p);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persisted OLT coordinate overrides per district (user-supplied).
  const [oltOverrides, setOltOverrides] = useState<OltLocationMap>({});

  // Walk the cable graph through joint nodes (J-*) to recover full
  // entity-to-entity OSRM paths.  After a consolidation pass, trunks are
  // stored as a chain of OLT→J-1→J-2→TB cables; without this reconstruction
  // every subsequent reconsolidate would lose those routes and fall back
  // to a straight line through buildings.
  const buildExistingCoordsMap = useCallback((cs: Cable[]): Map<string, [number, number][]> => {
    const out = new Map<string, [number, number][]>();
    // Pass 1: direct entity-to-entity (no joint endpoints).
    for (const c of cs) {
      const fJ = c.fromId.startsWith('J-');
      const tJ = c.toId.startsWith('J-');
      if (!fJ && !tJ) {
        out.set(`${c.fromId}::${c.toId}`, c.coords);
        out.set(`${c.toId}::${c.fromId}`, [...c.coords].reverse());
      }
    }
    // Pass 2: walk chains via joints.  Build undirected adjacency, then BFS
    // from each non-joint node, recording the path each time we reach
    // another non-joint node.  Only paths whose every link is OSRM-routed
    // are stored, so we never piece together straight-line fragments and
    // pretend they were routed.
    type Edge = { to: string; coords: [number, number][]; routed: boolean };
    const adj = new Map<string, Edge[]>();
    for (const c of cs) {
      if (!adj.has(c.fromId)) adj.set(c.fromId, []);
      if (!adj.has(c.toId)) adj.set(c.toId, []);
      adj.get(c.fromId)!.push({ to: c.toId, coords: c.coords, routed: c.routedByOSRM });
      adj.get(c.toId)!.push({ to: c.fromId, coords: [...c.coords].reverse(), routed: c.routedByOSRM });
    }
    for (const start of adj.keys()) {
      if (start.startsWith('J-')) continue;
      type Frame = { node: string; path: [number, number][]; allRouted: boolean };
      const queue: Frame[] = [{ node: start, path: [], allRouted: true }];
      const visited = new Set<string>([start]);
      while (queue.length > 0) {
        const { node, path, allRouted } = queue.shift()!;
        for (const e of adj.get(node) || []) {
          if (visited.has(e.to)) continue;
          visited.add(e.to);
          const newPath = path.length === 0 ? e.coords : [...path, ...e.coords.slice(1)];
          const newRouted = allRouted && e.routed;
          if (!e.to.startsWith('J-')) {
            const key = `${start}::${e.to}`;
            if (newRouted && !out.has(key)) {
              out.set(key, newPath);
              out.set(`${e.to}::${start}`, [...newPath].reverse());
            }
            // don't continue past terminal nodes
            continue;
          }
          queue.push({ node: e.to, path: newPath, allRouted: newRouted });
        }
      }
    }
    return out;
  }, []);

  // Internal: build network from arbitrary subscriber set
  const runBuild = useCallback(async (subs: Subscriber[], replaceCables = true, oltLocationsArg?: OltLocationMap) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const effectiveOlts: OltLocationMap = { ...oltOverrides, ...(oltLocationsArg ?? {}) };

    try {
      setStatus('clustering');
      let { districts: newDistricts, cables: newCables } = buildNetwork(subs, settings, effectiveOlts);

      // Snap OLT/TB/ORK positions to the nearest road via OSRM nearest. Without
      // this they end up at k-means centroids — often on a roof or in a yard —
      // and the cable routing then makes a long detour from the off-road
      // centroid to the road and back, producing visible zigzags and loops.
      if (settings.useOSRM) {
        setOsrmProgress({ done: 0, total: 1, current: 'Привязка точек к дорогам…' });
        const pts: { lat: number; lon: number }[] = [];
        for (const d of newDistricts) {
          pts.push({ lat: d.olt.lat, lon: d.olt.lon });
          for (const tb of d.olt.transitBoxes) {
            pts.push({ lat: tb.lat, lon: tb.lon });
            for (const ork of tb.orks) pts.push({ lat: ork.lat, lon: ork.lon });
          }
        }
        const snap = await snapBatch(pts, 60, 8);
        const remap = (lat: number, lon: number): [number, number] => {
          const s = snap.get(`${lat},${lon}`);
          return s ?? [lat, lon];
        };
        // Apply snapped coords to districts + every cable endpoint that used them.
        newDistricts = newDistricts.map((d) => {
          const [oltLat, oltLon] = remap(d.olt.lat, d.olt.lon);
          return {
            ...d,
            olt: {
              ...d.olt,
              lat: oltLat,
              lon: oltLon,
              transitBoxes: d.olt.transitBoxes.map((tb) => {
                const [tbLat, tbLon] = remap(tb.lat, tb.lon);
                return {
                  ...tb,
                  lat: tbLat,
                  lon: tbLon,
                  orks: tb.orks.map((ork) => {
                    const [orkLat, orkLon] = remap(ork.lat, ork.lon);
                    return { ...ork, lat: orkLat, lon: orkLon };
                  }),
                };
              }),
            },
          };
        });
        // Build an entity-id → (lat, lon) lookup so we can update cable endpoints.
        const idCoords = new Map<string, [number, number]>();
        for (const d of newDistricts) {
          idCoords.set(d.olt.id, [d.olt.lat, d.olt.lon]);
          for (const tb of d.olt.transitBoxes) {
            idCoords.set(tb.id, [tb.lat, tb.lon]);
            for (const ork of tb.orks) idCoords.set(ork.id, [ork.lat, ork.lon]);
          }
        }
        newCables = newCables.map((c) => {
          const f = idCoords.get(c.fromId);
          const t = idCoords.get(c.toId);
          if (!f && !t) return c;
          const coords = [...c.coords];
          if (f) coords[0] = f;
          if (t) coords[coords.length - 1] = t;
          return { ...c, coords };
        });
      }

      setStatus('routing');
      let finalCables = newCables;

      if (settings.useOSRM) {
        finalCables = await routeCables(
          newCables,
          settings.osrmDelay,
          true, // routeDrops — нужно для слияния дропов с магистралью по общим дорогам
          (done, total, current) => setOsrmProgress({ done, total, current }),
          controller.signal,
        );
      }

      // Глобальная консолидация: одна дорога — один кабель, размер по числу
      // абонентов, муфты в точках расхождения.
      const { cables: consolidated, joints: newJoints } = consolidateCables(finalCables, newDistricts);
      finalCables = consolidated;

      setStatus('calculating');
      const mats = calculateMaterials(newDistricts, finalCables, settings, newJoints.length);
      const issues = validateNetwork(newDistricts, finalCables);

      setDistricts(newDistricts);
      setCables(finalCables);
      setJoints(newJoints);
      setMaterials(mats);
      setValidationIssues(issues);
      setStatus('done');
    } catch (err) {
      if (!controller.signal.aborted) {
        setStatus('error');
        console.error(err);
      }
    }
  }, [settings, oltOverrides]);

  // Replace all subscribers — fresh build
  const buildFromSubscribers = useCallback(async (newSubs: Subscriber[], source: string, oltLocations?: OltLocationMap) => {
    const merged = [...newSubs];
    setAllSubscribers(merged);
    if (oltLocations) setOltOverrides(oltLocations);
    const record: ImportRecord = {
      id: newId('imp'),
      source,
      districts: Array.from(new Set(newSubs.map((s) => s.district))),
      count: newSubs.length,
      importedAt: new Date().toISOString(),
    };
    setImportHistory([record]);
    await runBuild(merged, true, oltLocations);
  }, [runBuild]);

  // Append new subscribers and rebuild combined network
  const appendSubscribers = useCallback(async (newSubs: Subscriber[], source: string, oltLocations?: OltLocationMap) => {
    // Avoid duplicate coordinates
    const seen = new Set(allSubscribers.map((s) => `${s.lat.toFixed(6)},${s.lon.toFixed(6)}`));
    const filtered = newSubs.filter((s) => !seen.has(`${s.lat.toFixed(6)},${s.lon.toFixed(6)}`));
    const merged = [...allSubscribers, ...filtered];
    setAllSubscribers(merged);
    if (oltLocations) setOltOverrides((prev) => ({ ...prev, ...oltLocations }));
    const record: ImportRecord = {
      id: newId('imp'),
      source,
      districts: Array.from(new Set(filtered.map((s) => s.district))),
      count: filtered.length,
      importedAt: new Date().toISOString(),
    };
    setImportHistory((prev) => [...prev, record]);
    await runBuild(merged, true, oltLocations);
  }, [allSubscribers, runBuild]);

  const stopOSRM = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  // Manually trigger consolidation: regenerate the raw cable tree from the
  // current district structure (preserving any existing routed coords for
  // direct entity-to-entity pairs), then consolidate. This works even after
  // previous consolidation (where trunk cables go through joint IDs).
  const reconsolidate = useCallback(async (bbox?: BBox | null) => {
    if (districts.length === 0) return;

    // Reconstruct OSRM-routed paths between direct entity pairs, EVEN when
    // the path currently passes through joint nodes from a previous
    // consolidation (e.g. OLT → J-1 → J-2 → TB-5).  Without this, repeated
    // reconsolidate calls would fall back to straight lines on every trunk,
    // and the OSRM re-routing pass below either had to redo all of them
    // (slow, partial failures) or leave them straight (spaghetti).
    const existingCoords = buildExistingCoordsMap(cables);

    const pathLen = (cs: [number, number][]) => {
      let l = 0;
      for (let i = 1; i < cs.length; i++) l += haversineM(cs[i - 1][0], cs[i - 1][1], cs[i][0], cs[i][1]);
      return l;
    };

    // Regenerate raw cables from the district tree, reusing OSRM coords where
    // available, falling back to straight line.
    let nextSeq = 0;
    const nextId = () => `cable-r-${++nextSeq}`;
    const raw: Cable[] = [];
    for (const d of districts) {
      const olt = d.olt;
      for (const tb of olt.transitBoxes) {
        const k1 = `${olt.id}::${tb.id}`;
        const c1 = existingCoords.get(k1) ?? [[olt.lat, olt.lon] as [number, number], [tb.lat, tb.lon] as [number, number]];
        raw.push({
          id: nextId(), type: tb.inCable, fibers: CABLE_FIBERS[tb.inCable],
          fromId: olt.id, toId: tb.id, coords: c1,
          lengthM: pathLen(c1), routedByOSRM: existingCoords.has(k1),
        });
        for (const ork of tb.orks) {
          const k2 = `${tb.id}::${ork.id}`;
          const c2 = existingCoords.get(k2) ?? [[tb.lat, tb.lon] as [number, number], [ork.lat, ork.lon] as [number, number]];
          raw.push({
            id: nextId(), type: ork.cableType, fibers: CABLE_FIBERS[ork.cableType],
            fromId: tb.id, toId: ork.id, coords: c2,
            lengthM: pathLen(c2), routedByOSRM: existingCoords.has(k2),
          });
          for (const sub of ork.subscribers) {
            const k3 = `${ork.id}::${sub.id}`;
            const c3 = existingCoords.get(k3) ?? [[ork.lat, ork.lon] as [number, number], [sub.lat, sub.lon] as [number, number]];
            raw.push({
              id: nextId(), type: 'ОК-4', fibers: CABLE_FIBERS['ОК-4'],
              fromId: ork.id, toId: sub.id, coords: c3,
              lengthM: pathLen(c3), routedByOSRM: existingCoords.has(k3),
            });
          }
        }
      }
    }

    // OSRM-route any cables that lost their routing (trunk OLT→TB after
    // previous consolidation typically falls into this category).
    let routed = raw;
    const needRouting = raw.filter((c) => !c.routedByOSRM);
    if (settings.useOSRM && needRouting.length > 0) {
      setStatus('routing');
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const reRouted = await routeCables(
          needRouting, settings.osrmDelay, true,
          (d, t, c) => setOsrmProgress({ done: d, total: t, current: c }),
          ctrl.signal,
        );
        const map = new Map(reRouted.map((c) => [c.id, c]));
        routed = raw.map((c) => map.get(c.id) ?? c);
      } catch { /* abort */ }
    }

    // Consolidate (optionally only the subset that touches the bbox).
    if (bbox) {
      // Scope-limited consolidation: run consolidate over a filtered district
      // set + filtered cables, then splice the result back into full state.
      // Outside-bbox cables/joints are preserved.
      const scope = filterByBBox(districts, routed, joints, bbox);
      const { cables: newConsolidated, joints: newJoints } = consolidateCables(routed.filter((c) => polylineTouchesBBox(c.coords, bbox)), scope.districts);
      // Replace bbox cables with the consolidated set; keep the rest untouched.
      setCables((prev) => [
        ...prev.filter((c) => !polylineTouchesBBox(c.coords, bbox)),
        ...newConsolidated,
      ]);
      setJoints((prev) => [
        ...prev.filter((j) => !pointInBBox(j.lat, j.lon, bbox)),
        ...newJoints,
      ]);
      setStatus('done');
      return;
    }
    const { cables: consolidated, joints: newJoints } = consolidateCables(routed, districts);
    setCables(consolidated);
    setJoints(newJoints);
    setMaterials(calculateMaterials(districts, consolidated, settings, newJoints.length));
    setStatus('done');
  }, [districts, cables, joints, settings, buildExistingCoordsMap]);

  // Re-route existing cables with OSRM (without re-clustering)
  // bbox: if provided, only re-route cables whose polyline touches the
  // rectangle.  In that mode we route IN PLACE on the current cables —
  // works correctly even after consolidation (where cables go through
  // joints and don't have direct entity-pair ids).
  const rerouteWithOSRM = useCallback(async (bbox?: BBox | null) => {
    if (districts.length === 0 && cables.length === 0) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setStatus('routing');

      const pathLen = (cs: [number, number][]) => {
        let l = 0;
        for (let i = 1; i < cs.length; i++) l += haversineM(cs[i - 1][0], cs[i - 1][1], cs[i][0], cs[i][1]);
        return l;
      };

      // ─── BBox mode: re-route ONLY cables that touch the rectangle ───
      // No regeneration from districts; no consolidation.  Each affected
      // cable's coords are replaced with the OSRM route between its current
      // endpoints.  Anything outside the bbox is preserved as-is.
      if (bbox) {
        const affected = cables.filter((c) => polylineTouchesBBox(c.coords, bbox));
        if (affected.length === 0) {
          setStatus('done');
          return;
        }
        const reRouted = await routeCables(
          affected, settings.osrmDelay, true,
          (done, total, current) => setOsrmProgress({ done, total, current }),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const byId = new Map(reRouted.map((c) => [c.id, c] as const));
        setCables((prev) => prev.map((c) => byId.get(c.id) ?? c));
        setMaterials(calculateMaterials(districts, cables, settings, joints.length));
        setStatus('done');
        return;
      }

      // ─── Full reroute: regenerate raw tree and re-consolidate ───
      let seq = 0;
      const nextId = () => `cable-r-${++seq}`;
      const raw: Cable[] = [];
      for (const d of districts) {
        const olt = d.olt;
        for (const tb of olt.transitBoxes) {
          raw.push({
            id: nextId(), type: tb.inCable, fibers: CABLE_FIBERS[tb.inCable],
            fromId: olt.id, toId: tb.id,
            coords: [[olt.lat, olt.lon], [tb.lat, tb.lon]],
            lengthM: pathLen([[olt.lat, olt.lon], [tb.lat, tb.lon]]),
            routedByOSRM: false,
          });
          for (const ork of tb.orks) {
            raw.push({
              id: nextId(), type: ork.cableType, fibers: CABLE_FIBERS[ork.cableType],
              fromId: tb.id, toId: ork.id,
              coords: [[tb.lat, tb.lon], [ork.lat, ork.lon]],
              lengthM: pathLen([[tb.lat, tb.lon], [ork.lat, ork.lon]]),
              routedByOSRM: false,
            });
            for (const sub of ork.subscribers) {
              raw.push({
                id: nextId(), type: 'ОК-4', fibers: CABLE_FIBERS['ОК-4'],
                fromId: ork.id, toId: sub.id,
                coords: [[ork.lat, ork.lon], [sub.lat, sub.lon]],
                lengthM: pathLen([[ork.lat, ork.lon], [sub.lat, sub.lon]]),
                routedByOSRM: false,
              });
            }
          }
        }
      }
      const routed = await routeCables(
        raw, 200, true,
        (done, total, current) => setOsrmProgress({ done, total, current }),
        controller.signal,
      );
      if (!controller.signal.aborted) {
        const { cables: consolidated, joints: newJoints } = consolidateCables(routed, districts);
        setCables(consolidated);
        setJoints(newJoints);
        setMaterials(calculateMaterials(districts, consolidated, settings, newJoints.length));
        setStatus('done');
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setStatus('error');
        console.error(err);
      }
    }
  }, [districts, cables, joints, settings]);

  // Annotation operations
  const addAnnotation = useCallback((a: Omit<MapAnnotation, 'id' | 'createdAt' | 'updatedAt'>) => {
    const ann: MapAnnotation = {
      ...a,
      id: newId('ann'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setAnnotations((prev) => [...prev, ann]);
    return ann;
  }, []);

  const updateAnnotation = useCallback((id: string, patch: Partial<MapAnnotation>) => {
    setAnnotations((prev) => prev.map((a) =>
      a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a,
    ));
  }, []);

  const deleteAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Manual subscriber actions
  // Incremental — DO NOT trigger a full rebuild here.  A full rebuild
  // re-runs kmeans/Voronoi which would shuffle ORK/TB assignments and
  // re-route every cable, making the map flash through a "spaghetti"
  // state for ~30 s with 600+ subs.  Instead: find the nearest existing
  // ORK, attach the new sub to it, and add ONE drop cable.
  const addSubscriberAt = useCallback(async (
    lat: number,
    lon: number,
    district: string,
    desc: string,
    cameraKind?: CameraKind,
  ) => {
    // Camera-type extras — Sergek-domain: drives colouring + bandwidth load.
    const kind: CameraKind = cameraKind ?? 'unknown';
    const side: ProjectSide = kind === 'ovn' ? 'ovn' : 'apk';
    const bw = CAMERA_MIN_BANDWIDTH_MBPS[kind];

    // Find nearest existing ORK.  If the project has no ORKs yet, fall back
    // to the legacy full-rebuild path so the user gets some structure.
    let nearestOrk: { id: string; lat: number; lon: number; tbId: string; district: string } | null = null;
    let bestDist = Infinity;
    for (const d of districts) {
      for (const tb of d.olt.transitBoxes) {
        for (const ork of tb.orks) {
          const dist = haversineM(lat, lon, ork.lat, ork.lon);
          if (dist < bestDist) {
            bestDist = dist;
            nearestOrk = { id: ork.id, lat: ork.lat, lon: ork.lon, tbId: tb.id, district: d.name };
          }
        }
      }
    }

    if (!nearestOrk) {
      // No structure yet — first subscriber.  Use the original full-rebuild.
      const sub: Subscriber = {
        id: newId('sub'),
        lat, lon, desc, district,
        fibers: { working: 2, spare: 1 },
        kind, side, minBandwidthMbps: bw,
      };
      const merged = [...allSubscribers, sub];
      setAllSubscribers(merged);
      await runBuild(merged);
      return;
    }

    const sub: Subscriber = {
      id: newId('sub'),
      lat, lon, desc,
      district: nearestOrk.district,
      orkId: nearestOrk.id,
      fibers: { working: 2, spare: 1 },
      kind, side, minBandwidthMbps: bw,
    };

    // Insert sub into the matching ORK + into the district subscribers list.
    setDistricts((prev) => prev.map((d) => {
      if (d.name !== nearestOrk!.district) return d;
      return {
        ...d,
        subscribers: [...d.subscribers, sub],
        olt: {
          ...d.olt,
          transitBoxes: d.olt.transitBoxes.map((tb) => {
            if (tb.id !== nearestOrk!.tbId) return tb;
            return {
              ...tb,
              orks: tb.orks.map((ork) =>
                ork.id === nearestOrk!.id
                  ? { ...ork, subscribers: [...ork.subscribers, sub] }
                  : ork,
              ),
            };
          }),
        },
      };
    }));
    setAllSubscribers((prev) => [...prev, sub]);

    // OSRM-route the drop from ORK to the new sub.
    let coords: [number, number][] = [[nearestOrk.lat, nearestOrk.lon], [lat, lon]];
    let routed = false;
    if (settings.useOSRM) {
      try {
        const r = await getRoute(nearestOrk.lat, nearestOrk.lon, lat, lon);
        if (r && r.length > 2) { coords = r; routed = true; }
      } catch { /* keep straight */ }
    }
    const cable: Cable = {
      id: `cable-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'ОК-4',
      fibers: CABLE_FIBERS['ОК-4'],
      fromId: nearestOrk.id,
      toId: sub.id,
      coords,
      lengthM: routed
        ? coords.slice(1).reduce((acc, c, i) => acc + haversineM(coords[i][0], coords[i][1], c[0], c[1]), 0)
        : haversineM(nearestOrk.lat, nearestOrk.lon, lat, lon),
      routedByOSRM: routed,
    };
    setCables((prev) => [...prev, cable]);
  }, [districts, allSubscribers, runBuild, settings.useOSRM]);

  const deleteSubscriber = useCallback(async (subId: string) => {
    const merged = allSubscribers.filter((s) => s.id !== subId);
    setAllSubscribers(merged);
    await runBuild(merged);
  }, [allSubscribers, runBuild]);

  // Move a TB or ORK (manual edit): update coords and rebuild cables only (no re-cluster)
  const moveEntity = useCallback((kind: 'tb' | 'ork' | 'olt', id: string, lat: number, lon: number) => {
    setDistricts((prev) => prev.map((d) => {
      if (kind === 'olt' && d.olt.id === id) {
        return { ...d, olt: { ...d.olt, lat, lon } };
      }
      return {
        ...d,
        olt: {
          ...d.olt,
          transitBoxes: d.olt.transitBoxes.map((tb) => {
            if (kind === 'tb' && tb.id === id) return { ...tb, lat, lon };
            return {
              ...tb,
              orks: tb.orks.map((ork) => kind === 'ork' && ork.id === id ? { ...ork, lat, lon } : ork),
            };
          }),
        },
      };
    }));
    // Update cable endpoints touching this id
    setCables((prev) => prev.map((c) => {
      if (c.fromId === id || c.toId === id) {
        const coords = [...c.coords];
        if (c.fromId === id) coords[0] = [lat, lon];
        if (c.toId === id) coords[coords.length - 1] = [lat, lon];
        // recalc straight-line length
        let len = 0;
        for (let i = 1; i < coords.length; i++) {
          const [la, lo] = coords[i - 1];
          const [lb, lob] = coords[i];
          const R = 6371000;
          const dLat = ((lb - la) * Math.PI) / 180;
          const dLon = ((lob - lo) * Math.PI) / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos((la * Math.PI) / 180) * Math.cos((lb * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
          len += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
        return { ...c, coords, lengthM: len, routedByOSRM: false };
      }
      return c;
    }));
  }, []);

  const updateCable = useCallback((id: string, patch: Partial<Pick<Cable, 'type' | 'coords' | 'lengthM'>>) => {
    setCables((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const updated = { ...c, ...patch };
      if (patch.type) updated.fibers = CABLE_FIBERS[patch.type];
      if (patch.coords && patch.lengthM == null) {
        let len = 0;
        for (let i = 1; i < patch.coords.length; i++) {
          len += haversineM(patch.coords[i - 1][0], patch.coords[i - 1][1], patch.coords[i][0], patch.coords[i][1]);
        }
        updated.lengthM = len;
      }
      return updated;
    }));
  }, []);

  const rerouteSingleCable = useCallback(async (id: string) => {
    const cable = cables.find((c) => c.id === id);
    if (!cable) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setStatus('routing');
      const routed = await routeCables([cable], 0, true, () => {}, controller.signal);
      if (!controller.signal.aborted && routed[0]) {
        setCables((prev) => prev.map((c) => c.id === id ? routed[0] : c));
        setStatus('done');
      }
    } catch {
      if (!controller.signal.aborted) setStatus('done');
    }
  }, [cables]);

  const updateOLT = useCallback((id: string, patch: Partial<Omit<OLT, 'id' | 'lat' | 'lon' | 'transitBoxes'>>) => {
    setDistricts((prev) => prev.map((d) =>
      d.olt.id === id ? { ...d, olt: { ...d.olt, ...patch } } : d,
    ));
  }, []);

  const updateTB = useCallback((id: string, patch: Partial<Omit<TransitBox, 'id' | 'lat' | 'lon' | 'orks'>>) => {
    setDistricts((prev) => prev.map((d) => ({
      ...d,
      olt: {
        ...d.olt,
        transitBoxes: d.olt.transitBoxes.map((tb) =>
          tb.id === id ? { ...tb, ...patch } : tb,
        ),
      },
    })));
  }, []);

  // Delete ORK: remove from its parent TB, remove its cables (TB→ORK + ORK→sub),
  // also remove its subscribers from the district.
  const deleteORK = useCallback((orkId: string) => {
    let removedSubIds = new Set<string>();
    setDistricts((prev) => prev.map((d) => ({
      ...d,
      subscribers: d.subscribers.filter((s) => {
        // find if this sub belonged to the deleted ORK
        const ork = d.olt.transitBoxes.flatMap((tb) => tb.orks).find((o) => o.id === orkId);
        if (ork && ork.subscribers.some((x) => x.id === s.id)) { removedSubIds.add(s.id); return false; }
        return true;
      }),
      olt: {
        ...d.olt,
        transitBoxes: d.olt.transitBoxes.map((tb) => ({
          ...tb,
          orks: tb.orks.filter((o) => o.id !== orkId),
        })),
      },
    })));
    setCables((prev) => prev.filter((c) => c.fromId !== orkId && c.toId !== orkId));
    setAllSubscribers((prev) => prev.filter((s) => !removedSubIds.has(s.id)));
  }, []);

  // Delete TB: remove all its ORKs (cascade), remove its cables (OLT→TB + TB→ORK),
  // and clean up subscribers/cables for the cascaded ORKs.
  const deleteTB = useCallback((tbId: string) => {
    const tb = districts
      .flatMap((d) => d.olt.transitBoxes)
      .find((x) => x.id === tbId);
    if (!tb) return;
    const orkIds = new Set(tb.orks.map((o) => o.id));
    const subIds = new Set(tb.orks.flatMap((o) => o.subscribers.map((s) => s.id)));
    setDistricts((prev) => prev.map((d) => ({
      ...d,
      subscribers: d.subscribers.filter((s) => !subIds.has(s.id)),
      olt: {
        ...d.olt,
        transitBoxes: d.olt.transitBoxes.filter((x) => x.id !== tbId),
      },
    })));
    setCables((prev) => prev.filter((c) =>
      c.fromId !== tbId && c.toId !== tbId &&
      !orkIds.has(c.fromId) && !orkIds.has(c.toId),
    ));
    setAllSubscribers((prev) => prev.filter((s) => !subIds.has(s.id)));
  }, [districts]);

  // Delete OLT: remove the entire district (everything downstream).
  const deleteOLT = useCallback((oltId: string) => {
    const district = districts.find((d) => d.olt.id === oltId);
    if (!district) return;
    const tbIds = new Set(district.olt.transitBoxes.map((tb) => tb.id));
    const orkIds = new Set(district.olt.transitBoxes.flatMap((tb) => tb.orks.map((o) => o.id)));
    const subIds = new Set(district.subscribers.map((s) => s.id));
    setDistricts((prev) => prev.filter((d) => d.olt.id !== oltId));
    setCables((prev) => prev.filter((c) =>
      c.fromId !== oltId && c.toId !== oltId &&
      !tbIds.has(c.fromId) && !tbIds.has(c.toId) &&
      !orkIds.has(c.fromId) && !orkIds.has(c.toId),
    ));
    setAllSubscribers((prev) => prev.filter((s) => !subIds.has(s.id)));
  }, [districts]);

  const deleteCable = useCallback((cableId: string) => {
    setCables((prev) => prev.filter((c) => c.id !== cableId));
  }, []);

  // Find entity coords by id (OLT/TB/ORK/sub).
  const findEntityCoords = useCallback((id: string): [number, number] | null => {
    for (const d of districts) {
      if (d.olt.id === id) return [d.olt.lat, d.olt.lon];
      for (const tb of d.olt.transitBoxes) {
        if (tb.id === id) return [tb.lat, tb.lon];
        for (const ork of tb.orks) {
          if (ork.id === id) return [ork.lat, ork.lon];
          const sub = ork.subscribers.find((s) => s.id === id);
          if (sub) return [sub.lat, sub.lon];
        }
      }
    }
    return null;
  }, [districts]);

  // Reassign ORK to a different TB. Updates parent reference + replaces TB→ORK cable.
  const reassignORK = useCallback((orkId: string, newTbId: string) => {
    let orkData: ORK | null = null;
    let oldTbId: string | null = null;
    let newTbCoords: [number, number] | null = null;
    for (const d of districts) {
      for (const tb of d.olt.transitBoxes) {
        if (tb.id === newTbId) newTbCoords = [tb.lat, tb.lon];
        const found = tb.orks.find((o) => o.id === orkId);
        if (found) { orkData = found; oldTbId = tb.id; }
      }
    }
    if (!orkData || !oldTbId || !newTbCoords || oldTbId === newTbId) return;
    setDistricts((prev) => prev.map((d) => ({
      ...d,
      olt: {
        ...d.olt,
        transitBoxes: d.olt.transitBoxes.map((tb) => {
          if (tb.id === oldTbId) return { ...tb, orks: tb.orks.filter((o) => o.id !== orkId) };
          if (tb.id === newTbId) return { ...tb, orks: [...tb.orks, { ...orkData!, tbId: newTbId }] };
          return tb;
        }),
      },
    })));
    setCables((prev) => {
      const filtered = prev.filter((c) => !(c.fromId === oldTbId && c.toId === orkId));
      const cable: Cable = {
        id: `cable-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'ОК-4', fibers: CABLE_FIBERS['ОК-4'],
        fromId: newTbId, toId: orkId,
        coords: [newTbCoords!, [orkData!.lat, orkData!.lon]],
        lengthM: haversineM(newTbCoords![0], newTbCoords![1], orkData!.lat, orkData!.lon),
        routedByOSRM: false,
      };
      return [...filtered, cable];
    });
  }, [districts]);

  // Reassign subscriber to a different ORK. Updates orkId + replaces ORK→sub drop cable.
  const reassignSubscriber = useCallback((subId: string, newOrkId: string) => {
    let subData: Subscriber | null = null;
    let oldOrkId: string | null = null;
    let newOrkCoords: [number, number] | null = null;
    for (const d of districts) {
      for (const tb of d.olt.transitBoxes) {
        for (const ork of tb.orks) {
          if (ork.id === newOrkId) newOrkCoords = [ork.lat, ork.lon];
          const found = ork.subscribers.find((s) => s.id === subId);
          if (found) { subData = found; oldOrkId = ork.id; }
        }
      }
    }
    if (!subData || !oldOrkId || !newOrkCoords || oldOrkId === newOrkId) return;
    setDistricts((prev) => prev.map((d) => ({
      ...d,
      subscribers: d.subscribers.map((s) => s.id === subId ? { ...s, orkId: newOrkId } : s),
      olt: {
        ...d.olt,
        transitBoxes: d.olt.transitBoxes.map((tb) => ({
          ...tb,
          orks: tb.orks.map((ork) => {
            if (ork.id === oldOrkId) return { ...ork, subscribers: ork.subscribers.filter((s) => s.id !== subId) };
            if (ork.id === newOrkId) return { ...ork, subscribers: [...ork.subscribers, { ...subData!, orkId: newOrkId }] };
            return ork;
          }),
        })),
      },
    })));
    setCables((prev) => {
      const filtered = prev.filter((c) => !(c.fromId === oldOrkId && c.toId === subId));
      const cable: Cable = {
        id: `cable-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'ОК-4', fibers: CABLE_FIBERS['ОК-4'],
        fromId: newOrkId, toId: subId,
        coords: [newOrkCoords!, [subData!.lat, subData!.lon]],
        lengthM: haversineM(newOrkCoords![0], newOrkCoords![1], subData!.lat, subData!.lon),
        routedByOSRM: false,
      };
      return [...filtered, cable];
    });
  }, [districts]);

  // Classify an entity id → 'olt' | 'tb' | 'ork' | 'sub' | 'joint' (best-effort).
  const findEntityKind = useCallback((id: string): 'olt' | 'tb' | 'ork' | 'sub' | 'joint' | null => {
    for (const d of districts) {
      if (d.olt.id === id) return 'olt';
      for (const tb of d.olt.transitBoxes) {
        if (tb.id === id) return 'tb';
        for (const ork of tb.orks) {
          if (ork.id === id) return 'ork';
          if (ork.subscribers.some((s) => s.id === id)) return 'sub';
        }
      }
    }
    if ((joints ?? []).some((j) => j.id === id)) return 'joint';
    return null;
  }, [districts, joints]);

  // Pick a sensible default cable type for an A→B link based on what's at each end.
  // Drop (any endpoint = sub) → ОК-4. Magistral (OLT involved) → ОК-24. Else ОК-12.
  const inferCableType = useCallback((fromId: string, toId: string): Cable['type'] => {
    const a = findEntityKind(fromId);
    const b = findEntityKind(toId);
    if (a === 'sub' || b === 'sub') return 'ОК-4';
    if (a === 'olt' || b === 'olt') return 'ОК-24';
    return 'ОК-12';
  }, [findEntityKind]);

  // Add a cable between two entities. When settings.useOSRM is on, fetches a
  // single OSRM route so the new cable follows real roads instead of cutting
  // diagonally through buildings — matches the smart-routing the user sees
  // when running the full build.
  const addCableBetween = useCallback(async (fromId: string, toId: string, typeArg?: Cable['type']) => {
    const from = findEntityCoords(fromId);
    const to = findEntityCoords(toId);
    if (!from || !to) return;

    const type = typeArg ?? inferCableType(fromId, toId);

    let coords: [number, number][] = [from, to];
    let routed = false;
    if (settings.useOSRM) {
      try {
        const route = await getRoute(from[0], from[1], to[0], to[1]);
        if (route && route.length > 2) {
          coords = route;
          routed = true;
        }
      } catch {
        // fall back to straight line
      }
    }

    const cable: Cable = {
      id: `cable-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      fibers: CABLE_FIBERS[type],
      fromId,
      toId,
      coords,
      lengthM: routed
        ? coords.slice(1).reduce(
            (acc, c, i) => acc + haversineM(coords[i][0], coords[i][1], c[0], c[1]),
            0,
          )
        : haversineM(from[0], from[1], to[0], to[1]),
      routedByOSRM: routed,
    };
    setCables((prev) => [...prev, cable]);
  }, [findEntityCoords, inferCableType, settings.useOSRM]);

  // Ручной кабель между двумя ПРОИЗВОЛЬНЫМИ точками карты (A→B) по OSRM, тип
  // выбирает пользователь. Концы — синтетические id (не сущности).
  const addCableByPoints = useCallback(async (
    a: [number, number], b: [number, number], type: Cable['type'],
  ) => {
    let coords: [number, number][] = [a, b];
    let routed = false;
    if (settings.useOSRM) {
      try {
        const route = await getRoute(a[0], a[1], b[0], b[1]);
        if (route && route.length > 2) { coords = route; routed = true; }
      } catch { /* fall back to straight line */ }
    }
    const lengthM = coords.slice(1).reduce(
      (acc, c, i) => acc + haversineM(coords[i][0], coords[i][1], c[0], c[1]), 0,
    );
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cable: Cable = {
      id: `cable-man-${stamp}`,
      type,
      fibers: CABLE_FIBERS[type],
      fromId: `pt-${stamp}-a`,
      toId: `pt-${stamp}-b`,
      coords,
      lengthM,
      routedByOSRM: routed,
    };
    setCables((prev) => [...prev, cable]);
  }, [settings.useOSRM]);

  // Manual placement of entities ----------------------------------------------

  const addOLTAt = useCallback((lat: number, lon: number, districtName: string) => {
    const cleanName = districtName.trim() || 'Новый район';
    const id = `OLT-${cleanName.slice(0, 8).replace(/\s/g, '')}-${Math.random().toString(36).slice(2, 5)}`;
    setDistricts((prev) => {
      const used = new Set(prev.map((d) => d.color));
      const color = DISTRICT_COLORS.find((c) => !used.has(c)) ?? DISTRICT_COLORS[prev.length % DISTRICT_COLORS.length];
      return [...prev, {
        name: cleanName, color,
        olt: { id, lat, lon, district: cleanName, model: 'Huawei MA5800-X7', capacity: 64, transitBoxes: [], l1Splitter: '1:4' },
        subscribers: [],
      }];
    });
  }, []);

  const addTBAt = useCallback((lat: number, lon: number, oltId?: string) => {
    // Auto-pick nearest OLT if not specified
    let chosen: { d: typeof districts[number]; olt: OLT } | null = null;
    if (oltId) {
      const d = districts.find((x) => x.olt.id === oltId);
      if (d) chosen = { d, olt: d.olt };
    } else {
      let bestD = Infinity;
      for (const d of districts) {
        const dist = haversineM(lat, lon, d.olt.lat, d.olt.lon);
        if (dist < bestD) { bestD = dist; chosen = { d, olt: d.olt }; }
      }
    }
    if (!chosen) return;
    const tbId = `Муфта-${chosen.d.name.slice(0, 4).replace(/\s/g, '')}-${chosen.olt.transitBoxes.length + 1}`;
    const newTB: TransitBox = {
      id: tbId, lat, lon, district: chosen.d.name,
      oltId: chosen.olt.id, orks: [],
      inCable: 'ОК-12', outCable: 'ОК-4', muftaType: 'МТОК-96А',
    };
    setDistricts((prev) => prev.map((d) =>
      d.olt.id === chosen!.olt.id
        ? { ...d, olt: { ...d.olt, transitBoxes: [...d.olt.transitBoxes, newTB] } }
        : d,
    ));
    // Auto-create OLT→TB straight-line cable
    const cable: Cable = {
      id: `cable-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'ОК-12', fibers: CABLE_FIBERS['ОК-12'],
      fromId: chosen.olt.id, toId: tbId,
      coords: [[chosen.olt.lat, chosen.olt.lon], [lat, lon]],
      lengthM: haversineM(chosen.olt.lat, chosen.olt.lon, lat, lon),
      routedByOSRM: false,
    };
    setCables((prev) => [...prev, cable]);
  }, [districts]);

  const addORKAt = useCallback((lat: number, lon: number, tbId?: string) => {
    // Auto-pick nearest TB
    let chosenTB: { tb: TransitBox; districtName: string } | null = null;
    if (tbId) {
      for (const d of districts) {
        const tb = d.olt.transitBoxes.find((x) => x.id === tbId);
        if (tb) { chosenTB = { tb, districtName: d.name }; break; }
      }
    } else {
      let bestD = Infinity;
      for (const d of districts) {
        for (const tb of d.olt.transitBoxes) {
          const dist = haversineM(lat, lon, tb.lat, tb.lon);
          if (dist < bestD) { bestD = dist; chosenTB = { tb, districtName: d.name }; }
        }
      }
    }
    if (!chosenTB) return;
    const orkId = `Бокс-${chosenTB.districtName.slice(0, 4).replace(/\s/g, '')}-${chosenTB.tb.orks.length + 1}-${Math.random().toString(36).slice(2, 4)}`;
    const newORK: ORK = {
      id: orkId, lat, lon, district: chosenTB.districtName,
      splitter: '1:8', tbId: chosenTB.tb.id,
      subscribers: [], cableType: 'ОК-4', boxType: 'Бокс-16',
    };
    setDistricts((prev) => prev.map((d) => ({
      ...d,
      olt: {
        ...d.olt,
        transitBoxes: d.olt.transitBoxes.map((tb) =>
          tb.id === chosenTB!.tb.id ? { ...tb, orks: [...tb.orks, newORK] } : tb,
        ),
      },
    })));
    const cable: Cable = {
      id: `cable-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'ОК-4', fibers: CABLE_FIBERS['ОК-4'],
      fromId: chosenTB.tb.id, toId: orkId,
      coords: [[chosenTB.tb.lat, chosenTB.tb.lon], [lat, lon]],
      lengthM: haversineM(chosenTB.tb.lat, chosenTB.tb.lon, lat, lon),
      routedByOSRM: false,
    };
    setCables((prev) => [...prev, cable]);
  }, [districts]);

  const updateORK = useCallback((id: string, patch: Partial<Omit<ORK, 'id' | 'lat' | 'lon' | 'subscribers'>>) => {
    setDistricts((prev) => prev.map((d) => ({
      ...d,
      olt: {
        ...d.olt,
        transitBoxes: d.olt.transitBoxes.map((tb) => ({
          ...tb,
          orks: tb.orks.map((ork) =>
            ork.id === id ? { ...ork, ...patch } : ork,
          ),
        })),
      },
    })));
  }, []);

  const rebuildFromCurrent = useCallback(async () => {
    if (allSubscribers.length > 0) await runBuild(allSubscribers);
  }, [allSubscribers, runBuild]);

  // Load a fully-built structure (districts + cables) directly into state.
  // Used by the smart-KML importer: vendor file already has OLT/TB/ORK/cables
  // drawn — we DON'T cluster, we just take it as the source of truth.
  const loadStructured = useCallback(async (
    newDistricts: District[],
    newCables: Cable[],
    source: string,
  ) => {
    setDistricts(newDistricts);
    setCables(newCables);
    setJoints([]);
    setAnnotations([]);
    const allSubs = newDistricts.flatMap((d) => d.subscribers);
    setAllSubscribers(allSubs);
    const mats = calculateMaterials(newDistricts, newCables, settings, 0);
    setMaterials(mats);
    setValidationIssues(validateNetwork(newDistricts, newCables));
    setImportHistory([{
      id: newId('imp'),
      source: `${source} (structured)`,
      districts: newDistricts.map((d) => d.name),
      count: allSubs.length,
      importedAt: new Date().toISOString(),
    }]);
    setStatus('done');
  }, [settings]);

  // Raw KML load — show the file as it was drawn (points + LineStrings)
  // WITHOUT running the auto-build / clustering pipeline.  Points become
  // subscribers (no ORK assignment yet), LineStrings become annotations of
  // type 'cable-route' so the original cable routes are visible 1:1.
  // The "🔨 Построить" button later calls rebuildFromCurrent to cluster.
  const loadRaw = useCallback(async (
    subs: Subscriber[],
    lines: Array<{ coords: [number, number][]; name: string; folder: string }>,
    source: string,
  ) => {
    setAllSubscribers(subs);
    setDistricts([]);
    setCables([]);
    setJoints([]);
    const annotations: MapAnnotation[] = lines.map((ln, i) => ({
      id: `ann-kml-${Date.now()}-${i}`,
      type: 'cable-route',
      shape: 'line',
      coords: ln.coords,
      name: ln.name || `Линия ${i + 1}`,
      description: ln.folder ? `Слой: ${ln.folder}` : '',
      color: '#fbbf24', // amber — distinct from real cables (orange/blue/green)
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    setAnnotations(annotations);
    setImportHistory([{
      id: newId('imp'),
      source: `${source} (raw)`,
      districts: Array.from(new Set(subs.map((s) => s.district))),
      count: subs.length,
      importedAt: new Date().toISOString(),
    }]);
    setStatus('done');
  }, []);

  // Bulk repair pass.  Deletes phantom / cross-district cables and OSRM-
  // routes drops for any subscriber that has no cable but a nearby ORK.
  // Returns a structured report — the AI can read it back via the tool
  // result and decide whether to do another pass.
  const autoRepair = useCallback(async (bbox?: BBox | null): Promise<RepairReport> => {
    // If a selection rectangle is active, only act on the subset inside it
    // — but still resolve nearest-ORK lookups against the FULL district tree
    // so an orphan sub at the bbox edge can attach to an ORK just outside.
    const scope = bbox ? filterByBBox(districts, cables, joints, bbox) : null;
    const planSourceDistricts = scope ? scope.districts : districts;
    const planSourceCables = scope ? scope.cables : cables;
    const plan = planRepair(planSourceDistricts, planSourceCables);
    // Apply deletions in one state update.
    if (plan.toDelete.length > 0) {
      const remove = new Set(plan.toDelete);
      setCables((prev) => prev.filter((c) => !remove.has(c.id)));
    }
    // OSRM-route the new drops sequentially with a small delay to avoid
    // hammering the public OSRM demo.
    for (const item of plan.toConnect) {
      const cable = await buildDropCable(item.sub, item.orkId, item.orkLat, item.orkLon, settings.useOSRM);
      setCables((prev) => [...prev, cable]);
      plan.report.addedCables.push({ fromId: cable.fromId, toId: cable.toId, lengthM: Math.round(cable.lengthM) });
      // tiny breather between OSRM calls
      if (settings.useOSRM) await new Promise((r) => setTimeout(r, 120));
    }
    return plan.report;
  }, [districts, cables, joints, settings.useOSRM]);

  // Import a full Project as-is (no re-clustering) — used for "existing network" import
  const importNetworkReplace = useCallback((incoming: Project) => {
    loadProjectInternal(incoming);
  }, []);

  // Merge incoming districts into current project without re-clustering.
  // Districts with the same name are merged at the subscriber level (rebuilds that district only).
  // Brand-new districts are added verbatim with their cables.
  const mergeNetworkDistricts = useCallback(async (incoming: Project) => {
    const existingNames = new Set(districts.map((d) => d.name));
    const brandNew = incoming.districts.filter((d) => !existingNames.has(d.name));
    const overlap = incoming.districts.filter((d) => existingNames.has(d.name));

    if (brandNew.length === 0 && overlap.length === 0) return;

    // Brand-new districts: add verbatim (keep exact OLT/TB/ORK/cable structure)
    const nextDistricts = [...districts, ...brandNew];

    // Add their cables (dedup by id)
    const existingCableIds = new Set(cables.map((c) => c.id));
    const incomingCables = incoming.cables ?? [];
    const brandNewIds = new Set(brandNew.map((d) => d.name));
    const newCables = incomingCables.filter((c) => {
      // Keep cables that belong to brand-new districts (fromId starts with OLT/Бокс/Муфта of new districts)
      if (existingCableIds.has(c.id)) return false;
      return true;
    });

    const nextCables = [...cables, ...newCables];
    const nextJoints = [...joints, ...(incoming.joints ?? [])];

    // Subscribers from overlapping districts get merged and rebuilt
    if (overlap.length > 0) {
      const incomingSubs = overlap.flatMap((d) => d.subscribers);
      // Avoid coordinate duplicates
      const seen = new Set(allSubscribers.map((s) => `${s.lat.toFixed(6)},${s.lon.toFixed(6)}`));
      const filtered = incomingSubs.filter((s) => !seen.has(`${s.lat.toFixed(6)},${s.lon.toFixed(6)}`));
      if (filtered.length > 0) {
        const mergedSubs = [...allSubscribers, ...filtered];
        setAllSubscribers(mergedSubs);
        // Full rebuild since subscriber set changed
        const record: ImportRecord = {
          id: newId('imp'),
          source: `Merge: ${incoming.name}`,
          districts: overlap.map((d) => d.name),
          count: filtered.length,
          importedAt: new Date().toISOString(),
        };
        setImportHistory((prev) => [...prev, record]);
        await runBuild(mergedSubs);
        return;
      }
    }

    // No overlapping subs to rebuild — just update state
    const allSubs = nextDistricts.flatMap((d) => d.subscribers);
    setAllSubscribers(allSubs);
    setDistricts(nextDistricts);
    setCables(nextCables);
    setJoints(nextJoints);
    const mats = calculateMaterials(nextDistricts, nextCables, settings, nextJoints.length);
    setMaterials(mats);
    setValidationIssues(validateNetwork(nextDistricts, nextCables));
    setStatus('done');

    const record: ImportRecord = {
      id: newId('imp'),
      source: `Network: ${incoming.name}`,
      districts: brandNew.map((d) => d.name),
      count: brandNew.reduce((s, d) => s + d.subscribers.length, 0),
      importedAt: new Date().toISOString(),
    };
    setImportHistory((prev) => [...prev, record]);
  }, [districts, cables, joints, allSubscribers, settings, runBuild]);

  // Projects — localStorage helpers (always kept as offline fallback)
  function loadProjects(): Project[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  }

  function saveToLocalStorage(project: Project) {
    const projects = loadProjects();
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      projects[idx] = { ...projects[idx], ...project, createdAt: projects[idx].createdAt };
    } else {
      projects.unshift(project);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.slice(0, 50)));
    localStorage.setItem(CURRENT_KEY, project.id);
  }

  const listProjects = useCallback(async (): Promise<Project[]> => {
    if (supabase) {
      try {
        const rows = await dbListProjects();
        return rows.map((r) => r.data);
      } catch {}
    }
    return loadProjects();
  }, []);

  const saveProject = useCallback(async () => {
    const project: Project = {
      id: projectId,
      name: projectName,
      status: status_,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      districts, cables, joints, annotations, importHistory, settings,
      snapshots,
    };
    // Always save to localStorage as offline backup
    saveToLocalStorage(project);
    // Save to Supabase if available
    if (supabase) {
      try {
        await dbSaveProject(project);
      } catch (e) {
        console.warn('[DB] save failed, using localStorage only', e);
      }
    }
    setLastSavedAt(new Date().toISOString());
    return project;
  }, [projectId, projectName, districts, cables, joints, annotations, importHistory, settings]);

  function loadProjectInternal(p: Project) {
    setProjectId(p.id);
    setProjectName(p.name);
    setDistricts(p.districts || []);
    setCables(p.cables || []);
    setJoints(p.joints || []);
    setAnnotations(p.annotations || []);
    setImportHistory(p.importHistory || []);
    setSettings({ ...DEFAULT_SETTINGS, ...p.settings });
    setProjectStatus(p.status ?? 'draft');
    setSnapshots(p.snapshots ?? []);
    const subs = (p.districts || []).flatMap((d) => d.subscribers);
    setAllSubscribers(subs);
    if (p.districts?.length) {
      const mats = calculateMaterials(p.districts, p.cables, p.settings, (p.joints || []).length);
      setMaterials(mats);
      setStatus('done');
    } else {
      setMaterials(null);
      setStatus('idle');
    }
  }

  const loadProject = useCallback(async (p: Project) => {
    // If we have Supabase, load the freshest copy from DB
    if (supabase) {
      try {
        const fresh = await dbLoadProject(p.id);
        if (fresh) { loadProjectInternal(fresh); localStorage.setItem(CURRENT_KEY, p.id); return; }
      } catch {}
    }
    loadProjectInternal(p);
    localStorage.setItem(CURRENT_KEY, p.id);
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    const projects = loadProjects().filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    if (supabase) {
      try { await dbDeleteProject(id); } catch {}
    }
  }, []);

  const newProject = useCallback(() => {
    setProjectId(newId('proj'));
    setProjectName('Новый проект');
    setProjectStatus('draft');
    setSnapshots([]);
    setDistricts([]);
    setCables([]);
    setJoints([]);
    setAnnotations([]);
    setImportHistory([]);
    setAllSubscribers([]);
    setMaterials(null);
    setValidationIssues([]);
    setStatus('idle');
    historyRef.current = [];
    historyCursor.current = -1;
    setCanUndo(false); setCanRedo(false);
    localStorage.removeItem(CURRENT_KEY);
  }, []);

  const exportProjectJSON = useCallback(() => {
    const project: Project = {
      id: projectId, name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      districts, cables, joints, annotations, importHistory, settings,
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/[^\w\s-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [projectId, projectName, districts, cables, annotations, importHistory, settings]);

  const importProjectJSON = useCallback(async (file: File) => {
    const text = await file.text();
    const p = JSON.parse(text) as Project;
    loadProjectInternal(p);
  }, []);

  // Auto-save
  useEffect(() => {
    if (!autoSaveEnabled) return;
    if (districts.length === 0 && annotations.length === 0) return;
    const t = setInterval(() => { saveProject(); }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [autoSaveEnabled, districts.length, annotations.length, saveProject]);

  const toggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const totalSubscribers = districts.reduce((s, d) => s + d.subscribers.length, 0);
  const totalCableKm = Math.round(cables.reduce((s, c) => s + c.lengthM, 0) / 100) / 10;
  const totalOrks = districts.reduce(
    (s, d) => s + d.olt.transitBoxes.reduce((ts, tb) => ts + tb.orks.length, 0),
    0,
  );

  // Optical power budget (per-subscriber dB loss + status)
  const powerBudgets = useMemo(() => calculateSubscriberBudgets(districts, cables), [districts, cables]);
  const powerBudgetStats = useMemo(() => budgetStats(powerBudgets), [powerBudgets]);

  return {
    projectId, projectName, setProjectName,
    districts, cables, joints, annotations, materials, settings, setSettings,
    prices, setPrices: setPricesAndStore,
    importHistory, allSubscribers,
    layers, toggleLayer,
    status, osrmProgress, stopOSRM, rerouteWithOSRM,
    validationIssues,
    editMode, setEditMode,
    autoSaveEnabled, setAutoSaveEnabled, lastSavedAt, dbEnabled,
    buildFromSubscribers, appendSubscribers,
    addAnnotation, updateAnnotation, deleteAnnotation,
    addSubscriberAt, deleteSubscriber, moveEntity, rebuildFromCurrent, autoRepair, loadRaw, loadStructured,
    saveProject, loadProject, deleteProject, listProjects, newProject,
    exportProjectJSON, importProjectJSON,
    totalSubscribers, totalCableKm, totalOrks,
    powerBudgets, powerBudgetStats,
    importNetworkReplace, mergeNetworkDistricts,
    updateOLT, updateTB, updateORK,
    updateCable, rerouteSingleCable,
    deleteOLT, deleteTB, deleteORK, deleteCable,
    addOLTAt, addTBAt, addORKAt, addCableBetween, addCableByPoints,
    reassignORK, reassignSubscriber,
    undo, redo, canUndo, canRedo,
    takeSnapshot, restoreSnapshot, deleteSnapshot, snapshots,
    projectStatus: status_, setProjectStatus,
    reconsolidate,
  };
}
