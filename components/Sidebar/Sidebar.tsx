'use client';
import { useState } from 'react';
import {
  Layers, StickyNote, Package, LineChart, Wallet, BarChart3, Wrench,
  GitBranch, Users, FolderOpen,
} from 'lucide-react';
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
import GeocodeSearch from '@/components/Geocoding/GeocodeSearch';
import BudgetTab from './BudgetTab';
import type { SubBudget, BudgetStats } from '@/components/Network/PowerBudget';
import type {
  ProjectSnapshot, ProjectStatus, InlineJoint, ProjectSettings, ProjectScenarios, AuditEntry,
} from '@/types/network';
import DashboardTab from './DashboardTab';
import type { SearchHit } from '@/lib/entitySearch';
import EntityIdSearch from '@/components/Search/EntityIdSearch';
import type { BBox } from '@/components/Network/Selection';

type Tab = 'layers' | 'materials' | 'schema' | 'groups' | 'notes' | 'dashboard' | 'stats' | 'projects' | 'cost' | 'tools' | 'budget';

type Group = 'map' | 'network' | 'analytics' | 'workflow';

const GROUPS: { id: Group; label: string; icon: typeof Layers; tabs: { id: Tab; label: string }[] }[] = [
  { id: 'map', label: 'Карта', icon: Layers, tabs: [
    { id: 'layers', label: 'Слои' },
    { id: 'notes', label: 'Заметки' },
  ]},
  { id: 'network', label: 'Сеть', icon: GitBranch, tabs: [
    { id: 'materials', label: 'Материалы' },
    { id: 'groups', label: 'ОРК' },
    { id: 'schema', label: 'Схема' },
  ]},
  { id: 'analytics', label: 'Анализ', icon: BarChart3, tabs: [
    { id: 'dashboard', label: 'Сводка' },
    { id: 'stats', label: 'Статистика' },
    { id: 'budget', label: 'Бюджет' },
    { id: 'cost', label: 'Стоимость' },
  ]},
  { id: 'workflow', label: 'Процесс', icon: Wrench, tabs: [
    { id: 'tools', label: 'Инструменты' },
    { id: 'projects', label: 'Проекты' },
  ]},
];

interface Props {
  districts: District[];
  cables: Cable[];
  joints?: InlineJoint[];
  selectionBBox?: BBox | null;
  selectionPoly?: [number, number][] | null;
  cableReserve?: number;
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
  saveProject: () => Promise<Project | void> | void;
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
  hasNetwork: boolean;
  settings?: ProjectSettings;
  scenarios?: ProjectScenarios;
  saveScenarioSlot?: (slot: 'a' | 'b') => void;
  restoreScenarioSlot?: (slot: 'a' | 'b') => void;
  readOnly?: boolean;
  onCopyShareViewLink?: () => void;
  onSearchHit?: (hit: SearchHit) => void;
  auditLog?: AuditEntry[];
  onCopyShareFieldLink?: () => void;
  scenarioDiffOn?: boolean;
  onToggleScenarioDiff?: () => void;
  onMobileClose?: () => void;
  /** Не закрывать drawer при переключении вкладок (мобилка). */
  mobilePersist?: boolean;
}

