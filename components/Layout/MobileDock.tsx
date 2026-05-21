'use client';
import { Menu, Pencil, Upload, Layers, Sparkles } from 'lucide-react';

interface Props {
  menuOpen: boolean;
  editMode: boolean;
  chatOpen?: boolean;
  onMenu: () => void;
  onToggleEdit: () => void;
  onImport: () => void;
  onLayers: () => void;
  onChat?: () => void;
}

export default function MobileDock({
  menuOpen, editMode, chatOpen, onMenu, onToggleEdit, onImport, onLayers, onChat,
}: Props) {
  return (
    <nav className="mobile-dock md:hidden" aria-label="Быстрые действия">
      <button type="button" data-active={menuOpen} onClick={onMenu} aria-label="Меню">
        <Menu size={20} />
        <span>Меню</span>
      </button>
      <button type="button" data-active={editMode} onClick={onToggleEdit} aria-label="Редактирование">
        <Pencil size={20} />
        <span>Редакт.</span>
      </button>
      <button type="button" onClick={onLayers} aria-label="Слои и инструменты">
        <Layers size={20} />
        <span>Слои</span>
      </button>
      <button type="button" onClick={onImport} aria-label="Импорт">
        <Upload size={20} />
        <span>Импорт</span>
      </button>
      {onChat && (
        <button type="button" data-active={chatOpen} onClick={onChat} aria-label="AI помощник">
          <Sparkles size={20} />
          <span>AI</span>
        </button>
      )}
    </nav>
  );
}
