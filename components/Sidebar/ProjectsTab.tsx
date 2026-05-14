'use client';
import { useState, useEffect, useRef } from 'react';
import { Project } from '@/types/network';

interface Props {
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
  importHistory: import('@/types/network').ImportRecord[];
}

export default function ProjectsTab({
  projectId, projectName, lastSavedAt, autoSaveEnabled, setAutoSaveEnabled,
  saveProject, loadProject, deleteProject, newProject, listProjects,
  exportProjectJSON, importProjectJSON, importHistory,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const list = await listProjects();
      setProjects(list);
    })();
  }, [listProjects, refreshTick, lastSavedAt]);

  const refresh = () => setRefreshTick((t) => t + 1);

  return (
    <div className="flex flex-col h-full">
      {/* Current project status */}
      <div className="p-3 border-b border-[#1e3a5f] bg-[#0a0e1a]/50">
        <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-1">Текущий проект</div>
        <div className="text-sm text-[#e2e8f0] font-medium mb-1 truncate">{projectName}</div>
        <div className="text-[10px] text-[#64748b] mb-2">
          {lastSavedAt
            ? `💾 Сохранено: ${new Date(lastSavedAt).toLocaleTimeString('ru')}`
            : '⚠️ Не сохранено'}
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[#94a3b8]">Автосохранение (30с)</span>
          <button
            onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
            className={`w-8 h-4 rounded-full transition-colors relative ${autoSaveEnabled ? 'bg-[#34d399]' : 'bg-[#1e3a5f]'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${autoSaveEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1">
          <button onClick={() => { saveProject(); refresh(); }} className="py-1.5 px-2 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 text-[#38bdf8] text-[10px] rounded transition-colors">
            💾 Сохранить
          </button>
          <button onClick={newProject} className="py-1.5 px-2 border border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0] text-[10px] rounded transition-colors">
            ➕ Новый
          </button>
          <button onClick={exportProjectJSON} className="py-1.5 px-2 border border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0] text-[10px] rounded transition-colors">
            📤 Экспорт JSON
          </button>
          <button onClick={() => fileRef.current?.click()} className="py-1.5 px-2 border border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0] text-[10px] rounded transition-colors">
            📥 Импорт JSON
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden"
                 onChange={(e) => {
                   const f = e.target.files?.[0];
                   if (f) importProjectJSON(f).then(refresh).catch((err) => alert('Ошибка: ' + err.message));
                 }} />
        </div>
      </div>

      {/* Import history */}
      {importHistory.length > 0 && (
        <div className="px-3 py-2 border-b border-[#1e3a5f]/40">
          <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-1">История импортов ({importHistory.length})</div>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {importHistory.slice().reverse().map((rec) => (
              <div key={rec.id} className="text-[10px] flex items-center justify-between">
                <div className="truncate flex-1">
                  <span className="text-[#94a3b8]">📄 {rec.source}</span>
                  <span className="text-[#64748b] ml-1">({rec.count})</span>
                </div>
                <span className="text-[#64748b] flex-shrink-0 ml-1">{new Date(rec.importedAt).toLocaleDateString('ru')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved projects list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2 text-[10px] text-[#64748b] uppercase tracking-wider sticky top-0 bg-[#0d1b2a] z-10">
          Сохранённые ({projects.length})
        </div>
        {projects.length === 0 ? (
          <p className="p-3 text-[10px] text-[#64748b] text-center">Нет сохранённых проектов</p>
        ) : (
          projects.map((p) => {
            const subCount = p.districts.reduce((s, d) => s + d.subscribers.length, 0);
            const isCurrent = p.id === projectId;
            return (
              <div key={p.id} className={`px-3 py-2 border-b border-[#1e3a5f]/30 hover:bg-[#1a2744]/30 transition-colors ${isCurrent ? 'bg-[#38bdf8]/5' : ''}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] flex-shrink-0" />}
                      <span className="text-xs text-[#e2e8f0] font-medium truncate">{p.name}</span>
                    </div>
                    <div className="text-[10px] text-[#64748b] mt-0.5">
                      {p.districts.length} р-нов · {subCount} або. · {(p.annotations?.length || 0)} заметок
                    </div>
                    <div className="text-[9px] text-[#64748b]">
                      {new Date(p.updatedAt).toLocaleString('ru')}
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => loadProject(p)}
                      disabled={isCurrent}
                      className="text-[10px] px-1.5 py-0.5 bg-[#38bdf8]/15 text-[#38bdf8] rounded hover:bg-[#38bdf8]/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Открыть
                    </button>
                    <button
                      onClick={() => { if (confirm(`Удалить «${p.name}»?`)) { deleteProject(p.id); refresh(); } }}
                      className="text-[10px] px-1.5 py-0.5 text-[#f87171] hover:bg-[#f87171]/10 rounded transition-colors"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
