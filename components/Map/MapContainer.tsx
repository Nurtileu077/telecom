'use client';
import { useEffect, useRef, useState } from 'react';
import {
  District, Cable, LayerVisibility, MapAnnotation, AnnotationType,
  ANNOTATION_PRESETS, InlineJoint, CABLE_COLORS as CABLE_COLORS_MAP,
  CAMERA_KIND_COLOR, CAMERA_KIND_LABEL, CAMERA_MIN_BANDWIDTH_MBPS,
} from '@/types/network';
import type { DrawingTool } from '@/components/Sidebar/NotesTab';
import { nearestTbToJoint, endpointLabel } from '@/components/Network/entityInterior';
import { warpWaypoint } from '@/components/Network/cableWaypoints';
import {
  CREW_KINDS, CREW_STATUS, SNP_STAGES, SNP_STAGE_SPECS, STAGE_STATUS_SPECS,
  AREA_KIND_LABEL,
} from '@/types/construction';
import { SNP_POINT_SOURCE } from '@/components/Construction/snpMap';
import { areaColor, visibleAtZoom } from '@/components/Construction/areaProgress';
import {
  SITE_OBJECT_SPECS, MUFTA_STATES, siteObjectColor,
} from '@/types/construction';
import { routeTitle, PLAN_LINE_COLOR } from '@/components/Construction/routeStyle';
import {
  METHOD_COLOR, METHOD_LABEL, kksPoints,
} from '@/components/Construction/routeSegments';
import {
  problemSpots, nearbyIncidents, incidentHours, SAME_SPOT_M,
} from '@/components/Construction/incidents';
import { pointAtDistanceM } from '@/components/Construction/routeProgress';
import {
  arrowsAlong, lengthLabels, progressSplit, METHOD_DASH, formatMeters, bearingDeg,
  clusterPoints,
} from '@/components/Construction/mapDecor';
import {
  snapToRoutes, nearestOnRoute, measureLine, measureAlongRoute, polygonAreaM2,
  perimeterM, formatArea, rectCoords, circleCoords, RouteSnap,
} from '@/components/Construction/measureTool';
import { parseMapHash, buildMapHash } from '@/lib/mapLink';

/**
 * Что показать в панели измерения.
 *
 * Карта меряет, а показывает панель снаружи: цифры надо читать, копировать
 * и класть в акт, а подпись, привязанная к последней точке, для этого не
 * годится.
 */
export interface MeasureReadout {
  points: number;
  /** По ломаной, которую щёлкали. */
  totalM: number;
  /** Напрямую от первой точки до последней. */
  straightM: number;
  /** По трассе, если обе точки прилипли к одной и той же. */
  alongRouteM?: number;
  areaM2?: number;
  perimeterM?: number;
}

/**
 * Ссылка «доехать».
 *
 * Свой навигатор в системе не нужен и не будет лучше телефонного: на
 * машине едут с тем приложением, к которому привыкли. Даём обе ссылки —
 * 2ГИС в Казахстане популярнее, но Google есть у всех.
 */
function routeLinks(lat: number, lon: number): string {
  const g = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  const d = `https://2gis.kz/routeSearch/rsType/car/to/${lon},${lat}`;
  return `<div style="margin-top:6px;display:flex;gap:8px;font-size:11px">
    <a href="${g}" target="_blank" rel="noreferrer" style="color:#38bdf8;text-decoration:none">🚗 Google</a>
    <a href="${d}" target="_blank" rel="noreferrer" style="color:#38bdf8;text-decoration:none">🚗 2ГИС</a>
  </div>`;
}

/**
 * «Откуда и куда едет» одной строкой.
 *
 * Спрашивают об этом каждый день, и отвечает не точка, а направление:
 * из какого села вышли, к какому идут и сколько до него осталось.
 */
function crewTripLine(
  trip?: import('@/components/Construction/crewPlace').CrewTrip,
): string {
  if (!trip || (!trip.from && !trip.to)) return '';
  const way = [trip.from, trip.to].filter(Boolean).map((v) => esc(v as string)).join(' → ');
  const left = trip.leftM && trip.leftM > 0
    ? ` <span style="color:#64748b">· осталось ${(trip.leftM / 1000).toFixed(1)} км</span>`
    : '';
  return `<br/><span style="font-size:11px;color:#2dd4bf">🚚 ${way}</span>${left}`;
}

/** Цвет прокола: свой, не пересекается с цветами этапов трассы. */
const DRILL_COLOR: Record<'ГНБ' | 'ГНП', string> = {
  'ГНБ': '#f472b6',
  'ГНП': '#fb923c',
};
import GpsLocateButton from '@/components/Map/GpsLocateButton';
import OfflineTilesButton from '@/components/Map/OfflineTilesButton';
import { getTile, putTile } from '@/lib/tileCache';
import PresenceCursors from '@/components/Map/PresenceCursors';
import MapLegend from '@/components/Map/MapLegend';
import MapSearch from '@/components/Map/MapSearch';
import ScaleBar from '@/components/Map/ScaleBar';

/**
 * Подложка, которая сначала смотрит на устройство.
 *
 * Обычный слой Leaflet идёт в сеть и в поле показывает серый квадрат.
 * Этот сначала ищет тайл в локальном хранилище, и только если не нашёл —
 * качает и заодно кладёт себе. Ничего не скачал заранее — работает как
 * обычный: хуже не становится.
 */
function cachedTileLayer(L: any, url: string, opts: any): any {
  const Cached = L.TileLayer.extend({
    createTile(coords: { x: number; y: number; z: number }, done: (e: unknown, t: HTMLImageElement) => void) {
      const img = document.createElement('img');
      img.setAttribute('role', 'presentation');
      img.alt = '';
      const src = (this as any).getTileUrl(coords);

      let objectUrl: string | null = null;
      const finish = (err: unknown) => {
        if (objectUrl) {
          // Ссылку освобождаем после отрисовки: иначе память течёт на
          // каждом движении карты, а у телефона её и так мало.
          const u = objectUrl;
          setTimeout(() => URL.revokeObjectURL(u), 1000);
        }
        done(err, img);
      };
      img.onload = () => finish(null);
      img.onerror = (e) => finish(e);

      void getTile(src).then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          img.src = objectUrl;
          return;
        }
        // Нет в кэше — обычная загрузка. Складывать в хранилище каждый
        // просмотренный тайл не станем: это решение человека, а не
        // побочный эффект прокрутки карты.
        img.crossOrigin = '';
        img.src = src;
      });

      return img;
    },
  });
  return new Cached(url, opts);
}

interface Props {
  districts: District[];
  cables: Cable[];
  joints?: InlineJoint[];
  // Subscribers that aren't yet placed inside any district's ORK — used to
  // show "raw" KML imports before the user clicks Build.  Renders as gray
  // dots so they're visibly different from the colored, ORK-assigned ones.
  unassignedSubscribers?: import('@/types/network').Subscriber[];
  layers: LayerVisibility;
  flyToRef?: React.MutableRefObject<((lat: number, lon: number, zoom?: number) => void) | null>;
  /**
   * Показать целиком: «посмотреть трассу» — это вопрос «от и до», а не
   * «где середина». Точкой на него не ответить, нужна рамка по всей линии.
   */
  fitRef?: React.MutableRefObject<((coords: [number, number][]) => void) | null>;
  mapElRef?: React.MutableRefObject<HTMLElement | null>;
  // Annotations
  annotations: MapAnnotation[];
  activeTool: DrawingTool;
  setActiveTool: (t: DrawingTool) => void;
  activeAnnotationType: AnnotationType;
  addAnnotation: (a: Omit<MapAnnotation, 'id' | 'createdAt' | 'updatedAt'>) => MapAnnotation;
  deleteAnnotation: (id: string) => void;
  // Edit mode
  editMode: boolean;
  placingMode?: boolean;
  // True while the host is waiting for a rectangle-selection corner click.
  // We fire onMapClick in this mode so the host can record the corner without
  // having to flip edit/placing mode on (which would change marker visuals).
  selectingMode?: boolean;
  onMapClick?: (lat: number, lon: number) => void;
  onMapContextMenu?: (lat: number, lon: number, screenX: number, screenY: number) => void;
  moveEntity?: (kind: 'tb' | 'ork' | 'olt' | 'joint' | 'sub', id: string, lat: number, lon: number) => void;
  deleteSubscriber?: (id: string) => void;
  onEntityClick?: (kind: 'olt' | 'tb' | 'ork', id: string) => void;
  onEntityDoubleClick?: (kind: 'olt' | 'tb' | 'ork', id: string) => void;
  onJointClick?: (jointId: string) => void;
  /** Узел в режиме перетаскивания (двойной клик или кнопка в инспекторе). */
  moveEntityTarget?: { kind: 'olt' | 'tb' | 'ork'; id: string } | null;
  onCableClick?: (id: string) => void;
  editingCableId?: string | null;
  onUpdateCableCoords?: (id: string, coords: [number, number][]) => void;
  onCableEndpointSnap?: (cableId: string, end: 'from' | 'to', entityId: string) => void;
  onSnapHighlight?: (entityId: string | null) => void;
  snapHighlightId?: string | null;
  /** Несколько узлов (режим «Соединить», совместимые цели). */
  snapHighlightIds?: Set<string> | null;

  // Power-budget colouring of subscribers
  budgetMap?: Map<string, 'ok' | 'warn' | 'fail'>;
  budgetColoring?: boolean;
  // Measure
  measureMode: boolean;
  setMeasureMode: (v: boolean) => void;
  // Heatmap
  heatmapEnabled: boolean;
  /** Проколы ГНБ/ГНП из журнала стройки — отдельный слой поверх сети. */
  drillPoints?: import('@/components/Construction/journalStore').DrillMapPoint[];
  /** Трассы с видом: пунктир — проект, сплошная — построено. */
  planRoutes?: import('@/components/Construction/routeStyle').RouteView[];
  /** Проколы, у которых сняты вход и выход — рисуются линией. */
  drillLines?: import('@/components/Construction/journalStore').DrillMapLine[];
  /**
   * Рисование трассы на стройке. Пока включено, клик ставит вершину;
   * правая кнопка или Enter заканчивают линию, Esc отменяет.
   */
  drawingRoute?: boolean;
  /**
   * Что рисуем: линию, замкнутый контур, прямоугольник или круг.
   * Механика у линии и контура одна — клики ставят вершины; прямоугольник
   * и круг задаются двумя кликами и превращаются в тот же контур.
   */
  drawShape?: 'route' | 'area' | 'rect' | 'circle';
  /**
   * Куда карта складывает своё текущее положение: центр и приближение.
   * Нужно тем, кто спрашивает «что сейчас на экране» — ссылка на место,
   * печать, выгрузка видимого куска.
   */
  mapViewRef?: { current: { lat: number; lon: number; zoom: number } | null };
  /** Померить: по прямой, вдоль трассы или площадь. */
  measureShape?: 'line' | 'area';
  onSetMeasureShape?: (s: 'line' | 'area') => void;
  /** Результат измерения — считает карта, показывает панель. */
  onMeasure?: (m: MeasureReadout | null) => void;
  measureReadout?: MeasureReadout | null;
  /** Переключить, что рисуем: контур, прямоугольник, круг. */
  onSetDrawShape?: (s: 'route' | 'area' | 'rect' | 'circle') => void;
  /** Сёла с их положением — для поиска по карте. */
  snpSearchPoints?: import('@/components/Construction/snpMap').SnpMapPoint[];
  /** Поиск по карте включён: на стройке ищут по названию села. */
  searchOnMap?: boolean;
  onToggleDrawRoute?: () => void;
  /** Включить рисование замкнутого контура. */
  onToggleDrawArea?: () => void;
  onRouteDrawn?: (coords: [number, number][]) => void;
  /** Трасса, у которой сейчас видны ручки: её можно тянуть и править. */
  editingRouteId?: string | null;
  onEditRoute?: (id: string | null) => void;
  onUpdateRouteCoords?: (id: string, coords: [number, number][]) => void;
  onDeleteRoute?: (id: string) => void;
  /** Разрезать трассу в стольких-то метрах от её начала. */
  onSplitRoute?: (id: string, atM: number) => void;
  /** Свести эту трассу с ближайшей к ней по концам. */
  onJoinRoute?: (id: string) => void;
  /** Отклонения от проекта — глубина и трасса — как контекст на карте. */
  deviations?: import('@/components/Construction/journalStore').DeviationMapItem[];
  /** Колонны на карте: где стоит бригада, чем занята, каким составом. */
  crews?: (import('@/types/construction').Crew & {
    trip?: import('@/components/Construction/crewPlace').CrewTrip;
    placement?: import('@/components/Construction/crewPlace').CrewPlacement;
  })[];
  /** Этапы по населённым пунктам: где ждут фронт, где работают, где закрыто. */
  snpPoints?: import('@/components/Construction/snpMap').SnpMapPoint[];
  /** Обведённые районы и сёла с ходом работ. */
  areas?: import('@/components/Construction/areaProgress').AreaMapItem[];
  /** Муфты, столбы, конечные точки, ККС. */
  siteObjects?: import('@/types/construction').SiteObject[];
  /**
   * Аварии. Открытая горит красным и пульсирует; место, где рвётся не в
   * первый раз, обведено кольцом — его видно, не открывая карточку.
   */
  incidents?: import('@/types/construction').Incident[];
  /** Поток по кабелю — украшение, включается слоем. */
  showFlow?: boolean;
  /** Кнопка «скачать карту на устройство» — нужна только на стройке. */
  offlineTiles?: boolean;
  /** Контур, который сейчас правят: у него появляются ручки вершин. */
  editingAreaId?: string | null;
  onEditArea?: (id: string | null) => void;
  onUpdateAreaCoords?: (id: string, coords: [number, number][]) => void;
  onRenameArea?: (id: string) => void;
  onDeleteArea?: (id: string) => void;
  onEditSiteObject?: (id: string) => void;
  /** Отрезки трассы по способам прокладки — когда красим по способу. */
  routeSegments?: import('@/components/Construction/routeSegments').RouteSegment[];
  routeColorMode?: 'stage' | 'method';
  /** Вчерашний день в движении: откуда куда дошли колонны. */
  playbackMoves?: import('@/components/Construction/playback').DayMove[];
  playbackDate?: string | null;
  onPlaybackDone?: () => void;
  /**
   * Рабочее место — стройка: сеть на карте не рисуем. Прорабу проектные
   * узлы и кабели мешают искать своё, а проектировщику — наоборот.
   */
  hideNetwork?: boolean;
  /** Перетаскивание колонны на новое место. */
  onMoveCrew?: (id: string, lat: number, lon: number) => void;
  // Bounding-box overlay for "export selection".  Drawn as a translucent
  // amber rectangle so the user can see what's about to be exported.
  selectionBBox?: { latMin: number; lonMin: number; latMax: number; lonMax: number } | null;
  // Лассо-выделение: вершины в процессе рисования и финальный полигон.
  selectionPoints?: [number, number][];
  selectionPoly?: [number, number][] | null;
  // «Показать ветку»: id кабелей выбранной ветки. Остальные кабели приглушаются.
  highlightCableIds?: Set<string> | null;
  /** Diff сценариев A↔B: пунктирные линии поверх карты */
  scenarioMapDiff?: import('@/lib/scenarioDiff').ScenarioMapDiff | null;
  onShowBranchSub?: (id: string) => void;
  /** Курсоры коллег (Supabase Realtime presence) */
  presencePeers?: import('@/hooks/useProjectPresence').PresenceCursor[];
  onPresenceCursorMove?: (lat: number, lon: number) => void;
}

const CABLE_COLORS: Record<string, string> = CABLE_COLORS_MAP as Record<string, string>;
const CABLE_WEIGHTS: Record<string, number> = {
  'ОК-4':  2.5, 'ОК-8':  3,
  'ОК-12': 3.5, 'ОК-16': 4,
  'ОК-24': 4.5, 'ОК-32': 5,
  'ОК-48': 6,   'ОК-96': 7,
};
const CABLE_LAYER_KEY: Record<string, keyof LayerVisibility> = {
  'ОК-4': 'cableOK4', 'ОК-8': 'cableOK8',
  'ОК-12': 'cableOK12', 'ОК-16': 'cableOK16',
  'ОК-24': 'cableOK24', 'ОК-32': 'cableOK32',
  'ОК-48': 'cableOK48', 'ОК-96': 'cableOK96',
};

type BaseMap = 'dark' | 'light' | 'satellite' | 'hybrid' | 'topo';

/** Как подложка называется по-русски — для подсказки на кнопке. */
const BASEMAP_LABEL: Record<BaseMap, string> = {
  dark: 'Тёмная схема',
  light: 'Светлая схема',
  satellite: 'Спутник',
  hybrid: 'Спутник с подписями',
  topo: 'Рельеф',
};

const BASEMAP_ICON: Record<BaseMap, string> = {
  dark: '🌙', light: '☀️', satellite: '🛰', hybrid: '🗺', topo: '⛰',
};

const BASEMAP_KEY = 'optiq-basemap-v1';

const BASEMAPS: Record<BaseMap, { url: string; attribution: string; subdomains?: string; maxZoom?: number }> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '©OpenStreetMap ©CartoDB', subdomains: 'abcd', maxZoom: 20,
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '©OpenStreetMap ©CartoDB', subdomains: 'abcd', maxZoom: 20,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '©Esri World Imagery', maxZoom: 19,
  },
  hybrid: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '©Esri World Imagery', maxZoom: 19,
  },
  // Рельеф нужен там, где трасса идёт по сопкам и оврагам: по спутнику
  // перепад высот не читается, а кабелеукладчик по нему не пойдёт.
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '©OpenTopoMap ©OpenStreetMap', subdomains: 'abc', maxZoom: 17,
  },
};

// Quantize a coordinate to a ~10m grid cell — used for detecting which cables
// share a road segment.  Mirrors the consolidation grid but coarser-than-screen
// so adjacent OSRM nodes hash to the same bucket.
function cellKey(lat: number, lon: number): string {
  const F = 10000; // ≈11 m  at the equator, ≈8 m on KZ latitudes
  return `${Math.round(lat * F)}_${Math.round(lon * F)}`;
}

// Assign each cable a "lane" index — 0 means draw on the road centreline, 1+
// means draw with a perpendicular offset. Two cables sharing >50% of their
// path segments get assigned different lanes so they stay visually distinct.
function computeCableLanes(cables: { id: string; coords: [number, number][] }[]): Map<string, number> {
  const segUsers = new Map<string, string[]>();
  for (const c of cables) {
    const cells = new Set<string>();
    for (const [la, lo] of c.coords) cells.add(cellKey(la, lo));
    for (const k of cells) {
      if (!segUsers.has(k)) segUsers.set(k, []);
      segUsers.get(k)!.push(c.id);
    }
  }
  const lanes = new Map<string, number>();
  // Sort cables by length descending so the longest gets lane 0 (visually
  // "underneath", the trunk on the road centreline).
  const sorted = [...cables].sort((a, b) => b.coords.length - a.coords.length);
  for (const c of sorted) {
    const taken = new Set<number>();
    for (const [la, lo] of c.coords) {
      const k = cellKey(la, lo);
      const users = segUsers.get(k) || [];
      for (const u of users) {
        if (u === c.id) continue;
        const ln = lanes.get(u);
        if (ln !== undefined) taken.add(ln);
      }
    }
    let lane = 0;
    while (taken.has(lane)) lane++;
    if (lane > 4) lane = 4; // cap so we don't fly off the road on dense overlaps
    lanes.set(c.id, lane);
  }
  return lanes;
}

