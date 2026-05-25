'use client';

import { useEffect, useRef } from 'react';
import type { PresenceCursor } from '@/hooks/useProjectPresence';

interface Props {
  map: any | null;
  peers: PresenceCursor[];
}

/** Маркеры курсоров коллег на Leaflet-карте. */
export default function PresenceCursors({ map, peers }: Props) {
  const markersRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    import('leaflet').then((L) => {
      if (cancelled) return;
      const existing = markersRef.current;
      const seen = new Set<string>();

      for (const p of peers) {
        if (!p.lat && !p.lon) continue;
        seen.add(p.userId);
        let m = existing.get(p.userId);
        const html = `<div style="pointer-events:none;transform:translate(-4px,-4px)">
          <div style="width:14px;height:14px;border-radius:50%;background:${p.color};border:2px solid #fff;box-shadow:0 0 6px ${p.color}"></div>
          <div style="margin-top:2px;padding:1px 5px;background:#0d1b2ae6;color:#e2e8f0;font-size:9px;font-weight:600;border-radius:4px;white-space:nowrap;border:1px solid ${p.color}55">${escapeHtml(p.name)}</div>
        </div>`;
        if (m) {
          m.setLatLng([p.lat, p.lon]);
        } else {
          m = L.marker([p.lat, p.lon], {
            icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
            interactive: false,
            zIndexOffset: 2000,
          }).addTo(map);
          existing.set(p.userId, m);
        }
      }

      for (const [id, m] of existing) {
        if (!seen.has(id)) {
          m.remove();
          existing.delete(id);
        }
      }
    });

    return () => { cancelled = true; };
  }, [map, peers]);

  useEffect(() => {
    return () => {
      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();
    };
  }, []);

  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
