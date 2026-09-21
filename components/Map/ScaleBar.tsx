'use client';
import { useEffect, useState } from 'react';
import { scaleBar } from '@/components/Construction/mapDecor';

/**
 * Масштабная линейка.
 *
 * Без неё расстояние на карте оценивают на глаз, а глаз на спутнике
 * ошибается в разы: одна и та же картинка может быть полем на километр и
 * двором на тридцать метров. Линейку смотрят и на экране, и на распечатке.
 */

interface Props {
  map: any;
  /** Подпись линейки наружу: её просит печатный лист. */
  onLabel?: (label: string) => void;
  className?: string;
}

/** Метры в пикселе на этой широте и приближении. */
function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

const MAX_PX = 92;

export default function ScaleBar({ map, onLabel, className }: Props) {
  const [mpp, setMpp] = useState<number | null>(null);

  useEffect(() => {
    if (!map) return undefined;
    const read = () => {
      try {
        setMpp(metersPerPixel(map.getCenter().lat, map.getZoom()));
      } catch {
        // Карта ещё не готова — просто подождём следующего события.
      }
    };
    read();
    map.on('zoomend', read);
    map.on('moveend', read);
    return () => {
      map.off('zoomend', read);
      map.off('moveend', read);
    };
  }, [map]);

  const bar = mpp && Number.isFinite(mpp) ? scaleBar(mpp, MAX_PX) : null;

  // Наружу отдаём из эффекта, а не прямо в разметке: запись во время
  // отрисовки — это побочное действие там, где его не ждут.
  const label = bar?.label;
  useEffect(() => { if (label) onLabel?.(label); }, [label, onLabel]);

  if (!bar) return null;

  return (
    <div className={className} aria-label={`Масштаб: ${bar.label}`}>
      <div className="flex items-end gap-1.5 select-none pointer-events-none">
        <div
          className="h-[7px] border-l border-r border-b border-[var(--text)]/70"
          style={{ width: bar.px }}
        />
        <span
          className="text-[10px] leading-none text-[var(--text)] font-medium
                     [text-shadow:0_0_3px_var(--bg-canvas),0_0_3px_var(--bg-canvas)]"
        >
          {bar.label}
        </span>
      </div>
    </div>
  );
}
