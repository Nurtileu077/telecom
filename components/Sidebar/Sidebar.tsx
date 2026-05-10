'use client';
import { useState } from 'react';
import {
  District, Cable, Materials, LayerVisibility, ValidationIssue,
  MapAnnotation, AnnotationType, Project, ImportRecord,
} from '@/types/network';
import LayersTab from './LayersTab';
import MaterialsTab from './MaterialsTab';
import SchemaTab from './SchemaTab';
import GroupsTab from './GroupsTab';
import NotesTab, { DrawingTool } from './NotesTab';
import StatsTab from './StatsTab';
import ProjectsTab from './ProjectsTab';

interface Props {
  districts: District[];
  cables: Cable[];
  materials: Materials | null;
  layers: LayerVisibility;
  toggleLayer: (key: keyof LayerVisibility) => void;
  validationIssues: ValidationIssue[];
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;

  annotations: MapAnnotation[];
  updateAnnotation: (id: string, patch: Partial<MapAnnotation>) => void;
  deleteAnnotation: (id: string) => void;
  activeTool: DrawingTool;
  setActiveTool: (t: DrawingTool) => void;
  activeAnnotationType: AnnotationType;
  setActiveAnnotationType: (t: AnnotationType) => void;

  projectId: string;
  projectName: string;
  lastSavedAt: string | null;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: (v: boolean) => void;
  saveProject: () => void;
  loadProject: (p: Project) => void;
  deleteProject: (id: string) => void;
  newProject: () => void;
  listProjects: () => Project[];
  exportProjectJSON: () => void;
  importProjectJSON: (file: File) => Promise<void>;
  importHistory: ImportRecord[];
}

type Tab = 'layers' | 'materials' | 'schema' | 'groups' | 'notes' | 'stats' | 'projects';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'layers',    label: 'Слои',     icon: '🗂' },
  { id: 'notes',     label: 'Заметки',  icon: '📝' },
  { id: 'materials', label: 'Матер.',   icon: '📦' },
  { id: 'stats',     label: 'Стат.',    icon: '📊' },
  { id: 'schema',    label: 'Схема',    icon: '🌳' },
  { id: 'groups',    label: 'ОРК',      icon: '👥' },
  { id: 'projects',  label: 'Проекты',  icon: '💾' },
];

export default function Sidebar(props: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('layers');

  return (
    <aside className="w-[300px] flex-shrink-0 bg-[#0d1b2a] border-r border-[#1e3a5f] flex flex-col h-full">
      <div className="grid grid-cols-7 border-b border-[#1e3a5f] gap-px bg-[#1e3a5f]/30">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-2 px-1 text-[9px] font-medium transition-all duration-200 flex flex-col items-center gap-0.5 ${
              activeTab === tab.id
                ? 'bg-[#38bdf8]/10 text-[#38bdf8]'
                : 'bg-[#0d1b2a] text-[#64748b] hover:text-[#94a3b8]'
            }`}
            title={tab.label}
          >
            <span className="text-sm">{tab.icon}</span>
            <span className="text-[8px]">{tab.label}</span>
          </button>
        ))}
      </div>

      {props.validationIssues.length > 0 && activeTab !== 'stats' && (
        <button
          onClick={() => setActiveTab('stats')}
          className="mx-2 mt-2 px-2 py-1 bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-md text-left hover:bg-[#f59e0b]/15 transition-colors"
        >
          <p className="text-[10px] text-[#f59e0b]">
            ⚠️ {props.validationIssues.length} предупреждений — открыть →
          </p>
        </button>
      )}

      <div className="flex-1 overflow-hidden">
        {activeTab === 'layers' && (
          <LayersTab districts={props.districts} layers={props.layers} toggleLayer={props.toggleLayer} />
        )}
        {activeTab === 'notes' && (
          <NotesTab
            annotations={props.annotations}
            updateAnnotation={props.updateAnnotation}
            deleteAnnotation={props.deleteAnnotation}
            activeTool={props.activeTool}
            setActiveTool={props.setActiveTool}
            activeAnnotationType={props.activeAnnotationType}
            setActiveAnnotationType={props.setActiveAnnotationType}
            flyTo={props.flyTo}
          />
        )}
        {activeTab === 'materials' && (
          <MaterialsTab materials={props.materials} districts={props.districts} cables={props.cables} />
        )}
        {activeTab === 'stats' && (
          <StatsTab districts={props.districts} cables={props.cables} issues={props.validationIssues} />
        )}
        {activeTab === 'schema' && (
          <SchemaTab districts={props.districts} flyTo={props.flyTo} />
        )}
        {activeTab === 'groups' && (
          <GroupsTab districts={props.districts} flyTo={props.flyTo} />
        )}
        {activeTab === 'projects' && (
          <ProjectsTab
            projectId={props.projectId}
            projectName={props.projectName}
            lastSavedAt={props.lastSavedAt}
            autoSaveEnabled={props.autoSaveEnabled}
            setAutoSaveEnabled={props.setAutoSaveEnabled}
            saveProject={props.saveProject}
            loadProject={props.loadProject}
            deleteProject={props.deleteProject}
            newProject={props.newProject}
            listProjects={props.listProjects}
            exportProjectJSON={props.exportProjectJSON}
            importProjectJSON={props.importProjectJSON}
            importHistory={props.importHistory}
          />
        )}
      </div>
    </aside>
  );
}
