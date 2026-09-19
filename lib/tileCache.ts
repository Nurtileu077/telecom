/**
 * Тайлы карты, скачанные заранее.
 *
 * В поле интернета нет. Карта без тайлов — серый прямоугольник, и всё
 * остальное на ней (трасса, колонна, прокол) висит в пустоте: понять, где
 * это, невозможно. Поэтому квадрат карты вокруг участка скачивается
 * заранее, пока связь есть, и дальше берётся с устройства.
 *
 * Хранилище — IndexedDB: тайлы двоичные и тяжёлые, в localStorage им
 * нельзя. Ключ — адрес тайла, потому что именно по нему его и попросят.
 */

const DB_NAME = 'optiq-tiles';
const STORE = 'tiles';
const DB_VERSION = 1;

/** Сколько тайлов держим: дальше старые вытесняются новыми. */
export const TILE_LIMIT = 20000;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

export function getTile(url: string): Promise<Blob | null> {
  return tx<Blob>('readonly', (s) => s.get(url) as IDBRequest<Blob>);
}

export function putTile(url: string, blob: Blob): Promise<void> {
  return tx('readwrite', (s) => s.put(blob, url) as IDBRequest<unknown>).then(() => undefined);
}

export function tileCount(): Promise<number> {
  return tx<number>('readonly', (s) => s.count()).then((n) => n ?? 0);
}

export function clearTiles(): Promise<void> {
  return tx('readwrite', (s) => s.clear() as IDBRequest<undefined>).then(() => undefined);
}

// ── Математика тайлов ────────────────────────────────────────────────────────

export interface TileCoord { z: number; x: number; y: number }

/** Веб-меркатор: та же формула, что у любого тайлового сервера. */
export function lonToX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToY(lat: number, z: number): number {
  const rad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Какие тайлы накрывают этот прямоугольник на этих масштабах.
 *
 * Считаем заранее, чтобы честно сказать, сколько их и сколько это весит:
 * «скачиваю карту» без числа — способ незаметно съесть гигабайт.
 */
export function tilesForBounds(b: Bounds, zooms: number[]): TileCoord[] {
  const out: TileCoord[] = [];
  for (const z of zooms) {
    const x1 = lonToX(Math.min(b.west, b.east), z);
    const x2 = lonToX(Math.max(b.west, b.east), z);
    const y1 = latToY(Math.max(b.north, b.south), z);
    const y2 = latToY(Math.min(b.north, b.south), z);
    const max = 2 ** z;
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        if (x < 0 || y < 0 || x >= max || y >= max) continue;
        out.push({ z, x, y });
      }
    }
  }
  return out;
}

/** Средний вес тайла, байт — по опыту растровых подложек. */
export const TILE_BYTES = 18_000;

export function estimateBytes(count: number): number {
  return count * TILE_BYTES;
}

export function tileUrl(template: string, t: TileCoord, subdomain = 'a'): string {
  return template
    .replace('{s}', subdomain)
    .replace('{z}', String(t.z))
    .replace('{x}', String(t.x))
    .replace('{y}', String(t.y))
    .replace('{r}', '');
}

export interface PrefetchProgress {
  done: number;
  total: number;
  failed: number;
}

/**
 * Скачать квадрат карты.
 *
 * Параллельно, но в меру: шесть запросов — это быстро для города и не
 * добивает мобильную связь в степи. Неудачные тайлы не отменяют остальные:
 * дыра в карте лучше, чем отсутствие карты.
 */
export async function prefetchTiles(
  tiles: TileCoord[],
  template: string,
  onProgress?: (p: PrefetchProgress) => void,
  signal?: { aborted: boolean },
  concurrency = 6,
): Promise<PrefetchProgress> {
  const state: PrefetchProgress = { done: 0, total: tiles.length, failed: 0 };
  let next = 0;

  const worker = async () => {
    while (next < tiles.length) {
      if (signal?.aborted) return;
      const t = tiles[next++];
      const url = tileUrl(template, t, 'abc'[next % 3]);
      try {
        const have = await getTile(url);
        if (!have) {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) throw new Error(String(res.status));
          await putTile(url, await res.blob());
        }
      } catch {
        state.failed += 1;
      }
      state.done += 1;
      onProgress?.({ ...state });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker));
  return state;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} МБ`;
}
