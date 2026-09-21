'use client';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Printer, Loader2 } from 'lucide-react';
import { downloadBlob } from '@/lib/download';
import type { LegendGroup } from '@/components/Construction/mapDecor';

/**
 * Карту — в файл и на бумагу.
 *
 * Карту возят с собой распечатанной: в поле нет ни связи, ни зарядки, а
 * согласовывать трассу с акимом и дорожниками надо на листе, который
 * можно положить на капот. Поэтому печать — не «страница как есть», а
 * лист с рамкой, масштабом, легендой и датой: без масштаба распечатка
 * не документ, а картинка.
 *
 * Тот же снимок годится и в отчёт, и в переписку, поэтому рядом кнопка
 * «снимок» — тот же кадр, только файлом.
 */

interface Props {
  /** Что снимаем — контейнер карты. */
  getMapEl: () => HTMLElement | null;
  /** Заголовок листа: область, участок, что показано. */
  title: string;
  legend?: LegendGroup[];
  /** Подпись масштабной линейки, например «5,00 км». */
  scaleLabel?: string;
  className?: string;
}

const SHEET_ID = 'optiq-print-sheet';

/**
 * Снимок карты.
 *
 * Тайлы, взятые из локального хранилища, живут на blob-ссылках, а те
 * освобождаются сразу после отрисовки. Поэтому перед съёмкой возвращаем
 * им сетевые адреса — иначе на снимке будут белые квадраты.
 */
async function capture(el: HTMLElement): Promise<Blob | null> {
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(el, {
    useCORS: true,
    backgroundColor: null,
    scale: Math.min(2, window.devicePixelRatio || 1),
    logging: false,
    onclone: (doc: Document) => {
      doc.querySelectorAll<HTMLImageElement>('img[data-tile-src]').forEach((img) => {
        if (img.src.startsWith('blob:')) img.src = img.dataset.tileSrc ?? img.src;
      });
      // Кнопки и панели поверх карты на снимке не нужны: снимают карту.
      doc.querySelectorAll<HTMLElement>('[data-capture="hide"]').forEach((n) => {
        n.style.visibility = 'hidden';
      });
    },
  });
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

function fileStamp(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
}

export default function MapCapture({
  getMapEl, title, legend, scaleLabel, className,
}: Props) {
  const [busy, setBusy] = useState<'png' | 'print' | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (sheet) URL.revokeObjectURL(sheet); }, [sheet]);

  // После печати лист убираем сами: браузер закрыл диалог — значит всё.
  useEffect(() => {
    const after = () => {
      document.body.removeAttribute('data-optiq-print');
      setSheet((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
    window.addEventListener('afterprint', after);
    return () => window.removeEventListener('afterprint', after);
  }, []);

  const shoot = useCallback(async (mode: 'png' | 'print') => {
    const el = getMapEl();
    if (!el) return;
    setBusy(mode);
    setError(null);
    try {
      const blob = await capture(el);
      if (!blob) throw new Error('пустой кадр');
      if (mode === 'png') {
        downloadBlob(`optiq_карта_${fileStamp()}.png`, blob);
        return;
      }
      const url = URL.createObjectURL(blob);
      setSheet(url);
      document.body.setAttribute('data-optiq-print', '1');
      // Даём кадру попасть в разметку до того, как откроется диалог.
      window.setTimeout(() => window.print(), 120);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'не получилось снять карту');
      window.setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(null);
    }
  }, [getMapEl]);

  return (
    <>
      <div className={className} data-capture="hide">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => shoot('png')}
            disabled={busy !== null}
            title="Снимок карты в PNG — в отчёт или в переписку"
            aria-label="Снимок карты"
            className="px-2 py-1.5 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a] text-[#94a3b8]
                       hover:text-[#e2e8f0] shadow-lg disabled:opacity-50"
          >
            {busy === 'png' ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
          </button>
          <button
            type="button"
            onClick={() => shoot('print')}
            disabled={busy !== null}
            title="Печать карты — лист с рамкой, масштабом и легендой"
            aria-label="Печать карты"
            className="px-2 py-1.5 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a] text-[#94a3b8]
                       hover:text-[#e2e8f0] shadow-lg disabled:opacity-50"
          >
            {busy === 'print' ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
          </button>
        </div>
        {error && (
          <div className="mt-1 px-2 py-1 rounded bg-[#0d1b2a] border border-[#f87171]/50
                          text-[10px] text-[#f87171] max-w-[180px]">
            Снимок не получился: {error}. Если карта скачана на устройство,
            попробуйте при связи.
          </div>
        )}
      </div>

      {sheet && typeof document !== 'undefined' && createPortal(
        <div id={SHEET_ID} className="optiq-print-sheet">
          <div className="ps-head">
            <div className="ps-title">{title}</div>
            <div className="ps-meta">
              {new Date().toLocaleString('ru')}
              {scaleLabel ? ` · масштабная линейка ${scaleLabel}` : ''}
            </div>
          </div>
          <img src={sheet} alt="" className="ps-map" />
          {legend && legend.length > 0 && (
            <div className="ps-legend">
              {legend.map((g) => (
                <div key={g.title} className="ps-legend-group">
                  <b>{g.title}</b>
                  {g.items.map((it) => (
                    <span key={it.label} className="ps-legend-item">
                      <i style={{ background: it.color }} />
                      {it.label}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="ps-foot">Optiq · ТОО «СК Фаворит Инжиниринг»</div>
        </div>,
        document.body,
      )}
    </>
  );
}