// Shift a polyline perpendicular to its local direction by `offsetM` metres.
// At inner vertices we use the BISECTOR of the incoming and outgoing segments
// (with miter compensation 1/sin(½θ)) so the offset stays a constant distance
// on the same side of the road through corners.  The naive averaged-tangent
// approach produced visible zigzag at intersections — offset flipped sides
// or compressed at sharp turns.
function offsetPolyline(coords: [number, number][], offsetM: number): [number, number][] {
  if (coords.length < 2 || offsetM === 0) return coords;

  // Convert a (lat, lon) point to local metres relative to the first vertex.
  const ref = coords[0];
  const cosLat = Math.cos((ref[0] * Math.PI) / 180);
  const toMx = (lon: number) => (lon - ref[1]) * 111320 * cosLat;
  const toMy = (lat: number) => (lat - ref[0]) * 111320;

  const xs = coords.map(([la, lo]) => toMx(lo));
  const ys = coords.map(([la]) => toMy(la));

  // Per-segment unit tangents
  const tx: number[] = [];
  const ty: number[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    const dy = ys[i + 1] - ys[i];
    const len = Math.hypot(dx, dy) || 1;
    tx.push(dx / len);
    ty.push(dy / len);
  }

  // Compute the offset point for each vertex.
  const out: [number, number][] = [];
  // Cap miter on very sharp angles so we don't fly off to infinity.
  const MAX_MITER = 4; // ~14° angle is the smallest before we cap

  for (let i = 0; i < coords.length; i++) {
    let nx: number;
    let ny: number;

    if (i === 0) {
      nx = -ty[0];
      ny = tx[0];
    } else if (i === coords.length - 1) {
      nx = -ty[i - 1];
      ny = tx[i - 1];
    } else {
      const tInX = tx[i - 1];
      const tInY = ty[i - 1];
      const tOutX = tx[i];
      const tOutY = ty[i];
      // Bisector normal: rotate the average tangent by 90°.
      // Equivalent to averaging the per-segment normals.
      const inNx = -tInY;
      const inNy = tInX;
      const outNx = -tOutY;
      const outNy = tOutX;
      let bx = inNx + outNx;
      let by = inNy + outNy;
      const bLen = Math.hypot(bx, by);
      if (bLen < 1e-6) {
        // 180° reversal — degenerate. Use the incoming normal.
        nx = inNx; ny = inNy;
      } else {
        bx /= bLen; by /= bLen;
        // Miter factor = 1 / (n · t_out) — distance to keep constant offset.
        // (n · t_out) = sin(half-angle between segments).
        const dot = bx * tOutX + by * tOutY;
        let miter = dot !== 0 ? 1 / Math.abs(dot) : MAX_MITER;
        // But we want offset distance to be `offsetM`, not |offsetM|×miter — wait,
        // we DO want miter so the parallel line is offsetM perpendicular to the
        // ORIGINAL segments, not the bisector.  Capped to avoid spikes.
        miter = Math.min(miter, MAX_MITER);
        // Perpendicular to bisector at miter distance:
        nx = -by * miter;
        ny = bx * miter;
      }
    }

    const x = xs[i] + nx * offsetM;
    const y = ys[i] + ny * offsetM;
    const lat = ref[0] + y / 111320;
    const lon = ref[1] + x / (111320 * cosLat);
    out.push([lat, lon]);
  }
  return out;
}

/** Экранирование пользовательского текста для HTML в попапах карты. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Размер маркеров в зависимости от зума — как в Google: точки «растут»
 *  при приближении и уменьшаются при отдалении. Возвращает множитель ≈ 0.85-1.75. */
function markerScale(zoom: number): number {
  return Math.max(0.85, Math.min(1.75, 0.85 + (zoom - 10) * 0.12));
}

/**
 * Толщина кабеля по зуму.
 *
 * На общем плане области волосяная линия сливается с дорогами и просто
 * теряется, поэтому внизу диапазона не даём ей истончаться, а вблизи —
 * наоборот, кабель становится заметно толще подложки.
 */
function lineScale(zoom: number): number {
  return Math.max(0.9, Math.min(1.8, 0.9 + (zoom - 9) * 0.1));
}

/**
 * Сколько метров в пикселе на этой широте и этом приближении.
 *
 * Нужно там, где шаг задаётся не в метрах, а глазами: стрелки направления
 * ставят через столько-то пикселей, иначе на области они слипаются в
 * сплошную полосу, а на селе исчезают вовсе.
 */
