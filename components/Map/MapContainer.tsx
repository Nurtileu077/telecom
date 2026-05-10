'use client';
import { useEffect, useRef, useMemo } from 'react';
import { District, Cable, LayerVisibility } from '@/types/network';

interface Props {
  districts: District[];
  cables: Cable[];
  layers: LayerVisibility;
  flyToRef?: React.MutableRefObject<((lat: number, lon: number, zoom?: number) => void) | null>;
}

const CABLE_COLORS: Record<string, string> = {
  'ОКБ-10': '#00d4fc',
  'ОКСНН-8': '#ec8a00',
  'ОКСНН-4': '#3a92fb',
  'ОКА-2': '#99d499',
};

const CABLE_WEIGHTS: Record<string, number> = {
  'ОКБ-10': 5,
  'ОКСНН-8': 3.5,
  'ОКСНН-4': 2.5,
  'ОКА-2': 1.5,
};

const CABLE_LAYER_KEY: Record<string, keyof LayerVisibility> = {
  'ОКБ-10': 'cableOKB10',
  'ОКСНН-8': 'cableOKSNN8',
  'ОКСНН-4': 'cableOKSNN4',
  'ОКА-2': 'cableOKA2',
};

export default function LeafletMap({ districts, cables, layers, flyToRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layersGroupRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mapRef.current) return;

    import('leaflet').then((L) => {
      if (!containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [43.0, 68.0],
        zoom: 7,
        preferCanvas: true,
        zoomControl: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '©OpenStreetMap ©CartoDB',
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      const group = L.layerGroup().addTo(map);
      layersGroupRef.current = group;
      mapRef.current = map;

      if (flyToRef) {
        flyToRef.current = (lat, lon, zoom = 16) => {
          map.flyTo([lat, lon], zoom, { duration: 1.2 });
        };
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layersGroupRef.current = null;
      }
    };
  }, []);

  // Re-render layers when data changes
  useEffect(() => {
    if (!mapRef.current || !layersGroupRef.current) return;
    import('leaflet').then((L) => {
      const group = layersGroupRef.current;
      group.clearLayers();

      if (!layers.cables) return;

      // Draw cables
      for (const cable of cables) {
        const layerKey = CABLE_LAYER_KEY[cable.type];
        if (!layers[layerKey]) continue;
        if (!layers.cableOKA2 && cable.type === 'ОКА-2') continue;

        const zoom = mapRef.current.getZoom();
        if (cable.type === 'ОКА-2' && zoom < 14) continue;

        const poly = L.polyline(cable.coords, {
          color: CABLE_COLORS[cable.type] || '#888',
          weight: CABLE_WEIGHTS[cable.type] || 2,
          opacity: cable.type === 'ОКА-2' ? 0.6 : 0.85,
        });
        poly.bindTooltip(
          `<b>${cable.type}</b><br/>${cable.fromId} → ${cable.toId}<br/>Длина: ${Math.round(cable.lengthM)} м`,
          { sticky: true, className: 'text-xs' }
        );
        group.addLayer(poly);
      }

      // Draw markers for each district
      for (const district of districts) {
        const { olt } = district;

        // OLT marker
        if (layers.olt) {
          const icon = L.divIcon({
            html: `<div class="map-marker olt-icon" style="width:40px;height:22px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;font-family:monospace;background:linear-gradient(135deg,#f59e0b,#fbbf24);border:2px solid #f59e0b;border-radius:4px;color:#0a0e1a">OLT</div>`,
            className: '',
            iconSize: [40, 22],
            iconAnchor: [20, 11],
          });
          const marker = L.marker([olt.lat, olt.lon], { icon });
          marker.bindPopup(`<b>${olt.id}</b><br/>Модель: ${olt.model}<br/>Район: ${district.name}<br/>Ёмкость: ${olt.capacity} або.<br/>TB: ${olt.transitBoxes.length}`);
          group.addLayer(marker);
        }

        for (const tb of olt.transitBoxes) {
          // TB marker
          if (layers.tb) {
            const icon = L.divIcon({
              html: `<div style="width:30px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;font-family:monospace;background:#1a2744;border:2px solid #38bdf8;border-radius:3px;color:#38bdf8">TB</div>`,
              className: '',
              iconSize: [30, 18],
              iconAnchor: [15, 9],
            });
            const marker = L.marker([tb.lat, tb.lon], { icon });
            marker.bindPopup(`<b>${tb.id}</b><br/>OLT: ${olt.id}<br/>ОРК: ${tb.orks.length}<br/>Муфта: ${tb.muftaType}`);
            group.addLayer(marker);
          }

          for (const ork of tb.orks) {
            // ORK marker
            if (layers.ork) {
              const icon = L.divIcon({
                html: `<div style="width:32px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;font-family:monospace;background:#1a2744;border:2px solid #f59e0b;border-radius:3px;color:#f59e0b">ОРК</div>`,
                className: '',
                iconSize: [32, 18],
                iconAnchor: [16, 9],
              });
              const marker = L.marker([ork.lat, ork.lon], { icon });
              marker.bindPopup(`<b>${ork.id}</b><br/>Сплиттер: ${ork.splitter}<br/>Або.: ${ork.subscribers.length}<br/>Муфта: ${tb.id}`);
              group.addLayer(marker);
            }

            // Subscriber markers
            if (layers.subscribers) {
              const zoom = mapRef.current.getZoom();
              if (zoom >= 13) {
                for (const sub of ork.subscribers) {
                  const circle = L.circleMarker([sub.lat, sub.lon], {
                    radius: 4,
                    fillColor: district.color,
                    fillOpacity: 0.8,
                    color: district.color,
                    weight: 1,
                  });
                  circle.bindPopup(`<b>${sub.desc}</b><br/>ОРК: ${ork.id}<br/>Волокна: ${sub.fibers.working}+${sub.fibers.spare}`);
                  group.addLayer(circle);
                }
              }
            }
          }
        }
      }
    });
  }, [districts, cables, layers]);

  // Re-render on zoom change
  useEffect(() => {
    if (!mapRef.current) return;
    const handler = () => {
      // Trigger re-render via layers dependency
    };
    mapRef.current.on('zoomend', handler);
    return () => mapRef.current?.off('zoomend', handler);
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
