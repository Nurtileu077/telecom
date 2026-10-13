import { WGS84_A, WGS84_F } from '@/lib/geodesy';
import { scaleBar } from '@/components/Construction/mapDecor';

/**
 * Печатный лист карты: размер бумаги, масштаб 1:N, линейка и сетка.
 *
 * На листе стояло «масштабная линейка 5,00 км», а самой линейки не было:
 * линейка жила поверх карты на экране, а снимали только карту под ней.
 * Подпись без отрезка ничего не говорит — по бумаге не измерить, и
 * акимату показывали картинку, а не карту. К тому же снимок растягивался
 * под ширину листа, и даже экранная линейка на нём врала бы в разы.
 *
 * Теперь размер карты на бумаге задаём сами в миллиметрах, поэтому знаем
 * масштаб: сколько метров на местности в миллиметре листа. Отсюда и
 * «1:24 000», и отрезок линейки нужной длины, и сетка координат —
 * то, без чего лист не документ.
 */

export type PaperSize = 'A4' | 'A3';
export type Orientation = 'landscape' | 'portrait';

export interface PrintOptions {
  paper: PaperSize;
  orientation: Orientation;
  /** Сетка координат поверх карты. */
  grid: boolean;
}

export const DEFAULT_PRINT: PrintOptions = { paper: 'A4', orientation: 'landscape', grid: true };

/**
 * Выбор листа, запомненный на устройстве.
 *
 * У кого в конторе A3, тот печатает на A3 всегда — выбирать заново
 * каждый раз незачем. Что не распознали — берём по умолчанию, а не
 * роняем печать.
 */
export function parsePrintOptions(raw: unknown): PrintOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PrintOptions, unknown>>;
  return {
    paper: o.paper === 'A3' ? 'A3' : 'A4',
    orientation: o.orientation === 'portrait' ? 'portrait' : 'landscape',
    grid: o.grid === undefined ? DEFAULT_PRINT.grid : o.grid === true,
  };
}

export const ORIENTATION_LABEL: Record<Orientation, string> = {
  landscape: 'альбомный',
  portrait: 'книжный',
};

/** Длинная и короткая сторона листа, мм. */
const PAPER_MM: Record<PaperSize, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
};

/** Поля листа — те же, что в правиле @page. */
export const SHEET_MARGIN_MM = 10;
/**
 * Место под шапку, строку с линейкой и легендой и подвал с оговорками.
 * Если отдать карте всю высоту, легенда уезжает на второй лист, и его
 * печатают зря.
 */
export const SHEET_RESERVED_MM = 52;

export function sheetMm(paper: PaperSize, orientation: Orientation): { w: number; h: number } {
  const [long, short] = PAPER_MM[paper] ?? PAPER_MM.A4;
  return orientation === 'portrait' ? { w: short, h: long } : { w: long, h: short };
}

/** Правило страницы для печати: какой лист и как повёрнут. */
export function pageCss(o: Pick<PrintOptions, 'paper' | 'orientation'>): string {
  return `@media print { @page { size: ${o.paper} ${o.orientation}; margin: ${SHEET_MARGIN_MM}mm; } }`;
}

/** Что было на экране в момент снимка. */
export interface MapView {
  /** Широта середины карты. */
  lat: number;
  zoom: number;
  north: number;
  south: number;
  east: number;
  west: number;
  /** Размер карты на экране, точки CSS. */
  widthPx: number;
  heightPx: number;
}

const E2 = WGS84_F * (2 - WGS84_F);

/**
 * Метры на местности в одной точке экрана — вдоль параллели этой широты.
 *
 * Плитки карты нарезаны на шаре радиусом большой полуоси, а местность — на
 * эллипсоиде: на широте Астаны параллель длиннее шаровой на 0,2 %. Мелочь,
 * но длины трасс мы уже меряем по эллипсоиду, и масштаб листа не должен
 * расходиться с ними.
 */
export function groundMetersPerPx(lat: number, zoom: number): number {
  const phi = (lat * Math.PI) / 180;
  const s = Math.sin(phi);
  const parallel = (2 * Math.PI * WGS84_A * Math.cos(phi)) / Math.sqrt(1 - E2 * s * s);
  return parallel / (256 * 2 ** zoom);
}

/**
 * Масштаб округляем вверх до двух значащих цифр — и под него чуть
 * уменьшаем карту на листе.
 *
 * «1:23 417» не прочитает никто, а «≈1:23 000» — уже неправда. Карта,
 * уменьшенная на пару процентов, даёт ровно «1:24 000», и это честная
 * цифра, по которой можно мерить циркулем.
 */
