import type { SiteObject, Crew, Incident } from '@/types/construction';
import { SITE_OBJECT_SPECS } from '@/types/construction';
import type { RouteView } from './routeStyle';
import { routeTitle } from './routeStyle';

/**
 * Найти на карте то, что назвали словом.
 *
 * Сейчас, чтобы посмотреть Серафимовку, карту мотают руками: сначала на
 * область, потом на район, потом глазами вдоль трассы. А название села
 * человек знает с самого начала — и это единственное, что он знает.
 *
 * Ищем по всему сразу: сёла, трассы, ККС и муфты, колонны, аварии,
 * контуры. Разделять поиск по разделам бессмысленно — спрашивающий не
 * обязан знать, в каком разделе живёт то, что он ищет.
 */

export type JournalHitKind =
  | 'snp' | 'route' | 'object' | 'crew' | 'incident' | 'area';

export const JOURNAL_HIT_LABEL: Record<JournalHitKind, string> = {
  snp: 'Село',
  route: 'Трасса',
  object: 'Объект',
  crew: 'Колонна',
  incident: 'Авария',
  area: 'Контур',
};

export const JOURNAL_HIT_ICON: Record<JournalHitKind, string> = {
  snp: '🏘', route: '〰', object: '🔗', crew: '👷', incident: '🚨', area: '▦',
};

export interface JournalHit {
  kind: JournalHitKind;
  id: string;
  label: string;
  sublabel?: string;
  lat: number;
  lon: number;
  /** Насколько близко открывать: село — издали, муфту — вплотную. */
  zoom: number;
  /** Чем лучше совпало, тем меньше. */
  rank: number;
  /** Рамка по всей линии или контуру, если она есть. */
  bounds?: [number, number][];
}

/**
 * Что ищем — описано тем минимумом, который поиску нужен.
 *
 * Село на карте и село в журнале — это две разные структуры одного и
 * того же, и требовать от поиска знать обе значит привязать его к обеим.
 */
export interface SearchableSnp {
  kato: string;
  snp: string;
  oblast?: string;
  rayon?: string;
  lat: number;
  lon: number;
}

export interface SearchableArea {
  id: string;
  name: string;
  coords: [number, number][];
  source?: string;
}

export interface JournalSearchSources {
  routes?: RouteView[];
  objects?: SiteObject[];
  areas?: SearchableArea[];
  crews?: (Crew & { lat?: number; lon?: number })[];
  incidents?: Incident[];
  snpPoints?: SearchableSnp[];
}

function norm(s: string): string {
  return (s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Насколько хорошо совпало.
 *
 * Совпадение с начала названия важнее совпадения в середине: кто ищет
 * «Сера», ищет Серафимовку, а не «Новосерафимовский участок». Совпадение
 * с начала слова — посередине между ними.
 */
export function matchRank(haystack: string, q: string): number | null {
  const h = norm(haystack);
  if (!h) return null;
  const at = h.indexOf(q);
  if (at < 0) return null;
  if (at === 0) return 0;
  return h[at - 1] === ' ' || h[at - 1] === '-' ? 1 : 2;
}

function push(
  out: JournalHit[],
  q: string,
  fields: (string | undefined)[],
  make: (rank: number) => JournalHit,
): void {
  let best: number | null = null;
  for (const f of fields) {
    const r = f ? matchRank(f, q) : null;
    if (r !== null && (best === null || r < best)) best = r;
  }
  if (best !== null) out.push(make(best));
}

export function searchJournal(
  query: string,
  src: JournalSearchSources,
  limit = 20,
): JournalHit[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const out: JournalHit[] = [];

  for (const p of src.snpPoints ?? []) {
    push(out, q, [p.snp, p.kato, p.rayon], (rank) => ({
      kind: 'snp', id: p.kato || p.snp, label: p.snp,
      sublabel: [p.rayon, p.oblast].filter(Boolean).join(', '),
      lat: p.lat, lon: p.lon, zoom: 13, rank,
    }));
  }

  for (const r of src.routes ?? []) {
    if (r.coords.length === 0) continue;
    const mid = r.coords[Math.floor(r.coords.length / 2)];
    push(out, q, [r.name, routeTitle(r), r.snp, r.from, r.to], (rank) => ({
      kind: 'route', id: r.id, label: routeTitle(r),
      sublabel: `${(r.lengthM / 1000).toFixed(2)} км${r.snp ? ` · ${r.snp}` : ''}`,
      lat: mid[0], lon: mid[1], zoom: 14, rank, bounds: r.coords,
    }));
  }

  for (const o of src.objects ?? []) {
    const spec = SITE_OBJECT_SPECS[o.kind];
    push(out, q, [o.name, spec.label, o.endpointKind, o.uchastok, o.model], (rank) => ({
      kind: 'object', id: o.id, label: o.name || spec.label,
      sublabel: [spec.label, o.endpointKind, o.uchastok].filter(Boolean).join(' · '),
      lat: o.lat, lon: o.lon, zoom: 17, rank,
    }));
  }

  for (const c of src.crews ?? []) {
    if (c.lat === undefined || c.lon === undefined) continue;
    push(out, q, [c.name, c.kind, c.contractor], (rank) => ({
      kind: 'crew', id: c.id, label: c.name || 'Колонна',
      sublabel: [c.contractor, c.kind].filter(Boolean).join(' · '),
      lat: c.lat!, lon: c.lon!, zoom: 15, rank,
    }));
  }

  for (const i of src.incidents ?? []) {
    push(out, q, [i.damage, i.cause, i.uchastok, i.crew], (rank) => ({
      kind: 'incident', id: i.id, label: i.damage || 'Авария',
      sublabel: [i.cause, i.uchastok].filter(Boolean).join(' · '),
      lat: i.lat, lon: i.lon, zoom: 16, rank,
    }));
  }

  for (const a of src.areas ?? []) {
    if (a.coords.length === 0) continue;
    const mid = a.coords[Math.floor(a.coords.length / 2)];
    push(out, q, [a.name, a.source], (rank) => ({
      kind: 'area', id: a.id, label: a.name,
      sublabel: a.source, lat: mid[0], lon: mid[1], zoom: 12, rank,
      bounds: a.coords,
    }));
  }

  // Порядок: сначала по качеству совпадения, потом по длине названия —
  // короткое совпало точнее, чем длинное с тем же куском внутри.
  return out
    .sort((a, b) => a.rank - b.rank || a.label.length - b.label.length
      || a.label.localeCompare(b.label, 'ru'))
    .slice(0, limit);
}
