'use client';
import { useEffect, useRef, useState } from 'react';
import {
  District, Cable, LayerVisibility, MapAnnotation, AnnotationType,
  ANNOTATION_PRESETS,
} from '@/types/network';
import type { DrawingTool } from '@/components/Sidebar/NotesTab';

interface Props {
  districts: District[];
  cables: Cable[];
  layers: LayerVisibility;
  flyToRef?: React.MutableRefObject<((lat: number, lon: number, zoom?: number) => void) | null>;
  // Annotations
  annotations: MapAnnotation[];
  activeTool: DrawingTool;
  setActiveTool: (t: DrawingTool) => void;
  activeAnnotationType: AnnotationType;
  addAnnotation: (a: Omit<MapAnnotation, 'id' | 'createdAt' | 'updatedAt'>) => MapAnnotation;
  deleteAnnotation: (id: string) => void;
  // Edit mode
  editMode: boolean;
  onMapClick?: (lat: number, lon: number) => void;
  // Measure
  measureMode: boolean;
  setMeasureMode: (v: boolean) => void;
}

const CABLE_COLORS: Record<string, string> = {
  'ОКБ-10': '#00d4fc', 'ОКСНН-8': '#ec8a00', 'ОКСНН-4': '#3a92fb', 'ОКА-2': '#99d499',
};
const CABLE_WEIGHTS: Record<string, number> = {
  'ОКБ-10': 5, 'ОКСНН-8': 3.5, 'ОКСНН-4': 2.5, 'ОКА-2': 1.5,
};
const CABLE_LAYER_KEY: Record<string, keyof LayerVisibility> = {
  'ОКБ-10': 'cableOKB10', 'ОКСНН-8': 'cableOKSNN8',
  'ОКСНН-4': 'cableOKSNN4', 'ОКА-2': 'cableOKA2',
};

type BaseMap = 'dark' | 'light' | 'satellite' | 'hybrid';

const BASEMAPS: Record<BaseMap, { url: string; attribution: string; subdomains?: string }> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '©OSM ©CartoDB', subdomains: 'abcd',
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '©OSM ©CartoDB', subdomains: 'abcd',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '©Esri',
  },
  hybrid: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '©Esri', // overlay with labels added separately
  },
};

