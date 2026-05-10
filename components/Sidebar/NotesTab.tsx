'use client';
import { useState } from 'react';
import { MapAnnotation, AnnotationType, ANNOTATION_PRESETS } from '@/types/network';

export type DrawingTool = 'point' | 'polygon' | 'line' | 'circle' | null;

interface Props {
  annotations: MapAnnotation[];
  updateAnnotation: (id: string, patch: Partial<MapAnnotation>) => void;
  deleteAnnotation: (id: string) => void;
  activeTool: DrawingTool;
  setActiveTool: (t: DrawingTool) => void;
  activeAnnotationType: AnnotationType;
  setActiveAnnotationType: (t: AnnotationType) => void;
  flyTo: ((lat: number, lon: number, zoom?: number) => void) | null;
}

export default function NotesTab({
  annotations, updateAnnotation, deleteAnnotation,
  activeTool, setActiveTool, activeAnnotationType, setActiveAnnotationType,
  flyTo,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [filter, setFilter] = useState<AnnotationType | 'all'>('all');

  const filtered = filter === 'all' ? annotations : annotations.filter((a) => a.type === filter);

  const startEdit = (a: MapAnnotation) => {
    setEditing(a.id);
    setEditName(a.name);
    setEditDesc(a.description);
  };

  const saveEdit = () => {
    if (editing) {
      updateAnnotation(editing, { name: editName, description: editDesc });
      setEditing(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Drawing toolbar */}
      <div className="p-2 border-b border-[#1e3a5f]">
        <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-2">Тип заметки</div>
        <div className="grid grid-cols-3 gap-1 mb-2">
          {(Object.keys(ANNOTATION_PRESETS) as AnnotationType[]).map((type) => {
            const preset = ANNOTATION_PRESETS[type];
            const isActive = activeAnnotationType === type;
            return (
              <button
                key={type}
                onClick={() => setActiveAnnotationType(type)}
                className={`p-1.5 rounded-md text-[10px] transition-all ${isActive ? 'bg-[#38bdf8]/10 border border-[#38bdf8]/50' : 'border border-[#1e3a5f] hover:border-[#1e3a5f]/80'}`}
                title={preset.label}
              >
                <div className="text-base">{preset.icon}</div>
                <div className="text-[9px] text-[#94a3b8] truncate">{preset.label}</div>
              </button>
            );
          })}
        </div>

        <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-1 mt-2">Инструмент</div>
        <div className="grid grid-cols-4 gap-1">
          {([
            { tool: 'point' as const, icon: '📍', label: 'Точка' },
            { tool: 'polygon' as const, icon: '⬛', label: 'Область' },
            { tool: 'line' as const, icon: '〰', label: 'Линия' },
            { tool: 'circle' as const, icon: '◯', label: 'Круг' },
          ]).map(({ tool, icon, label }) => (
            <button
              key={tool}
              onClick={() => setActiveTool(activeTool === tool ? null : tool)}
              className={`p-1.5 rounded-md text-[10px] transition-all ${activeTool === tool ? 'bg-[#34d399]/15 border border-[#34d399]/50 text-[#34d399]' : 'border border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
              title={label}
            >
              <div className="text-sm">{icon}</div>
            </button>
          ))}
        </div>
        {activeTool && (
          <div className="mt-2 text-[10px] text-[#34d399]">
            ✏️ Кликайте по карте, чтобы рисовать. ESC = отмена.
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="p-2 border-b border-[#1e3a5f] flex gap-1 overflow-x-auto">
        <button
          onClick={() => setFilter('all')}
          className={`px-2 py-0.5 rounded-md text-[10px] flex-shrink-0 ${filter === 'all' ? 'bg-[#38bdf8]/15 text-[#38bdf8]' : 'text-[#64748b] hover:text-[#94a3b8]'}`}
        >
          Все ({annotations.length})
        </button>
        {(Object.keys(ANNOTATION_PRESETS) as AnnotationType[]).map((t) => {
          const count = annotations.filter((a) => a.type === t).length;
          if (count === 0) return null;
          return (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-2 py-0.5 rounded-md text-[10px] flex-shrink-0 ${filter === t ? 'bg-[#38bdf8]/15 text-[#38bdf8]' : 'text-[#64748b] hover:text-[#94a3b8]'}`}
            >
              {ANNOTATION_PRESETS[t].icon} {count}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <div className="text-3xl mb-2">📝</div>
            <p className="text-sm text-[#94a3b8] mb-1">Заметок пока нет</p>
            <p className="text-[10px] text-[#64748b]">Выберите тип и инструмент выше, затем рисуйте на карте</p>
          </div>
        ) : (
          filtered.map((a) => {
            const preset = ANNOTATION_PRESETS[a.type];
            const isEditing = editing === a.id;
            const first = a.coords[0];
            return (
              <div key={a.id} className="border-b border-[#1e3a5f]/40 p-2 hover:bg-[#1a2744]/30 transition-colors">
                <div className="flex items-start gap-2">
                  <span className="text-base flex-shrink-0">{preset.icon}</span>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] mb-1 focus:outline-none focus:border-[#38bdf8]"
                          autoFocus
                          placeholder="Название"
                        />
                        <textarea
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          rows={2}
                          className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-[10px] text-[#94a3b8] mb-1 focus:outline-none focus:border-[#38bdf8] resize-none"
                          placeholder="Описание (необязательно)"
                        />
                        <div className="flex gap-1">
                          <button onClick={saveEdit} className="px-2 py-0.5 bg-[#34d399]/15 text-[#34d399] text-[10px] rounded">✓ Сохр</button>
                          <button onClick={() => setEditing(null)} className="px-2 py-0.5 text-[#64748b] text-[10px] rounded">Отм</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => first && flyTo?.(first[0], first[1], 17)}
                          className="text-xs text-[#e2e8f0] font-medium hover:text-[#38bdf8] transition-colors block text-left truncate w-full"
                        >
                          {a.name || '(без названия)'}
                        </button>
                        {a.description && (
                          <p className="text-[10px] text-[#64748b] mt-0.5 line-clamp-2">{a.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[9px] text-[#64748b]">
                          <span>{preset.label}</span>
                          <span>•</span>
                          <span>{a.shape}</span>
                        </div>
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => startEdit(a)} className="text-[#64748b] hover:text-[#38bdf8] transition-colors p-0.5" title="Редактировать">✎</button>
                      <button onClick={() => deleteAnnotation(a.id)} className="text-[#64748b] hover:text-[#f87171] transition-colors p-0.5" title="Удалить">×</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
