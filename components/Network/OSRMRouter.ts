import { Cable } from '@/types/network';

// Routing provider configuration. The router checks providers in order.
// User can set ORS key or self-host URL via ProjectSettings.
export type RoutingProvider = 'osrm-public' | 'ors' | 'custom';

export interface RouterConfig {
  provider?: RoutingProvider;
  orsApiKey?: string;
  customOsrmUrl?: string;  // e.g. "https://my-osrm.example.com/route/v1/driving"
}

const OSRM_MIRRORS = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
];

const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car';

export type ProgressCallback = (done: number, total: number, current: string) => void;

export interface RoutingStats {
  total: number;
  routed: number;
  failed: number;
  cached: number;
  lastError?: string;
}

// ---------- Local route cache (localStorage) -------------------------------
// Routes are deterministic per endpoint pair, so we cache to avoid hitting the
// rate-limited demo server repeatedly. Cache is rounded to 5 decimals (≈1m)
// so tiny coord jitters still hit. Capped at CACHE_MAX entries (LRU eviction).

const CACHE_KEY = 'osrm-route-cache-v1';
const CACHE_MAX = 5000;

type CacheEntry = { coords: [number, number][]; ts: number };

function cacheKey(lat1: number, lon1: number, lat2: number, lon2: number): string {
  return `${lat1.toFixed(5)},${lon1.toFixed(5)};${lat2.toFixed(5)},${lon2.toFixed(5)}`;
}

let memCache: Map<string, CacheEntry> | null = null;
function getCache(): Map<string, CacheEntry> {
  if (memCache) return memCache;
  memCache = new Map();
  if (typeof window === 'undefined') return memCache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return memCache;
    const data = JSON.parse(raw) as [string, CacheEntry][];
    for (const [k, v] of data) memCache.set(k, v);
  } catch {/* corrupt cache — start fresh */}
  return memCache;
}

let saveDebounce: ReturnType<typeof setTimeout> | null = null;
function saveCacheDebounced(): void {
  if (typeof window === 'undefined' || !memCache) return;
  if (saveDebounce) clearTimeout(saveDebounce);
  saveDebounce = setTimeout(() => {
    const m = memCache!;
    // LRU eviction: keep newest CACHE_MAX by ts
    let entries = [...m.entries()];
    if (entries.length > CACHE_MAX) {
      entries = entries.sort((a, b) => b[1].ts - a[1].ts).slice(0, CACHE_MAX);
      memCache = new Map(entries);
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
    } catch {/* quota — silently drop */}
  }, 500);
}

function cacheGet(lat1: number, lon1: number, lat2: number, lon2: number): [number, number][] | null {
  const c = getCache();
  const hit = c.get(cacheKey(lat1, lon1, lat2, lon2));
  if (hit) { hit.ts = Date.now(); return hit.coords; }
  return null;
}

function cacheSet(lat1: number, lon1: number, lat2: number, lon2: number, coords: [number, number][]): void {
  const c = getCache();
  c.set(cacheKey(lat1, lon1, lat2, lon2), { coords, ts: Date.now() });
  // Also cache reverse direction — same road, reversed coords
  c.set(cacheKey(lat2, lon2, lat1, lon1), { coords: [...coords].reverse(), ts: Date.now() });
  saveCacheDebounced();
}

export function clearOSRMCache(): void {
  memCache = new Map();
  if (typeof window !== 'undefined') {
    try { localStorage.removeItem(CACHE_KEY); } catch {/* ignore */}
  }
}

export function getOSRMCacheStats(): { size: number; bytes: number } {
  const c = getCache();
  let bytes = 0;
  if (typeof window !== 'undefined') {
    try { bytes = (localStorage.getItem(CACHE_KEY) || '').length; } catch {/* ignore */}
  }
  return { size: c.size, bytes };
}

// ---------- Fetch helpers --------------------------------------------------

