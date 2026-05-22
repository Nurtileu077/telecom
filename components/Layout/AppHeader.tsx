'use client';
import {
  Upload, Save, FolderOpen, HelpCircle, Undo2, Redo2, Plus, Camera,
  Pencil, Eye, Sparkles, Hammer, GitBranch, Lasso, X, Package, Menu,
} from 'lucide-react';
import Logo from '@/components/Brand/Logo';
import GeocodeSearch from '@/components/Geocoding/GeocodeSearch';
import EntityIdSearch from '@/components/Search/EntityIdSearch';
import type { District, Cable, InlineJoint } from '@/types/network';
import type { SearchHit } from '@/lib/entitySearch';
import { PROJECT_STATUS_LABELS, ProjectStatus, type UserRole } from '@/types/network';
import RoleSelector from '@/components/Layout/RoleSelector';

export type PlacingMode = 'olt' | 'tb' | 'ork' | null;

interface Props {
  projectName: string;
  onProjectNameChange: (v: string) => void;
  projectStatus: ProjectStatus;
  onProjectStatusChange?: (s: ProjectStatus) => void;
  userRole?: UserRole;
  onUserRoleChange?: (r: UserRole) => void;
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
  totalSubscribers: number;
  totalCableKm: number | string;
  totalOrks: number;
  annotationsCount: number;
  status: string;
  osrmPercent: number;
  lastSavedAt: string | null;
  editMode: boolean;
  onToggleEditMode: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  placing: PlacingMode;
  onSetPlacing: (m: PlacingMode) => void;
  cableDrawActive: boolean;
  pointCableActive: boolean;
  connectModeActive?: boolean;
  undoHint?: string | null;
  onToggleCableDraw: () => void;
  onTogglePointCable: () => void;
  onToggleConnectMode?: () => void;
  dbEnabled: boolean;
  onCatalog: () => void;
  onProjects: () => void;
  onSave: () => void;
  canSave: boolean;
  showBuild: boolean;
  onBuild: () => void;
  branchActive: boolean;
  onClearBranch: () => void;
  selectionPoly: boolean;
  selecting: boolean;
  selectionCount: number;
  onStartSelection: () => void;
  onFinishSelection: () => void;
  onClearSelection: () => void;
  showAddCameras: boolean;
  onAddCameras: () => void;
  onImport: () => void;
  onHelp: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onMenuToggle?: () => void;
  mobileMenuOpen?: boolean;
  districts?: District[];
  cables?: Cable[];
  joints?: InlineJoint[];
  onSearchHit?: (hit: SearchHit) => void;
}

