'use client';
import { useState } from 'react';
import {
  District, Cable, Materials, LayerVisibility, ValidationIssue,
  MapAnnotation, AnnotationType, Project, ImportRecord, PriceCatalog,
} from '@/types/network';
import LayersTab from './LayersTab';
import MaterialsTab from './MaterialsTab';
import SchemaTab from './SchemaTab';
import GroupsTab from './GroupsTab';
import NotesTab, { DrawingTool } from './NotesTab';
import StatsTab from './StatsTab';
import ProjectsTab from './ProjectsTab';
import CostTab from './CostTab';
import ToolsTab from './ToolsTab';
import BudgetTab from './BudgetTab';
import type { SubBudget, BudgetStats } from '@/components/Network/PowerBudget';
import type { ProjectSnapshot, ProjectStatus } from '@/types/network';

interface Props {
  districts: District[];
  cables: Cable[];
  materials: Materials | null;
  layers: LayerVisibility;
  toggleLayer: (key: keyof LayerVisibility) => void;
  patchLayers?: (patch: Partial<LayerVisibility>) => void;
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
  saveProject: () => Promise<Project> | void;
  loadProject: (p: Project) => Promise<void> | void;
  deleteProject: (id: string) => Promise<void> | void;
  newProject: () => void;
  listProjects: () => Promise<Project[]> | Project[];
  exportProjectJSON: () => void;
  importProjectJSON: (file: File) => Promise<void>;
  importHistory: ImportRecord[];

  prices: PriceCatalog;
  setPrices: (p: PriceCatalog) => void;
  heatmapEnabled: boolean;
  setHeatmapEnabled: (v: boolean) => void;
  onExportPDF: () => void;
  onPrintMap: () => void;
  onRerouteOSRM: () => void;
  onReconsolidate: () => void;
  osrmStatus: string;

  powerBudgets: SubBudget[];
  powerBudgetStats: BudgetStats;
  budgetColoring: boolean;
  setBudgetColoring: (v: boolean) => void;

  projectStatus: ProjectStatus;
  setProjectStatus: (s: ProjectStatus) => void;
  snapshots: ProjectSnapshot[];
  takeSnapshot: (name: string) => ProjectSnapshot;
  restoreSnapshot: (id: string) => void;
  deleteSnapshot: (id: string) => void;
}

type Tab = 'layers' | 'materials' | 'schema' | 'groups' | 'notes' | 'stats' | 'projects' | 'cost' | 'tools' | 'budget';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'layers',    label: 'Слои',     icon: '🗂' },
  { id: 'notes',     label: 'Замет.',   icon: '📝' },
  { id: 'materials', label: 'Матер.',   icon: '📦' },
  { id: 'budget',    label: 'Бюдж.',    icon: '📉' },
  { id: 'cost',      label: 'Цена',     icon: '💰' },
  { id: 'stats',     label: 'Стат.',    icon: '📊' },
  { id: 'tools',     label: 'Инстр.',   icon: '🧰' },
  { id: 'schema',    label: 'Схема',    icon: '🌳' },
  { id: 'groups',    label: 'ОРК',      icon: '👥' },
  { id: 'projects',  label: 'Проекты',  icon: '💾' },
];

export default function Sidebar(props: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('layers');

  return (
    <aside className="w-[300px] flex-shrink-0 bg-[#0d1b2a] border-r border-[#1e3a5f] flex flex-col h-full">
      <div className="flex flex-wrap border-b border-[#1e3a5f] bg-[#0d1b2a]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-[54px] py-1.5 px-1 text-[9px] font-medium transition-all duration-200 flex flex-col items-center gap-0.5 border-b-2 ${
              activeTab === tab.id
                ? 'border-[#38bdf8] bg-[#38bdf8]/10 text-[#38bdf8]'
                : 'border-transparent text-[#64748b] hover:text-[#94a3b8] hover:bg-[#1e3a5f]/20'
            }`}
            title={tab.label}
          >
            <span className="text-sm leading-none">{tab.icon}</span>
            <span className="text-[8px] leading-tight mt-0.5">{tab.label}</span>
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
          <LayersTab districts={props.districts} layers={props.layers} toggleLayer={props.toggleLayer} setLayers={props.patchLayers} />
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
        {activeTab === 'budget' && (
          <BudgetTab
            budgets={props.powerBudgets}
            stats={props.powerBudgetStats}
            districts={props.districts}
            flyTo={props.flyTo}
          />
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
        {activeTab === 'cost' && (
          <CostTab materials={props.materials} prices={props.prices} setPrices={props.setPrices} />
        )}
        {activeTab === 'tools' && (
          <ToolsTab
            onShowHeatmap={() => props.setHeatmapEnabled(!props.heatmapEnabled)}
            heatmapEnabled={props.heatmapEnabled}
            onExportPDF={props.onExportPDF}
            onPrintMap={props.onPrintMap}
            onRerouteOSRM={props.onRerouteOSRM}
            onReconsolidate={props.onReconsolidate}
            osrmStatus={props.osrmStatus}
            hasCables={props.cables.length > 0}
            budgetColoring={props.budgetColoring}
            onToggleBudgetColoring={() => props.setBudgetColoring(!props.budgetColoring)}
          />
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
            projectStatus={props.projectStatus}
            setProjectStatus={props.setProjectStatus}
            snapshots={props.snapshots}
            takeSnapshot={props.takeSnapshot}
            restoreSnapshot={props.restoreSnapshot}
            deleteSnapshot={props.deleteSnapshot}
          />
        )}
      </div>
    </aside>
  );
}
