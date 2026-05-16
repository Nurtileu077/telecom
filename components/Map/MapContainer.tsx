'use client';
import { useEffect, useRef, useState } from 'react';
import {
  District, Cable, LayerVisibility, MapAnnotation, AnnotationType,
  ANNOTATION_PRESETS, InlineJoint, CABLE_COLORS as CABLE_COLORS_MAP,
} from '@/types/network';
import type { DrawingTool } from '@/components/Sidebar/NotesTab';

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
  onMapClick?: (lat: number, lon: number) => void;
  onMapContextMenu?: (lat: number, lon: number, screenX: number, screenY: number) => void;
  moveEntity?: (kind: 'tb' | 'ork' | 'olt', id: string, lat: number, lon: number) => void;
  deleteSubscriber?: (id: string) => void;
  onEntityClick?: (kind: 'olt' | 'tb' | 'ork', id: string) => void;
  onCableClick?: (id: string) => void;
  editingCableId?: string | null;
  onUpdateCableCoords?: (id: string, coords: [number, number][]) => void;

  // Power-budget colouring of subscribers
  budgetMap?: Map<string, 'ok' | 'warn' | 'fail'>;
  budgetColoring?: boolean;
  // Measure
  measureMode: boolean;
  setMeasureMode: (v: boolean) => void;
  // Heatmap
  heatmapEnabled: boolean;
}

const CABLE_COLORS: Record<string, string> = CABLE_COLORS_MAP as Record<string, string>;
const CABLE_WEIGHTS: Record<string, number> = {
  'ОК-4':  1.5, 'ОК-8':  2,
  'ОК-12': 2.5, 'ОК-16': 3,
  'ОК-24': 3.5, 'ОК-32': 4,
  'ОК-48': 5,   'ОК-96': 6,
};
const CABLE_LAYER_KEY: Record<string, keyof LayerVisibility> = {
  'ОК-4': 'cableOK4', 'ОК-8': 'cableOK8',
  'ОК-12': 'cableOK12', 'ОК-16': 'cableOK16',
  'ОК-24': 'cableOK24', 'ОК-32': 'cableOK32',
  'ОК-48': 'cableOK48', 'ОК-96': 'cableOK96',
};

type BaseMap = 'dark' | 'light' | 'satellite' | 'hybrid';

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