export default function AppHeader(p: Props) {
  return (
    <header className="app-header min-h-12 md:h-14 flex flex-nowrap items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1.5 md:py-0 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0 z-30 overflow-hidden">
      {p.onMenuToggle && (
        <button
          type="button"
          className="btn btn-ghost btn-icon md:hidden shrink-0"
          onClick={p.onMenuToggle}
          aria-label="Открыть меню"
          aria-expanded={p.mobileMenuOpen}
        >
          <Menu size={18} />
        </button>
      )}
      <Logo compact />
      <input
        type="text"
        value={p.projectName}
        onChange={(e) => p.onProjectNameChange(e.target.value)}
        className="input-optiq h-8 md:h-9 px-2 flex-1 min-w-0 max-w-[120px] sm:max-w-[140px] text-xs md:text-sm font-medium bg-transparent border-transparent hover:border-[var(--border-strong)]"
      />
      <select
        value={p.projectStatus}
        disabled={!p.onProjectStatusChange}
        onChange={(e) => p.onProjectStatusChange?.(e.target.value as ProjectStatus)}
        className="input-optiq h-8 text-[10px] md:text-[11px] font-semibold px-1.5 md:px-2 cursor-pointer shrink-0 max-w-[100px] md:max-w-none disabled:opacity-70"
        style={{
          color: PROJECT_STATUS_LABELS[p.projectStatus].color,
          borderColor: `${PROJECT_STATUS_LABELS[p.projectStatus].color}44`,
          background: `${PROJECT_STATUS_LABELS[p.projectStatus].color}14`,
        }}
      >
        {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((s) => (
          <option key={s} value={s}>{PROJECT_STATUS_LABELS[s].label}</option>
        ))}
      </select>

      {p.userRole && p.onUserRoleChange && (
        <div className="relative hidden md:block">
          <RoleSelector role={p.userRole} onRoleChange={p.onUserRoleChange} compact />
        </div>
      )}
      <GeocodeSearch flyTo={p.flyTo} className="hidden sm:block" />
      {p.districts && p.onSearchHit && (
        <EntityIdSearch
          districts={p.districts}
          cables={p.cables ?? []}
          joints={p.joints}
          flyTo={p.flyTo}
          onSelectHit={p.onSearchHit}
          className="hidden md:block"
        />
      )}

      <div className="hidden lg:flex items-center gap-1 flex-wrap">
        <span className="chip chip-accent">{p.totalSubscribers} аб.</span>
        <span className="chip chip-success">{p.totalCableKm} км</span>
        <span className="chip chip-warn">{p.totalOrks} ОРК</span>
        {p.status === 'routing' && <span className="chip chip-violet">OSRM {p.osrmPercent}%</span>}
        {p.lastSavedAt && p.status === 'done' && (
          <span className="chip chip-success">
            {new Date(p.lastSavedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div className="ml-auto app-header-toolbar flex items-center gap-1 justify-end shrink min-w-0">
        <div className="seg hidden xl:flex">
          <button type="button" data-active={!p.editMode} onClick={() => p.editMode && p.onToggleEditMode()}>
            <Eye size={12} className="inline mr-1" />Просмотр
          </button>
          <button type="button" data-active={p.editMode} onClick={() => !p.editMode && p.onToggleEditMode()}>
            <Pencil size={12} className="inline mr-1" />Редакт.
          </button>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={p.onUndo}
          disabled={!p.canUndo}
          title={p.undoHint ? `Отменить: ${p.undoHint}` : 'Ctrl+Z'}
        >
          <Undo2 size={16} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={p.onRedo} disabled={!p.canRedo} title="Ctrl+Shift+Z"><Redo2 size={16} /></button>

        <div className="hidden 2xl:flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)]">
          <button type="button" className={`btn btn-ghost text-[10px] py-1 ${p.placing === 'olt' ? '!bg-[var(--accent-dim)] !text-[var(--accent)]' : ''}`} onClick={() => p.onSetPlacing(p.placing === 'olt' ? null : 'olt')}><Plus size={12} />OLT</button>
          <button type="button" className={`btn btn-ghost text-[10px] py-1 ${p.placing === 'tb' ? '!bg-[var(--accent-dim)] !text-[var(--accent)]' : ''}`} onClick={() => p.onSetPlacing(p.placing === 'tb' ? null : 'tb')}>Муфта</button>
          <button type="button" className={`btn btn-ghost text-[10px] py-1 ${p.placing === 'ork' ? '!bg-[var(--accent-dim)] !text-[var(--accent)]' : ''}`} onClick={() => p.onSetPlacing(p.placing === 'ork' ? null : 'ork')}>ОРК</button>
          <button type="button" className={`btn btn-ghost text-[10px] py-1 ${p.cableDrawActive ? '!bg-[var(--accent-dim)] !text-[var(--accent)]' : ''}`} onClick={p.onToggleCableDraw}>Кабель</button>
          <button type="button" className={`btn btn-ghost text-[10px] py-1 ${p.pointCableActive ? '!bg-[var(--accent-dim)] !text-[var(--accent)]' : ''}`} onClick={p.onTogglePointCable}>A→B</button>
          {p.onToggleConnectMode && (
            <button type="button" className={`btn btn-ghost text-[10px] py-1 ${p.connectModeActive ? '!bg-[var(--success)]/15 !text-[var(--success)]' : ''}`} onClick={p.onToggleConnectMode}>Соединить</button>
          )}
        </div>

        {p.showBuild && (
          <button type="button" className="btn btn-warn hidden lg:flex" onClick={p.onBuild}><Hammer size={14} />Построить</button>
        )}
        {p.branchActive && (
          <button type="button" className="btn btn-secondary text-[11px]" onClick={p.onClearBranch}><GitBranch size={14} />Ветка <X size={12} /></button>
        )}
        {p.selectionPoly ? (
          <button type="button" className="btn btn-secondary text-[11px]" onClick={p.onClearSelection}><Lasso size={14} />Снять</button>
        ) : p.selecting ? (
          <>
            <button type="button" className="btn btn-primary text-[11px]" onClick={p.onFinishSelection} disabled={p.selectionCount < 3}>Готово ({p.selectionCount})</button>
            <button type="button" className="btn btn-ghost text-[11px]" onClick={p.onClearSelection}>Отмена</button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost text-[11px] hidden xl:flex" onClick={p.onStartSelection}><Lasso size={14} />Лассо</button>
        )}
        {p.showAddCameras && (
          <button type="button" className="btn btn-ghost text-[11px] hidden xl:flex" onClick={p.onAddCameras}><Camera size={14} />Камеры</button>
        )}

        <button type="button" className="btn btn-ghost btn-icon hidden sm:flex" onClick={p.onCatalog} disabled={!p.dbEnabled} title="Каталог"><Package size={16} /></button>
        <button type="button" className="btn btn-ghost text-[11px] hidden sm:flex" onClick={p.onProjects}><FolderOpen size={14} />Проекты</button>
        <button type="button" className="btn btn-ghost text-[11px] hidden sm:flex" onClick={p.onSave} disabled={!p.canSave}><Save size={14} />Сохранить</button>
        <button type="button" className="btn btn-primary shrink-0" onClick={p.onImport}>
          <Upload size={16} /><span className="hidden sm:inline">Импорт</span>
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={p.onHelp}><HelpCircle size={16} /></button>
        <button type="button" className={`btn btn-icon ${p.chatOpen ? 'btn-secondary' : 'btn-ghost'}`} onClick={p.onToggleChat} title="AI"><Sparkles size={16} className="text-[var(--accent-2)]" /></button>
      </div>
    </header>
  );
}