export default function Sidebar({ onMobileClose, mobilePersist, ...props }: Props) {
  const [group, setGroup] = useState<Group>('map');
  const [activeTab, setActiveTab] = useState<Tab>('layers');

  const currentGroup = GROUPS.find((g) => g.id === group)!;

  const selectGroup = (g: Group) => {
    setGroup(g);
    const first = GROUPS.find((x) => x.id === g)!.tabs[0].id;
    setActiveTab(first);
    if (!mobilePersist) onMobileClose?.();
  };

  const selectTab = (id: Tab) => {
    setActiveTab(id);
    if (!mobilePersist) onMobileClose?.();
  };

  const pipelineStep = props.hasNetwork ? (props.osrmStatus === 'routing' ? 2 : 3) : props.materials ? 1 : 0;

  return (
    <aside className="flex shrink-0 h-full border-r border-[var(--border)] bg-[var(--bg-surface)] max-md:h-[100dvh]">
      <nav className="w-11 md:w-12 flex flex-col items-center py-2 gap-1 border-r border-[var(--border)] bg-[var(--bg-canvas)] shrink-0">
        {GROUPS.map((g) => {
          const Icon = g.icon;
          const active = group === g.id;
          return (
            <button
              key={g.id}
              type="button"
              title={g.label}
              onClick={() => selectGroup(g.id)}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all relative ${
                active ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-[var(--accent)] rounded-r" />}
              <Icon size={18} strokeWidth={1.75} />
            </button>
          );
        })}
      </nav>

      <div className="w-[min(268px,calc(100vw-44px))] md:w-[268px] flex flex-col min-w-0 flex-1">
        <div className="px-3 py-2 border-b border-[var(--border)] flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
          <p className="section-title">{currentGroup.label}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {currentGroup.tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTab(t.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  activeTab === t.id
                    ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                    : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          </div>
          {onMobileClose && (
            <button
              type="button"
              onClick={onMobileClose}
              className="md:hidden shrink-0 w-8 h-8 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
              aria-label="Закрыть меню"
            >
              ×
            </button>
          )}
        </div>

        {group === 'workflow' && (
          <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-canvas)]/50">
            <p className="section-title mb-2">Пайплайн</p>
            {['Импорт', 'Построение', 'OSRM', 'Слияние'].map((label, i) => (
              <div key={label} className="flex items-center gap-2 py-1">
                <span className={`stepper-dot ${i < pipelineStep ? 'done' : i === pipelineStep ? 'active' : 'pending'}`}>
                  {i < pipelineStep ? '✓' : i + 1}
                </span>
                <span className="text-[11px] text-[var(--text-2)]">{label}</span>
              </div>
            ))}
          </div>
        )}

        {props.validationIssues.length > 0 && activeTab !== 'stats' && (
          <button
            type="button"
            onClick={() => { setGroup('analytics'); setActiveTab('stats'); }}
            className="mx-2 mt-2 px-2 py-1.5 rounded-lg text-left chip chip-warn w-[calc(100%-16px)]"
          >
            {props.validationIssues.length} предупреждений →
          </button>
        )}

        <div className="md:hidden px-3 py-2 border-b border-[var(--border)] space-y-2">
          <GeocodeSearch flyTo={props.flyTo} className="relative block w-full" />
          {props.onSearchHit && (
            <EntityIdSearch
              districts={props.districts}
              cables={props.cables}
              joints={props.joints}
              flyTo={props.flyTo}
              onSelectHit={props.onSearchHit}
              className="relative block w-full"
            />
          )}
        </div>

        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
          {activeTab === 'layers' && <LayersTab districts={props.districts} layers={props.layers} toggleLayer={props.toggleLayer} />}
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
            <MaterialsTab materials={props.materials} districts={props.districts} cables={props.cables} joints={props.joints} selectionBBox={props.selectionBBox} selectionPoly={props.selectionPoly} cableReserve={props.cableReserve} />
          )}
          {activeTab === 'budget' && <BudgetTab budgets={props.powerBudgets} stats={props.powerBudgetStats} districts={props.districts} flyTo={props.flyTo} />}
          {activeTab === 'dashboard' && (
            <DashboardTab
              districts={props.districts}
              cables={props.cables}
              issues={props.validationIssues}
              materials={props.materials}
              prices={props.prices}
              projectStatus={props.projectStatus}
              scenarios={props.scenarios ?? {}}
              auditLog={props.auditLog ?? []}
              lastSavedAt={props.lastSavedAt}
            />
          )}
          {activeTab === 'stats' && <StatsTab districts={props.districts} cables={props.cables} issues={props.validationIssues} />}
          {activeTab === 'schema' && <SchemaTab districts={props.districts} flyTo={props.flyTo} />}
          {activeTab === 'groups' && <GroupsTab districts={props.districts} flyTo={props.flyTo} />}
          {activeTab === 'cost' && (
            <CostTab
              materials={props.materials}
              prices={props.prices}
              setPrices={props.setPrices}
              districts={props.districts}
              cables={props.cables}
              joints={props.joints}
              settings={props.settings}
            />
          )}
          {activeTab === 'tools' && (
            <ToolsTab
              projectId={props.projectId}
              districts={props.districts}
              cables={props.cables}
              annotations={props.annotations}
              scenarios={props.scenarios}
              settings={props.settings}
              prices={props.prices}
              onSaveScenarioA={props.saveScenarioSlot ? () => props.saveScenarioSlot!('a') : undefined}
              onSaveScenarioB={props.saveScenarioSlot ? () => props.saveScenarioSlot!('b') : undefined}
              onRestoreScenarioA={props.restoreScenarioSlot ? () => props.restoreScenarioSlot!('a') : undefined}
              onRestoreScenarioB={props.restoreScenarioSlot ? () => props.restoreScenarioSlot!('b') : undefined}
              readOnly={props.readOnly}
              onCopyShareViewLink={props.onCopyShareViewLink}
              onCopyShareFieldLink={props.onCopyShareFieldLink}
              scenarioDiffOn={props.scenarioDiffOn}
              onToggleScenarioDiff={props.onToggleScenarioDiff}
              onShowHeatmap={() => props.setHeatmapEnabled(!props.heatmapEnabled)}
              heatmapEnabled={props.heatmapEnabled}
              onExportPDF={props.onExportPDF}
              onPrintMap={props.onPrintMap}
              onRerouteOSRM={props.onRerouteOSRM}
              onReconsolidate={props.onReconsolidate}
              selectionBBox={props.selectionBBox}
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

        {mobilePersist && onMobileClose && (
          <div className="md:hidden shrink-0 p-3 border-t border-[var(--border)] bg-[var(--bg-canvas)]">
            <button
              type="button"
              onClick={onMobileClose}
              className="w-full py-2.5 rounded-xl bg-[var(--accent)] text-[#041016] text-sm font-semibold"
            >
              ← На карту
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
