import type { District, Cable, InlineJoint } from '@/types/network';

export type SearchHitKind = 'sub' | 'ork' | 'tb' | 'olt' | 'cable' | 'joint';

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  label: string;
  sublabel?: string;
  lat: number;
  lon: number;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ');
}

export function searchNetwork(
  query: string,
  districts: District[],
  cables: Cable[],
  joints: InlineJoint[] = [],
  limit = 24,
): SearchHit[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];

  const hits: SearchHit[] = [];

  for (const d of districts) {
    const { olt } = d;
    if (norm(olt.id).includes(q) || norm(d.name).includes(q)) {
      hits.push({ kind: 'olt', id: olt.id, label: olt.id, sublabel: d.name, lat: olt.lat, lon: olt.lon });
    }
    for (const tb of olt.transitBoxes) {
      if (norm(tb.id).includes(q)) {
        hits.push({ kind: 'tb', id: tb.id, label: tb.id, sublabel: `${d.name} · ${tb.muftaType}`, lat: tb.lat, lon: tb.lon });
      }
      for (const ork of tb.orks) {
        if (norm(ork.id).includes(q)) {
          hits.push({
            kind: 'ork', id: ork.id, label: ork.id,
            sublabel: `${d.name} · ${ork.subscribers.length} кам.`,
            lat: ork.lat, lon: ork.lon,
          });
        }
        for (const s of ork.subscribers) {
          if (norm(s.id).includes(q) || norm(s.desc).includes(q)) {
            hits.push({
              kind: 'sub', id: s.id, label: s.desc || s.id,
              sublabel: `${ork.id} · ${d.name}`,
              lat: s.lat, lon: s.lon,
            });
          }
        }
      }
    }
    for (const s of d.subscribers) {
      if (hits.some((h) => h.kind === 'sub' && h.id === s.id)) continue;
      if (norm(s.id).includes(q) || norm(s.desc).includes(q)) {
        hits.push({
          kind: 'sub', id: s.id, label: s.desc || s.id,
          sublabel: d.name,
          lat: s.lat, lon: s.lon,
        });
      }
    }
  }

  for (const c of cables) {
    const name = c.displayName ?? '';
    if (norm(c.id).includes(q) || norm(name).includes(q) || norm(c.fromId).includes(q) || norm(c.toId).includes(q)) {
      const mid = c.coords[Math.floor(c.coords.length / 2)] ?? c.coords[0];
      if (mid) {
        hits.push({
          kind: 'cable', id: c.id,
          label: name || `${c.fromId} → ${c.toId}`,
          sublabel: `${c.type} · ${Math.round(c.lengthM)} м`,
          lat: mid[0], lon: mid[1],
        });
      }
    }
  }

  for (const j of joints) {
    if (norm(j.id).includes(q)) {
      hits.push({ kind: 'joint', id: j.id, label: j.id, sublabel: 'Транзит', lat: j.lat, lon: j.lon });
    }
  }

  return hits.slice(0, limit);
}

export function parseDeepLinkOpen(param: string | null): { kind: 'olt' | 'tb' | 'ork' | 'joint' | 'sub'; id: string } | null {
  if (!param) return null;
  const m = param.match(/^(olt|tb|ork|joint|sub):(.+)$/i);
  if (!m) return null;
  return { kind: m[1].toLowerCase() as 'olt' | 'tb' | 'ork' | 'joint' | 'sub', id: m[2] };
}

export function buildPassportUrl(kind: string, id: string): string {
  if (typeof window === 'undefined') return `?open=${kind}:${encodeURIComponent(id)}`;
  const u = new URL(window.location.href);
  u.searchParams.set('open', `${kind}:${id}`);
  return u.toString();
}
