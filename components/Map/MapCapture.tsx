'use client';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Printer, Loader2 } from 'lucide-react';
import { downloadBlob } from '@/lib/download';
import type { LegendGroup } from '@/components/Construction/mapDecor';
import {
  layoutSheet, coordGrid, sheetNotes, pageCss, scaleText, perCmText, snapshotBar,
  parsePrintOptions, ORIENTATION_LABEL,
  type MapView, type PrintOptions, type SheetLayout, type CoordGrid, type PaperBar,
} from './printSheet';

/**
 * Карту — в файл и на бумагу.
 *
 * Карту возят с собой распечатанной: в поле нет ни связи, ни зарядки, а
 * согласовывать трассу с акимом и дорожниками надо на листе, который
 * можно положить на капот. Поэтому печать — не «страница как есть», а
 * лист с рамкой, масштабом 1:N, линейкой, сеткой, легендой и датой: без
 * масштаба распечатка не документ, а картинка.
 *
 * Тот же снимок годится и в отчёт, и в переписку, поэтому рядом кнопка
 * «снимок» — тот же кадр, только файлом и со своей линейкой.
 */

interface Props {
  /** Что снимаем — контейнер карты. */
  getMapEl: () => HTMLElement | null;
  /** Что показано: середина, зум, рамка и размер карты на экране. */
  getView: () => MapView | null;
  /** Заголовок листа: область, участок, что показано. */
  title: string;
  legend?: LegendGroup[];
  className?: string;
}

const SHEET_ID = 'optiq-print-sheet';
const PREFS_KEY = 'optiq-map-print-v1';

function loadOptions(): PrintOptions {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return parsePrintOptions(raw ? JSON.parse(raw) : null);
  } catch {
    return parsePrintOptions(null);
  }
}

function saveOptions(o: PrintOptions): void {
  // Не запомнили — не беда: в следующий раз лист выберут заново.
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(o)); } catch { /* память браузера */ }
}

const captureScale = () => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

/**
 * Снимок карты.
 *
 * Тайлы, взятые из локального хранилища, живут на blob-ссылках, а те
 * освобождаются сразу после отрисовки. Поэтому перед съёмкой возвращаем
 * им сетевые адреса — иначе на снимке будут белые квадраты.
 */
