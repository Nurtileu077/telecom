'use client';
import {
  Upload, Save, FolderOpen, HelpCircle, Undo2, Redo2,
  Pencil, Eye, Sparkles, GitBranch, X, Package, Menu,
} from 'lucide-react';
import Logo from '@/components/Brand/Logo';
import GeocodeSearch from '@/components/Geocoding/GeocodeSearch';
import { PROJECT_STATUS_LABELS, ProjectStatus, type UserRole } from '@/types/network';
import RoleSelector from '@/components/Layout/RoleSelector';

export type PlacingMode = 'olt' | 'tb' | 'ork' | 'box' | null;

interface Props {
  projectName: string;
  onProjectNameChange: (v: string) => void;
  projectStatus: ProjectStatus;
  onProjectStatusChange?: (s: ProjectStatus) => void;
  userRole?: UserRole;
  onUserRoleChange?: (r: UserRole) => void;
  authSlot?: React.ReactNode;
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
  undoHint?: string | null;
  dbEnabled: boolean;
  onCatalog: () => void;
  onProjects: () => void;
  onSave: () => void;
  canSave: boolean;
  branchActive: boolean;
  onClearBranch: () => void;
  onImport: () => void;
  onHelp: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onMenuToggle?: () => void;
  mobileMenuOpen?: boolean;
}

export default function AppHeader(p: Props) {
  return (
    <header className="app-header min-h-12 md:h-14 flex flex-nowrap items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1.5 md:py-0 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0 z-30">
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
      <GeocodeSearch flyTo={p.flyTo} className="hidden sm:block min-w-0 max-w-[140px] lg:max-w-[180px]" />

      <div className="hidden md:flex items-center gap-0.5 shrink-0 border-r border-[var(--border)] pr-2 mr-0.5">
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={p.onUndo}
          disabled={!p.canUndo}
          title={p.undoHint ? `Отменить: ${p.undoHint}` : 'Отменить (Ctrl+Z)'}
        >
          <Undo2 size={16} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={p.onRedo} disabled={!p.canRedo} title="Повторить">
          <Redo2 size={16} />
        </button>
      </div>

      <div className="hidden lg:flex items-center gap-1 flex-wrap shrink min-w-0">
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

      <div className="ml-auto app-header-toolbar flex items-center gap-1 justify-end shrink-0 flex-nowrap">
        <div className="flex md:hidden items-center gap-0.5 shrink-0">
          <button type="button" className="btn btn-ghost btn-icon" onClick={p.onUndo} disabled={!p.canUndo} title="Отменить">
            <Undo2 size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={p.onRedo} disabled={!p.canRedo} title="Повторить">
            <Redo2 size={16} />
          </button>
        </div>
        {p.authSlot}
        <div className="seg hidden lg:flex">
          <button type="button" data-active={!p.editMode} onClick={() => p.editMode && p.onToggleEditMode()}>
            <Eye size={12} className="inline mr-1" />Просмотр
          </button>
          <button type="button" data-active={p.editMode} onClick={() => !p.editMode && p.onToggleEditMode()}>
            <Pencil size={12} className="inline mr-1" />Редакт.
          </button>
        </div>
        {p.branchActive && (
          <button type="button" className="btn btn-secondary text-[11px]" onClick={p.onClearBranch}><GitBranch size={14} />Ветка <X size={12} /></button>
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
