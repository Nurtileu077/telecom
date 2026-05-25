'use client';
import { Home, LayoutGrid, Plus, Share2 } from 'lucide-react';

interface Props {
  menuOpen: boolean;
  onHome: () => void;
  onMenu: () => void;
  onAdd: () => void;
  onShare: () => void;
}

export default function MobileDock({ menuOpen, onHome, onMenu, onAdd, onShare }: Props) {
  return (
    <nav className="mobile-dock md:hidden" aria-label="Навигация">
      <button type="button" onClick={onHome} aria-label="Домой — карта">
        <Home size={22} strokeWidth={2} />
        <span>Домой</span>
      </button>
      <button type="button" data-active={menuOpen} onClick={onMenu} aria-label="Меню и слои">
        <LayoutGrid size={22} strokeWidth={2} />
        <span>Меню</span>
      </button>
      <button type="button" className="mobile-dock-fab" onClick={onAdd} aria-label="Добавить">
        <Plus size={26} strokeWidth={2.5} />
      </button>
      <button type="button" onClick={onShare} aria-label="Поделиться">
        <Share2 size={22} strokeWidth={2} />
        <span>Поделиться</span>
      </button>
    </nav>
  );
}