export default function LeafletMap(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const hybridLabelsRef = useRef<any>(null);
  const dataGroupRef = useRef<any>(null);
  const annoGroupRef = useRef<any>(null);
  const drawGroupRef = useRef<any>(null);
  const measureGroupRef = useRef<any>(null);
  const drawStateRef = useRef<{ coords: [number, number][]; tempLayer?: any }>({ coords: [] });
  const measureStateRef = useRef<{ coords: [number, number][]; layer?: any; total: number }>({ coords: [], total: 0 });

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
        subdomains: BASEMAPS.dark.subdomains as any,
        maxZoom: 20,
      }).addTo(map);
      tileLayerRef.current = tile;

      dataGroupRef.current = L.layerGroup().addTo(map);
      annoGroupRef.current = L.layerGroup().addTo(map);
      drawGroupRef.current = L.layerGroup().addTo(map);
      measureGroupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      if (propsRef.current.flyToRef) {
        propsRef.current.flyToRef.current = (lat, lon, zoom = 16) => {
          map.flyTo([lat, lon], zoom, { duration: 1.0 });
        };
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

        // Edit mode: add subscriber
        if (p.editMode && p.onMapClick) {
          p.onMapClick(lat, lon);
          return;
        }
      });

      // Right-click: finish polygon/line
      map.on('contextmenu', (e: any) => {
        e.originalEvent.preventDefault();
        const p = propsRef.current;
        if (p.activeTool === 'polygon' || p.activeTool === 'line') {
          finishShape(L);
        }
        if (p.measureMode) {
          // reset measure
          measureStateRef.current = { coords: [], total: 0 };
          measureGroupRef.current?.clearLayers();
        }
      });

      // Re-render on zoom (for drop visibility threshold)
      map.on('zoomend', () => {
        renderData();
      });
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
        attribution: bm.attribution, subdomains: bm.subdomains as any, maxZoom: 20,
      }).addTo(mapRef.current);
      tileLayerRef.current = tile;
      if (baseMap === 'hybrid') {
        const lbl = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 20, attribution: '',
        }).addTo(mapRef.current);
        hybridLabelsRef.current = lbl;
      }
    });
  }, [baseMap]);

  // Cursor based on mode
  useEffect(() => {
    if (!containerRef.current) return;
    if (props.activeTool || props.editMode || props.measureMode) {
      containerRef.current.style.cursor = 'crosshair';
    } else {
      containerRef.current.style.cursor = '';
    }
  }, [props.activeTool, props.editMode, props.measureMode]);

  function renderData() {
    const map = mapRef.current;
    const group = dataGroupRef.current;
    if (!map || !group) return;
    import('leaflet').then((L) => {
      group.clearLayers();
      const { districts, cables, layers } = propsRef.current;
      const zoom = map.getZoom();

      if (layers.cables) {
        for (const cable of cables) {
          const layerKey = CABLE_LAYER_KEY[cable.type];
          if (!layers[layerKey]) continue;
          if (cable.type === 'ОКА-2' && zoom < 14) continue;

          const poly = L.polyline(cable.coords, {
            color: CABLE_COLORS[cable.type] || '#888',
            weight: CABLE_WEIGHTS[cable.type] || 2,
            opacity: cable.type === 'ОКА-2' ? 0.6 : 0.85,
          });
          poly.bindTooltip(
            `<b>${cable.type}</b><br/>${cable.fromId} → ${cable.toId}<br/>Длина: ${Math.round(cable.lengthM)} м`,
            { sticky: true, className: 'text-xs' },
          );
          group.addLayer(poly);
        }
      }

      for (const district of districts) {
        const { olt } = district;
        if (layers.olt) {
          const icon = L.divIcon({
            html: `<div style="width:40px;height:22px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;font-family:monospace;background:linear-gradient(135deg,#f59e0b,#fbbf24);border:2px solid #f59e0b;border-radius:4px;color:#0a0e1a;box-shadow:0 2px 8px rgba(0,0,0,0.5)">OLT</div>`,
            className: '', iconSize: [40, 22], iconAnchor: [20, 11],
          });
          const m = L.marker([olt.lat, olt.lon], { icon });
          m.bindPopup(`<b>${olt.id}</b><br/>${olt.model}<br/>Район: ${district.name}<br/>Ёмкость: ${olt.capacity}<br/>TB: ${olt.transitBoxes.length}`);
          group.addLayer(m);
        }
        for (const tb of olt.transitBoxes) {
          if (layers.tb) {
            const icon = L.divIcon({
              html: `<div style="width:30px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;font-family:monospace;background:#1a2744;border:2px solid #38bdf8;border-radius:3px;color:#38bdf8;box-shadow:0 1px 4px rgba(0,0,0,0.4)">TB</div>`,
              className: '', iconSize: [30, 18], iconAnchor: [15, 9],
            });
            const m = L.marker([tb.lat, tb.lon], { icon });
            m.bindPopup(`<b>${tb.id}</b><br/>OLT: ${olt.id}<br/>ОРК: ${tb.orks.length}<br/>Муфта: ${tb.muftaType}`);
            group.addLayer(m);
          }
          for (const ork of tb.orks) {
            if (layers.ork) {
              const icon = L.divIcon({
                html: `<div style="width:32px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;font-family:monospace;background:#1a2744;border:2px solid #f59e0b;border-radius:3px;color:#f59e0b;box-shadow:0 1px 4px rgba(0,0,0,0.4)">ОРК</div>`,
                className: '', iconSize: [32, 18], iconAnchor: [16, 9],
              });
              const m = L.marker([ork.lat, ork.lon], { icon });
              m.bindPopup(`<b>${ork.id}</b><br/>Сплиттер: ${ork.splitter}<br/>Або.: ${ork.subscribers.length}<br/>Муфта: ${tb.id}`);
              group.addLayer(m);
            }
            if (layers.subscribers && zoom >= 13) {
              for (const sub of ork.subscribers) {
                const c = L.circleMarker([sub.lat, sub.lon], {
                  radius: 4, fillColor: district.color, fillOpacity: 0.8,
                  color: district.color, weight: 1,
                });
                c.bindPopup(`<b>${sub.desc}</b><br/>ОРК: ${ork.id}<br/>Волокна: ${sub.fibers.working}+${sub.fibers.spare}`);
                group.addLayer(c);
              }
            }
          }
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
  useEffect(() => { renderData(); }, [props.districts, props.cables, props.layers]);
  useEffect(() => { renderAnnotations(); }, [props.annotations]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

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