export function roundScaleUp(n: number): number {
  if (!(n > 0) || !Number.isFinite(n)) return n;
  const pow = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.ceil(n / pow - 1e-9) * pow;
}

/** «1:24 000» — так, как пишут на картах. */
export function scaleText(n: number): string {
  return `1:${Math.round(n).toLocaleString('ru')}`;
}

/** Сколько метров местности в сантиметре листа: «в 1 см 240 м». */
export function perCmText(n: number): string {
  const m = n / 100;
  if (m < 1000) return `в 1 см ${m.toLocaleString('ru', { maximumFractionDigits: 1 })} м`;
  return `в 1 см ${(m / 1000).toLocaleString('ru', { maximumFractionDigits: 2 })} км`;
}

export interface PaperBar {
  /** Длина отрезка на местности, м. */
  meters: number;
  /** Та же длина на бумаге, мм. */
  mm: number;
  label: string;
  /** Деления: доля длины от 0 до 1. Через одно — закрашены. */
  ticks: number[];
}

/**
 * Линейка на бумаге — разбитая на деления, как на топографической карте.
 *
 * Длину берём круглую (1-2-5), а миллиметры — точные, без округления:
 * округление до миллиметра на линейке в 40 мм — уже 1 % ошибки.
 */
export function paperScaleBar(scaleN: number, maxMm = 60): PaperBar | null {
  if (!(scaleN > 0) || !Number.isFinite(scaleN)) return null;
  const metersPerMm = scaleN / 1000;
  const bar = scaleBar(metersPerMm, maxMm);
  const lead = Math.round(bar.meters / 10 ** Math.floor(Math.log10(bar.meters)));
  const parts = lead === 2 ? 4 : 5;
  return {
    meters: bar.meters,
    mm: bar.meters / metersPerMm,
    label: bar.label,
    ticks: Array.from({ length: parts + 1 }, (_, i) => i / parts),
  };
}

export interface SheetLayout {
  paper: { w: number; h: number };
  /** Размер карты на листе, мм. */
  mapWmm: number;
  mapHmm: number;
  /** Знаменатель масштаба по середине листа. */
  scale: number;
  /** Масштаб у верхнего и нижнего края — проекция растягивает к северу. */
  scaleTop: number;
  scaleBottom: number;
  /** Разница масштабов по краям такая, что её надо назвать вслух. */
  stretched: boolean;
  bar: PaperBar | null;
}

/** С какой разницы между краями листа масштаб оговариваем отдельно. */
const STRETCH_NOTE = 0.02;

/**
 * Раскладка карты на листе.
 *
 * Карта сохраняет пропорции экрана и занимает всё, что осталось от листа
 * после шапки и подвала, — а потом чуть уменьшается под круглый масштаб.
 */
export function layoutSheet(view: MapView, opts: Pick<PrintOptions, 'paper' | 'orientation'>): SheetLayout | null {
  const { widthPx, heightPx } = view;
  if (!(widthPx > 0) || !(heightPx > 0) || !Number.isFinite(view.zoom)) return null;
  const paper = sheetMm(opts.paper, opts.orientation);
  const availW = paper.w - 2 * SHEET_MARGIN_MM;
  const availH = paper.h - 2 * SHEET_MARGIN_MM - SHEET_RESERVED_MM;
  if (availW <= 0 || availH <= 0) return null;

  const aspect = widthPx / heightPx;
  const fitW = Math.min(availW, availH * aspect);
  const groundW = groundMetersPerPx(view.lat, view.zoom) * widthPx;
  if (!(groundW > 0) || !Number.isFinite(groundW)) return null;

  const scale = roundScaleUp(groundW / (fitW / 1000));
  const mapWmm = (groundW / scale) * 1000;
  const mapHmm = mapWmm / aspect;

  // В проекции карты метр у верхнего края листа короче, чем у нижнего:
  // на листе с областью целиком разница доходит до десятков процентов.
  const at = (lat: number) => scale * (groundMetersPerPx(lat, view.zoom) / groundMetersPerPx(view.lat, view.zoom));
  const scaleTop = at(view.north);
  const scaleBottom = at(view.south);
  const stretched = Math.abs(scaleBottom - scaleTop) / scale > STRETCH_NOTE;

  return {
    paper, mapWmm, mapHmm, scale, scaleTop, scaleBottom, stretched,
    bar: paperScaleBar(scale),
  };
}

/** Масштаб у края — для оговорки, без лишней точности. */
export function edgeScaleText(n: number): string {
  if (!(n > 0)) return '';
  const pow = 10 ** (Math.floor(Math.log10(n)) - 1);
  return scaleText(Math.round(n / pow) * pow);
}