function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export default function LeafletMap(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gpsMarkerRef = useRef<any>(null);
  const gpsCircleRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const hybridLabelsRef = useRef<any>(null);
  const dataGroupRef = useRef<any>(null);
  const annoGroupRef = useRef<any>(null);
  const drillGroupRef = useRef<any>(null);
  const crewGroupRef = useRef<any>(null);
  const deviationGroupRef = useRef<any>(null);
  const planGroupRef = useRef<any>(null);
  const snpGroupRef = useRef<any>(null);
  const areaGroupRef = useRef<any>(null);
  const drawGroupRef = useRef<any>(null);
  const measureGroupRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const drawStateRef = useRef<{ coords: [number, number][]; tempLayer?: any }>({ coords: [] });
  /** Вершины рисуемой трассы — живут, пока линию не закончили. */
  const routeDraftRef = useRef<[number, number][]>([]);
  /** Отложенная вершина: двойной клик приходит после двух одиночных. */
  const routeClickTimerRef = useRef<number | null>(null);
  /** Отложенная перерисовка плана после перемотки карты. */
  const panTimerRef = useRef<number | null>(null);
  /** Карту открыли по ссылке на место — своё положение она не выбирает. */
  const openedFromLinkRef = useRef(false);
  /** Черновик прямоугольника или круга: первый клик поставил угол. */
  const shapeDraftRef = useRef<any>(null);
  /** Где последний раз щёлкнули по трассе — там её и режут. */
  const lastRouteClickRef = useRef<{ id: string; lat: number; lon: number } | null>(null);
  /** Ручки правки трассы — отдельная группа, чтобы не мешать слоям. */
  const routeEditGroupRef = useRef<any>(null);
  const objectGroupRef = useRef<any>(null);
  const incidentGroupRef = useRef<any>(null);
  const areaEditGroupRef = useRef<any>(null);
  const flowGroupRef = useRef<any>(null);
  const flowRafRef = useRef<number | null>(null);
  const playbackGroupRef = useRef<any>(null);
  const playbackRafRef = useRef<number | null>(null);
  const measureStateRef = useRef<{
    coords: [number, number][];
    /** К какой трассе прилипла каждая точка, если прилипла. */
    snaps: (RouteSnap | null)[];
    layer?: any;
    total: number;
  }>({ coords: [], snaps: [], total: 0 });
  const waypointGroupRef = useRef<any>(null);
  const entityDragRef = useRef(false);

  const [baseMap, setBaseMapState] = useState<BaseMap>('dark');
  // Подложку выбирают один раз под свою работу: прорабу нужен спутник,
  // в офисе — схема. Спрашивать об этом каждое утро незачем.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(BASEMAP_KEY) as BaseMap | null;
      if (saved && saved in BASEMAPS) setBaseMapState(saved);
    } catch { /* приватный режим */ }
  }, []);
  const setBaseMap = (bm: BaseMap) => {
    setBaseMapState(bm);
    try { window.localStorage.setItem(BASEMAP_KEY, bm); } catch { /* приватный режим */ }
  };
  const [mapReady, setMapReady] = useState(false);

  // Stable refs for callbacks (so we don't re-init map)
  const propsRef = useRef(props);
  propsRef.current = props;

  // Initialize map
  useEffect(() => {
    if (typeof window === 'undefined' || mapRef.current || !containerRef.current) return;

    import('leaflet').then((L) => {
      if (!containerRef.current || mapRef.current) return;

      // Адрес вида #14/52.09/69.12 открывает ровно то место, которое видел
      // тот, кто дал ссылку. Без него «посмотри вот тут» означает «открой
      // и ищи сам», и человек на том конце открывает не то.
      const linked = parseMapHash(window.location.hash);

      const map = L.map(containerRef.current, {
        center: linked ? [linked.lat, linked.lon] : [43.0, 68.0],
        zoom: linked ? linked.zoom : 7,
        preferCanvas: true,
        zoomControl: false,
      });
      openedFromLinkRef.current = !!linked;
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Base layer
      const tile = cachedTileLayer(L, BASEMAPS.dark.url, {
        attribution: BASEMAPS.dark.attribution,
        subdomains: (BASEMAPS.dark.subdomains ?? '') as any,
        maxZoom: BASEMAPS.dark.maxZoom ?? 20,
      }).addTo(map);
      tileLayerRef.current = tile;

      dataGroupRef.current = L.layerGroup().addTo(map);
      annoGroupRef.current = L.layerGroup().addTo(map);
      drillGroupRef.current = L.layerGroup().addTo(map);
      crewGroupRef.current = L.layerGroup().addTo(map);
      deviationGroupRef.current = L.layerGroup().addTo(map);
      planGroupRef.current = L.layerGroup().addTo(map);
      // Контуры идут первыми: это подложка, а не объекты поверх.
      areaGroupRef.current = L.layerGroup().addTo(map);
      snpGroupRef.current = L.layerGroup().addTo(map);
      objectGroupRef.current = L.layerGroup().addTo(map);
      incidentGroupRef.current = L.layerGroup().addTo(map);
      areaEditGroupRef.current = L.layerGroup().addTo(map);
      flowGroupRef.current = L.layerGroup().addTo(map);
      playbackGroupRef.current = L.layerGroup().addTo(map);
      routeEditGroupRef.current = L.layerGroup().addTo(map);
      drawGroupRef.current = L.layerGroup().addTo(map);
      measureGroupRef.current = L.layerGroup().addTo(map);
      waypointGroupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);

      // Force Leaflet to recalculate container size after layout settles
      setTimeout(() => { map.invalidateSize(); }, 100);

      const onResize = () => { map.invalidateSize(); };
      window.addEventListener('resize', onResize);

      if (propsRef.current.flyToRef) {
        propsRef.current.flyToRef.current = (lat, lon, zoom = 16) => {
          map.flyTo([lat, lon], zoom, { duration: 1.0 });
        };
      }
      if (propsRef.current.fitRef) {
        propsRef.current.fitRef.current = (coords) => {
          const pts = coords.filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
          if (pts.length === 0) return;
          try {
            map.fitBounds(L.latLngBounds(pts as [number, number][]),
              { padding: [70, 70], maxZoom: 16 });
          } catch { /* вырожденная рамка — пусть остаётся как было */ }
        };
      }
      if (propsRef.current.mapElRef) {
        propsRef.current.mapElRef.current = containerRef.current;
      }

      // Двойной клик заканчивает линию — так делают везде, включая
      // Google Earth, и объяснять это никому не приходится.
      map.on('dblclick', () => {
        if (!propsRef.current.drawingRoute) return;
        // Отменяем вершину, которую поставил бы второй клик двойного.
        if (routeClickTimerRef.current !== null) {
          window.clearTimeout(routeClickTimerRef.current);
          routeClickTimerRef.current = null;
        }
        finishRouteDraft();
      });

      // Map click handler
      map.on('click', (e: any) => {
        const { lat, lng: lon } = e.latlng;
        const p = propsRef.current;

        // Рисование трассы: вершину ставим с задержкой. Двойной клик,
        // которым заканчивают линию, состоит из двух одиночных, и без
        // задержки он добавлял бы две лишние вершины в конце.
        if (p.drawingRoute) {
          // Прямоугольник и круг задаются двумя кликами: первый — угол или
          // центр, второй — противоположный угол или край. Обводить зону
          // работ двадцатью кликами никто не станет.
          if (p.drawShape === 'rect' || p.drawShape === 'circle') {
            const draft = routeDraftRef.current;
            if (draft.length === 0) {
              draft.push([lat, lon]);
              renderRouteDraft(L);
            } else {
              const shape = p.drawShape === 'rect'
                ? rectCoords(draft[0], [lat, lon])
                : circleCoords(draft[0], [lat, lon]);
              routeDraftRef.current = [];
              renderRouteDraft(L);
              propsRef.current.onRouteDrawn?.(shape);
            }
            return;
          }

          if (routeClickTimerRef.current !== null) window.clearTimeout(routeClickTimerRef.current);
          routeClickTimerRef.current = window.setTimeout(() => {
            routeClickTimerRef.current = null;
            // Прилипание к существующей трассе: новая линия, начатая рядом
            // со старой, должна к ней цепляться — иначе в стыке остаётся
            // разрыв, которого на земле нет.
            const snap = snapClick(lat, lon, 12);
            routeDraftRef.current.push(snap ? [snap.lat, snap.lon] : [lat, lon]);
            renderRouteDraft(L);
          }, 220);
          return;
        }

        // Measure mode
        if (p.measureMode) {
          const cs = measureStateRef.current;
          const snap = p.measureShape === 'area' ? null : snapClick(lat, lon, 14);
          cs.coords.push(snap ? [snap.lat, snap.lon] : [lat, lon]);
          cs.snaps.push(snap);
          renderMeasure(L);
          return;
        }

        // Drawing tool
        if (p.activeTool) {
          handleDrawClick(L, lat, lon);
          return;
        }

        // Edit mode: add subscriber. Placement mode: place OLT/TB/ORK
        // Edit mode: add subscriber. Placement mode: place OLT/TB/ORK.
        // Selection mode: record rectangle corner.
        if ((p.editMode || p.placingMode || p.selectingMode) && p.onMapClick) {
          p.onMapClick(lat, lon);
          return;
        }
      });

      // Right-click: finish polygon/line OR open context menu for "add here".
      map.on('contextmenu', (e: any) => {
        e.originalEvent.preventDefault();
        const p = propsRef.current;
        if (p.drawingRoute) {
          finishRouteDraft();
          return;
        }
        if (p.activeTool === 'polygon' || p.activeTool === 'line') {
          finishShape(L);
          return;
        }
        if (p.measureMode) {
          // reset measure
          measureStateRef.current = { coords: [], snaps: [], total: 0 };
          measureGroupRef.current?.clearLayers();
          return;
        }
        // Otherwise: hand off to host for a context menu (add point here, etc.)
        if (p.onMapContextMenu) {
          const oe = e.originalEvent as MouseEvent;
          p.onMapContextMenu(e.latlng.lat, e.latlng.lng, oe.clientX, oe.clientY);
        }
      });

      let lastPresenceSend = 0;
      map.on('mousemove', (e: any) => {
        // Прямоугольник и круг показываем прямо под курсором: без этого
        // второй клик ставят вслепую и промахиваются.
        const p = propsRef.current;
        if (p.drawingRoute && (p.drawShape === 'rect' || p.drawShape === 'circle')
            && routeDraftRef.current.length === 1) {
          const from = routeDraftRef.current[0];
          const to: [number, number] = [e.latlng.lat, e.latlng.lng];
          const coords = p.drawShape === 'rect' ? rectCoords(from, to) : circleCoords(from, to);
          if (shapeDraftRef.current) drawGroupRef.current?.removeLayer(shapeDraftRef.current);
          shapeDraftRef.current = coords.length >= 3
            ? L.polygon(coords, {
              color: '#38bdf8', weight: 3, opacity: 0.95, dashArray: '8,6',
              fillColor: '#38bdf8', fillOpacity: 0.12,
            })
            : null;
          if (shapeDraftRef.current) drawGroupRef.current?.addLayer(shapeDraftRef.current);
        }

        const now = Date.now();
        if (now - lastPresenceSend < 80) return;
        lastPresenceSend = now;
        propsRef.current.onPresenceCursorMove?.(e.latlng.lat, e.latlng.lng);
      });

      // Re-render on zoom (for drop visibility threshold)
      map.on('zoomend', () => {
        renderData();
        // План рисуется с толщиной по зуму — иначе на отдалении он снова
        // превращается в волос.
        renderPlanRoutes();
        // Объекты издали скучиваются, вблизи расходятся — значит зум их
        // тоже перерисовывает.
        renderSiteObjects();
        // Контуры раскрываются вглубь по мере приближения: издали область,
        // ближе районы, ещё ближе сёла.
        renderAreas();
      });

      // Стрелки направления и подписи длин рисуются только для того, что
      // сейчас в окне, — значит при перемотке карты их надо досчитать.
      // С задержкой: перетаскивание карты не должно тянуть за собой
      // перерисовку сотни трасс на каждом кадре.
      const rememberView = () => {
        try {
          const c = map.getCenter();
          const v = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
          if (propsRef.current.mapViewRef) propsRef.current.mapViewRef.current = v;
          // Адрес правим без записи в историю: иначе кнопка «назад»
          // отматывала бы карту по кадру за раз вместо возврата назад.
          window.history.replaceState(null, '', buildMapHash(v));
        } catch {
          // Карта ещё не готова — положение запомним на следующем движении.
        }
      };
      rememberView();

      map.on('moveend', () => {
        rememberView();
        if (panTimerRef.current !== null) window.clearTimeout(panTimerRef.current);
        panTimerRef.current = window.setTimeout(() => {
          panTimerRef.current = null;
          renderPlanRoutes();
        }, 260);
      });
      map.on('zoomend', rememberView);

      // After map ready: render existing data and fit bounds if already loaded
      setTimeout(() => {
        renderData();
        renderAnnotations();
        const districts = propsRef.current.districts;
        // Ссылку открыли ради конкретного места — уводить с него карту
        // на общий план значит не открыть ссылку вовсе.
        if (districts.length > 0 && !openedFromLinkRef.current) {
          const pts: [number, number][] = [];
          for (const d of districts) {
            pts.push([d.olt.lat, d.olt.lon]);
            for (const tb of d.olt.transitBoxes) {
              pts.push([tb.lat, tb.lon]);
              for (const ork of tb.orks) pts.push([ork.lat, ork.lon]);
            }
          }
          if (pts.length > 0) {
            try { map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 }); } catch {}
          }
        }
      }, 200);
    });

    const onResize = () => mapRef.current?.invalidateSize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
    };
  }, []);

  // ESC key cancels drawing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (propsRef.current.activeTool) {
          propsRef.current.setActiveTool(null);
          drawStateRef.current = { coords: [] };
          drawGroupRef.current?.clearLayers();
        }
        if (propsRef.current.measureMode) {
          propsRef.current.setMeasureMode(false);
          measureStateRef.current = { coords: [], snaps: [], total: 0 };
          measureGroupRef.current?.clearLayers();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Switch base map
  useEffect(() => {
    if (!mapRef.current) return;
    import('leaflet').then((L) => {
      if (tileLayerRef.current) tileLayerRef.current.remove();
      if (hybridLabelsRef.current) { hybridLabelsRef.current.remove(); hybridLabelsRef.current = null; }
      const bm = BASEMAPS[baseMap];
      const tile = cachedTileLayer(L, bm.url, {
        attribution: bm.attribution, subdomains: (bm.subdomains ?? '') as any, maxZoom: bm.maxZoom ?? 20,
      }).addTo(mapRef.current);
      tileLayerRef.current = tile;
      // For hybrid: add CartoDB labels overlay on top of Esri satellite
      if (baseMap === 'hybrid') {
        hybridLabelsRef.current = L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
          { attribution: '', subdomains: 'abcd' as any, maxZoom: 20, pane: 'shadowPane' },
        ).addTo(mapRef.current);
      }
    });
  }, [baseMap]);

  // Cursor based on mode
  useEffect(() => {
    if (!containerRef.current) return;
    if (props.activeTool || props.editMode || props.measureMode || props.placingMode || props.selectingMode) {
      containerRef.current.style.cursor = 'crosshair';
    } else {
      containerRef.current.style.cursor = '';
    }
  }, [props.activeTool, props.editMode, props.measureMode, props.placingMode, props.selectingMode]);

  function entityDraggable(kind: 'olt' | 'tb' | 'ork', id: string): boolean {
    const p = propsRef.current;
    const t = p.moveEntityTarget;
    if (t?.kind === kind && t.id === id) return true;
    return !!p.editMode;
  }

  function wireEntityMarker(marker: any, kind: 'olt' | 'tb' | 'ork', id: string) {
    let dragged = false;
    marker.on('dragstart', () => {
      dragged = true;
      entityDragRef.current = true;
    });
    marker.on('dragend', (e: any) => {
      const ll = e.target.getLatLng();
      propsRef.current.moveEntity?.(kind, id, ll.lat, ll.lng);
      window.setTimeout(() => {
        dragged = false;
        entityDragRef.current = false;
      }, 50);
    });
    marker.on('dblclick', (e: any) => {
      e.originalEvent?.stopPropagation?.();
      propsRef.current.onEntityDoubleClick?.(kind, id);
    });
    marker.on('click', (e: any) => {
      if (dragged || entityDragRef.current) return;
      e.originalEvent?.stopPropagation?.();
      propsRef.current.onEntityClick?.(kind, id);
    });
    marker.on('contextmenu', (e: any) => {
      e.originalEvent?.preventDefault?.();
      propsRef.current.onEntityClick?.(kind, id);
    });
  }

  // Перетаскивание для объектов без полноценного инспектора (муфты, абоненты):
  // вешаем только drag, существующий click/contextmenu сохраняется.
  function wireDragOnly(marker: any, kind: 'joint' | 'sub', id: string) {
    marker.on('dragstart', () => { entityDragRef.current = true; });
    marker.on('dragend', (e: any) => {
      const ll = e.target.getLatLng();
      propsRef.current.moveEntity?.(kind, id, ll.lat, ll.lng);
      window.setTimeout(() => { entityDragRef.current = false; }, 50);
    });
  }

  function renderData() {
    const map = mapRef.current;
    const group = dataGroupRef.current;
    if (!map || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      // На стройке проектная сеть не рисуется: она не помогает прорабу и
      // забивает карту объектами, которых он не ведёт.
      if (propsRef.current.hideNetwork) return;
      const { districts, cables, layers, joints, moveEntityTarget, snapHighlightId, snapHighlightIds } = propsRef.current;
      const isSnapTarget = (id: string) =>
        snapHighlightId === id || (snapHighlightIds?.has(id) ?? false);
      const zoom = map.getZoom();
      const ms = markerScale(zoom);
      // Базовые размеры → пиксели для конкретного зума
      const px = (base: number) => Math.max(8, Math.round(base * ms));

      if (layers.cables) {
        // ── Параллельные кабели на одной дороге ──
        // Разные OLT, идущие по одной улице, архитектурно остаются отдельными
        // кабелями (разные оптические сигналы). Чтобы они не накладывались
        // визуально в один полилайн, считаем для каждого кабеля «полосу»
        // (lane index) на основе общих сегментов с соседями и рендерим со
        // сдвигом перпендикулярно направлению. На реальной карте это видно
        // как несколько тонких линий рядом, а не одна толстая чёрная.
        const lanes = computeCableLanes(cables);

        for (const cable of cables) {
          const layerKey = CABLE_LAYER_KEY[cable.type];
          if (!layers[layerKey]) continue;
          if (cable.type === 'ОК-4' && zoom < 14) continue;

          const isEditing = propsRef.current.editingCableId === cable.id;
          const hl = propsRef.current.highlightCableIds;
          const diffMode = !!propsRef.current.scenarioMapDiff;
          const dimmed = !!hl && !hl.has(cable.id);
          const inBranch = !!hl && hl.has(cable.id);
          const inDiff = diffMode && hl?.has(cable.id);
          const lane = lanes.get(cable.id) ?? 0;
          // 0.6 m между параллельными «полосами» — компактно, помещается в ширину
          // полосы дороги.  Знакочередование вокруг центра, кап на 4 полосе.
          // Дропы (ОК-4) — короткие, без offset, чтобы не вылетать с двора.
          const skipOffset = cable.type === 'ОК-4' || cable.lengthM < 80;
          const offsetM = skipOffset || lane === 0
            ? 0
            : ((lane % 2 === 1 ? 1 : -1) * Math.ceil(lane / 2)) * 0.6;
          const drawnCoords = offsetM === 0 ? cable.coords : offsetPolyline(cable.coords, offsetM);

          const poly = L.polyline(drawnCoords, {
            color: dimmed
              ? '#334155'
              : inDiff
                ? '#fbbf24'
                : isEditing
                  ? '#c4b5fd'
                  : (CABLE_COLORS[cable.type] || '#888'),
            weight: dimmed
              ? 1.5
              : ((CABLE_WEIGHTS[cable.type] || 3) + (isEditing ? 2 : inDiff ? 2 : inBranch ? 1 : 0))
                * lineScale(zoom),
            opacity: dimmed ? 0.12 : inDiff || inBranch ? 1 : (cable.type === 'ОК-4' ? 0.6 : 0.85),
            // Клики ловит широкая «hit»-линия ниже, чтобы по кабелю было легко
            // попасть без приближения карты.
            interactive: false,
          });
          const cableTitle = cable.displayName
            ? `<b>${cable.displayName}</b><br/><span style="font-size:10px;color:#94a3b8">${cable.type}</span>`
            : `<b>${cable.type}</b>`;
          const installNote = cable.installType
            ? `<br/>Прокладка: ${({ aerial: 'Воздушная', duct: 'В канализации', ground: 'В грунте' } as Record<string, string>)[cable.installType] ?? cable.installType}`
            : '';
          // Попап по клику (как у ОРК/муфты): откуда → куда, тип, начало/конец.
          const fromL = endpointLabel(districts, cable.fromId, joints);
          const toL = endpointLabel(districts, cable.toId, joints);
          const start = cable.coords[0];
          const end = cable.coords[cable.coords.length - 1];
          const fmt = (p: [number, number]) => `${p[0].toFixed(5)}, ${p[1].toFixed(5)}`;
          const tooltipHtml = `${cableTitle}<br/>${cable.fromId} → ${cable.toId}<br/>Длина: ${Math.round(cable.lengthM)} м${installNote}${lane > 0 ? `<br/><i style=\"color:#94a3b8\">полоса ${lane}</i>` : ''}`;
          const popupHtml = `<b>${cable.displayName || cable.type}</b>`
            + `<br/>Тип: <b>${cable.type}</b> · ${cable.fibers} вол.`
            + `<br/>Откуда: ${fromL.label} <span style="color:#94a3b8;font-size:10px">${fromL.shortId}</span>`
            + `<br/>Куда: ${toL.label} <span style="color:#94a3b8;font-size:10px">${toL.shortId}</span>`
            + `<br/>Длина: ${Math.round(cable.lengthM)} м${installNote}`
            + `<br/><span style="color:#64748b;font-size:10px">Начало: ${fmt(start)}<br/>Конец: ${fmt(end)}</span>`;
          group.addLayer(poly);
          // Широкая прозрачная линия-«хваталка»: увеличивает зону клика по кабелю.
          if (!dimmed) {
            const hit = L.polyline(drawnCoords, {
              color: '#ffffff',
              weight: Math.max(16, (CABLE_WEIGHTS[cable.type] || 2) + 12),
              opacity: 0,
              interactive: true,
              bubblingMouseEvents: false,
            });
            hit.bindTooltip(tooltipHtml, { sticky: true, className: 'text-xs' });
            hit.bindPopup(popupHtml);
            hit.on('click', (e: any) => {
              e.originalEvent?.stopPropagation?.();
              propsRef.current.onCableClick?.(cable.id);
            });
            group.addLayer(hit);
          }
        }

        const diff = propsRef.current.scenarioMapDiff;
        if (diff) {
          const dash = '10 8';
          for (const d of diff.removed) {
            if (d.cable.coords.length < 2) continue;
            L.polyline(d.cable.coords, {
              color: '#f87171', weight: 4, opacity: 0.85, dashArray: dash,
            }).bindTooltip(
              `<b>− Сценарий A</b><br/>${d.cable.type} · ${Math.round(d.cable.lengthM)} м<br/><span style="color:#94a3b8">нет в B</span>`,
              { sticky: true, className: 'text-xs' },
            ).addTo(group);
          }
          for (const d of diff.added) {
            if (d.cable.coords.length < 2) continue;
            L.polyline(d.cable.coords, {
              color: '#34d399', weight: 4, opacity: 0.9, dashArray: dash,
            }).bindTooltip(
              `<b>+ Сценарий B</b><br/>${d.cable.type} · ${Math.round(d.cable.lengthM)} м`,
              { sticky: true, className: 'text-xs' },
            ).addTo(group);
          }
          for (const d of diff.modified) {
            if (d.cable.coords.length < 2) continue;
            L.polyline(d.cable.coords, {
              color: '#fbbf24', weight: 5, opacity: 0.95,
            }).bindTooltip(
              `<b>Δ A→B</b><br/>${d.deltaLengthM != null && d.deltaLengthM >= 0 ? '+' : ''}${d.deltaLengthM ?? 0} м<br/>${d.cable.type}`,
              { sticky: true, className: 'text-xs' },
            ).addTo(group);
            if (d.other && d.other.coords.length >= 2) {
              L.polyline(d.other.coords, {
                color: '#f87171', weight: 2, opacity: 0.35, dashArray: '4 6',
              }).addTo(group);
            }
          }
        }
      }

      // In-line муфты — точки расхождения магистрали (создаются консолидацией)
      if (layers.tb && joints && zoom >= 13) {
        for (const j of joints) {
          if (nearestTbToJoint(j, districts, 8)) continue;
          const icon = L.divIcon({
            html: `<div style="width:14px;height:14px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;background:#0d1b2a;border:1.5px solid #38bdf8;border-radius:50%;color:#38bdf8;box-shadow:0 0 4px rgba(56,189,248,0.6)">⊕</div>`,
            className: '', iconSize: [14, 14], iconAnchor: [7, 7],
          });
          const canDrag = !!propsRef.current.editMode;
          const m = L.marker([j.lat, j.lon], { icon, draggable: canDrag });
          m.bindTooltip(
            `<b>Транзитная муфта</b><br/>${j.id}<br/>Ответвлений: ${j.branchCount}<br/><i style="font-size:10px;color:#94a3b8">Клик — что внутри${canDrag ? ' · тащи — переместить' : ''}</i>`,
            { sticky: true, className: 'text-xs' },
          );
          m.on('click', (e: any) => {
            if (entityDragRef.current) return;
            e.originalEvent?.stopPropagation?.();
            propsRef.current.onJointClick?.(j.id);
          });
          if (canDrag) wireDragOnly(m, 'joint', j.id);
          group.addLayer(m);
        }
      }

      for (const district of districts) {
        const { olt } = district;
        if (layers.olt) {
          const moveHere = moveEntityTarget?.kind === 'olt' && moveEntityTarget.id === olt.id;
          const snapHere = isSnapTarget(olt.id);
          const wOlt = px(44), hOlt = px(24), fOlt = Math.max(9, Math.round(10 * ms));
          const icon = L.divIcon({
            html: `<div style="width:${wOlt}px;height:${hOlt}px;display:flex;align-items:center;justify-content:center;font-size:${fOlt}px;font-weight:700;font-family:monospace;background:linear-gradient(135deg,#f59e0b,#fbbf24);border:2px solid ${snapHere ? '#34d399' : moveHere ? '#a78bfa' : '#f59e0b'};border-radius:4px;color:#0a0e1a;box-shadow:0 ${snapHere || moveHere ? '0 12px' : '2px 8px'} rgba(${snapHere ? '52,211,153' : moveHere ? '167,139,250' : '0,0,0'},0.55)">OLT</div>`,
            className: '', iconSize: [wOlt, hOlt], iconAnchor: [Math.round(wOlt / 2), Math.round(hOlt / 2)],
          });
          const canDrag = entityDraggable('olt', olt.id);
          const m = L.marker([olt.lat, olt.lon], { icon, draggable: canDrag });
          m.bindPopup(`<b>${olt.displayName || olt.id}</b>${olt.displayName ? `<br/><span style="font-size:10px;color:#64748b">${olt.id}</span>` : ''}<br/>${olt.model}<br/>Район: ${district.name}<br/>Ёмкость: ${olt.capacity}<br/>TB: ${olt.transitBoxes.length}<br/><i style="font-size:10px;color:#94a3b8">Двойной клик — режим перемещения</i>`);
          if (olt.displayName && zoom >= 15) m.bindTooltip(olt.displayName, { permanent: true, direction: 'right', offset: [12, 0], className: 'entity-label' });
          wireEntityMarker(m, 'olt', olt.id);
          group.addLayer(m);
        }
        for (const tb of olt.transitBoxes) {
          if (layers.tb) {
            const moveHere = moveEntityTarget?.kind === 'tb' && moveEntityTarget.id === tb.id;
            const snapHere = isSnapTarget(tb.id);
            const canDrag = entityDraggable('tb', tb.id);
            const tbSize = px(20), tbFont = Math.max(11, Math.round(13 * ms));
            const iconTb = L.divIcon({
              html: `<div style="width:${tbSize}px;height:${tbSize}px;display:flex;align-items:center;justify-content:center;font-size:${tbFont}px;font-weight:700;background:#0d1b2a;border:2px solid ${snapHere ? '#34d399' : moveHere ? '#a78bfa' : '#38bdf8'};border-radius:50%;color:#38bdf8;box-shadow:0 0 ${snapHere || moveHere ? '10px' : '5px'} rgba(${snapHere ? '52,211,153' : '56,189,248'},0.75)">⊕</div>`,
              className: '', iconSize: [tbSize, tbSize], iconAnchor: [Math.round(tbSize / 2), Math.round(tbSize / 2)],
            });
            const m = L.marker([tb.lat, tb.lon], { icon: iconTb, draggable: canDrag });
            m.bindPopup(`<b>${tb.displayName || tb.id}</b>${tb.displayName ? `<br/><span style="font-size:10px;color:#64748b">${tb.id}</span>` : ''}<br/>OLT: ${olt.id}<br/>ОРК: ${tb.orks.length}<br/>Муфта: ${tb.muftaType}<br/><i style="color:#64748b;font-size:10px">Двойной клик — переместить</i>`);
            if (tb.displayName && zoom >= 15) m.bindTooltip(tb.displayName, { permanent: true, direction: 'right', offset: [10, 0], className: 'entity-label' });
            wireEntityMarker(m, 'tb', tb.id);
            group.addLayer(m);
          }
          for (const ork of tb.orks) {
            if (layers.ork) {
              const moveHere = moveEntityTarget?.kind === 'ork' && moveEntityTarget.id === ork.id;
              const snapHere = isSnapTarget(ork.id);
              const canDrag = entityDraggable('ork', ork.id);
              const wOrk = px(36), hOrk = px(20), fOrk = Math.max(9, Math.round(10 * ms));
              const iconOrk = L.divIcon({
                html: `<div style="width:${wOrk}px;height:${hOrk}px;display:flex;align-items:center;justify-content:center;font-size:${fOrk}px;font-weight:600;font-family:monospace;background:#1a2744;border:2px solid ${snapHere ? '#34d399' : moveHere ? '#a78bfa' : '#f59e0b'};border-radius:3px;color:#f59e0b;box-shadow:0 1px 4px rgba(0,0,0,0.4)">ОРК</div>`,
                className: '', iconSize: [wOrk, hOrk], iconAnchor: [Math.round(wOrk / 2), Math.round(hOrk / 2)],
              });
              const m = L.marker([ork.lat, ork.lon], { icon: iconOrk, draggable: canDrag });
              m.bindPopup(`<b>${ork.displayName || ork.id}</b>${ork.displayName ? `<br/><span style="font-size:10px;color:#64748b">${ork.id}</span>` : ''}<br/>Сплиттер: ${ork.splitter}<br/>Або.: ${ork.subscribers.length}<br/>Муфта: ${tb.id}<br/><i style="color:#64748b;font-size:10px">Двойной клик — переместить</i>`);
              if (ork.displayName && zoom >= 15) m.bindTooltip(ork.displayName, { permanent: true, direction: 'right', offset: [10, 0], className: 'entity-label' });
              wireEntityMarker(m, 'ork', ork.id);
              group.addLayer(m);
            }
            if (layers.subscribers && zoom >= 11) {
              const budgetMap = propsRef.current.budgetMap;
              const colorByBudget = propsRef.current.budgetColoring;
              for (const sub of ork.subscribers) {
                // Camera + pole-mounted ONT box (Бокс на столбе): on the
                // physical layout every camera has its own small box on
                // the pole — the cable enters it, ONT lives inside, and
                // 2 fibers (working + spare) feed up to the camera.  We
                // render this as a small filled square with a coloured
                // dot inside, where the colour = camera-type:
                //   amber = ЛУ, red = Перекрёсток, sky = ОВН.
                // If kind is missing (old project / build flow), we fall
                // back to the district colour so the camera doesn't end
                // up indistinguishable gray.
                const camKind = sub.kind ?? 'unknown';
                let dotColor = camKind === 'unknown' ? district.color : CAMERA_KIND_COLOR[camKind];
                if (colorByBudget && budgetMap) {
                  const s = budgetMap.get(sub.id);
                  if (s === 'ok')   dotColor = '#34d399';
                  if (s === 'warn') dotColor = '#f59e0b';
                  if (s === 'fail') dotColor = '#f87171';
                }
                // Larger box for intersection cameras so the busiest type
                // pops on the map. Базовые размеры подняты и масштабируются
                // от зума: на z11-12 видны как мелкие точки, на z16+ — крупные.
                const boxBase = camKind === 'intersection' ? 14 : 12;
                const dotBase = camKind === 'intersection' ? 6 : 5;
                const boxPx = Math.max(7, Math.round(boxBase * ms));
                const dotPx = Math.max(3, Math.round(dotBase * ms));
                const camLabel = CAMERA_KIND_LABEL[camKind];
                const bw = sub.minBandwidthMbps ?? CAMERA_MIN_BANDWIDTH_MBPS[camKind];
                const canDragSub = !!propsRef.current.editMode;
                // Прозрачная обёртка увеличивает зону захвата/клика по боксу,
                // особенно в режиме редактирования (легче перетаскивать).
                const hitPx = canDragSub ? 24 : 18;
                const icon = L.divIcon({
                  className: '',
                  iconSize: [hitPx, hitPx],
                  iconAnchor: [hitPx / 2, hitPx / 2],
                  html: `<div style="width:${hitPx}px;height:${hitPx}px;display:flex;align-items:center;justify-content:center;${canDragSub ? 'cursor:move;' : ''}">
                    <div style="
                    width:${boxPx}px;height:${boxPx}px;
                    background:#0d1b2a;
                    border:1.5px solid ${dotColor};
                    border-radius:2px;
                    box-shadow:0 0 3px rgba(0,0,0,0.6);
                    display:flex;align-items:center;justify-content:center
                  "><div style="width:${dotPx}px;height:${dotPx}px;background:${dotColor};border-radius:50%"></div></div></div>`,
                });
                const m = L.marker([sub.lat, sub.lon], { icon, draggable: canDragSub });
                if (canDragSub) wireDragOnly(m, 'sub', sub.id);
                const branchBtn = `<button onclick="window.__showBranchSub__('${sub.id}')" style="margin-top:6px;padding:2px 8px;background:#38bdf8;color:#0a0e1a;border:none;border-radius:3px;font-size:10px;cursor:pointer;font-weight:600">🌿 Показать ветку</button>`;
                const delBtn = propsRef.current.editMode ? '<br/><button onclick="window.__deleteSub__(\'' + sub.id + '\')" style="margin-top:6px;padding:2px 8px;background:#f87171;color:#fff;border:none;border-radius:3px;font-size:10px;cursor:pointer">Удалить</button>' : '';
                m.bindPopup(`<b>${sub.desc}</b><br/>Тип: <b>${camLabel}</b> · ${bw} Мбит/с<br/>📦 Бокс на столбе → ОРК: ${ork.id}<br/>Волокна: ${sub.fibers.working}+${sub.fibers.spare}<br/>${branchBtn}${delBtn}`);
                m.on('contextmenu', (e: any) => {
                  e.originalEvent.preventDefault();
                  if (propsRef.current.editMode && confirm(`Удалить абонента «${sub.desc}»?`)) {
                    propsRef.current.deleteSubscriber?.(sub.id);
                  }
                });
                group.addLayer(m);
              }
            }
          }
        }
      }

      // ── Unassigned subscribers (raw KML before build) ──
      // Districts is empty (or sub.id isn't found in any ORK).  Show as
      // gray dots so the user can see what was loaded before clustering.
      const assigned = new Set<string>();
      for (const d of districts) {
        for (const tb of d.olt.transitBoxes) {
          for (const ork of tb.orks) for (const s of ork.subscribers) assigned.add(s.id);
        }
      }
      const unassigned = (propsRef.current.unassignedSubscribers ?? [])
        .filter((s) => !assigned.has(s.id));
      if (layers.subscribers && unassigned.length > 0) {
        const baseR = Math.max(2, Math.round(3.5 * ms));
        for (const s of unassigned) {
          const camKind = s.kind ?? 'unknown';
          const color = CAMERA_KIND_COLOR[camKind] ?? '#94a3b8';
          const c = L.circleMarker([s.lat, s.lon], {
            radius: camKind === 'intersection' ? baseR + 1 : baseR,
            color,
            fillColor: color,
            fillOpacity: 0.7,
            weight: 1,
          });
          const camLabel = CAMERA_KIND_LABEL[camKind];
          c.bindTooltip(`<b>${s.desc}</b><br/>Тип: ${camLabel} · ${s.minBandwidthMbps ?? CAMERA_MIN_BANDWIDTH_MBPS[camKind]} Мбит/с<br/>${s.district}`, { sticky: true, className: 'text-xs' });
          group.addLayer(c);
        }
      }
    });
  }

  function renderAnnotations() {
    const map = mapRef.current;
    const group = annoGroupRef.current;
    if (!map || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      for (const a of propsRef.current.annotations) {
        const preset = ANNOTATION_PRESETS[a.type];
        const color = a.color || preset.color;
        const popup = `<div style="min-width:160px"><b>${preset.icon} ${a.name || preset.label}</b>${a.description ? `<br/><span style="color:#94a3b8">${a.description}</span>` : ''}<br/><span style="color:#64748b;font-size:10px">${preset.label}</span></div>`;

        if (a.shape === 'point' && a.coords[0]) {
          const [lat, lon] = a.coords[0];
          const icon = L.divIcon({
            html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:${color}33;border:2px solid ${color};border-radius:50%;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.5)">${preset.icon}</div>`,
            className: '', iconSize: [28, 28], iconAnchor: [14, 14],
          });
          const m = L.marker([lat, lon], { icon });
          m.bindPopup(popup);
          group.addLayer(m);
        } else if (a.shape === 'polygon' && a.coords.length >= 3) {
          const poly = L.polygon(a.coords, {
            color, weight: 2, fillColor: color, fillOpacity: 0.15, opacity: 0.8,
          });
          poly.bindPopup(popup);
          poly.bindTooltip(`${preset.icon} ${a.name || preset.label}`, { sticky: true });
          group.addLayer(poly);
        } else if (a.shape === 'line' && a.coords.length >= 2) {
          const line = L.polyline(a.coords, { color, weight: 3, dashArray: '6,4', opacity: 0.85 });
          line.bindPopup(popup);
          line.bindTooltip(`${preset.icon} ${a.name || preset.label}`, { sticky: true });
          group.addLayer(line);
        } else if (a.shape === 'arrow' && a.coords.length >= 2) {
          // Стрелка — то, чем на распечатке показывают «вот сюда».
          // Сплошная, с наконечником на последней вершине.
          const line = L.polyline(a.coords, { color, weight: 3, opacity: 0.9 });
          line.bindPopup(popup);
          line.bindTooltip(`${preset.icon} ${a.name || preset.label}`, { sticky: true });
          group.addLayer(line);

          const tip = a.coords[a.coords.length - 1];
          const prev = a.coords[a.coords.length - 2];
          group.addLayer(L.marker(tip, {
            interactive: false,
            zIndexOffset: 300,
            icon: L.divIcon({
              className: '',
              iconSize: [0, 0],
              iconAnchor: [0, 0],
              html: `<div style="transform:translate(-7px,-8px) rotate(${bearingDeg(prev, tip).toFixed(0)}deg);
                font-size:15px;line-height:1;color:${color};
                text-shadow:0 0 3px #000">▲</div>`,
            }),
          }));
        } else if (a.shape === 'circle' && a.coords[0] && a.radius) {
          const [lat, lon] = a.coords[0];
          const c = L.circle([lat, lon], {
            radius: a.radius, color, weight: 2, fillColor: color, fillOpacity: 0.15, opacity: 0.8,
          });
          c.bindPopup(popup);
          c.bindTooltip(`${preset.icon} ${a.name || preset.label} (R=${Math.round(a.radius)}м)`, { sticky: true });
          group.addLayer(c);
        }

        // Подпись видна без клика. Пометка, которую надо сначала найти
        // мышью, чтобы прочитать, — это не пометка, а загадка.
        if (a.name && a.shape !== 'point') {
          const at = a.shape === 'circle' ? a.coords[0] : a.coords[a.coords.length - 1];
          if (at) {
            group.addLayer(L.marker(at, {
              interactive: false,
              zIndexOffset: 280,
              icon: L.divIcon({
                className: '',
                iconSize: [0, 0],
                iconAnchor: [0, 0],
                html: `<div style="transform:translate(10px,-6px);white-space:nowrap;
                  padding:1px 5px;border-radius:4px;background:#0c1018dd;
                  border:1px solid ${color}88;color:#e2e8f0;font-size:10px;
                  font-weight:600">${esc(a.name)}</div>`,
              }),
            }));
          }
        }
      }
    });
  }

  /**
   * Проколы ГНБ/ГНП из журнала стройки.
   * Отдельная группа слоёв: не очищается перестройкой сети и переживает зум.
   */
  function renderDrillPoints() {
    const group = drillGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const pts = propsRef.current.drillPoints ?? [];
      if (pts.length === 0) return;

      for (const p of pts) {
        // ГНБ розовый, ГНП оранжевый: янтарный занят трассой с проложенной
        // трубой, и два разных смысла одним цветом читать невозможно.
        const color = DRILL_COLOR[p.drillKind];
        const icon = L.divIcon({
          className: '',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          html: `<div style="width:12px;height:12px;background:${color};border:1.5px solid #06080f;
                 transform:rotate(45deg);box-shadow:0 0 6px ${color}99"></div>`,
        });
        const m = L.marker([p.lat, p.lon], { icon });
        const len = p.meters ? `${p.meters} м` : '—';
        const when = p.date ? new Date(`${p.date}T00:00:00Z`).toLocaleDateString('ru') : '—';
        m.bindPopup(
          `<b>${p.drillKind}</b> · ${len}<br/>` +
          `${p.uchastok || '—'}<br/>` +
          `<span style="color:#64748b;font-size:11px">${p.oblast || ''} · ${when}</span>` +
          (p.note ? `<br/><span style="font-size:11px">${p.note.replace(/</g, '&lt;')}</span>` : '') +
          routeLinks(p.lat, p.lon),
        );
        group.addLayer(m);
      }
    });
  }

  /**
   * Колонны на карте.
   *
   * Метка крупная и подписанная: с одного взгляда видно, какая бригада где
   * стоит и чем занята. Цвет кружка — вид работ, кольцо — состояние
   * (работает, ждёт, закончила, простой). Метка перетаскивается — так
   * бригаду переносят на другой участок.
   */
  function renderCrews() {
    const group = crewGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const crews = propsRef.current.crews ?? [];
      if (crews.length === 0) return;

      for (const c of crews) {
        if (typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;

        const kind = CREW_KINDS[c.kind];
        const st = CREW_STATUS[c.status];
        const onDuty = c.members.filter((m) => !m.dayOff).length;
        const equip = Object.values(c.equipment ?? {}).reduce((s, v) => s + (v || 0), 0);
        // Работающая колонна мягко пульсирует — глаз сам находит активные.
        const pulse = c.status === 'working'
          ? 'animation: optiq-crew-pulse 2.2s ease-in-out infinite;'
          : '';

        // Выведенная по журналу — пунктиром: это счёт бригад, а не карточка.
        const ring = c.derived ? 'dashed' : 'solid';

        const icon = L.divIcon({
          className: '',
          iconSize: [46, 58],
          iconAnchor: [23, 52],
          html: `
            <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
              <div style="
                width:38px;height:38px;border-radius:50%;
                background:${kind.color}22;border:3px ${ring} ${st.color};
                box-shadow:0 0 10px ${st.color}66, 0 2px 6px rgba(0,0,0,.6);
                display:flex;align-items:center;justify-content:center;
                font-size:19px;line-height:1;${pulse}
              ">${kind.icon}</div>
              <div style="
                margin-top:2px;padding:1px 5px;border-radius:4px;white-space:nowrap;
                background:#0c1018ee;border:1px solid ${kind.color}88;
                color:${kind.color};font-size:10px;font-weight:600;
                font-family:ui-monospace,monospace;
              ">${esc(c.name)}</div>
            </div>`,
        });

        // Выведенную колонну таскать нечего: её место считается по журналу,
        // и ручной сдвиг некуда записать — карточки в справочнике нет.
        const draggable = !!propsRef.current.onMoveCrew && !c.derived;
        const m = L.marker([c.lat, c.lon], { icon, draggable, zIndexOffset: 800 });

        const roster = c.members.length === 0
          ? '<i style="color:#64748b">состав не заполнен</i>'
          : c.members.map((mem) => {
              const off = mem.dayOff
                ? ' <span style="color:#f87171">выходной</span>'
                : '';
              const role = mem.role ? ` <span style="color:#64748b">· ${esc(mem.role)}</span>` : '';
              return `${esc(mem.name)}${role}${off}`;
            }).join('<br/>');

        const equipList = Object.entries(c.equipment ?? {})
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${esc(k)} — ${v}`)
          .join('<br/>') || '<i style="color:#64748b">техника не указана</i>';

        m.bindPopup(`
          <div style="min-width:210px">
            <b style="color:${kind.color}">${kind.icon} ${esc(c.name)}</b>
            <span style="color:#64748b;font-size:11px"> · ${esc(kind.label)}</span><br/>
            <span style="color:${st.color};font-size:11px">● ${esc(st.label)}</span>
            ${c.uchastok ? `<br/><span style="font-size:11px">${esc(c.uchastok)}</span>` : ''}
            ${c.contractor ? `<br/><span style="color:#64748b;font-size:11px">${esc(c.contractor)}</span>` : ''}
            ${crewTripLine(c.trip)}
            ${c.derived
              ? `<div style="margin-top:6px;padding-top:5px;border-top:1px solid #1e293b;font-size:11px;color:#94a3b8">
                   Колонна выведена по журналу — состав и технику в дневном
                   отчёте не пишут. Заведите её в разделе «Колонны», чтобы
                   вписать людей и машины.
                 </div>`
              : `<div style="margin-top:6px;padding-top:5px;border-top:1px solid #1e293b">
              <b style="font-size:11px">Состав</b>
              <span style="color:#64748b;font-size:11px">— в строю ${onDuty} из ${c.members.length}</span>
              <div style="font-size:11px;margin-top:2px">${roster}</div>
            </div>
            <div style="margin-top:6px;padding-top:5px;border-top:1px solid #1e293b">
              <b style="font-size:11px">Техника</b>
              <span style="color:#64748b;font-size:11px">— ${equip} ед.</span>
              <div style="font-size:11px;margin-top:2px">${equipList}</div>
            </div>`}
            ${c.note ? `<div style="margin-top:5px;font-size:11px;color:#94a3b8">${esc(c.note)}</div>` : ''}
            ${c.placement?.date && c.placement.source !== 'manual'
              ? `<div style="margin-top:6px;font-size:10px;color:#64748b">
                   ${c.placement.source === 'progress' ? 'По метражу вдоль трассы' : 'Встала по отчёту'},
                   ${new Date(`${c.placement.date}T00:00:00Z`).toLocaleDateString('ru')}
                 </div>`
              : ''}
            ${routeLinks(c.lat as number, c.lon as number)}
            ${draggable ? '<div style="margin-top:6px;font-size:10px;color:#64748b">Перетащите метку, чтобы перебросить колонну</div>' : ''}
          </div>`);

        if (draggable) {
          m.on('dragend', (e: any) => {
            const ll = e.target.getLatLng();
            propsRef.current.onMoveCrew?.(c.id, ll.lat, ll.lng);
          });
        }
        group.addLayer(m);
      }
    });
  }

  /**
   * Отклонения от проекта на карте.
   *
   * Это память трассы: через три года аварийная бригада приедет копать и
   * увидит, что здесь кабель на 0,5 м, потому что скальник, а не на
   * проектных 1,2 м. Поэтому подпись несёт глубину и причину, а не только
   * факт отклонения.
   *
   * Красный пунктир — протокол мобильной группы не оформлен, янтарный —
   * оформлен: незакрытые видно сразу, не заходя в список.
   */
  function renderDeviations() {
    const group = deviationGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const items = propsRef.current.deviations ?? [];
      if (items.length === 0) return;

      for (const d of items) {
        const color = d.closed ? '#fbbf24' : '#f87171';
        const depth = d.actualDepthM !== undefined
          ? `${String(d.actualDepthM).replace('.', ',')} м`
          : null;
        const design = d.designDepthM !== undefined
          ? `${String(d.designDepthM).replace('.', ',')} м`
          : '1,2 м';

        const popup = `
          <div style="min-width:200px">
            <b style="color:${color}">
              ${d.kind === 'depth' ? 'Отклонение по глубине' : 'Отклонение по трассе'}
            </b><br/>
            ${depth
              ? `<span style="font-size:12px">Глубина <b>${depth}</b>
                 <span style="color:#64748b">вместо ${design}</span></span><br/>`
              : ''}
            <span style="font-size:12px">${esc(d.reason)}</span><br/>
            <span style="font-size:11px;color:#64748b">
              ${esc(d.uchastok || '—')} · ${d.lengthM} м
              ${d.date ? ` · ${new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ru')}` : ''}
            </span>
            ${d.contractor ? `<br/><span style="font-size:11px;color:#64748b">${esc(d.contractor)}</span>` : ''}
            <div style="margin-top:5px;font-size:11px;color:${color}">
              ${d.closed
                ? `✓ Протокол МГ №${esc(d.protocolNumber ?? '')}`
                : '⚠ Протокол мобильной группы не оформлен'}
            </div>
            ${d.coords[0] ? routeLinks(d.coords[0].lat, d.coords[0].lon) : ''}
          </div>`;

        if (d.coords.length >= 2) {
          const line = L.polyline(d.coords.map((p) => [p.lat, p.lon]), {
            color, weight: 5, opacity: 0.9, dashArray: '10,6',
          });
          line.bindPopup(popup);
          line.bindTooltip(
            depth ? `${depth} — ${esc(d.reason)}` : esc(d.reason),
            { sticky: true, className: 'text-xs' },
          );
          group.addLayer(line);
        }

        // Метка всегда на начале: отрезок в 50 м на общем плане не виден,
        // а знать о нём нужно.
        const [p0] = d.coords;
        const icon = L.divIcon({
          className: '',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          html: `<div style="
            width:22px;height:22px;border-radius:50%;
            background:${color}22;border:2px solid ${color};
            display:flex;align-items:center;justify-content:center;
            font-size:11px;font-weight:700;color:${color};
            box-shadow:0 0 8px ${color}66;
          ">${depth ? depth.replace(' м', '') : '!'}</div>`,
        });
        const m = L.marker([p0.lat, p0.lon], { icon, zIndexOffset: 700 });
        m.bindPopup(popup);
        group.addLayer(m);
      }
    });
  }

  /**
   * Проектная трасса — «как должно быть».
   *
   * Рисуется приглушённым пунктиром под фактическими кабелями: план нужен
   * как ориентир, а не как главный слой, иначе он перебьёт то, что реально
   * построено. Сравнение плана и факта видно глазом там, где линии расходятся.
   */
  function renderPlanRoutes() {
    const group = planGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const routes = propsRef.current.planRoutes ?? [];
      const drillLines = propsRef.current.drillLines ?? [];
      if (routes.length === 0 && drillLines.length === 0) return;
      const zoom = mapRef.current?.getZoom?.() ?? 10;

      const byMethod = propsRef.current.routeColorMode === 'method';
      const segments = propsRef.current.routeSegments ?? [];
      const segmented = new Set(segments.map((sg) => sg.routeId));

      // Докуда дошли по каждой трассе. Отдельной записи «дошли до такого-то
      // километра» никто не ведёт и вести не будет, но границы отрезков по
      // способам — это ровно она и есть.
      const doneByRoute = new Map<string, number>();
      for (const sg of segments) {
        doneByRoute.set(sg.routeId, Math.max(doneByRoute.get(sg.routeId) ?? 0, sg.toM));
      }

      // Стрелки и подписи — это маркеры, а их на сотне трасс набираются
      // тысячи. Рисуем только то, что сейчас на экране, и с общим потолком:
      // карта должна оставаться картой, а не списком значков.
      const view = mapRef.current?.getBounds?.();
      let arrowBudget = 140;
      let labelBudget = 50;

      for (const r of routes) {
        if (r.coords.length < 2) continue;
        // В режиме «по способу» трассу рисуют её отрезки, а сама линия
        // остаётся бледной подложкой: два смысла одним цветом не читаются.
        const asBase = byMethod && segmented.has(r.id);

        // Пройденная часть красится этапом, остаток остаётся проектом.
        // Сплошная цветная во всю длину обещала готовность, которой нет:
        // «докуда дошли» — вопрос, который задают глазами, а не процентом.
        const doneM = doneByRoute.get(r.id) ?? 0;
        const split = doneM > 0 && !asBase ? progressSplit(r.coords, doneM) : null;
        const partial = !!split && split.share > 0.01 && split.share < 0.99;

        const line = L.polyline(r.coords, {
          color: asBase ? '#475569' : partial ? PLAN_LINE_COLOR : r.color,
          // Проект — сплошная синяя, тоньше факта. Пунктир превращал её в
          // такую же штриховку, как у границ района, и трасса терялась
          // среди контуров. Тонкая и сплошная читается как трасса, а
          // толщина и цвет по-прежнему отличают проект от построенного.
          weight: (asBase || r.dashed || partial ? (asBase ? 2 : 2.5) : 4.5) * lineScale(zoom),
          opacity: asBase ? 0.5 : r.dashed || partial ? 0.8 : 0.95,
          dashArray: undefined,
        });
        const title = routeTitle(r);
        const stageLabel = r.stage ? SNP_STAGE_SPECS[r.stage].label : 'работ не было';
        line.bindTooltip(
          `${esc(title)} · ${esc(stageLabel)}${r.lengthM ? ` · ${(r.lengthM / 1000).toFixed(2)} км` : ''}`,
          { sticky: true, className: 'text-xs' },
        );
        line.bindPopup(
          `<b>${esc(title)}</b>`
          + (r.name && r.name !== title
            ? `<br/><span style="color:#64748b;font-size:11px">${esc(r.name)}</span>` : '')
          + `<div style="margin-top:4px;color:${r.color};font-size:12px">${esc(stageLabel)}</div>`
          + (r.snp ? `<span style="font-size:11px">${esc(r.snp)}</span><br/>` : '')
          + `<span style="font-size:11px">${(r.lengthM / 1000).toFixed(3)} км</span>`
          + `<br/><span style="color:#64748b;font-size:10px">${esc(r.source)}</span>`
          + (propsRef.current.onEditRoute
            ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                 <button onclick="window.__optiqEditRoute__('${esc(r.id)}')"
                   style="padding:3px 8px;background:#2dd4bf;color:#041016;border:none;border-radius:3px;font-size:10px;cursor:pointer;font-weight:600">
                   ✏️ Править линию</button>
                 <button onclick="window.__optiqSplitRoute__('${esc(r.id)}')"
                   style="padding:3px 8px;background:transparent;color:#38bdf8;border:1px solid #38bdf8;border-radius:3px;font-size:10px;cursor:pointer">
                   ✂️ Разрезать здесь</button>
                 <button onclick="window.__optiqJoinRoute__('${esc(r.id)}')"
                   style="padding:3px 8px;background:transparent;color:#a78bfa;border:1px solid #a78bfa;border-radius:3px;font-size:10px;cursor:pointer">
                   🔗 Склеить с соседней</button>
                 <button onclick="window.__optiqDeleteRoute__('${esc(r.id)}')"
                   style="padding:3px 8px;background:transparent;color:#f87171;border:1px solid #f87171;border-radius:3px;font-size:10px;cursor:pointer">
                   Удалить</button>
               </div>`
            : ''),
        );
        // Где именно щёлкнули по линии — это и есть место разреза.
        line.on('click', (e: any) => {
          lastRouteClickRef.current = { id: r.id, lat: e.latlng.lat, lon: e.latlng.lng };
        });
        group.addLayer(line);

        // Закрашенная часть — «сделано». Остаток остался синим проектом.
        if (partial && split) {
          const done = L.polyline(split.done, {
            color: r.color, weight: 4.5 * lineScale(zoom), opacity: 0.95,
          });
          done.bindTooltip(
            `${esc(title)} · пройдено ${formatMeters(split.doneM)}`
            + ` из ${formatMeters(split.totalM)} · ${Math.round(split.share * 100)}%`,
            { sticky: true, className: 'text-xs' },
          );
          group.addLayer(done);
        }

        // Стрелки направления и длины перегонов. Их считают маркерами, а
        // маркеров на сотне трасс набираются тысячи, поэтому только то,
        // что сейчас в окне, и в пределах общего потолка.
        const onScreen = !view || (() => {
          try { return view.intersects(L.latLngBounds(r.coords as any)); } catch { return true; }
        })();

        if (zoom >= 10 && onScreen && arrowBudget > 0 && !r.dashed) {
          const mpp = metersPerPixel(r.coords[0][0], zoom);
          const arrows = arrowsAlong(r.coords, { everyM: mpp * 130, max: Math.min(12, arrowBudget) });
          arrowBudget -= arrows.length;
          for (const a of arrows) {
            group.addLayer(L.marker([a.lat, a.lon], {
              interactive: false,
              zIndexOffset: 260,
              icon: L.divIcon({
                className: '',
                iconSize: [0, 0],
                iconAnchor: [0, 0],
                // ▲ смотрит вверх, а азимут считается от севера — значит
                // поворот на сам азимут и даёт направление движения.
                html: `<div style="transform:translate(-5px,-6px) rotate(${a.deg.toFixed(0)}deg);
                  font-size:10px;line-height:1;color:${r.color};
                  text-shadow:0 0 3px #000,0 0 3px #000">▲</div>`,
              }),
            }));
          }
        }

        if (zoom >= 12 && onScreen && labelBudget > 0) {
          const mpp = metersPerPixel(r.coords[0][0], zoom);
          // Подписываем перегон, если он длиннее полусотни пикселей: короче
          // — и цифра не поместится над самой линией.
          const labels = lengthLabels(r.coords, {
            minMeters: mpp * 60,
            max: Math.min(4, labelBudget),
          });
          labelBudget -= labels.length;
          for (const lb of labels) {
            group.addLayer(L.marker([lb.lat, lb.lon], {
              interactive: false,
              zIndexOffset: 240,
              icon: L.divIcon({
                className: '',
                iconSize: [0, 0],
                iconAnchor: [0, 0],
                html: `<div style="
                  transform:translate(-50%,-14px);white-space:nowrap;
                  padding:0 4px;border-radius:3px;
                  background:#0c1018cc;color:#cbd5e1;
                  font-size:9px;font-family:ui-monospace,monospace;
                ">${esc(lb.text)}</div>`,
              }),
            }));
          }
        }

        // «Откуда — куда» прямо на концах линии. Название трассы это и
        // говорит, но читать его в подсказке — значит навести мышь на
        // каждую: на карте вопрос «куда она ведёт» задают глазами.
        // На отдалении подписи слипаются, поэтому только вблизи.
        if (zoom >= 11 && (r.from || r.to)) {
          const ends: [string | undefined, [number, number]][] = [
            [r.from, r.coords[0]],
            [r.to, r.coords[r.coords.length - 1]],
          ];
          for (const [label, at] of ends) {
            if (!label || !at) continue;
            group.addLayer(L.marker(at, {
              interactive: false,
              zIndexOffset: 300,
              icon: L.divIcon({
                className: '',
                iconSize: [0, 0],
                iconAnchor: [0, 0],
                html: `<div style="
                  transform:translate(8px,-8px);white-space:nowrap;
                  padding:1px 5px;border-radius:4px;
                  background:#0c1018dd;border:1px solid ${r.color}88;
                  color:#e2e8f0;font-size:10px;font-weight:600;
                  font-family:ui-monospace,monospace;
                ">${esc(label)}</div>`,
              }),
            }));
          }
        }
      }

      // Отрезки по способам: где шли баром, где по колодцам.
      if (byMethod) {
        for (const sg of segments) {
          if (sg.coords.length < 2) continue;
          const color = METHOD_COLOR[sg.method];
          const seg = L.polyline(sg.coords, {
            color, weight: 5 * lineScale(zoom), opacity: 0.95,
            // Способ виден и рисунком линии, а не только цветом: на
            // спутнике цвета спорят с подложкой, а карту ещё и печатают.
            dashArray: METHOD_DASH[sg.method],
          });
          const when = sg.dates.length
            ? `${new Date(`${sg.dates[0]}T00:00:00Z`).toLocaleDateString('ru')}`
              + (sg.dates.length > 1
                ? ` — ${new Date(`${sg.dates[sg.dates.length - 1]}T00:00:00Z`).toLocaleDateString('ru')}`
                : '')
            : '';
          seg.bindTooltip(
            `${esc(METHOD_LABEL[sg.method])} · ${Math.round(sg.meters).toLocaleString('ru')} м`,
            { sticky: true, className: 'text-xs' },
          );
          seg.bindPopup(
            `<b style="color:${color}">${esc(METHOD_LABEL[sg.method])}</b>`
            + `<br/><span style="font-size:11px">${Math.round(sg.meters).toLocaleString('ru')} м`
            + ` · с ${Math.round(sg.fromM).toLocaleString('ru')} по ${Math.round(sg.toM).toLocaleString('ru')} м трассы</span>`
            + (when ? `<br/><span style="color:#64748b;font-size:11px">${when}</span>` : '')
            + '<div style="margin-top:5px;font-size:10px;color:#64748b">'
            + 'Границы отрезка посчитаны по дневным метрам: внутри дня порядок способов неизвестен.'
            + '</div>',
          );
          group.addLayer(seg);
        }

        // ККС: досюда по колодцам, дальше по земле.
        for (const k of kksPoints(segments)) {
          const m = L.marker([k.lat, k.lon], {
            zIndexOffset: 550,
            icon: L.divIcon({
              className: '',
              iconSize: [16, 16],
              iconAnchor: [8, 8],
              html: `<div style="width:12px;height:12px;border-radius:2px;
                     background:#0c1018;border:2px solid #38bdf8;
                     box-shadow:0 0 6px #38bdf899"></div>`,
            }),
          });
          m.bindTooltip('ККС — досюда по колодцам', { sticky: true, className: 'text-xs' });
          m.bindPopup(
            '<b style="color:#38bdf8">ККС</b>'
            + `<br/><span style="font-size:11px">Досюда по существующей канализации, `
            + `${Math.round(k.atM).toLocaleString('ru')} м от начала</span>`
            + '<br/><span style="font-size:11px">Дальше — по земле</span>',
          );
          group.addLayer(m);
        }
      }

      // Проколы линией: у ГНБ есть вход и выход, и на карте это отрезок,
      // а не точка. Цвет свой, чтобы не путать с трассой.
      for (const d of drillLines) {
        const color = DRILL_COLOR[d.drillKind];
        const line = L.polyline(d.coords.map((c) => [c.lat, c.lon]), {
          color,
          weight: 5 * lineScale(zoom),
          opacity: 0.95,
        });
        const when = d.date ? new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ru') : '—';
        line.bindTooltip(
          `${d.drillKind}${d.meters ? ` · ${d.meters} м` : ''} — ${esc(d.uchastok || '')}`,
          { sticky: true, className: 'text-xs' },
        );
        line.bindPopup(
          `<b style="color:${color}">${d.drillKind}</b>`
          + (d.meters ? ` · ${d.meters} м` : '')
          + (d.count ? ` · ${d.count} шт` : '')
          + `<br/>${esc(d.uchastok || '—')}`
          + `<br/><span style="color:#64748b;font-size:11px">${esc(d.oblast || '')} · ${when}</span>`
          + (d.crossings?.length
            ? `<br/><span style="font-size:11px">Кололи: ${esc(d.crossings.join(', '))}</span>` : '')
          + (d.contractor ? `<br/><span style="font-size:11px">${esc(d.contractor)}</span>` : '')
          + (d.note ? `<br/><span style="font-size:11px">${esc(d.note)}</span>` : '')
          + (d.historyCount > 1
            ? `<div style="margin-top:5px;padding-top:4px;border-top:1px solid #1e293b;font-size:11px;color:#94a3b8">
                 Здесь же ${d.historyCount} ${d.historyCount % 10 === 1 && d.historyCount % 100 !== 11 ? 'прокол' : 'проколов'}
                 · ${(d.historyMeters / 1000).toFixed(2)} км бестраншейно
               </div>`
            : '')
          + routeLinks(d.coords[0].lat, d.coords[0].lon),
        );
        group.addLayer(line);
      }
    });
  }

  /**
   * Вчерашний день в движении.
   *
   * Метка едет от утренней точки к вечерней по прямой между ними —
   * настоящий трек по часам никто не пишет, и притворяться, что он есть,
   * было бы враньём. Показываем ровно то, что знаем: откуда и докуда
   * дошли за день.
   */
  function runPlayback() {
    const group = playbackGroupRef.current;
    if (!mapRef.current || !group) return;
    if (playbackRafRef.current !== null) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    }
    group.clearLayers();

    const moves = propsRef.current.playbackMoves ?? [];
    if (moves.length === 0) return;

    import('leaflet').then((L) => {
      const markers = moves.map((mv) => {
        // След пути — бледная линия под меткой, чтобы было видно, что
        // пройдено, когда движение закончилось.
        group.addLayer(L.polyline(
          [[mv.from.lat, mv.from.lon], [mv.to.lat, mv.to.lon]],
          { color: '#4ade80', weight: 3, opacity: 0.45, dashArray: '6,6' },
        ));
        const marker = L.marker([mv.from.lat, mv.from.lon], {
          zIndexOffset: 1200,
          icon: L.divIcon({
            className: '',
            iconSize: [34, 34],
            iconAnchor: [17, 17],
            html: `<div style="
              width:30px;height:30px;border-radius:50%;
              background:#0c1018ee;border:3px solid #4ade80;
              display:flex;align-items:center;justify-content:center;font-size:15px;
              box-shadow:0 0 12px #4ade8099">🚜</div>`,
          }),
        });
        marker.bindTooltip(
          `${esc(mv.uchastok)} — ${Math.round(mv.meters).toLocaleString('ru')} м`,
          { permanent: true, direction: 'top', className: 'text-xs' },
        );
        group.addLayer(marker);
        return { marker, mv };
      });

      const DURATION = 4000;
      const started = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - started) / DURATION);
        for (const { marker, mv } of markers) {
          marker.setLatLng([
            mv.from.lat + (mv.to.lat - mv.from.lat) * k,
            mv.from.lon + (mv.to.lon - mv.from.lon) * k,
          ]);
        }
        if (k < 1) {
          playbackRafRef.current = requestAnimationFrame(step);
        } else {
          playbackRafRef.current = null;
          propsRef.current.onPlaybackDone?.();
        }
      };
      playbackRafRef.current = requestAnimationFrame(step);
    });
  }

  /**
   * Муфты, столбы, конечные точки, ККС.
   *
   * У муфты цвет говорит о состоянии: серая не установлена, янтарная
   * установлена, бирюзовая заварена. Установить и заварить — разные
   * работы и разные дни, и на карте это должно различаться с одного
   * взгляда, без открывания карточки.
   */
  function renderSiteObjects() {
    const group = objectGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const objects = propsRef.current.siteObjects ?? [];
      if (objects.length === 0) return;
      const zoom = mapRef.current?.getZoom?.() ?? 10;
      const scale = markerScale(zoom);
      let shown = objects;

      // Издали объекты сливаются в пятно: тысяча значков не читается и
      // не нажимается, а карта их честно рисует и тормозит. Вблизи, где
      // они разъезжаются, скучивание только мешает.
      if (zoom < 14) {
        const mpp = metersPerPixel(objects[0].lat, zoom);
        const clusters = clusterPoints(objects, 46, mpp);
        const clustered = clusters.filter((c) => c.items.length > 1);
        const single = clusters.filter((c) => c.items.length === 1);

        for (const c of clustered) {
          const size = Math.round(24 + Math.min(14, Math.log2(c.items.length) * 4));
          const m = L.marker([c.lat, c.lon], {
            zIndexOffset: 480,
            icon: L.divIcon({
              className: '',
              iconSize: [size, size],
              iconAnchor: [size / 2, size / 2],
              html: `<div style="
                width:${size}px;height:${size}px;border-radius:50%;
                background:#0c1018ee;border:2px solid #38bdf8;color:#e2e8f0;
                display:flex;align-items:center;justify-content:center;
                font-size:${Math.round(size * 0.42)}px;font-weight:700;
                box-shadow:0 0 8px #38bdf855;
              ">${c.items.length}</div>`,
            }),
          });
          const kinds = new Map<string, number>();
          for (const it of c.items) {
            const label = SITE_OBJECT_SPECS[it.kind].plural;
            kinds.set(label, (kinds.get(label) ?? 0) + 1);
          }
          m.bindTooltip(
            [...kinds].map(([k, n]) => `${k}: ${n}`).join(' · '),
            { sticky: true, className: 'text-xs' },
          );
          // Клик по куче раскрывает её: это то, чего от неё и ждут.
          m.on('click', () => {
            try {
              mapRef.current?.fitBounds(
                L.latLngBounds(c.items.map((it) => [it.lat, it.lon] as [number, number])),
                { padding: [60, 60], maxZoom: 17 },
              );
            } catch { /* вырожденная рамка */ }
          });
          group.addLayer(m);
        }

        // Одиночки рисуем как обычно — прятать их в кучу из одного незачем.
        shown = single.map((c) => c.items[0]);
      }

      for (const o of shown) {
        if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
        const spec = SITE_OBJECT_SPECS[o.kind];
        const color = siteObjectColor(o);
        const size = Math.round(20 * scale);

        const icon = L.divIcon({
          className: '',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          html: `<div style="
            width:${size}px;height:${size}px;border-radius:${o.kind === 'stolb' ? '3px' : '50%'};
            background:#0c1018ee;border:2px solid ${color};
            display:flex;align-items:center;justify-content:center;
            font-size:${Math.round(size * 0.5)}px;line-height:1;
            box-shadow:0 0 6px ${color}66;
          ">${spec.icon}</div>`,
        });

        const state = o.kind === 'mufta'
          ? MUFTA_STATES[o.state ?? 'planned'].label
          : o.endpointKind || spec.label;

        const m = L.marker([o.lat, o.lon], { icon, zIndexOffset: 500 });
        m.bindTooltip(`${spec.icon} ${esc(o.name || spec.label)} — ${esc(state)}`,
          { sticky: true, className: 'text-xs' });
        m.bindPopup(
          `<b>${esc(o.name || spec.label)}</b>`
          + `<br/><span style="color:${color};font-size:12px">${esc(state)}</span>`
          + (o.uchastok ? `<br/><span style="font-size:11px">${esc(o.uchastok)}</span>` : '')
          + (o.number ? `<br/><span style="font-size:11px">№ ${esc(o.number)}</span>` : '')
          + (o.date
            ? `<br/><span style="color:#64748b;font-size:11px">${new Date(`${o.date}T00:00:00Z`).toLocaleDateString('ru')}</span>`
            : '')
          + (o.note ? `<br/><span style="font-size:11px">${esc(o.note)}</span>` : '')
          + (propsRef.current.onEditSiteObject
            ? `<div style="margin-top:6px">
                 <button onclick="window.__optiqEditObject__('${esc(o.id)}')"
                   style="padding:3px 8px;background:#2dd4bf;color:#041016;border:none;border-radius:3px;font-size:10px;cursor:pointer;font-weight:600">
                   ✏️ Изменить</button>
               </div>`
            : '')
          + routeLinks(o.lat, o.lon),
        );
        group.addLayer(m);
      }
    });
  }

  /**
   * Поток по кабелю.
   *
   * Украшение, и мы его так и называем: работы оно не делает. Но
   * показывает то, что иначе видно только в цифрах — что сеть уже живая.
   * Огонёк идёт только по трассам, где кабель задут: по трубе без кабеля
   * ему идти неоткуда, и рисовать там движение значит врать.
   */
  function runFlow() {
    const group = flowGroupRef.current;
    if (!mapRef.current || !group) return;
    if (flowRafRef.current !== null) {
      cancelAnimationFrame(flowRafRef.current);
      flowRafRef.current = null;
    }
    group.clearLayers();

    if (!propsRef.current.showFlow) return;
    const routes = (propsRef.current.planRoutes ?? [])
      .filter((r) => r.stage === 'zaduvka' || r.stage === 'svarka' || r.stage === 'sdacha')
      .filter((r) => r.coords.length >= 2 && r.lengthM > 0);
    if (routes.length === 0) return;

    import('leaflet').then((L) => {
      // Больше трёх десятков огоньков — это уже не картинка, а нагрузка
      // на телефон, который в поле и так на последнем издыхании.
      const shown = routes.slice(0, 30);
      const dots = shown.map((r) => {
        const dot = L.circleMarker([r.coords[0][0], r.coords[0][1]], {
          radius: 4,
          color: '#e0f2fe',
          weight: 1,
          fillColor: '#38bdf8',
          fillOpacity: 0.95,
          interactive: false,
        });
        group.addLayer(dot);
        // Фаза у каждой трассы своя: одинаковый старт выглядит как парад,
        // а не как поток.
        return { route: r, dot, phase: Math.random() };
      });

      const SPEED_M_S = 1200;
      let last = performance.now();
      const step = (t: number) => {
        const dt = Math.min(0.1, (t - last) / 1000);
        last = t;
        for (const d of dots) {
          d.phase += (SPEED_M_S * dt) / d.route.lengthM;
          if (d.phase > 1) d.phase -= 1;
          const at = pointAtDistanceM(d.route.coords, d.phase * d.route.lengthM);
          if (at) d.dot.setLatLng([at.lat, at.lon]);
        }
        flowRafRef.current = requestAnimationFrame(step);
      };
      flowRafRef.current = requestAnimationFrame(step);
    });
  }

  /**
   * Аварии на карте.
   *
   * Открытая авария — красная и пульсирует: она требует выезда сегодня.
   * Устранённая остаётся серой точкой, потому что через год важно не то,
   * что её закрыли, а что она здесь была. Место, где рвалось больше
   * одного раза, обведено кольцом — это и есть карта проблемных мест.
   */
  function renderIncidents() {
    const group = incidentGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const list = propsRef.current.incidents ?? [];
      if (list.length === 0) return;
      const spots = problemSpots(list);

      // Сначала кольца проблемных мест — чтобы точки легли поверх.
      for (const s of spots) {
        group.addLayer(L.circle([s.lat, s.lon], {
          radius: SAME_SPOT_M,
          color: '#f87171',
          weight: 1,
          opacity: 0.6,
          fillColor: '#f87171',
          fillOpacity: 0.07,
          interactive: false,
        }));
      }

      for (const i of list) {
        if (!Number.isFinite(i.lat) || !Number.isFinite(i.lon)) continue;
        const open = !i.fixedAt;
        const color = open ? '#f87171' : '#64748b';
        const size = open ? 22 : 16;
        const pulse = open
          ? 'animation: optiq-crew-pulse 2.2s ease-in-out infinite;'
          : '';
        const icon = L.divIcon({
          className: '',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          html: `<div style="
            width:${size}px;height:${size}px;border-radius:50%;
            background:#0c1018ee;border:2px solid ${color};
            display:flex;align-items:center;justify-content:center;
            font-size:${Math.round(size * 0.55)}px;line-height:1;
            box-shadow:0 0 8px ${color}88;${pulse}
          ">🚨</div>`,
        });

        const hours = incidentHours(i);
        const here = nearbyIncidents(list, i.lat, i.lon, SAME_SPOT_M, i.id);
        const m = L.marker([i.lat, i.lon], { icon, zIndexOffset: 700 });
        m.bindTooltip(`🚨 ${esc(i.damage)}`, { sticky: true, className: 'text-xs' });
        m.bindPopup(
          `<b style="color:${color}">${esc(i.damage)}</b>`
          + `<br/><span style="font-size:11px">${open ? 'открыта' : 'устранена'}`
          + (hours !== null ? ` · ${hours} ч` : '') + '</span>'
          + (i.uchastok ? `<br/><span style="font-size:11px">${esc(i.uchastok)}</span>` : '')
          + (i.cause ? `<br/><span style="color:#94a3b8;font-size:11px">причина: ${esc(i.cause)}</span>` : '')
          + `<br/><span style="color:#64748b;font-size:11px">${
            new Date(i.reportedAt).toLocaleString('ru')}</span>`
          + (here.length
            ? `<br/><span style="color:#fbbf24;font-size:11px">здесь уже рвалось ${here.length} раз</span>`
            : '')
          + routeLinks(i.lat, i.lon),
        );
        group.addLayer(m);
      }
    });
  }

  /**
   * Районы и сёла, обведённые в Google Earth.
   *
   * Границы не рисуются заново — они читаются из того же KML, которым
   * пользуется прораб. Заливка показывает ход работ: серое — данных нет,
   * янтарное — начато, зелёное — идёт, бирюзовое — закрыто, красное —
   * стоит. На такую карту можно смотреть вместо таблицы.
   */
  function renderAreas() {
    const group = areaGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const items = propsRef.current.areas ?? [];
      if (items.length === 0) return;

      // Область под районом, район под селом: иначе крупный контур
      // перекрывает мелкий и по нему нельзя щёлкнуть.
      const order: Record<string, number> = { oblast: 0, rayon: 1, snp: 2 };
      const sorted = [...items].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));

      // Издали область, ближе районы, ещё ближе сёла — правило живёт
      // рядом с самими контурами, а не в разметке карты.
      const shown = visibleAtZoom(sorted, mapRef.current?.getZoom?.() ?? 10);

      for (const a of shown) {
        if (a.coords.length < 3) continue;
        const blocked = a.blockedSnp > 0;
        const color = areaColor(a.completion, blocked);
        const isSnp = a.kind === 'snp';
        const poly = L.polygon(a.coords, {
          color,
          weight: isSnp ? 1.5 : a.kind === 'rayon' ? 2.5 : 3,
          opacity: isSnp ? 0.8 : 0.9,
          dashArray: a.kind === 'oblast' ? '8,6' : undefined,
          fillColor: color,
          // Заливка тем плотнее, чем мельче контур: у области она только
          // мешала бы читать то, что внутри.
          fillOpacity: a.completion === null ? 0.05 : isSnp ? 0.3 : a.kind === 'rayon' ? 0.12 : 0.04,
        });

        const progress = a.completion === null
          ? 'данных по журналу нет'
          : `${Math.round(a.completion * 100)}% этапов пройдено`;
        const snpLine = a.totalSnp > 0
          ? `<br/><span style="font-size:11px">Сёл закрыто ${a.doneSnp} из ${a.totalSnp}`
            + (a.activeSnp ? ` · в работе ${a.activeSnp}` : '')
            + (a.blockedSnp ? ` · <span style="color:#f87171">стоит ${a.blockedSnp}</span>` : '')
            + '</span>'
          : '';

        // Перегон подписываем тем, по чему посчитано: «зеренди серафимовка»
        // — это путь к Серафимовке, и цифра на нём её, а не ничья.
        const via = a.via && a.via.length > 1
          ? ` · перегон ${a.via.join(' → ')}, показано по «${a.via[a.via.length - 1]}»`
          : '';
        poly.bindTooltip(`${esc(a.name)} — ${esc(progress)}${esc(via)}`,
          { sticky: true, className: 'text-xs' });
        // Обводка — такая же нарисованная вещь, как трасса: её правят на
        // месте, а не «обращаются к тому, кто загрузил файл».
        const editable = !!propsRef.current.onEditArea;
        const editing = propsRef.current.editingAreaId === a.id;
        const btn = (act: string, label: string, bg: string, fg = '#041016') =>
          `<button onclick="window.__optiqArea__('${act}','${esc(a.id)}')"
             style="padding:3px 8px;background:${bg};color:${fg};border:none;border-radius:3px;
                    font-size:10px;cursor:pointer;font-weight:600;margin-right:4px">${label}</button>`;

        poly.bindPopup(
          `<b>${esc(a.name)}</b>`
          + `<br/><span style="color:#64748b;font-size:11px">${esc(AREA_KIND_LABEL[a.kind])}`
          + `${a.rayon && a.kind === 'snp' ? ` · ${esc(a.rayon)}` : ''}</span>`
          + `<div style="margin-top:4px;color:${color};font-size:12px">${esc(progress)}</div>`
          + (via ? `<div style="color:#64748b;font-size:11px">${esc(via.replace(/^ · /, ''))}</div>` : '')
          + snpLine
          + (a.kato ? `<br/><span style="color:#64748b;font-size:10px;font-family:ui-monospace,monospace">${esc(a.kato)}</span>` : '')
          + `<br/><span style="color:#64748b;font-size:10px">${esc(a.source)}</span>`
          + (a.kind !== 'snp'
            ? `<div style="margin-top:6px">`
              + `<button onclick="window.__optiqArea__('zoom','${esc(a.id)}')"
                   style="padding:3px 8px;background:#1e3a5f;color:#e2e8f0;border:none;border-radius:3px;
                          font-size:10px;cursor:pointer;font-weight:600">⤢ Раскрыть</button>`
              + `</div>`
            : '')
          + (editable
            ? `<div style="margin-top:6px">`
              + btn(editing ? 'done' : 'edit', editing ? '✓ Готово' : '✏️ Изменить', '#2dd4bf')
              + btn('rename', '✎ Имя', '#1e3a5f', '#e2e8f0')
              + btn('delete', '🗑', '#1e3a5f', '#f87171')
              + `</div>`
              + (editing
                ? `<div style="margin-top:4px;color:#64748b;font-size:10px">
                     Тяните точки. Правый клик по точке — убрать её.</div>`
                : '')
            : ''),
        );
        group.addLayer(poly);
      }
    });
  }

  /**
   * Этапы по населённым пунктам.
   *
   * Список этапов говорит, что закрыто; карта говорит, где. Прорабу нужно
   * второе: увидеть, что ГНБ ждут вот в этих трёх сёлах вдоль одной дороги.
   *
   * Янтарная пульсирующая метка — фронт передали, но никто не взял. Зелёная —
   * работают. Красная — стоит. Серая — ещё не начинали. Бирюзовая с галочкой —
   * село закрыто. Полоска из шести делений под меткой — сколько этапов пройдено.
   */
  function renderSnpPoints() {
    const group = snpGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const pts = propsRef.current.snpPoints ?? [];
      if (pts.length === 0) return;

      for (const p of pts) {
        const doneAll = p.stage === null;
        const color = doneAll ? '#2dd4bf'
          : p.waiting ? '#fbbf24'
          : STAGE_STATUS_SPECS[p.status].color;
        const spec = p.stage ? SNP_STAGE_SPECS[p.stage] : null;
        const glyph = doneAll ? '✓'
          : spec?.crewKind ? CREW_KINDS[spec.crewKind].icon
          : '🏁';
        // Пульсирует только то, что кого-то ждёт: иначе пульсирует вся карта
        // и перестаёт что-либо значить.
        const pulse = p.waiting ? 'animation: optiq-crew-pulse 2.2s ease-in-out infinite;' : '';

        const doneCount = Math.round(p.completion * SNP_STAGES.length);
        const bar = SNP_STAGES.map((_, i) => `<div style="
            width:5px;height:3px;border-radius:1px;
            background:${i < doneCount ? '#2dd4bf' : '#334155'};
          "></div>`).join('');

        const icon = L.divIcon({
          className: '',
          iconSize: [34, 40],
          iconAnchor: [17, 34],
          html: `
            <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
              <div style="
                width:26px;height:26px;border-radius:50%;
                background:#0c1018ee;border:2px solid ${color};
                box-shadow:0 0 8px ${color}66;
                display:flex;align-items:center;justify-content:center;
                font-size:13px;line-height:1;${pulse}
              ">${glyph}</div>
              <div style="display:flex;gap:1px;margin-top:2px">${bar}</div>
            </div>`,
        });

        const stageRows = SNP_STAGES.map((s) => {
          const label = SNP_STAGE_SPECS[s].label;
          const passed = SNP_STAGES.indexOf(s) < doneCount;
          const here = s === p.stage;
          const mark = passed ? '✓' : here ? '●' : '·';
          const c = passed ? '#2dd4bf' : here ? color : '#475569';
          return `<div style="color:${c};font-size:11px">${mark} ${label}</div>`;
        }).join('');

        const state = doneAll ? 'Село закрыто'
          : p.waiting ? `Ждёт: ${spec?.label ?? ''}`
          : `${STAGE_STATUS_SPECS[p.status].label}: ${spec?.label ?? ''}`;

        const m = L.marker([p.lat, p.lon], { icon, zIndexOffset: 600 });
        m.bindTooltip(`${glyph} ${esc(p.snp)} — ${esc(state)}`, { sticky: true, className: 'text-xs' });
        m.bindPopup(`
          <div style="min-width:190px">
            <b>${esc(p.snp)}</b>
            <span style="color:#64748b;font-size:10px;font-family:ui-monospace,monospace"> ${esc(p.kato)}</span><br/>
            <span style="font-size:11px;color:#64748b">
              ${esc([p.oblast, p.rayon].filter(Boolean).join(', '))}
            </span>
            <div style="margin:5px 0;color:${color};font-size:12px">${esc(state)}</div>
            ${p.blockReason ? `<div style="font-size:11px;color:#f87171">${esc(p.blockReason)}</div>` : ''}
            <div style="margin-top:4px">${stageRows}</div>
            <div style="margin-top:5px;font-size:10px;color:#64748b">
              Место ${esc(SNP_POINT_SOURCE[p.from])}
            </div>
            ${routeLinks(p.lat, p.lon)}
          </div>`);
        group.addLayer(m);
      }
    });
  }

  /** Показывает линию, которую сейчас рисуют, вместе с вершинами. */
  function renderRouteDraft(L: any) {
    const group = drawGroupRef.current;
    if (!group) return;
    group.clearLayers();
    shapeDraftRef.current = null;
    const pts = routeDraftRef.current;
    if (pts.length === 0) return;

    // Контур показываем замкнутым с самого начала: иначе до последнего
    // клика непонятно, что рисуешь — линию или площадку.
    const area = propsRef.current.drawShape !== 'route';
    const color = area ? '#38bdf8' : '#f472b6';
    if (pts.length >= 2) {
      group.addLayer(area && pts.length >= 3
        ? L.polygon(pts, {
          color, weight: 3, opacity: 0.95, dashArray: '8,6',
          fillColor: color, fillOpacity: 0.12,
        })
        : L.polyline(pts, {
          color, weight: 4, opacity: 0.95, dashArray: '8,6',
        }));
    }
    pts.forEach((c, i) => {
      group.addLayer(L.circleMarker(c, {
        radius: i === 0 ? 6 : 4,
        color, fillColor: '#0c1018', fillOpacity: 1, weight: 2,
      }));
    });
  }

  /** Заканчивает линию: меньше двух вершин — рисовать нечего. */
  function finishRouteDraft() {
    if (routeClickTimerRef.current !== null) {
      window.clearTimeout(routeClickTimerRef.current);
      routeClickTimerRef.current = null;
    }
    const pts = routeDraftRef.current;
    routeDraftRef.current = [];
    drawGroupRef.current?.clearLayers();
    // Линии хватает двух точек, контуру нужно три: из двух контур не
    // получится, а молча превратить его в линию — подсунуть не то.
    const need = propsRef.current.drawShape === 'area' ? 3 : 2;
    propsRef.current.onRouteDrawn?.(pts.length >= need ? pts : []);
  }

  /**
   * Ручки на трассе, которую правят.
   *
   * Тянуть можно каждую вершину; форма при этом сохраняется — соседние
   * точки едут следом и к соседним ручкам смещение сходит на нет.
   * Правая кнопка по ручке убирает вершину: линия из двух точек — предел,
   * дальше это уже не линия.
   */
  function renderRouteEdit() {
    const group = routeEditGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const id = propsRef.current.editingRouteId;
      if (!id) return;
      const route = (propsRef.current.planRoutes ?? []).find((r) => r.id === id);
      if (!route || route.coords.length < 2) return;

      const coords = route.coords;
      group.addLayer(L.polyline(coords, {
        color: '#2dd4bf', weight: 3, opacity: 0.9, dashArray: '6,6',
      }));

      // Ручек на длинной трассе может быть сотня; показываем не больше
      // двадцати равномерно — иначе они сливаются в кашу.
      const MAX = 20;
      const step = coords.length > MAX ? (coords.length - 1) / (MAX - 1) : 1;
      const idx = new Set<number>([0, coords.length - 1]);
      for (let k = 0; k < MAX; k++) idx.add(Math.round(k * step));

      [...idx].sort((a, b) => a - b).forEach((i, pos, arr) => {
        const c = coords[i];
        if (!c) return;
        const m = L.marker(c, {
          draggable: true,
          icon: L.divIcon({
            className: '',
            iconSize: [12, 12],
            iconAnchor: [6, 6],
            html: `<div style="width:10px;height:10px;border-radius:50%;
                   background:#0c1018;border:2px solid #2dd4bf;cursor:grab"></div>`,
          }),
        });
        const prevH = pos > 0 ? arr[pos - 1] : null;
        const nextH = pos < arr.length - 1 ? arr[pos + 1] : null;

        m.on('dragend', (e: any) => {
          const ll = e.target.getLatLng();
          propsRef.current.onUpdateRouteCoords?.(
            id, warpWaypoint(coords, prevH, i, nextH, ll.lat, ll.lng),
          );
        });
        m.on('contextmenu', (e: any) => {
          e.originalEvent?.preventDefault?.();
          if (coords.length <= 2) return;
          const next = coords.filter((_, j) => j !== i);
          propsRef.current.onUpdateRouteCoords?.(id, next);
        });
        group.addLayer(m);
      });
    });
  }

  /**
   * Ручки вершин обводки.
   *
   * То же, что у трассы, с одним отличием: кольцо нельзя разорвать.
   * Поэтому вершину убираем только пока их больше четырёх, а соседние
   * тянутся следом — иначе правка одной точки превращает плавный контур
   * в зубец.
   */
  function renderAreaEdit() {
    const group = areaEditGroupRef.current;
    if (!mapRef.current || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const id = propsRef.current.editingAreaId;
      if (!id) return;
      const area = (propsRef.current.areas ?? []).find((a) => a.id === id);
      if (!area || area.coords.length < 3) return;

      const coords = area.coords;
      group.addLayer(L.polygon(coords, {
        color: '#2dd4bf', weight: 2, opacity: 0.9, dashArray: '6,6',
        fill: false, interactive: false,
      }));

      // Контуры из KML бывают на сотни точек; показываем не больше
      // тридцати равномерно, иначе ручки сливаются в кашу.
      const MAX = 30;
      const step = coords.length > MAX ? (coords.length - 1) / (MAX - 1) : 1;
      const idx = new Set<number>([0, coords.length - 1]);
      for (let k = 0; k < MAX; k++) idx.add(Math.round(k * step));

      [...idx].sort((a, b) => a - b).forEach((i, pos, arr) => {
        const c = coords[i];
        if (!c) return;
        const m = L.marker(c, {
          draggable: true,
          icon: L.divIcon({
            className: '',
            iconSize: [12, 12],
            iconAnchor: [6, 6],
            html: `<div style="width:10px;height:10px;border-radius:2px;
                   background:#0c1018;border:2px solid #2dd4bf;cursor:grab"></div>`,
          }),
        });
        const prevH = pos > 0 ? arr[pos - 1] : null;
        const nextH = pos < arr.length - 1 ? arr[pos + 1] : null;

        m.on('dragend', (e: any) => {
          const ll = e.target.getLatLng();
          propsRef.current.onUpdateAreaCoords?.(
            id, warpWaypoint(coords, prevH, i, nextH, ll.lat, ll.lng),
          );
        });
        m.on('contextmenu', (e: any) => {
          e.originalEvent?.preventDefault?.();
          // Меньше четырёх точек — это уже не контур.
          if (coords.length <= 4) return;
          propsRef.current.onUpdateAreaCoords?.(id, coords.filter((_, j) => j !== i));
        });
        group.addLayer(m);
      });
    });
  }

  function handleDrawClick(L: any, lat: number, lon: number) {
    const tool = propsRef.current.activeTool;
    const type = propsRef.current.activeAnnotationType;
    const color = ANNOTATION_PRESETS[type].color;

    if (tool === 'point') {
      propsRef.current.addAnnotation({
        type, shape: 'point', coords: [[lat, lon]],
        name: '', description: '', color,
      });
      propsRef.current.setActiveTool(null);
      return;
    }

    if (tool === 'arrow') {
      // Стрелку ставят двумя кликами: откуда показываем и куда.
      // Собирать её вершинами, как ломаную, никто не станет — это
      // пометка на бегу, а не построение.
      const st = drawStateRef.current;
      if (st.coords.length === 0) {
        st.coords.push([lat, lon]);
        drawGroupRef.current.addLayer(
          L.circleMarker([lat, lon], { radius: 5, color, fillOpacity: 1 }),
        );
      } else {
        propsRef.current.addAnnotation({
          type, shape: 'arrow', coords: [st.coords[0], [lat, lon]],
          name: '', description: '', color,
        });
        drawStateRef.current = { coords: [] };
        drawGroupRef.current.clearLayers();
        propsRef.current.setActiveTool(null);
      }
      return;
    }

    if (tool === 'circle') {
      // 1st click = center, 2nd click = radius
      const s = drawStateRef.current;
      if (s.coords.length === 0) {
        s.coords.push([lat, lon]);
        const dot = L.circleMarker([lat, lon], { radius: 5, color, fillOpacity: 1 });
        drawGroupRef.current.addLayer(dot);
      } else {
        const [clat, clon] = s.coords[0];
        const radius = haversineMeters(clat, clon, lat, lon);
        propsRef.current.addAnnotation({
          type, shape: 'circle', coords: [[clat, clon]], radius,
          name: '', description: '', color,
        });
        drawStateRef.current = { coords: [] };
        drawGroupRef.current.clearLayers();
        propsRef.current.setActiveTool(null);
      }
      return;
    }

    // polygon / line: collect until right-click
    const s = drawStateRef.current;
    s.coords.push([lat, lon]);
    drawGroupRef.current.clearLayers();
    if (tool === 'polygon' && s.coords.length >= 3) {
      const poly = L.polygon(s.coords, { color, weight: 2, fillOpacity: 0.1, dashArray: '4,4' });
      drawGroupRef.current.addLayer(poly);
    } else if (s.coords.length >= 2) {
      const line = L.polyline(s.coords, { color, weight: 3, dashArray: '4,4', opacity: 0.7 });
      drawGroupRef.current.addLayer(line);
    }
    for (const [plat, plon] of s.coords) {
      const dot = L.circleMarker([plat, plon], { radius: 4, color, fillOpacity: 1 });
      drawGroupRef.current.addLayer(dot);
    }
  }

  function finishShape(L: any) {
    const tool = propsRef.current.activeTool;
    const type = propsRef.current.activeAnnotationType;
    const color = ANNOTATION_PRESETS[type].color;
    const s = drawStateRef.current;
    if (!s.coords.length) return;

    if (tool === 'polygon' && s.coords.length >= 3) {
      propsRef.current.addAnnotation({
        type, shape: 'polygon', coords: s.coords,
        name: '', description: '', color,
      });
    } else if (tool === 'line' && s.coords.length >= 2) {
      propsRef.current.addAnnotation({
        type, shape: 'line', coords: s.coords,
        name: '', description: '', color,
      });
    }
    drawStateRef.current = { coords: [] };
    drawGroupRef.current.clearLayers();
    propsRef.current.setActiveTool(null);
  }

  /**
   * Измерение.
   *
   * По прямой меряют редко: кабель идёт по трассе, и «сколько отсюда
   * досюда» значит «сколько по линии». Поэтому клик рядом с трассой
   * прилипает к ней, и тогда рядом с прямой показывается ещё и длина по
   * трассе — обычно она заметно больше.
   *
   * Площадь нужна под пропорку и рекультивацию: там считают гектарами.
   */
  function renderMeasure(L: any) {
    measureGroupRef.current.clearLayers();
    const s = measureStateRef.current;
    const area = propsRef.current.measureShape === 'area';
    if (s.coords.length === 0) {
      propsRef.current.onMeasure?.(null);
      return;
    }

    const m = measureLine(s.coords);
    s.total = m.totalM;

    // Вдоль трассы — только когда обе крайние точки сели на одну и ту же.
    let alongRouteM: number | undefined;
    const first = s.snaps[0];
    const last = s.snaps[s.snaps.length - 1];
    if (!area && s.coords.length === 2 && first && last && first.routeId === last.routeId) {
      const route = (propsRef.current.planRoutes ?? []).find((r) => r.id === first.routeId);
      if (route) alongRouteM = measureAlongRoute(route.coords, first, last).alongM;
    }

    if (area && s.coords.length >= 3) {
      measureGroupRef.current.addLayer(L.polygon(s.coords, {
        color: '#fbbf24', weight: 2, opacity: 0.95, fillColor: '#fbbf24', fillOpacity: 0.18,
      }));
    } else if (s.coords.length >= 2) {
      measureGroupRef.current.addLayer(L.polyline(s.coords, {
        color: '#fbbf24', weight: 3, opacity: 0.9, dashArray: '8,4',
      }));
    }

    s.coords.forEach(([lat, lon], i) => {
      // Прилипшая точка обведена: видно, что мерим по трассе, а не мимо.
      const snapped = !!s.snaps[i];
      measureGroupRef.current.addLayer(L.circleMarker([lat, lon], {
        radius: snapped ? 6 : 5,
        color: snapped ? '#2dd4bf' : '#fbbf24',
        weight: snapped ? 3 : 1,
        fillColor: '#fbbf24',
        fillOpacity: 1,
      }));
    });

    const readout: MeasureReadout = {
      points: s.coords.length,
      totalM: m.totalM,
      straightM: m.straightM,
      alongRouteM,
      areaM2: area && s.coords.length >= 3 ? polygonAreaM2(s.coords) : undefined,
      perimeterM: area && s.coords.length >= 3 ? perimeterM(s.coords) : undefined,
    };
    propsRef.current.onMeasure?.(readout);

    const headline = readout.areaM2 !== undefined
      ? formatArea(readout.areaM2)
      : formatMeters(alongRouteM ?? m.totalM);
    const at = s.coords[s.coords.length - 1];
    measureGroupRef.current.addLayer(L.marker(at, {
      interactive: false,
      icon: L.divIcon({
        html: `<div style="background:#0d1b2a;border:1px solid #fbbf24;color:#fbbf24;
                 padding:2px 6px;border-radius:4px;font-family:ui-monospace,monospace;
                 font-size:11px;font-weight:bold;white-space:nowrap">📏 ${esc(headline)}`
          + (alongRouteM !== undefined
            ? `<span style="color:#2dd4bf"> по трассе</span>` : '')
          + '</div>',
        className: '', iconSize: [80, 20], iconAnchor: [-8, 8],
      }),
    }));
  }

  /**
   * Куда на самом деле попал клик.
   *
   * Допуск — в пикселях, а не в метрах: на общем плане пиксель это сотни
   * метров, и прилипать к линии за километр было бы враньём.
   */
  function snapClick(lat: number, lon: number, px = 12): RouteSnap | null {
    const map = mapRef.current;
    if (!map) return null;
    const mpp = metersPerPixel(lat, map.getZoom?.() ?? 12);
    return snapToRoutes(
      { lat, lon },
      (propsRef.current.planRoutes ?? []).map((r) => ({ id: r.id, coords: r.coords })),
      mpp * px,
    );
  }

  // Re-render whenever data changes
  useEffect(() => {
    renderData();
  }, [props.districts, props.cables, props.joints, props.layers, props.editMode, props.editingCableId, props.budgetColoring, props.budgetMap, props.highlightCableIds, props.scenarioMapDiff, props.moveEntityTarget, props.snapHighlightId, props.snapHighlightIds]);

  // Waypoint editing: drag moves one vertex (no perpendicular inserts)
  useEffect(() => {
    const group = waypointGroupRef.current;
    if (!group) return;
    group.clearLayers();
    const { editingCableId, onUpdateCableCoords } = propsRef.current;
    if (!editingCableId || !onUpdateCableCoords) return;

    import('leaflet').then((L) => {
      import('@/components/Network/SnapConnect').then(({ nearestEntity, SNAP_ENTITY_M, compatibleTargetsForCable }) => {
        const readCoords = (): [number, number][] => {
          const c = propsRef.current.cables.find((x) => x.id === editingCableId);
          return c ? c.coords.map((p) => [p[0], p[1]] as [number, number]) : [];
        };

        const coords = readCoords();
        if (coords.length < 2) return;

        const makeIcon = (kind: 'end' | 'mid') =>
          L.divIcon({
            html: kind === 'end'
              ? '<div style="width:12px;height:12px;background:#2dd4bf;border:2px solid #fff;border-radius:2px;cursor:grab;box-shadow:0 0 8px rgba(45,212,191,0.5)"></div>'
              : '<div style="width:10px;height:10px;background:#a78bfa;border:2px solid #fff;border-radius:50%;cursor:grab"></div>',
            className: '',
            iconSize: kind === 'end' ? [12, 12] : [10, 10],
            iconAnchor: kind === 'end' ? [6, 6] : [5, 5],
          });

        const applyCoords = (newCoords: [number, number][]) => {
          propsRef.current.onUpdateCableCoords?.(editingCableId, newCoords);
        };

        const n = coords.length;
        // На длинной OSRM-трассе вершин десятки/сотни — показывать ручку на
        // каждой неудобно. Всегда даём ручки на концах (A/B), а промежуточные
        // прореживаем до ≤ MAX_MID равномерно вдоль линии.
        const MAX_MID = 10;
        const handleIndices: number[] = [0];
        const interior = n - 2;
        if (interior > 0 && interior <= MAX_MID) {
          for (let i = 1; i < n - 1; i++) handleIndices.push(i);
        } else if (interior > MAX_MID) {
          const step = (n - 1) / (MAX_MID + 1);
          for (let k = 1; k <= MAX_MID; k++) {
            const i = Math.round(k * step);
            if (i > 0 && i < n - 1 && handleIndices[handleIndices.length - 1] !== i) {
              handleIndices.push(i);
            }
          }
        }
        if (n - 1 > 0) handleIndices.push(n - 1);

        handleIndices.forEach((idx, hpos) => {
          const coord = coords[idx];
          const kind = idx === 0 || idx === n - 1 ? 'end' : 'mid';
          const m = L.marker(coord, { icon: makeIcon(kind), draggable: true });
          const isEnd = idx === 0 || idx === n - 1;
          const end: 'from' | 'to' = idx === 0 ? 'from' : 'to';
          // Соседние ручки задают пролёт, внутри которого трасса тянется за
          // ручкой: к ним смещение сходит на нет, и форма не рушится.
          const prevH = hpos > 0 ? handleIndices[hpos - 1] : null;
          const nextH = hpos < handleIndices.length - 1 ? handleIndices[hpos + 1] : null;

          m.on('drag', () => {
            if (!isEnd) return;
            const ll = m.getLatLng();
            const cable = propsRef.current.cables.find((x) => x.id === editingCableId);
            if (cable) {
              const allowed = new Set(compatibleTargetsForCable(cable, end, propsRef.current.districts));
              const hit = nearestEntity(ll.lat, ll.lng, propsRef.current.districts, SNAP_ENTITY_M);
              if (hit && allowed.has(hit.id)) {
                m.setLatLng([hit.lat, hit.lon]);
                propsRef.current.onSnapHighlight?.(hit.id);
                return;
              }
            }
            propsRef.current.onSnapHighlight?.(null);
          });

          m.on('dragend', () => {
            const ll = m.getLatLng();
            const latest = readCoords();
            if (idx < 0 || idx >= latest.length) return;
            propsRef.current.onSnapHighlight?.(null);

            if (isEnd) {
              const cable = propsRef.current.cables.find((x) => x.id === editingCableId);
              if (cable) {
                const allowed = new Set(compatibleTargetsForCable(cable, end, propsRef.current.districts));
                const hit = nearestEntity(
                  ll.lat, ll.lng, propsRef.current.districts, SNAP_ENTITY_M,
                );
                if (hit && allowed.has(hit.id)) {
                  propsRef.current.onCableEndpointSnap?.(editingCableId, end, hit.id);
                  return;
                }
              }
            }
            // Тянем вершину, не спрямляя трассу: спрятанные вершины пролёта
            // едут следом и к соседним ручкам смещение сходит на нет.
            // Раньше они выбрасывались, и обход озера превращался в прямую.
            applyCoords(warpWaypoint(coords, prevH, idx, nextH, ll.lat, ll.lng));
          });
          group.addLayer(m);
        });
      });
    });
  }, [props.editingCableId, props.cables]);
  useEffect(() => { renderAnnotations(); }, [props.annotations]);
  useEffect(() => { renderDrillPoints(); }, [props.drillPoints, mapReady]);
  useEffect(() => { renderCrews(); }, [props.crews, mapReady]);
  useEffect(() => { renderDeviations(); }, [props.deviations, mapReady]);
  useEffect(() => {
    renderPlanRoutes();
  }, [props.planRoutes, props.drillLines, props.routeSegments, props.routeColorMode, mapReady]);
  useEffect(() => { renderRouteEdit(); }, [props.editingRouteId, props.planRoutes, mapReady]);
  useEffect(() => { renderAreaEdit(); }, [props.editingAreaId, props.areas, mapReady]);
  // Карточка контура меняется вместе с режимом правки: кнопка должна
  // превращаться в «Готово», а не оставаться «Изменить».
  useEffect(() => { renderAreas(); }, [props.editingAreaId]);

  // Рисование: Enter заканчивает линию, Esc бросает начатое. Клавиатура
  // здесь важнее кнопок — рисуют мышью, вторая рука на клавишах.
  useEffect(() => {
    if (!props.drawingRoute) {
      routeDraftRef.current = [];
      drawGroupRef.current?.clearLayers();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') finishRouteDraft();
      if (e.key === 'Escape') {
        routeDraftRef.current = [];
        drawGroupRef.current?.clearLayers();
        propsRef.current.onRouteDrawn?.([]);
      }
      if (e.key === 'Backspace') {
        routeDraftRef.current.pop();
        import('leaflet').then((L) => renderRouteDraft(L));
      }
    };
    window.addEventListener('keydown', onKey);
    // Двойной клик не должен заодно приближать карту.
    mapRef.current?.doubleClickZoom?.disable();
    return () => {
      window.removeEventListener('keydown', onKey);
      mapRef.current?.doubleClickZoom?.enable();
    };
  }, [props.drawingRoute]);
  useEffect(() => { renderSnpPoints(); }, [props.snpPoints, mapReady]);
  useEffect(() => { renderAreas(); }, [props.areas, mapReady]);
  useEffect(() => { renderSiteObjects(); }, [props.siteObjects, mapReady]);
  useEffect(() => { renderIncidents(); }, [props.incidents, mapReady]);
  useEffect(() => {
    runFlow();
    return () => {
      if (flowRafRef.current !== null) cancelAnimationFrame(flowRafRef.current);
      flowRafRef.current = null;
    };
  }, [props.planRoutes, props.showFlow, mapReady]);
  useEffect(() => {
    runPlayback();
    return () => {
      if (playbackRafRef.current !== null) cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    };
  }, [props.playbackMoves, mapReady]);
  useEffect(() => { renderData(); }, [props.hideNetwork]);

  /**
   * Первый показ журнала без проекта сети: подвинуть карту к данным.
   *
   * Без этого человек открывает приложение и видит пустой юг страны, хотя
   * стройка идёт в Акмолинской. Двигаем ровно один раз: если делать это на
   * каждое обновление, карта будет выдёргивать из-под рук при каждой записи.
   */
  const didFitJournalRef = useRef(false);
  useEffect(() => {
    if (!mapReady || didFitJournalRef.current) return;
    if (props.districts.length > 0) return;
    const pts: [number, number][] = [];
    for (const p of props.drillPoints ?? []) pts.push([p.lat, p.lon]);
    for (const s of props.snpPoints ?? []) pts.push([s.lat, s.lon]);
    for (const c of props.crews ?? []) {
      if (typeof c.lat === 'number' && typeof c.lon === 'number') pts.push([c.lat, c.lon]);
    }
    for (const d of props.deviations ?? []) for (const c of d.coords) pts.push([c.lat, c.lon]);
    for (const r of props.planRoutes ?? []) if (r.coords[0]) pts.push(r.coords[0]);
    if (pts.length === 0) return;
    didFitJournalRef.current = true;
    import('leaflet').then((L) => {
      try {
        // animate: false — карта должна сразу открыться на данных, а не
        // проезжать через полстраны; заодно положение выставляется
        // синхронно, а не по окончании анимации.
        mapRef.current?.fitBounds(L.latLngBounds(pts), {
          padding: [60, 60], maxZoom: 12, animate: false,
        });
      } catch { /* данные могут быть кривыми — это не повод ломать карту */ }
    });
  }, [mapReady, props.districts, props.drillPoints, props.snpPoints, props.crews,
      props.deviations, props.planRoutes]);

  // Draw the lasso selection overlay (independent layer so it doesn't get
  // cleared by the data-layer rerender): in-progress vertices + closed polygon.
  const selectionLayerRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    import('leaflet').then((L) => {
      if (selectionLayerRef.current) {
        map.removeLayer(selectionLayerRef.current);
        selectionLayerRef.current = null;
      }
      const poly = props.selectionPoly;
      const pts = props.selectionPoints ?? [];
      const group = L.layerGroup();
      if (poly && poly.length >= 3) {
        // Финальный замкнутый полигон выделения.
        L.polygon(poly as any, {
          color: '#fbbf24', weight: 2, dashArray: '6,4',
          fillColor: '#fbbf24', fillOpacity: 0.08,
        } as any).addTo(group);
      } else if (pts.length > 0) {
        // В процессе: пунктирная линия по вершинам + точки-маркеры.
        if (pts.length >= 2) {
          L.polyline(pts as any, { color: '#fbbf24', weight: 2, dashArray: '6,4' } as any).addTo(group);
        }
        for (const [la, lo] of pts) {
          L.circleMarker([la, lo], {
            radius: 4, color: '#fbbf24', fillColor: '#fbbf24', fillOpacity: 1, weight: 1,
          } as any).addTo(group);
        }
      } else {
        return;
      }
      group.addTo(map);
      selectionLayerRef.current = group;
    });
  }, [props.selectionPoly, props.selectionPoints]);

  // Heatmap
  useEffect(() => {
    if (!mapRef.current) return;
    (async () => {
      const L = await import('leaflet');
      await import('leaflet.heat');
      if (heatLayerRef.current) {
        mapRef.current.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      if (!props.heatmapEnabled) return;
      const points: [number, number, number][] = [];
      for (const d of props.districts) {
        for (const sub of d.subscribers) {
          points.push([sub.lat, sub.lon, 0.7]);
        }
      }
      if (points.length === 0) return;
      // @ts-ignore
      heatLayerRef.current = (L as any).heatLayer(points, {
        radius: 25, blur: 18, maxZoom: 17, max: 1.0,
        gradient: { 0.2: '#3b82f6', 0.4: '#34d399', 0.6: '#fbbf24', 0.8: '#f97316', 1.0: '#ef4444' },
      }).addTo(mapRef.current);
    })();
  }, [props.heatmapEnabled, props.districts]);

  // Expose delete subscriber to window for popup buttons
  useEffect(() => {
    (window as any).__deleteSub__ = (id: string) => propsRef.current.deleteSubscriber?.(id);
    (window as any).__showBranchSub__ = (id: string) => propsRef.current.onShowBranchSub?.(id);
    (window as any).__optiqEditRoute__ = (id: string) => {
      mapRef.current?.closePopup?.();
      propsRef.current.onEditRoute?.(id);
    };
    (window as any).__optiqEditObject__ = (id: string) => {
      mapRef.current?.closePopup?.();
      propsRef.current.onEditSiteObject?.(id);
    };
    // Одна точка входа на все действия с контуром: кнопок в карточке
    // три, а обработчик пусть будет один.
    (window as any).__optiqArea__ = (act: string, id: string) => {
      mapRef.current?.closePopup?.();
      if (act === 'zoom') {
        // «Раскрыть» — это подвинуть карту так, чтобы стало видно то,
        // что внутри: районы у области, сёла у района.
        const a = (propsRef.current.areas ?? []).find((x) => x.id === id);
        if (a?.coords?.length) {
          import('leaflet').then((L) => {
            try {
              mapRef.current?.fitBounds(L.latLngBounds(a.coords), { padding: [40, 40] });
            } catch { /* вырожденная рамка */ }
          });
        }
        return;
      }
      if (act === 'edit') propsRef.current.onEditArea?.(id);
      if (act === 'done') propsRef.current.onEditArea?.(null);
      if (act === 'rename') propsRef.current.onRenameArea?.(id);
      if (act === 'delete') propsRef.current.onDeleteArea?.(id);
    };
    (window as any).__optiqDeleteRoute__ = (id: string) => {
      mapRef.current?.closePopup?.();
      propsRef.current.onDeleteRoute?.(id);
    };
    (window as any).__optiqSplitRoute__ = (id: string) => {
      mapRef.current?.closePopup?.();
      const click = lastRouteClickRef.current;
      const route = (propsRef.current.planRoutes ?? []).find((r) => r.id === id);
      if (!route || !click || click.id !== id) return;
      const hit = nearestOnRoute({ lat: click.lat, lon: click.lon }, route.coords);
      if (hit) propsRef.current.onSplitRoute?.(id, hit.atM);
    };
    (window as any).__optiqJoinRoute__ = (id: string) => {
      mapRef.current?.closePopup?.();
      propsRef.current.onJoinRoute?.(id);
    };
    return () => {
      delete (window as any).__deleteSub__;
      delete (window as any).__showBranchSub__;
      delete (window as any).__optiqEditRoute__;
      delete (window as any).__optiqDeleteRoute__;
      delete (window as any).__optiqSplitRoute__;
      delete (window as any).__optiqJoinRoute__;
      delete (window as any).__optiqEditObject__;
    };
  }, []);

  return (
    <div className="relative w-full h-full" style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />

      {mapReady && (
        <PresenceCursors map={mapRef.current} peers={props.presencePeers ?? []} />
      )}

      {mapReady && (
        <ScaleBar
          map={mapRef.current}
          className="absolute left-2 md:left-3 bottom-[calc(8px+env(safe-area-inset-bottom))] z-[400]"
        />
      )}

      {/* Легенда объясняет только то, что сейчас на карте: слой выключили
          — ушла и его строка. */}
      {mapReady && (
        <MapLegend
          layers={{
            plan: (props.planRoutes?.length ?? 0) > 0,
            objects: (props.siteObjects?.length ?? 0) > 0,
            drills: (props.drillPoints?.length ?? 0) > 0 || (props.drillLines?.length ?? 0) > 0,
            crews: (props.crews?.length ?? 0) > 0,
            deviations: (props.deviations?.length ?? 0) > 0,
            incidents: (props.incidents?.length ?? 0) > 0,
            areas: (props.areas?.length ?? 0) > 0,
            snp: (props.snpPoints?.length ?? 0) > 0,
            flow: !!props.showFlow,
          }}
          colorMode={props.routeColorMode ?? 'stage'}
          className="absolute left-2 md:left-3 bottom-[calc(30px+env(safe-area-inset-bottom))] z-[400]"
        />
      )}

      {props.offlineTiles && (
        <OfflineTilesButton
          className="absolute bottom-[calc(162px+env(safe-area-inset-bottom))] md:bottom-auto md:top-[104px] right-2 md:right-3 z-[400]"
          template={BASEMAPS[baseMap].url}
          getBounds={() => {
            const map = mapRef.current;
            if (!map) return null;
            const b = map.getBounds();
            return {
              north: b.getNorth(), south: b.getSouth(),
              east: b.getEast(), west: b.getWest(),
              zoom: map.getZoom(),
            };
          }}
        />
      )}

      <GpsLocateButton
        className="absolute bottom-[calc(118px+env(safe-area-inset-bottom))] md:bottom-auto md:top-14 right-2 md:right-3 z-[400]"
        onLocated={(lat, lon, accuracyM) => {
          propsRef.current.flyToRef?.current?.(lat, lon, 18);
          import('leaflet').then((L) => {
            const map = mapRef.current;
            if (!map) return;
            gpsMarkerRef.current?.remove();
            gpsCircleRef.current?.remove();
            const icon = L.divIcon({
              className: '',
              html: '<div style="width:14px;height:14px;border-radius:50%;background:#38bdf8;border:2px solid #fff;box-shadow:0 0 8px #38bdf8"></div>',
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            });
            gpsMarkerRef.current = L.marker([lat, lon], { icon }).addTo(map)
              .bindPopup('<b>Вы здесь</b>');
            if (accuracyM && accuracyM < 200) {
              gpsCircleRef.current = L.circle([lat, lon], { radius: accuracyM, color: '#38bdf8', fillOpacity: 0.08, weight: 1 }).addTo(map);
            }
          });
        }}
      />

      {/* Basemap switcher */}
      <div className="absolute bottom-[calc(58px+env(safe-area-inset-bottom))] md:bottom-auto md:top-3 right-2 md:right-3 flex flex-col gap-1 z-[400]">
        <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg p-1 flex gap-0.5 shadow-xl">
          {(['dark', 'light', 'satellite', 'hybrid', 'topo'] as BaseMap[]).map((bm) => (
            <button
              key={bm}
              onClick={() => setBaseMap(bm)}
              className={`px-2 py-1 text-[10px] rounded transition-all ${baseMap === bm ? 'bg-[#38bdf8]/15 text-[#38bdf8]' : 'text-[#94a3b8] hover:text-[#e2e8f0]'}`}
              title={BASEMAP_LABEL[bm]}
              aria-label={BASEMAP_LABEL[bm]}
              aria-pressed={baseMap === bm}
            >
              {BASEMAP_ICON[bm]}
            </button>
          ))}
        </div>
      </div>

      {/* Measure / Edit mode indicator */}
      {props.searchOnMap && mapReady && (
        <MapSearch
          className="absolute top-2 left-1/2 -translate-x-1/2 z-[401]"
          sources={{
            routes: props.planRoutes,
            objects: props.siteObjects,
            areas: props.areas,
            crews: props.crews,
            incidents: props.incidents,
            snpPoints: props.snpSearchPoints,
          }}
          onPick={(hit) => {
            const map = mapRef.current;
            if (!map) return;
            // Трассу и контур показываем целиком: их вопрос — «где она
            // идёт», а не «где её середина».
            if (hit.bounds && hit.bounds.length > 1) {
              import('leaflet').then((L) => {
                try {
                  map.fitBounds(L.latLngBounds(hit.bounds as [number, number][]),
                    { padding: [60, 60], maxZoom: 16 });
                } catch {
                  map.flyTo([hit.lat, hit.lon], hit.zoom, { duration: 0.8 });
                }
              });
              return;
            }
            map.flyTo([hit.lat, hit.lon], hit.zoom, { duration: 0.8 });
          }}
        />
      )}

      <div className="absolute top-2 left-2 md:top-3 md:left-3 z-[400] flex flex-col gap-1 max-md:max-w-[140px]">
        <button
          onClick={() => {
            const next = !props.measureMode;
            props.setMeasureMode(next);
            if (!next) { measureStateRef.current = { coords: [], snaps: [], total: 0 }; measureGroupRef.current?.clearLayers(); }
            if (next) props.setActiveTool(null);
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border shadow-lg transition-all ${props.measureMode ? 'bg-[#fbbf24]/15 border-[#fbbf24] text-[#fbbf24]' : 'bg-[#0d1b2a] border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
        >
          📏 Линейка
        </button>
        {props.onRouteDrawn && (
          <button
            onClick={() => props.onToggleDrawRoute?.()}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border shadow-lg transition-all ${
              props.drawingRoute
                ? 'bg-[#f472b6]/15 border-[#f472b6] text-[#f472b6]'
                : 'bg-[#0d1b2a] border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
          >
            ✏️ Трасса
          </button>
        )}
        {props.onRouteDrawn && props.onToggleDrawArea && (
          <button
            onClick={() => props.onToggleDrawArea?.()}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border shadow-lg transition-all ${
              props.drawingRoute && props.drawShape === 'area'
                ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8]'
                : 'bg-[#0d1b2a] border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
          >
            ✏️ Контур
          </button>
        )}
        {/* Прямоугольник и круг — те же контуры, только двумя кликами.
            Площадку под склад или зону работ обводят именно так. */}
        {props.onRouteDrawn && props.onSetDrawShape && (
          <div className="flex gap-1">
            {([['rect', '▭', 'Прямоугольник'], ['circle', '◯', 'Круг']] as const).map(
              ([shape, glyph, title]) => (
                <button
                  key={shape}
                  title={title}
                  aria-label={title}
                  onClick={() => props.onSetDrawShape?.(shape)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border shadow-lg transition-all ${
                    props.drawingRoute && props.drawShape === shape
                      ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8]'
                      : 'bg-[#0d1b2a] border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
                >
                  {glyph}
                </button>
              ),
            )}
          </div>
        )}
        {props.playbackDate && (
          <div className="bg-[#0d1b2a]/95 border border-[#4ade80]/50 rounded-lg px-3 py-1.5 text-[10px] text-[#e2e8f0] shadow-lg max-w-[220px]">
            {new Date(`${props.playbackDate}T00:00:00Z`).toLocaleDateString('ru')}:{' '}
            {(props.playbackMoves ?? []).length
              ? `${(props.playbackMoves ?? []).length} колонн в движении`
              : 'движения по трассам нет'}
          </div>
        )}
        {props.editingRouteId && (
          <div className="bg-[#0d1b2a]/95 border border-[#2dd4bf]/50 rounded-lg px-3 py-1.5 text-[10px] text-[#e2e8f0] shadow-lg max-w-[220px] flex flex-col gap-1.5">
            <span>Тяните ручки — трасса гнётся, форма остаётся. ПКМ по ручке убирает вершину.</span>
            <button type="button" onClick={() => props.onEditRoute?.(null)}
                    className="self-start px-2 py-0.5 rounded bg-[#2dd4bf] text-[#041016] text-[10px] font-semibold">
              Готово
            </button>
          </div>
        )}
        {props.drawingRoute && (
          <div className="bg-[#0d1b2a]/95 rounded-lg px-3 py-1.5 text-[10px] text-[#e2e8f0] shadow-lg max-w-[220px] border"
               style={{ borderColor: props.drawShape === 'route' ? '#f472b680' : '#38bdf880' }}>
            {props.drawShape === 'rect' && 'Клик — первый угол, второй клик — противоположный.'}
            {props.drawShape === 'circle' && 'Клик — центр, второй клик — край круга.'}
            {(props.drawShape === 'route' || props.drawShape === 'area') && (
              <>
                Кликайте по карте — вершины {props.drawShape === 'area' ? 'контура' : 'трассы'}.
                Двойной клик, ПКМ или Enter — закончить. Backspace — убрать
                последнюю. Esc — отмена.
                {props.drawShape === 'area' && ' Контуру нужно минимум три точки.'}
                {props.drawShape === 'route' && ' Рядом с трассой вершина прилипает к ней.'}
              </>
            )}
          </div>
        )}
        {props.measureMode && props.onSetMeasureShape && (
          <div className="bg-[#0d1b2a]/95 border border-[#fbbf24]/50 rounded-lg p-2 shadow-lg
                          max-w-[230px] flex flex-col gap-1.5">
            <div className="flex gap-1">
              {([['line', 'Длина'], ['area', 'Площадь']] as const).map(([s, label]) => (
                <button
                  key={s}
                  onClick={() => {
                    props.onSetMeasureShape?.(s);
                    measureStateRef.current = { coords: [], snaps: [], total: 0 };
                    measureGroupRef.current?.clearLayers();
                    props.onMeasure?.(null);
                  }}
                  className={`flex-1 py-1 rounded text-[10.5px] font-medium border transition-colors ${
                    (props.measureShape ?? 'line') === s
                      ? 'bg-[#fbbf24]/15 border-[#fbbf24] text-[#fbbf24]'
                      : 'border-[#1e3a5f] text-[#94a3b8]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {props.measureReadout ? (
              <div className="text-[11px] text-[#e2e8f0] font-mono leading-snug">
                {props.measureReadout.areaM2 !== undefined ? (
                  <>
                    <div className="text-[13px] font-bold text-[#fbbf24]">
                      {formatArea(props.measureReadout.areaM2)}
                    </div>
                    <div className="text-[#94a3b8]">
                      периметр {formatMeters(props.measureReadout.perimeterM ?? 0)}
                    </div>
                  </>
                ) : (
                  <>
                    {props.measureReadout.alongRouteM !== undefined && (
                      <div className="text-[13px] font-bold text-[#2dd4bf]">
                        {formatMeters(props.measureReadout.alongRouteM)}
                        <span className="text-[9px] font-normal"> по трассе</span>
                      </div>
                    )}
                    <div className={props.measureReadout.alongRouteM !== undefined
                      ? 'text-[#94a3b8]' : 'text-[13px] font-bold text-[#fbbf24]'}>
                      {formatMeters(props.measureReadout.totalM)}
                      <span className="text-[9px] font-normal"> по ломаной</span>
                    </div>
                    {props.measureReadout.points > 2 && (
                      <div className="text-[#94a3b8]">
                        {formatMeters(props.measureReadout.straightM)}
                        <span className="text-[9px]"> напрямую</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-[#94a3b8]">
                {(props.measureShape ?? 'line') === 'area'
                  ? 'Три клика и больше — обведите площадку.'
                  : 'Два клика. Рядом с трассой точка прилипает, и длина считается по трассе.'}
              </div>
            )}
            <div className="text-[9px] text-[#64748b]">ПКМ — сброс, Esc — выключить</div>
          </div>
        )}
        {(props.activeTool || props.editMode || (props.measureMode && !props.onSetMeasureShape)) && (
          <div className="bg-[#0d1b2a]/95 border border-[#1e3a5f] rounded-lg px-3 py-1.5 text-[10px] text-[#94a3b8] shadow-lg max-w-[200px]">
            {props.measureMode && <>📏 Кликайте по карте — измерение. ПКМ = сброс. ESC = выкл.</>}
            {props.activeTool && !props.measureMode && <>✏️ Рисование: {props.activeTool}. ПКМ = завершить. ESC = отмена.</>}
            {props.editMode && !props.activeTool && !props.measureMode && <>🛠 Клик по карте = добавить абонента.</>}
          </div>
        )}
      </div>
    </div>
  );
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