async function capture(el: HTMLElement, decorate?: (c: HTMLCanvasElement, scale: number) => void): Promise<Blob | null> {
  const { default: html2canvas } = await import('html2canvas');
  const scale = captureScale();
  const canvas = await html2canvas(el, {
    useCORS: true,
    backgroundColor: null,
    scale,
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
  decorate?.(canvas, scale);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * Линейка в левом нижнем углу снимка — на белой плашке, чтобы читалась и
 * на спутнике, и на тёмной подложке.
 */
function drawSnapshotBar(canvas: HTMLCanvasElement, scale: number, view: MapView | null): void {
  if (!view) return;
  const bar = snapshotBar(view, scale);
  const ctx = canvas.getContext('2d');
  if (!bar || !ctx) return;
  const pad = 6 * scale;
  const font = 11 * scale;
  ctx.save();
  ctx.font = `600 ${font}px ui-sans-serif, system-ui, sans-serif`;
  const textW = ctx.measureText(bar.label).width;
  const boxW = pad * 3 + bar.px + textW;
  const boxH = pad * 2 + font;
  const x0 = 8 * scale;
  const y0 = canvas.height - boxH - 8 * scale;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  const yb = y0 + boxH - pad;
  ctx.beginPath();
  ctx.moveTo(x0 + pad, yb - 6 * scale);
  ctx.lineTo(x0 + pad, yb);
  ctx.lineTo(x0 + pad + bar.px, yb);
  ctx.lineTo(x0 + pad + bar.px, yb - 6 * scale);
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(bar.label, x0 + pad * 2 + bar.px, yb);
  ctx.restore();
}

function fileStamp(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
}

export default function MapCapture({
  getMapEl, getView, title, legend, className,
}: Props) {
  const [busy, setBusy] = useState<'png' | 'print' | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [opts, setOpts] = useState<PrintOptions>(() => parsePrintOptions(null));
  // То, что было на экране в момент снимка: по нему считается масштаб листа.
  const [view, setView] = useState<MapView | null>(null);

  useEffect(() => { setOpts(loadOptions()); }, []);
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

  const change = (patch: Partial<PrintOptions>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    saveOptions(next);
  };

  const shoot = useCallback(async (mode: 'png' | 'print') => {
    const el = getMapEl();
    if (!el) return;
    const v = getView();
    setBusy(mode);
    setError(null);
    try {
      const blob = await capture(el, mode === 'png' ? (c, s) => drawSnapshotBar(c, s, v) : undefined);
      if (!blob) throw new Error('пустой кадр');
      if (mode === 'png') {
        downloadBlob(`optiq_карта_${fileStamp()}.png`, blob);
        return;
      }
      const url = URL.createObjectURL(blob);
      setView(v);
      setSheet(url);
      setPanel(false);
      document.body.setAttribute('data-optiq-print', '1');
      // Даём кадру попасть в разметку до того, как откроется диалог.
      window.setTimeout(() => window.print(), 120);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'не получилось снять карту');
      window.setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(null);
    }
  }, [getMapEl, getView]);

  const layout = view ? layoutSheet(view, opts) : null;
  const grid = view && opts.grid ? coordGrid(view) : null;
  const notes = sheetNotes(layout, grid);

  return (
    <>
      <div className={className} data-capture="hide">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => shoot('png')}
            disabled={busy !== null}
            title="Снимок карты в PNG с масштабной линейкой — в отчёт или в переписку"
            aria-label="Снимок карты"
            className="px-2 py-1.5 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a] text-[#94a3b8]
                       hover:text-[#e2e8f0] shadow-lg disabled:opacity-50"
          >
            {busy === 'png' ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
          </button>
          <button
            type="button"
            onClick={() => setPanel((p) => !p)}
            disabled={busy !== null}
            title="Печать карты — лист A4 или A3 с масштабом, линейкой, сеткой и легендой"
            aria-label="Печать карты"
            aria-expanded={panel}
            className={`px-2 py-1.5 rounded-lg border bg-[#0d1b2a] shadow-lg disabled:opacity-50
                        ${panel ? 'border-[#38bdf8] text-[#38bdf8]' : 'border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
          >
            {busy === 'print' ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
          </button>
        </div>
        {panel && (
          <div className="mt-1 p-2 rounded-lg bg-[#0d1b2a] border border-[#1e3a5f] shadow-xl
                          flex flex-col gap-1.5 text-[11px] text-[#cbd5e1] w-[188px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#94a3b8]">Лист</span>
              <div className="seg">
                {(['A4', 'A3'] as const).map((p) => (
                  <button key={p} type="button" data-active={opts.paper === p}
                          onClick={() => change({ paper: p })}>{p}</button>
                ))}
              </div>
            </div>
            <div className="seg self-stretch">
              {(['landscape', 'portrait'] as const).map((o) => (
                <button key={o} type="button" data-active={opts.orientation === o} className="flex-1"
                        onClick={() => change({ orientation: o })}>{ORIENTATION_LABEL[o]}</button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={opts.grid} onChange={(e) => change({ grid: e.target.checked })} />
              Сетка координат
            </label>
            <p className="text-[9.5px] text-[#94a3b8] leading-snug">
              Печатайте в масштабе 100 %, без «уместить на странице» — тогда
              верна и цифра 1:N, а не только линейка.
            </p>
            <button type="button" className="btn btn-primary text-[11px] justify-center"
                    disabled={busy !== null} onClick={() => shoot('print')}>
              <Printer size={13} /> Печатать
            </button>
          </div>
        )}
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
          {/* Лист выбранного размера: правило страницы — своё на каждую печать. */}
          <style>{pageCss(opts)}</style>
          <div className="ps-head">
            <div className="ps-title">{title}</div>
            <div className="ps-meta">
              {new Date().toLocaleString('ru')}
              {layout ? ` · М ${scaleText(layout.scale)}` : ''}
              {` · ${opts.paper} ${ORIENTATION_LABEL[opts.orientation]}`}
            </div>
          </div>
          {layout ? (
            <div className="ps-mapbox" style={{ width: `${layout.mapWmm}mm`, height: `${layout.mapHmm}mm` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sheet} alt="" className="ps-map" />
              {grid && <GridOverlay layout={layout} grid={grid} />}
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sheet} alt="" className="ps-map-free" />
          )}
          <div className="ps-row">
            {layout?.bar && (
              <div className="ps-scale">
                <PaperScaleBar bar={layout.bar} />
                <span>Масштаб {scaleText(layout.scale)} · {perCmText(layout.scale)}</span>
              </div>
            )}
            {legend && legend.length > 0 && (
              <div className="ps-legend">
                {legend.map((g) => (
                  <div key={g.title} className="ps-legend-group">
                    <b>{g.title}</b>
                    {g.items.map((it) => (
                      <span key={it.label} className="ps-legend-item">
                        {/* Снимки на листе — тоже рамкой: заливка
                            сделала бы сплошную и пунктирную метку
                            одинаковыми кружками. */}
                        <i style={it.outline
                          ? { background: '#ffffff', border: `0.5mm ${it.outline} ${it.color}`, borderRadius: '0.6mm' }
                          : { background: it.color }} />
                        {it.label}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="ps-foot">
            {notes.map((n) => <div key={n}>{n}</div>)}
            <div>Optiq · ТОО «СК Фаворит Инжиниринг»</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Линейка с делениями, длиной в настоящих миллиметрах листа. */
function PaperScaleBar({ bar }: { bar: PaperBar }) {
  const pad = 4;
  const w = bar.mm + pad * 2;
  const segs = bar.ticks.slice(1).map((t, i) => ({ x: bar.ticks[i] * bar.mm, w: (t - bar.ticks[i]) * bar.mm, dark: i % 2 === 0 }));
  return (
    <svg width={`${w}mm`} height="8mm" viewBox={`0 0 ${w} 8`} style={{ overflow: 'visible' }} aria-label={`Линейка ${bar.label}`}>
      {segs.map((s) => (
        <rect key={s.x} x={pad + s.x} y={4.6} width={s.w} height={1.4}
              fill={s.dark ? '#0f172a' : '#ffffff'} stroke="#0f172a" strokeWidth={0.2} />
      ))}
      <text x={pad} y={3.6} fontSize={2.6} textAnchor="middle" fill="#0f172a">0</text>
      <text x={pad + bar.mm} y={3.6} fontSize={2.6} textAnchor="middle" fill="#0f172a">{bar.label}</text>
    </svg>
  );
}

/**
 * Сетка поверх снимка. Рисуется в миллиметрах листа, поэтому совпадает с
 * картой при любом размере бумаги.
 */
function GridOverlay({ layout, grid }: { layout: SheetLayout; grid: CoordGrid }) {
  const W = layout.mapWmm;
  const H = layout.mapHmm;
  const halo = { paintOrder: 'stroke' as const, stroke: '#ffffff', strokeWidth: 0.7 };
  return (
    <svg className="ps-grid" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {grid.lines.map((l) => (l.kind === 'lon' ? (
        <g key={`lon${l.value}`}>
          <line x1={l.pos * W} y1={0} x2={l.pos * W} y2={H} stroke="#0f172a" strokeOpacity={0.5} strokeWidth={0.15} />
          <text x={l.pos * W + 0.8} y={3} fontSize={2.4} fill="#0f172a" style={halo}>{l.label}</text>
        </g>
      ) : (
        <g key={`lat${l.value}`}>
          <line x1={0} y1={l.pos * H} x2={W} y2={l.pos * H} stroke="#0f172a" strokeOpacity={0.5} strokeWidth={0.15} />
          <text x={0.8} y={l.pos * H - 0.8} fontSize={2.4} fill="#0f172a" style={halo}>{l.label}</text>
        </g>
      )))}
    </svg>
  );
}
