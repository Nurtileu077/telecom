'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Project } from '@/types/network';

interface Props {
  onLoad: (p: Project) => void;
  onNew: () => void;
  onClose: () => void;
  listProjects: () => Promise<Project[]>;
  deleteProject: (id: string) => Promise<void>;
  currentProjectId: string;
  dbEnabled: boolean;
}

export default function ProjectListModal({
  onLoad, onNew, onClose, listProjects, deleteProject, currentProjectId, dbEnabled,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listProjects();
      setProjects(list);
    } finally {
      setLoading(false);
    }
  }, [listProjects]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить проект?')) return;
    setDeleting(id);
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0f1623] border border-[#1e293b] rounded-xl w-full max-w-lg mx-4 shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e293b]">
          <div>
            <h2 className="text-white font-semibold text-base">Мои проекты</h2>
            <p className="text-[10px] text-[#64748b] mt-0.5">
              {dbEnabled ? '☁ Supabase' : '💾 localStorage'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onNew}
              className="px-3 py-1.5 rounded-lg bg-[#38bdf8]/10 text-[#38bdf8] text-xs font-medium hover:bg-[#38bdf8]/20 transition-colors"
            >
              + Новый
            </button>
            <button onClick={onClose} className="text-[#64748b] hover:text-white transition-colors text-lg leading-none px-1">×</button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 divide-y divide-[#1e293b]">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && projects.length === 0 && (
            <div className="text-center text-[#64748b] text-sm py-12">
              Нет сохранённых проектов
            </div>
          )}
          {!loading && projects.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 px-5 py-3.5 hover:bg-[#1e293b]/40 transition-colors group ${p.id === currentProjectId ? 'bg-[#38bdf8]/5' : ''}`}
            >
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { onLoad(p); onClose(); }}>
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium truncate">{p.name || 'Без названия'}</span>
                  {p.id === currentProjectId && (
                    <span className="text-[10px] text-[#38bdf8] bg-[#38bdf8]/10 px-1.5 py-0.5 rounded">открыт</span>
                  )}
                </div>
                <div className="text-[11px] text-[#64748b] mt-0.5 flex gap-3">
                  <span>{p.districts?.length ?? 0} районов</span>
                  <span>{p.districts?.reduce((s, d) => s + d.subscribers.length, 0) ?? 0} абонентов</span>
                  <span>{fmt(p.updatedAt)}</span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(p.id)}
                disabled={deleting === p.id}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[#f87171] hover:text-red-400 text-sm px-2 py-1 rounded"
              >
                {deleting === p.id ? '...' : '✕'}
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1e293b] text-[11px] text-[#475569]">
          {projects.length} проект(ов)
        </div>
      </div>
    </div>
  );
}
