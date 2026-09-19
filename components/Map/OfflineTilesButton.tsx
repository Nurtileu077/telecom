'use client';
import { useEffect, useRef, useState } from 'react';
import { CloudDownload, X, Trash2 } from 'lucide-react';
import {
  tilesForBounds, prefetchTiles, estimateBytes, fmtSize,
  tileCount, clearTiles, TILE_LIMIT, type Bounds,
} from '@/lib/tileCache';

/**
 * Карта на устройство.
 *
 * В поле интернета нет, а карта без тайлов — серый прямоугольник: трасса,
 * колонна и прокол висят в пустоте, и понять, где это, невозможно.
 * Поэтому квадрат вокруг участка скачивается заранее, пока связь есть.
 *
 * Сколько это весит, говорим до скачивания, а не после: «скачиваю карту»
 * без числа — способ незаметно съесть гигабайт чужого трафика.
 */

interface Props {
  /** Что сейчас видно на экране — этот квадрат и скачиваем. */
  getBounds: () => (Bounds & { zoom: number }) | null;
  /** Адрес подложки, как его понимает Leaflet. */
  template: string;
  className?: string;
}

/** На сколько масштабов вглубь: четыре шага — это «видно дома». */
const DEPTH = 3;

export default function OfflineTilesButton({ getBounds, template, className }: Props) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<{ count: number; zooms: number[] } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [have, setHave] = useState<number | null>(null);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    if (!open) return;
    void tileCount().then(setHave);
    const b = getBounds();
    if (!b) { setPlan(null); return; }
    const zooms = Array.from({ length: DEPTH + 1 }, (_, i) => Math.round(b.zoom) + i)
      .filter((z) => z >= 1 && z <= 19);
    setPlan({ count: tilesForBounds(b, zooms).length, zooms });
  }, [open, getBounds]);

  const start = async () => {
    const b = getBounds();
    if (!b || !plan) return;
    abortRef.current = { aborted: false };
    const tiles = tilesForBounds(b, plan.zooms);
    setProgress({ done: 0, total: tiles.length, failed: 0 });
    const res = await prefetchTiles(tiles, template, setProgress, abortRef.current);
    setProgress(res);
    void tileCount().then(setHave);
  };

  const busy = !!progress && progress.done < progress.total && !abortRef.current.aborted;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Скачать карту участка на устройство"
              className={`${className ?? ''} w-9 h-9 rounded-lg bg-[#0c1018ee] border border-[#1e3a5f] text-[#94a3b8] hover:text-[#2dd4bf] flex items-center justify-center`}>
        <CloudDownload size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
             onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-[380px] rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-semibold text-[var(--text)] flex-1">Карта на устройство</h3>
              <button type="button" onClick={() => !busy && setOpen(false)}
                      className="btn btn-ghost btn-icon"><X size={16} /></button>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <p className="text-[12px] text-[var(--text-muted)] leading-snug">
                Скачается то, что сейчас на экране, и четыре масштаба вглубь.
                Дальше карта в этом месте работает без связи.
              </p>

              {plan ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2">
                  <div className="text-[12.5px] text-[var(--text)]">
                    {plan.count.toLocaleString('ru')} тайлов · примерно {fmtSize(estimateBytes(plan.count))}
                  </div>
                  <div className="text-[10.5px] text-[var(--text-muted)]">
                    масштабы {plan.zooms[0]}—{plan.zooms[plan.zooms.length - 1]}
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-[var(--text-muted)]">Карта ещё не готова.</p>
              )}

              {plan && plan.count > 4000 && !progress && (
                <p className="text-[11.5px] text-[var(--warn)]">
                  Это много. Отдалите карту к нужному участку — скачается
                  меньше и быстрее.
                </p>
              )}

              {progress && (
                <div className="flex flex-col gap-1">
                  <div className="h-1.5 rounded-full bg-[var(--bg-canvas)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--accent)] transition-all"
                         style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {progress.done} из {progress.total}
                    {progress.failed > 0 && ` · не скачалось ${progress.failed}`}
                    {!busy && progress.done >= progress.total && ' · готово'}
                  </div>
                </div>
              )}

              {have !== null && (
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  <span>на устройстве {have.toLocaleString('ru')} тайлов</span>
                  {have > 0 && (
                    <button type="button"
                            onClick={() => { void clearTiles().then(() => setHave(0)); }}
                            className="ml-auto text-[var(--text-muted)] hover:text-[var(--danger)] flex items-center gap-1">
                      <Trash2 size={12} />очистить
                    </button>
                  )}
                </div>
              )}
              {have !== null && have > TILE_LIMIT * 0.9 && (
                <p className="text-[11px] text-[var(--warn)]">
                  Память под карту почти занята. Очистите — скачаете то, что
                  нужно сейчас.
                </p>
              )}
            </div>

            <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)]">
              {busy ? (
                <button type="button" className="btn btn-ghost flex-1"
                        onClick={() => { abortRef.current.aborted = true; }}>
                  Остановить
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost flex-1" onClick={() => setOpen(false)}>
                    Закрыть
                  </button>
                  <button type="button" className="btn btn-primary flex-1"
                          disabled={!plan || plan.count === 0} onClick={() => void start()}>
                    Скачать
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