export default function LeafletMap(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const hybridLabelsRef = useRef<any>(null);
  const dataGroupRef = useRef<any>(null);
  const annoGroupRef = useRef<any>(null);
  const drawGroupRef = useRef<any>(null);
  const measureGroupRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const drawStateRef = useRef<{ coords: [number, number][]; tempLayer?: any }>({ coords: [] });
  const measureStateRef = useRef<{ coords: [number, number][]; layer?: any; total: number }>({ coords: [], total: 0 });
  const waypointGroupRef = useRef<any>(null);

  const [baseMap, setBaseMap] = useState<BaseMap>('dark');

  // Stable refs for callbacks (so we don't re-init map)
  const propsRef = useRef(props);
  propsRef.current = props;

  // Initialize map
  useEffect(() => {
    if (typeof window === 'undefined' || mapRef.current || !containerRef.current) return;

    import('leaflet').then((L) => {
      if (!containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [43.0, 68.0], zoom: 7, preferCanvas: true, zoomControl: false,
      });
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Base layer
      const tile = L.tileLayer(BASEMAPS.dark.url, {
        attribution: BASEMAPS.dark.attribution,
        subdomains: (BASEMAPS.dark.subdomains ?? '') as any,
        maxZoom: BASEMAPS.dark.maxZoom ?? 20,
      }).addTo(map);
      tileLayerRef.current = tile;

      dataGroupRef.current = L.layerGroup().addTo(map);
      annoGroupRef.current = L.layerGroup().addTo(map);
      drawGroupRef.current = L.layerGroup().addTo(map);
      measureGroupRef.current = L.layerGroup().addTo(map);
      waypointGroupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      // Force Leaflet to recalculate container size after layout settles
      setTimeout(() => { map.invalidateSize(); }, 100);
      setTimeout(() => { map.invalidateSize(); }, 500);

      if (propsRef.current.flyToRef) {
        propsRef.current.flyToRef.current = (lat, lon, zoom = 16) => {
          map.flyTo([lat, lon], zoom, { duration: 1.0 });
        };
      }
      if (propsRef.current.mapElRef) {
        propsRef.current.mapElRef.current = containerRef.current;
      }

      // Map click handler
      map.on('click', (e: any) => {
        const { lat, lng: lon } = e.latlng;
        const p = propsRef.current;

        // Measure mode
        if (p.measureMode) {
          const cs = measureStateRef.current;
          cs.coords.push([lat, lon]);
          renderMeasure(L);
          return;
        }

        // Drawing tool
        if (p.activeTool) {
          handleDrawClick(L, lat, lon);
          return;
        }

        // Edit mode: add subscriber. Placement mode: place OLT/TB/ORK
        if ((p.editMode || p.placingMode) && p.onMapClick) {
          p.onMapClick(lat, lon);
          return;
        }
      });

      // Right-click: finish polygon/line OR open context menu for "add here".
      map.on('contextmenu', (e: any) => {
        e.originalEvent.preventDefault();
        const p = propsRef.current;
        if (p.activeTool === 'polygon' || p.activeTool === 'line') {
          finishShape(L);
          return;
        }
        if (p.measureMode) {
          // reset measure
          measureStateRef.current = { coords: [], total: 0 };
          measureGroupRef.current?.clearLayers();
          return;
        }
        // Otherwise: hand off to host for a context menu (add point here, etc.)
        if (p.onMapContextMenu) {
          const oe = e.originalEvent as MouseEvent;
          p.onMapContextMenu(e.latlng.lat, e.latlng.lng, oe.clientX, oe.clientY);
        }
      });

      // Re-render on zoom (for drop visibility threshold)
      map.on('zoomend', () => {
        renderData();
      });

      // After map ready: render existing data and fit bounds if already loaded
      setTimeout(() => {
        renderData();
        renderAnnotations();
        const districts = propsRef.current.districts;
        if (districts.length > 0) {
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

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
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
          measureStateRef.current = { coords: [], total: 0 };
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
      const tile = L.tileLayer(bm.url, {
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
    if (props.activeTool || props.editMode || props.measureMode || props.placingMode) {
      containerRef.current.style.cursor = 'crosshair';
    } else {
      containerRef.current.style.cursor = '';
    }
  }, [props.activeTool, props.editMode, props.measureMode, props.placingMode]);

  function renderData() {
    const map = mapRef.current;
    const group = dataGroupRef.current;
    if (!map || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const { districts, cables, layers, joints } = propsRef.current;
      const zoom = map.getZoom();

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
            color: isEditing ? '#c4b5fd' : (CABLE_COLORS[cable.type] || '#888'),
            weight: isEditing ? (CABLE_WEIGHTS[cable.type] || 2) + 2 : (CABLE_WEIGHTS[cable.type] || 2),
            opacity: cable.type === 'ОК-4' ? 0.6 : 0.85,
          });
          poly.bindTooltip(
            `<b>${cable.type}</b><br/>${cable.fromId} → ${cable.toId}<br/>Длина: ${Math.round(cable.lengthM)} м${lane > 0 ? `<br/><i style=\"color:#94a3b8\">полоса ${lane}</i>` : ''}`,
            { sticky: true, className: 'text-xs' },
          );
          poly.on('click', (e: any) => {
            e.originalEvent?.stopPropagation?.();
            propsRef.current.onCableClick?.(cable.id);
          });
          group.addLayer(poly);
        }
      }

      // In-line муфты — точки расхождения магистрали (создаются консолидацией)
      if (layers.tb && joints && zoom >= 13) {
        for (const j of joints) {
          const icon = L.divIcon({
            html: `<div style="width:14px;height:14px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;background:#0d1b2a;border:1.5px solid #38bdf8;border-radius:50%;color:#38bdf8;box-shadow:0 0 4px rgba(56,189,248,0.6)">⊕</div>`,
            className: '', iconSize: [14, 14], iconAnchor: [7, 7],
          });
          const m = L.marker([j.lat, j.lon], { icon });
          m.bindTooltip(
            `<b>Транзитная муфта</b><br/>${j.id}<br/>Ответвлений: ${j.branchCount}`,
            { sticky: true, className: 'text-xs' },
          );
          group.addLayer(m);
        }
      }

      for (const district of districts) {
        const { olt } = district;
        if (layers.olt) {
          const icon = L.divIcon({
            html: `<div style="width:40px;height:22px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;font-family:monospace;background:linear-gradient(135deg,#f59e0b,#fbbf24);border:2px solid #f59e0b;border-radius:4px;color:#0a0e1a;box-shadow:0 2px 8px rgba(0,0,0,0.5)">OLT</div>`,
            className: '', iconSize: [40, 22], iconAnchor: [20, 11],
          });
          const draggable = !!propsRef.current.editMode;
          const m = L.marker([olt.lat, olt.lon], { icon, draggable });
          m.bindPopup(`<b>${olt.id}</b><br/>${olt.model}<br/>Район: ${district.name}<br/>Ёмкость: ${olt.capacity}<br/>TB: ${olt.transitBoxes.length}`);
          m.on('click', () => { propsRef.current.onEntityClick?.('olt', olt.id); });
          m.on('contextmenu', (e: any) => {
            e.originalEvent.preventDefault();
            propsRef.current.onEntityClick?.('olt', olt.id);
          });
          if (draggable) {
            m.on('dragend', (e: any) => {
              const ll = e.target.getLatLng();
              propsRef.current.moveEntity?.('olt', olt.id, ll.lat, ll.lng);
            });
          }
          group.addLayer(m);
        }
        for (const tb of olt.transitBoxes) {
          if (layers.tb) {
            const icon = L.divIcon({
              html: `<div style="width:30px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;font-family:monospace;background:#1a2744;border:2px solid #38bdf8;border-radius:3px;color:#38bdf8;box-shadow:0 1px 4px rgba(0,0,0,0.4)">TB</div>`,
              className: '', iconSize: [30, 18], iconAnchor: [15, 9],
            });
            const draggable = !!propsRef.current.editMode;
            const m = L.marker([tb.lat, tb.lon], { icon, draggable });
            m.bindPopup(`<b>${tb.id}</b><br/>OLT: ${olt.id}<br/>ОРК: ${tb.orks.length}<br/>Муфта: ${tb.muftaType}${draggable ? '<br/><i style="color:#64748b;font-size:10px">Перетащи для перемещения</i>' : ''}`);
            m.on('click', () => { propsRef.current.onEntityClick?.('tb', tb.id); });
            m.on('contextmenu', (e: any) => {
              e.originalEvent.preventDefault();
              propsRef.current.onEntityClick?.('tb', tb.id);
            });
            if (draggable) {
              m.on('dragend', (e: any) => {
                const ll = e.target.getLatLng();
                propsRef.current.moveEntity?.('tb', tb.id, ll.lat, ll.lng);
              });
            }
            group.addLayer(m);
          }
          for (const ork of tb.orks) {
            if (layers.ork) {
              const icon = L.divIcon({
                html: `<div style="width:32px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;font-family:monospace;background:#1a2744;border:2px solid #f59e0b;border-radius:3px;color:#f59e0b;box-shadow:0 1px 4px rgba(0,0,0,0.4)">ОРК</div>`,
                className: '', iconSize: [32, 18], iconAnchor: [16, 9],
              });
              const draggable = !!propsRef.current.editMode;
              const m = L.marker([ork.lat, ork.lon], { icon, draggable });
              m.bindPopup(`<b>${ork.id}</b><br/>Сплиттер: ${ork.splitter}<br/>Або.: ${ork.subscribers.length}<br/>Муфта: ${tb.id}${draggable ? '<br/><i style="color:#64748b;font-size:10px">Перетащи для перемещения</i>' : ''}`);
              m.on('click', () => { propsRef.current.onEntityClick?.('ork', ork.id); });
              m.on('contextmenu', (e: any) => {
                e.originalEvent.preventDefault();
                propsRef.current.onEntityClick?.('ork', ork.id);
              });
              if (draggable) {
                m.on('dragend', (e: any) => {
                  const ll = e.target.getLatLng();
                  propsRef.current.moveEntity?.('ork', ork.id, ll.lat, ll.lng);
                });
              }
              group.addLayer(m);
            }
            if (layers.subscribers && zoom >= 13) {
              const budgetMap = propsRef.current.budgetMap;
              const colorByBudget = propsRef.current.budgetColoring;
              for (const sub of ork.subscribers) {
                let fillColor = district.color;
                if (colorByBudget && budgetMap) {
                  const s = budgetMap.get(sub.id);
                  if (s === 'ok')   fillColor = '#34d399';
                  if (s === 'warn') fillColor = '#f59e0b';
                  if (s === 'fail') fillColor = '#f87171';
                }
                const c = L.circleMarker([sub.lat, sub.lon], {
                  radius: 4, fillColor, fillOpacity: 0.85,
                  color: fillColor, weight: 1,
                });
                c.bindPopup(`<b>${sub.desc}</b><br/>ОРК: ${ork.id}<br/>Волокна: ${sub.fibers.working}+${sub.fibers.spare}${propsRef.current.editMode ? '<br/><button onclick="window.__deleteSub__(\'' + sub.id + '\')" style="margin-top:6px;padding:2px 8px;background:#f87171;color:#fff;border:none;border-radius:3px;font-size:10px;cursor:pointer">Удалить</button>' : ''}`);
                c.on('contextmenu', (e: any) => {
                  e.originalEvent.preventDefault();
                  if (propsRef.current.editMode && confirm(`Удалить абонента «${sub.desc}»?`)) {
                    propsRef.current.deleteSubscriber?.(sub.id);
                  }
                });
                group.addLayer(c);
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
        const radius = zoom >= 16 ? 3.5 : zoom >= 13 ? 2.5 : 1.5;
        for (const s of unassigned) {
          const c = L.circleMarker([s.lat, s.lon], {
            radius,
            color: '#94a3b8',
            fillColor: '#94a3b8',
            fillOpacity: 0.6,
            weight: 1,
          });
          c.bindTooltip(`<b>${s.desc}</b><br/>${s.district}<br/><i style="color:#64748b">не привязан — нажми «Построить»</i>`, { sticky: true, className: 'text-xs' });
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
        } else if (a.shape === 'circle' && a.coords[0] && a.radius) {
          const [lat, lon] = a.coords[0];
          const c = L.circle([lat, lon], {
            radius: a.radius, color, weight: 2, fillColor: color, fillOpacity: 0.15, opacity: 0.8,
          });
          c.bindPopup(popup);
          c.bindTooltip(`${preset.icon} ${a.name || preset.label} (R=${Math.round(a.radius)}м)`, { sticky: true });
          group.addLayer(c);
        }
      }
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

  function renderMeasure(L: any) {
    measureGroupRef.current.clearLayers();
    const s = measureStateRef.current;
    if (s.coords.length === 0) return;
    let total = 0;
    for (let i = 1; i < s.coords.length; i++) {
      total += haversineMeters(s.coords[i - 1][0], s.coords[i - 1][1], s.coords[i][0], s.coords[i][1]);
    }
    s.total = total;
    if (s.coords.length >= 2) {
      const line = L.polyline(s.coords, { color: '#fbbf24', weight: 3, opacity: 0.9, dashArray: '8,4' });
      measureGroupRef.current.addLayer(line);
    }
    for (const [lat, lon] of s.coords) {
      measureGroupRef.current.addLayer(
        L.circleMarker([lat, lon], { radius: 5, color: '#fbbf24', fillColor: '#fbbf24', fillOpacity: 1 }),
      );
    }
    // tooltip at last point
    const last = s.coords[s.coords.length - 1];
    const label = L.marker(last, {
      icon: L.divIcon({
        html: `<div style="background:#0d1b2a;border:1px solid #fbbf24;color:#fbbf24;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:11px;font-weight:bold;white-space:nowrap">📏 ${total < 1000 ? `${Math.round(total)} м` : `${(total / 1000).toFixed(2)} км`}</div>`,
        className: '', iconSize: [80, 20], iconAnchor: [-8, 8],
      }),
    });
    measureGroupRef.current.addLayer(label);
  }

  // Re-render whenever data changes
  useEffect(() => { renderData(); }, [props.districts, props.cables, props.joints, props.layers, props.editMode, props.editingCableId, props.budgetColoring, props.budgetMap]);

  // Waypoint editing: show draggable handles for the selected cable
  useEffect(() => {
    const group = waypointGroupRef.current;
    if (!group) return;
    group.clearLayers();
    const { editingCableId, cables, onUpdateCableCoords } = propsRef.current;
    if (!editingCableId || !onUpdateCableCoords) return;
    const cable = cables.find((c) => c.id === editingCableId);
    if (!cable) return;
    import('leaflet').then((L) => {
      const coords: [number, number][] = cable.coords.map((c) => [c[0], c[1]]);
      const icon = L.divIcon({
        html: '<div style="width:10px;height:10px;background:#a78bfa;border:2px solid #fff;border-radius:50%;cursor:grab"></div>',
        className: '', iconSize: [10, 10], iconAnchor: [5, 5],
      });
      const markers: any[] = coords.map((coord, idx) => {
        const m = L.marker(coord, { icon, draggable: true });
        m.on('dragend', () => {
          const ll = m.getLatLng();
          coords[idx] = [ll.lat, ll.lng];
          const newCoords: [number, number][] = coords.map((c) => [c[0], c[1]]);
          // recalc length
          let len = 0;
          const R = 6371000;
          for (let i = 1; i < newCoords.length; i++) {
            const [la, lo] = newCoords[i - 1];
            const [lb, lob] = newCoords[i];
            const dLat = ((lb - la) * Math.PI) / 180;
            const dLon = ((lob - lo) * Math.PI) / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos((la * Math.PI) / 180) * Math.cos((lb * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
            len += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          }
          propsRef.current.onUpdateCableCoords?.(editingCableId, newCoords);
          // update marker position in coords array for subsequent drags
          markers[idx].setLatLng([ll.lat, ll.lng]);
        });
        group.addLayer(m);
        return m;
      });
    });
  }, [props.editingCableId, props.cables]);
  useEffect(() => { renderAnnotations(); }, [props.annotations]);

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
    return () => { delete (window as any).__deleteSub__; };
  }, []);

  return (
    <div className="relative w-full h-full" style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />

      {/* Basemap switcher */}
      <div className="absolute top-3 right-3 flex flex-col gap-1 z-[400]">
        <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg p-1 flex gap-0.5 shadow-xl">
          {(['dark', 'light', 'satellite', 'hybrid'] as BaseMap[]).map((bm) => (
            <button
              key={bm}
              onClick={() => setBaseMap(bm)}
              className={`px-2 py-1 text-[10px] rounded transition-all ${baseMap === bm ? 'bg-[#38bdf8]/15 text-[#38bdf8]' : 'text-[#94a3b8] hover:text-[#e2e8f0]'}`}
              title={bm}
            >
              {bm === 'dark' ? '🌙' : bm === 'light' ? '☀️' : bm === 'satellite' ? '🛰' : '🗺'}
            </button>
          ))}
        </div>
      </div>

      {/* Measure / Edit mode indicator */}
      <div className="absolute top-3 left-3 z-[400] flex flex-col gap-1">
        <button
          onClick={() => {
            const next = !props.measureMode;
            props.setMeasureMode(next);
            if (!next) { measureStateRef.current = { coords: [], total: 0 }; measureGroupRef.current?.clearLayers(); }
            if (next) props.setActiveTool(null);
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border shadow-lg transition-all ${props.measureMode ? 'bg-[#fbbf24]/15 border-[#fbbf24] text-[#fbbf24]' : 'bg-[#0d1b2a] border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'}`}
        >
          📏 Линейка
        </button>
        {(props.activeTool || props.editMode || props.measureMode) && (
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
