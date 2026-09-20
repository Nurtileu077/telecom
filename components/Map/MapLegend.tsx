'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { mapLegend, LegendItem } from '@/components/Construction/mapDecor';
import { ConstructionLayers, RouteColorMode } from '@/components/Construction/mapLayers';

/**
 * Что значат цвета на карте.
 *
 * Пока легенды нет, каждый цвет объясняется наведением мыши по очереди на
 * каждую линию — а вопрос «жёлтая это труба или подвес» задают один раз и
 * ко всей карте. Свёрнута по умолчанию: тем, кто цвета уже помнит, она
 * только закрывает угол.
 */

interface Props {
  layers: ConstructionLayers;
  colorMode: RouteColorMode;
  className?: string;
}

const KEY = 'optiq-legend-open-v1';

function loadOpen(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}

function Swatch({ item }: { item: LegendItem }) {
  if (item.kind === 'line') {
    return (
      <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" className="shrink-0">
        <line
          x1="1" y1="5" x2="21" y2="5"
          stroke={item.color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={item.dash}
        />
      </svg>
    );
  }
  const common = { background: item.color };
  if (item.kind === 'square') {
    return <span className="shrink-0 w-[10px] h-[10px] rounded-[2px]" style={common} />;
  }
  if (item.kind === 'diamond') {
    return (
      <span
        className="shrink-0 w-[9px] h-[9px] rotate-45 rounded-[1px]"
        style={common}
      />
    );
  }
  if (item.kind === 'pin') {
    return <span className="shrink-0 text-[11px] leading-none" style={{ color: item.color }}>⌂</span>;
  }
  return <span className="shrink-0 w-[10px] h-[10px] rounded-full" style={common} />;
}

export default function MapLegend({ layers, colorMode, className }: Props) {
  const [open, setOpen] = useState(false);

  // Состояние читаем после монтирования: на сервере localStorage нет, а
  // разъехавшаяся разметка при гидрации хуже, чем свёрнутая легенда.
  useEffect(() => { setOpen(loadOpen()); }, []);

  const groups = mapLegend(layers, colorMode);
  if (groups.length === 0) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* приватный режим */ }
  }

  return (
    <div className={className}>
      <div
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]/95 backdrop-blur
                   shadow-lg overflow-hidden max-w-[210px]"
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold
                     text-[var(--text)] hover:bg-white/5"
        >
          Легенда
          {open
            ? <ChevronDown size={13} className="ml-auto text-[var(--text-muted)]" />
            : <ChevronUp size={13} className="ml-auto text-[var(--text-muted)]" />}
        </button>

        {open && (
          <div className="px-2.5 pb-2 max-h-[46vh] overflow-y-auto">
            {groups.map((g) => (
              <div key={g.title} className="mt-1.5 first:mt-0">
                <div className="text-[9px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                  {g.title}
                </div>
                <ul className="space-y-[3px]">
                  {g.items.map((it) => (
                    <li key={`${g.title}-${it.label}`} className="flex items-center gap-1.5">
                      <Swatch item={it} />
                      <span className="text-[10.5px] text-[var(--text)] leading-tight">
                        {it.label}
                        {it.note && (
                          <span className="text-[var(--text-muted)]"> — {it.note}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
