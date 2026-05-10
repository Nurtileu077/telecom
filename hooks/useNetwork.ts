'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  District, Cable, Subscriber, ProjectSettings, Materials, LayerVisibility,
  DEFAULT_SETTINGS, Project, MapAnnotation, ImportRecord, ValidationIssue,
  PriceCatalog, DEFAULT_PRICES,
} from '@/types/network';
import { buildNetwork } from '@/components/Network/AutoBuild';
import { calculateMaterials, validateNetwork } from '@/components/Network/MaterialCalc';
import { routeCables } from '@/components/Network/OSRMRouter';

export type BuildStatus = 'idle' | 'importing' | 'clustering' | 'routing' | 'calculating' | 'done' | 'error';

export interface OSRMProgress {
  done: number;
  total: number;
  current: string;
}

const DEFAULT_LAYERS: LayerVisibility = {
  olt: true, tb: true, ork: true, subscribers: true, cables: true,
  cableOKB10: true, cableOKSNN8: true, cableOKSNN4: true, cableOKA2: true,
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

  const abortRef = useRef<AbortController | null>(null);

  // Auto-load last project on mount
  useEffect(() => {
    try {
      const lastId = localStorage.getItem(CURRENT_KEY);
      if (lastId) {
        const projects = loadProjects();
        const p = projects.find((x) => x.id === lastId);
        if (p) loadProjectInternal(p);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Internal: build network from arbitrary subscriber set
  const runBuild = useCallback(async (subs: Subscriber[], replaceCables = true) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setStatus('clustering');
      const { districts: newDistricts, cables: newCables } = buildNetwork(subs, settings);

      setStatus('routing');
      let finalCables = newCables;

      if (settings.useOSRM) {
        finalCables = await routeCables(
          newCables,
          settings.osrmDelay,
          false,
          (done, total, current) => setOsrmProgress({ done, total, current }),
          controller.signal,
        );
      }

      setStatus('calculating');
      const mats = calculateMaterials(newDistricts, finalCables, settings);
      const issues = validateNetwork(newDistricts, finalCables);

      setDistricts(newDistricts);
      setCables(finalCables);
      setMaterials(mats);
      setValidationIssues(issues);
      setStatus('done');
    } catch (err) {
      if (!controller.signal.aborted) {
        setStatus('error');
        console.error(err);
      }
    }
  }, [settings]);

  // Replace all subscribers — fresh build
  const buildFromSubscribers = useCallback(async (newSubs: Subscriber[], source: string) => {
    const merged = [...newSubs];
    setAllSubscribers(merged);
    const record: ImportRecord = {
      id: newId('imp'),
      source,
      districts: Array.from(new Set(newSubs.map((s) => s.district))),
      count: newSubs.length,
      importedAt: new Date().toISOString(),
    };
    setImportHistory([record]);
    await runBuild(merged);
  }, [runBuild]);

  // Append new subscribers and rebuild combined network
  const appendSubscribers = useCallback(async (newSubs: Subscriber[], source: string) => {
    // Avoid duplicate coordinates
    const seen = new Set(allSubscribers.map((s) => `${s.lat.toFixed(6)},${s.lon.toFixed(6)}`));
    const filtered = newSubs.filter((s) => !seen.has(`${s.lat.toFixed(6)},${s.lon.toFixed(6)}`));
    const merged = [...allSubscribers, ...filtered];
    setAllSubscribers(merged);
    const record: ImportRecord = {
      id: newId('imp'),
      source,
      districts: Array.from(new Set(filtered.map((s) => s.district))),
      count: filtered.length,
      importedAt: new Date().toISOString(),
    };
    setImportHistory((prev) => [...prev, record]);
    await runBuild(merged);
  }, [allSubscribers, runBuild]);

  const stopOSRM = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

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
  const addSubscriberAt = useCallback(async (lat: number, lon: number, district: string, desc: string) => {
    const sub: Subscriber = {
      id: newId('sub'),
      lat, lon, desc, district,
      fibers: { working: 2, spare: 1 },
    };
    const merged = [...allSubscribers, sub];
    setAllSubscribers(merged);
    await runBuild(merged);
  }, [allSubscribers, runBuild]);

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

  const rebuildFromCurrent = useCallback(async () => {
    if (allSubscribers.length > 0) await runBuild(allSubscribers);
  }, [allSubscribers, runBuild]);

  // Projects
  function loadProjects(): Project[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  }

  const listProjects = useCallback((): Project[] => loadProjects(), []);

  const saveProject = useCallback(() => {
    const project: Project = {
      id: projectId,
      name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      districts, cables, annotations, importHistory, settings,
    };
    const projects = loadProjects();
    const idx = projects.findIndex((p) => p.id === projectId);
    if (idx >= 0) {
      projects[idx] = { ...projects[idx], ...project, createdAt: projects[idx].createdAt };
    } else {
      projects.unshift(project);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.slice(0, 50)));
    localStorage.setItem(CURRENT_KEY, projectId);
    setLastSavedAt(new Date().toISOString());
    return project;
  }, [projectId, projectName, districts, cables, annotations, importHistory, settings]);

  function loadProjectInternal(p: Project) {
    setProjectId(p.id);
    setProjectName(p.name);
    setDistricts(p.districts || []);
    setCables(p.cables || []);
    setAnnotations(p.annotations || []);
    setImportHistory(p.importHistory || []);
    setSettings({ ...DEFAULT_SETTINGS, ...p.settings });
    // Reconstruct allSubscribers from districts
    const subs = (p.districts || []).flatMap((d) => d.subscribers);
    setAllSubscribers(subs);
    if (p.districts?.length) {
      const mats = calculateMaterials(p.districts, p.cables, p.settings);
      setMaterials(mats);
      setStatus('done');
    } else {
      setMaterials(null);
      setStatus('idle');
    }
  }

  const loadProject = useCallback((p: Project) => {
    loadProjectInternal(p);
  }, []);

  const deleteProject = useCallback((id: string) => {
    const projects = loadProjects().filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, []);

  const newProject = useCallback(() => {
    setProjectId(newId('proj'));
    setProjectName('Новый проект');
    setDistricts([]);
    setCables([]);
    setAnnotations([]);
    setImportHistory([]);
    setAllSubscribers([]);
    setMaterials(null);
    setValidationIssues([]);
    setStatus('idle');
    localStorage.removeItem(CURRENT_KEY);
  }, []);

  const exportProjectJSON = useCallback(() => {
    const project: Project = {
      id: projectId, name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      districts, cables, annotations, importHistory, settings,
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
    const t = setInterval(() => saveProject(), AUTOSAVE_INTERVAL_MS);
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

  return {
    projectId, projectName, setProjectName,
    districts, cables, annotations, materials, settings, setSettings,
    prices, setPrices: setPricesAndStore,
    importHistory, allSubscribers,
    layers, toggleLayer,
    status, osrmProgress, stopOSRM,
    validationIssues,
    editMode, setEditMode,
    autoSaveEnabled, setAutoSaveEnabled, lastSavedAt,
    buildFromSubscribers, appendSubscribers,
    addAnnotation, updateAnnotation, deleteAnnotation,
    addSubscriberAt, deleteSubscriber, moveEntity, rebuildFromCurrent,
    saveProject, loadProject, deleteProject, listProjects, newProject,
    exportProjectJSON, importProjectJSON,
    totalSubscribers, totalCableKm, totalOrks,
  };
}