// ── Сетка координат ────────────────────────────────────────────────────────

export interface GridLine {
  /** Параллель (широта) или меридиан (долгота). */
  kind: 'lat' | 'lon';
  value: number;
  /** Доля от левого края (меридиан) или от верхнего (параллель), 0…1. */
  pos: number;
  label: string;
}

export interface CoordGrid {
  step: number;
  stepLabel: string;
  lines: GridLine[];
}

/** Шаги сетки в градусах — от двадцати метров до сотен километров. */
const GRID_STEPS = [
  0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10,
];

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

function decimals(step: number): number {
  let d = 0;
  while (d < 6 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-9) d++;
  return d;
}

function degText(v: number, dec: number): string {
  return `${v.toFixed(dec).replace('.', ',').replace('-', '−')}°`;
}

/**
 * Сетка в градусах WGS-84 — тех же, что в телефоне и в KML.
 *
 * Шаг один для широт и долгот: так её читают на любой карте. Линий не
 * больше восьми по длинной стороне — иначе подписи налезают друг на
 * друга, а трассу под сеткой не видно.
 */
export function coordGrid(view: Pick<MapView, 'north' | 'south' | 'east' | 'west'>, maxLines = 8): CoordGrid | null {
  const { north, south, east, west } = view;
  if (![north, south, east, west].every(Number.isFinite) || north <= south || east <= west) return null;
  const span = Math.max(north - south, east - west);
  const step = GRID_STEPS.find((s) => span / s <= maxLines) ?? GRID_STEPS[GRID_STEPS.length - 1];
  const dec = decimals(step);
  const lines: GridLine[] = [];

  const yN = mercY(north);
  const yS = mercY(south);
  for (let k = Math.ceil(south / step); k * step <= north + 1e-12; k++) {
    const value = Number((k * step).toFixed(dec));
    if (value <= south || value >= north) continue;
    lines.push({ kind: 'lat', value, pos: (yN - mercY(value)) / (yN - yS), label: degText(value, dec) });
  }
  for (let k = Math.ceil(west / step); k * step <= east + 1e-12; k++) {
    const value = Number((k * step).toFixed(dec));
    if (value <= west || value >= east) continue;
    lines.push({ kind: 'lon', value, pos: (value - west) / (east - west), label: degText(value, dec) });
  }
  return { step, stepLabel: degText(step, dec), lines };
}

/**
 * Оговорки под картой.
 *
 * Цифра 1:N верна только на бумаге, напечатанной в натуральную величину:
 * браузер по умолчанию любит «уместить на странице», и лист выходит
 * мельче. Линейку это не ломает — она уменьшается вместе с картой, — а
 * подпись ломает. Поэтому так и пишем: что верно всегда, а что — при
 * каком условии.
 */
export function sheetNotes(layout: SheetLayout | null, grid: CoordGrid | null): string[] {
  if (!layout) {
    return ['Масштаб не определён: на момент печати карта не сообщила, что на ней показано, — мерить по этому листу нельзя.'];
  }
  const out: string[] = [];
  out.push(`Масштаб ${scaleText(layout.scale)} верен при печати в натуральную величину (100 %, без «уместить на странице»); `
    + 'линейка верна при любой печати.');
  if (layout.stretched) {
    out.push(`Масштаб указан по середине листа: в проекции карты у верхнего края ${edgeScaleText(layout.scaleTop)}, `
      + `у нижнего ${edgeScaleText(layout.scaleBottom)} — мерьте линейкой поближе к середине.`);
  }
  if (grid) {
    out.push(`Сетка — градусы WGS-84, шаг ${grid.stepLabel}: широта подписана у левого края, долгота — у верхнего.`);
  }
  return out;
}

// ── Снимок файлом ──────────────────────────────────────────────────────────

/**
 * Линейка на снимке PNG.
 *
 * Снимок карты тоже уходит в отчёт и в переписку — и тоже без линейки
 * превращался в картинку. На снимке масштаб не 1:N (его могут вставить
 * любого размера), а отрезок, который растягивается вместе со снимком.
 */
export function snapshotBar(view: Pick<MapView, 'lat' | 'zoom'>, pixelRatio: number, maxCssPx = 120): { px: number; label: string } | null {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const mpp = groundMetersPerPx(view.lat, view.zoom) / ratio;
  if (!(mpp > 0) || !Number.isFinite(mpp)) return null;
  const bar = scaleBar(mpp, maxCssPx * ratio);
  return { px: bar.meters / mpp, label: bar.label };
}