async function fetchOSRM(
  base: string,
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  signal: AbortSignal,
  timeoutMs = 15000,
): Promise<[number, number][]> {
  const url = `${base}/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error(`OSRM ${data.code || 'no-route'}`);
    return data.routes[0].geometry.coordinates.map(
      ([lon, lat]: [number, number]) => [lat, lon] as [number, number],
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

async function fetchORS(
  apiKey: string,
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  signal: AbortSignal,
  timeoutMs = 15000,
): Promise<[number, number][]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(`${ORS_URL}/geojson`, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/geo+json',
      },
      body: JSON.stringify({ coordinates: [[lon1, lat1], [lon2, lat2]] }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const coords = data.features?.[0]?.geometry?.coordinates;
    if (!coords?.length) throw new Error('ORS no-route');
    return coords.map(([lon, lat]: [number, number]) => [lat, lon] as [number, number]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

// Try each configured provider in order with exponential backoff on rate limits.
async function routeOne(
  cfg: RouterConfig,
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  signal: AbortSignal,
): Promise<{ coords: [number, number][] | null; error?: string; cached?: boolean }> {
  // 1. Cache
  const hit = cacheGet(lat1, lon1, lat2, lon2);
  if (hit) return { coords: hit, cached: true };

  let lastError: string | undefined;

  const tryFetch = async (label: string, fn: () => Promise<[number, number][]>): Promise<[number, number][] | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) return null;
      try {
        return await fn();
      } catch (e: any) {
        const msg = e?.message || 'unknown';
        lastError = `${label}: ${msg}`;
        // Backoff for rate-limit / server errors
        if (/HTTP (429|5\d\d)/.test(msg) && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt))); // 1s, 2s
          continue;
        }
        return null;
      }
    }
    return null;
  };

  // 2. Custom OSRM (self-hosted) — highest priority if set
  if (cfg.customOsrmUrl) {
    const coords = await tryFetch('custom-osrm', () => fetchOSRM(cfg.customOsrmUrl!, lat1, lon1, lat2, lon2, signal));
    if (coords && coords.length > 2) { cacheSet(lat1, lon1, lat2, lon2, coords); return { coords }; }
  }

  // 3. OpenRouteService — if API key supplied
  if (cfg.orsApiKey) {
    const coords = await tryFetch('ors', () => fetchORS(cfg.orsApiKey!, lat1, lon1, lat2, lon2, signal));
    if (coords && coords.length > 2) { cacheSet(lat1, lon1, lat2, lon2, coords); return { coords }; }
  }

  // 4. Public OSRM mirrors
  for (const base of OSRM_MIRRORS) {
    const label = new URL(base).hostname;
    const coords = await tryFetch(label, () => fetchOSRM(base, lat1, lon1, lat2, lon2, signal));
    if (coords && coords.length > 2) { cacheSet(lat1, lon1, lat2, lon2, coords); return { coords }; }
  }

  return { coords: null, error: lastError };
}

export async function getRoute(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  cfg: RouterConfig = {},
): Promise<[number, number][]> {
  const ctrl = new AbortController();
  const r = await routeOne(cfg, lat1, lon1, lat2, lon2, ctrl.signal);
  return r.coords ?? [[lat1, lon1], [lat2, lon2]];
}

function calcLength(coords: [number, number][]): number {
  let len = 0;
  const R = 6371000;
  for (let i = 1; i < coords.length; i++) {
    const [la, lo] = coords[i - 1];
    const [lb, lob] = coords[i];
    const dLat = ((lb - la) * Math.PI) / 180;
    const dLon = ((lob - lo) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((la * Math.PI) / 180) *
        Math.cos((lb * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    len += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return len;
}

export async function routeCables(
  cables: Cable[],
  delay: number,
  routeDrops: boolean,
  onProgress: ProgressCallback,
  signal: AbortSignal,
  cfg: RouterConfig = {},
): Promise<Cable[]> {
  const priority: Cable['type'][] = ['ОК-96', 'ОК-48', 'ОК-32', 'ОК-24', 'ОК-16', 'ОК-12', 'ОК-8', 'ОК-4'];
  const toRoute = cables
    .filter((c) => routeDrops || c.type !== 'ОК-4')
    .sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));

  const result = new Map<string, Cable>(cables.map((c) => [c.id, c]));
  let done = 0;
  let routed = 0;
  let cached = 0;
  let failed: Cable[] = [];
  let firstError: string | undefined;

  const route = async (cable: Cable, delayMs: number): Promise<boolean> => {
    if (signal.aborted) return false;
    const from = cable.coords[0];
    const to = cable.coords[cable.coords.length - 1];
    const r = await routeOne(cfg, from[0], from[1], to[0], to[1], signal);
    if (r.coords && r.coords.length > 2) {
      result.set(cable.id, {
        ...cable, coords: r.coords, lengthM: calcLength(r.coords), routedByOSRM: true,
      });
      if (r.cached) cached++; else routed++;
      return true;
    }
    if (!firstError && r.error) firstError = r.error;
    return false;
  };

  // === Pass 1: main routing ===
  for (const cable of toRoute) {
    if (signal.aborted) break;
    onProgress(done, toRoute.length, `${cable.type}: ${cable.fromId} → ${cable.toId}`);
    const ok = await route(cable, delay);
    if (!ok) failed.push(cable);
    done++;
    if (delay > 0 && !signal.aborted) await new Promise((r) => setTimeout(r, delay));
  }

  // === Pass 2/3: retry failures with longer delays ===
  // Rate-limit recovery typically takes a few seconds. Try twice with
  // increasing waits between requests; this turns ~25% failure rates
  // into near-zero on the same project-osrm demo server.
  const retryDelays = [2000, 4000];
  for (let p = 0; p < retryDelays.length && failed.length > 0 && !signal.aborted; p++) {
    const retryDelay = retryDelays[p];
    console.log(`[OSRM] retry pass ${p + 1}: ${failed.length} cables, ${retryDelay}ms spacing`);
    const stillFailed: Cable[] = [];
    let i = 0;
    for (const cable of failed) {
      if (signal.aborted) break;
      onProgress(i, failed.length, `Повтор ${p + 1}: ${cable.fromId} → ${cable.toId}`);
      const ok = await route(cable, retryDelay);
      if (!ok) stillFailed.push(cable);
      i++;
      if (!signal.aborted) await new Promise((r) => setTimeout(r, retryDelay));
    }
    failed = stillFailed;
  }

  const failedCount = failed.length;
  onProgress(toRoute.length, toRoute.length, '');

  if (toRoute.length > 0) {
    if (failedCount === toRoute.length) {
      console.error(`[OSRM] ALL ${toRoute.length} routes failed. First error: ${firstError ?? 'unknown'}`);
    } else if (failedCount > 0) {
      console.warn(`[OSRM] ${routed} routed + ${cached} cached, ${failedCount} failed. First error: ${firstError ?? 'unknown'}`);
    } else {
      console.log(`[OSRM] ${routed} routed + ${cached} cached, 0 failed`);
    }
  }

  const out = cables.map((c) => result.get(c.id) ?? c) as Cable[] & { __stats?: RoutingStats };
  out.__stats = { total: toRoute.length, routed, cached, failed: failedCount, lastError: firstError };
  return out;
}
