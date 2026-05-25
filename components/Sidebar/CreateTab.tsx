'use client';

import {
  Plus, GitBranch, Lasso, Camera, Link2, MapPin, Package,
} from 'lucide-react';
import type { PlacingMode } from '@/components/Layout/AppHeader';

interface Props {
  readOnly?: boolean;
  placing: PlacingMode;
  onSetPlacing: (m: PlacingMode) => void;
  cableDrawActive: boolean;
  pointCableActive: boolean;
  connectModeActive: boolean;
  onToggleCableDraw: () => void;
  onTogglePointCable: () => void;
  onToggleConnectMode: () => void;
  selecting: boolean;
  selectionCount: number;
  onStartSelection: () => void;
  onFinishSelection: () => void;
  onClearSelection: () => void;
  selectionPoly: boolean;
  showAddCameras: boolean;
  onAddCameras: () => void;
  editMode: boolean;
  onToggleEditMode: () => void;
  showBuild: boolean;
  onBuild: () => void;
}

function ToolBtn({
  active, disabled, onClick, children, title,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-[12px] font-medium transition-colors border ${
        active
          ? 'bg-[#38bdf8]/15 border-[#38bdf8]/50 text-[#38bdf8]'
          : 'border-[#1e3a5f] text-[#e2e8f0] hover:bg-[#1e3a5f]/40 disabled:opacity-40'
      }`}
    >
      {children}
    </button>
  );
}

export default function CreateTab(p: Props) {
  const ro = p.readOnly;

  return (
    <div className="overflow-y-auto h-full p-3 space-y-4">
      <section>
        <h3 className="section-title mb-2">Объекты на карте</h3>
        <p className="text-[10px] text-[#64748b] mb-2">Выберите тип → клик по карте</p>
        <div className="grid grid-cols-2 gap-1.5">
          <ToolBtn active={p.placing === 'olt'} disabled={ro} onClick={() => p.onSetPlacing(p.placing === 'olt' ? null : 'olt')} title="OLT">
            <Plus size={14} className="text-[#f59e0b]" /><span>OLT</span>
          </ToolBtn>
          <ToolBtn active={p.placing === 'tb'} disabled={ro} onClick={() => p.onSetPlacing(p.placing === 'tb' ? null : 'tb')} title="Муфта">
            <span className="text-[#38bdf8]">◆</span><span>Муфта</span>
          </ToolBtn>
          <ToolBtn active={p.placing === 'ork'} disabled={ro} onClick={() => p.onSetPlacing(p.placing === 'ork' ? null : 'ork')} title="ОРК">
            <Package size={14} className="text-[#a78bfa]" /><span>ОРК</span>
          </ToolBtn>
          <ToolBtn active={p.placing === 'box'} disabled={ro} onClick={() => p.onSetPlacing(p.placing === 'box' ? null : 'box')} title="Бокс / камера">
            <Camera size={14} className="text-[#94a3b8]" /><span>Бокс</span>
          </ToolBtn>
        </div>
      </section>

      <section>
        <h3 className="section-title mb-2">Кабели</h3>
        <div className="flex flex-col gap-1.5">
          <ToolBtn active={p.cableDrawActive} disabled={ro} onClick={p.onToggleCableDraw}>
            <GitBranch size={14} /><span>Кабель (узлы)</span>
          </ToolBtn>
          <ToolBtn active={p.pointCableActive} disabled={ro} onClick={p.onTogglePointCable}>
            <MapPin size={14} /><span>Точка A → B</span>
          </ToolBtn>
          <ToolBtn active={p.connectModeActive} disabled={ro} onClick={p.onToggleConnectMode}>
            <Link2 size={14} /><span>Соединить</span>
          </ToolBtn>
        </div>
      </section>

      <section>
        <h3 className="section-title mb-2">Выделение и импорт</h3>
        <div className="flex flex-col gap-1.5">
          {p.selectionPoly ? (
            <ToolBtn onClick={p.onClearSelection}><Lasso size={14} /><span>Снять лассо</span></ToolBtn>
          ) : p.selecting ? (
            <>
              <ToolBtn active onClick={p.onFinishSelection} disabled={p.selectionCount < 3}>
                <Lasso size={14} /><span>Готово ({p.selectionCount})</span>
              </ToolBtn>
              <ToolBtn onClick={p.onClearSelection}>Отмена лассо</ToolBtn>
            </>
          ) : (
            <ToolBtn disabled={ro} onClick={p.onStartSelection}><Lasso size={14} /><span>Лассо</span></ToolBtn>
          )}
          {p.showAddCameras && (
            <ToolBtn disabled={ro} onClick={p.onAddCameras}><Camera size={14} /><span>Добавить камеры</span></ToolBtn>
          )}
        </div>
      </section>

      <section>
        <h3 className="section-title mb-2">Режим</h3>
        <ToolBtn active={p.editMode} disabled={ro} onClick={p.onToggleEditMode}>
          <span>{p.editMode ? '✓' : '○'}</span><span>Редактирование карты</span>
        </ToolBtn>
        {p.showBuild && (
          <div className="mt-1.5">
            <ToolBtn disabled={ro} onClick={p.onBuild}>
              <span className="text-[#fbbf24]">⚒</span><span>Построить сеть</span>
            </ToolBtn>
          </div>
        )}
      </section>
    </div>
  );
}
