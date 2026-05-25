'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Project } from '@/types/network';
import { dbListShares, dbShareProject, dbUnshareProject, type ProjectShare } from '@/lib/supabase';

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
  // Sharing UI state (per-project expander).
  const [shareOpenId, setShareOpenId] = useState<string | null>(null);
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const openShare = useCallback(async (id: string) => {
    if (shareOpenId === id) { setShareOpenId(null); return; }
    setShareOpenId(id);
    setShareEmail('');
    setShareMsg(null);
    setShares([]);
    try {
      setShares(await dbListShares(id));
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : 'Не удалось загрузить доступы');
    }
  }, [shareOpenId]);

  const addShare = useCallback(async (id: string) => {
    const email = shareEmail.trim().toLowerCase();
    if (!email.includes('@')) { setShareMsg('Введите корректный email'); return; }
    setShareBusy(true);
    setShareMsg(null);
    try {
      await dbShareProject(id, email);
      setShares(await dbListShares(id));
      setShareEmail('');
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : 'Не удалось выдать доступ');
    } finally {
      setShareBusy(false);
    }
  }, [shareEmail]);

  const removeShare = useCallback(async (id: string, email: string) => {
    setShareBusy(true);
    try {
      await dbUnshareProject(id, email);
      setShares((prev) => prev.filter((s) => s.email !== email));
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : 'Не удалось убрать доступ');
    } finally {
      setShareBusy(false);
    }
  }, []);

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
            <div key={p.id} className={p.id === currentProjectId ? 'bg-[#38bdf8]/5' : ''}>
              <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#1e293b]/40 transition-colors group">
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
                {dbEnabled && (
                  <button
                    onClick={() => openShare(p.id)}
                    title="Поделиться по email"
                    className={`transition-colors text-xs px-2 py-1 rounded border ${
                      shareOpenId === p.id
                        ? 'border-[#38bdf8]/60 text-[#38bdf8] bg-[#38bdf8]/10'
                        : 'border-transparent text-[#64748b] hover:text-[#38bdf8]'
                    }`}
                  >
                    🔗 Доступ
                  </button>
                )}
                <button
                  onClick={() => handleDelete(p.id)}
                  disabled={deleting === p.id}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[#f87171] hover:text-red-400 text-sm px-2 py-1 rounded"
                >
                  {deleting === p.id ? '...' : '✕'}
                </button>
              </div>

              {dbEnabled && shareOpenId === p.id && (
                <div className="px-5 pb-4 pt-1 bg-[#0a0e1a]/60">
                  <div className="text-[11px] text-[#94a3b8] mb-2">
                    Доступ по email — человек увидит и сможет редактировать этот проект,
                    войдя под своим аккаунтом.
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={shareEmail}
                      onChange={(e) => setShareEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addShare(p.id)}
                      placeholder="name@company.kz"
                      className="flex-1 h-9 px-3 text-sm rounded-lg bg-[#0a0e1a] border border-[#1e3a5f] text-[#e2e8f0]"
                    />
                    <button
                      onClick={() => addShare(p.id)}
                      disabled={shareBusy}
                      className="px-3 h-9 rounded-lg bg-[#38bdf8] text-[#0a0e1a] text-xs font-semibold disabled:opacity-50"
                    >
                      {shareBusy ? '…' : 'Дать доступ'}
                    </button>
                  </div>
                  {shareMsg && <div className="text-[11px] text-[#f87171] mt-2">{shareMsg}</div>}
                  <div className="mt-3 space-y-1.5">
                    {shares.length === 0 && (
                      <div className="text-[11px] text-[#475569]">Пока ни с кем не поделились</div>
                    )}
                    {shares.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 text-xs bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg px-2.5 py-1.5">
                        <span className="text-[#e2e8f0] truncate">{s.email}</span>
                        <button
                          onClick={() => removeShare(p.id, s.email)}
                          disabled={shareBusy}
                          className="text-[#f87171] hover:text-red-400 shrink-0 px-1"
                          title="Убрать доступ"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
