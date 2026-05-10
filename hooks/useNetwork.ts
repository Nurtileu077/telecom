'use client';
import { useState, useCallback, useRef } from 'react';
import { District, Cable, Subscriber, ProjectSettings, Materials, LayerVisibility, DEFAULT_SETTINGS, Project } from '@/types/network';
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

export function useNetwork() {
  const [districts, setDistricts] = useState<District[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [status, setStatus] = useState<BuildStatus>('idle');
  const [osrmProgress, setOsrmProgress] = useState<OSRMProgress>({ done: 0, total: 0, current: '' });
  const [validationIssues, setValidationIssues] = useState<ReturnType<typeof validateNetwork>>([]);
  const [projectName, setProjectName] = useState('Новый проект');
  const abortRef = useRef<AbortController | null>(null);

  const buildFromSubscribers = useCallback(async (subscribers: Subscriber[]) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setStatus('clustering');
      const { districts: newDistricts, cables: newCables } = buildNetwork(subscribers, settings);

      setStatus('routing');
      let finalCables = newCables;

      if (settings.useOSRM) {
        finalCables = await routeCables(
          newCables,
          settings.osrmDelay,
          false,
          (done, total, current) => {
            setOsrmProgress({ done, total, current });
          },
          controller.signal
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

  const stopOSRM = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const saveProject = useCallback(() => {
    const project: Project = {
      id: Date.now().toString(),
      name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      districts,
      cables,
      settings,
    };
    const projects = JSON.parse(localStorage.getItem('gpon-projects') || '[]') as Project[];
    projects.unshift(project);
    localStorage.setItem('gpon-projects', JSON.stringify(projects.slice(0, 20)));
    return project;
  }, [districts, cables, settings, projectName]);

  const loadProject = useCallback((project: Project) => {
    setDistricts(project.districts);
    setCables(project.cables);
    setSettings(project.settings);
    setProjectName(project.name);
    const mats = calculateMaterials(project.districts, project.cables, project.settings);
    setMaterials(mats);
    setStatus('done');
  }, []);

  const toggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const totalSubscribers = districts.reduce((s, d) => s + d.subscribers.length, 0);
  const totalCableKm = Math.round(cables.reduce((s, c) => s + c.lengthM, 0) / 100) / 10;
  const totalOrks = districts.reduce((s, d) => s + d.olt.transitBoxes.reduce((ts, tb) => ts + tb.orks.length, 0), 0);

  return {
    districts, cables, materials, settings, setSettings,
    layers, toggleLayer,
    status, osrmProgress, stopOSRM,
    validationIssues,
    projectName, setProjectName,
    buildFromSubscribers,
    saveProject, loadProject,
    totalSubscribers, totalCableKm, totalOrks,
  };
}
