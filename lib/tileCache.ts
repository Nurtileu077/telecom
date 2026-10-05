/**
 * Тайлы карты, скачанные заранее.
 *
 * В поле интернета нет. Карта без тайлов — серый прямоугольник, и всё
 * остальное на ней (трасса, колонна, прокол) висит в пустоте: понять, где
 * это, невозможно. Поэтому квадрат карты вокруг участка скачивается
 * заранее, пока связь есть, и дальше берётся с устройства.
 *
 * Хранилище — IndexedDB: тайлы двоичные и тяжёлые, в localStorage им
 * нельзя. Ключ — адрес тайла, потому что именно по нему его и попросят,
 * но приведённый к одному виду (см. tileKey).
 */
import { isBlankTile, isEsriImagery, withoutBlankParam, ESRI_BLANK } from './imagery';

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

/**
 * Ключ тайла в хранилище.
 *
 * Один и тот же тайл приходит по разным адресам: Карто раздаёт его с a, b,
 * c и d, и скачивание клало его под одной буквой, а карта искала под
 * другой — три четверти скачанного в поле не находилось. У спутника карта
 * просит тайл с `blankTile=false`, а скачанное раньше лежит без него.
 * Поэтому ключ — адрес, приведённый к одному виду: без этого признака и с
 * первой буквой сервера.
 */
export function tileKey(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('blankTile');
    u.hostname = u.hostname
      .replace(/^[a-d]\.basemaps\.cartocdn\.com$/, 'a.basemaps.cartocdn.com')
      .replace(/^[a-c]\.tile\.opentopomap\.org$/, 'a.tile.opentopomap.org');
    return u.toString();
  } catch {
    return url;
  }
}

export function getTile(url: string): Promise<Blob | null> {
  return tx<Blob>('readonly', (s) => s.get(tileKey(url)) as IDBRequest<Blob>);
}

export function putTile(url: string, blob: Blob): Promise<void> {
  return tx('readwrite', (s) => s.put(blob, tileKey(url)) as IDBRequest<unknown>).then(() => undefined);
}

export function deleteTile(url: string): Promise<void> {
  return tx('readwrite', (s) => s.delete(tileKey(url)) as IDBRequest<undefined>).then(() => undefined);
}

/**
 * Убрать из хранилища серые заглушки спутника, скачанные раньше.
 *
 * До того как скачивание научилось их узнавать, карта на телефоне почти
 * вся из них и состояла, а место под тайлы не бесконечно. Заглушка в
 * хранилище хуже, чем ничего: вместо неё карта покажет снимок мельче, но
 * настоящий. Сначала смотрим на размер, байты читаем только у подходящих.
 */
export function purgeBlankTiles(): Promise<number> {
  return openDb().then((db) => {
    if (!db) return 0;
    return new Promise<number>((resolve) => {
      const suspects: { key: IDBValidKey; blob: Blob }[] = [];
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (cur) {
            const v = cur.value as Blob;
            if (v?.size === ESRI_BLANK.size && isEsriImagery(String(cur.key))) {
              suspects.push({ key: cur.key, blob: v });
            }
            cur.continue();
            return;
          }
          void (async () => {
            let removed = 0;
            for (const s of suspects) {
              if (!(await isBlankTile(s.blob))) continue;
              await tx('readwrite', (st) => st.delete(s.key) as IDBRequest<undefined>);
              removed += 1;
            }
            resolve(removed);
          })();
        };
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  });
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

// ── Снимок крупнее, чем он есть ──────────────────────────────────────────────

/**
 * Насколько вверх искать замену недостающему тайлу.
 *
 * Пять ступеней — это в 32 раза крупнее: дальше одна точка снимка
 * растягивается на полэкрана, и от неё больше путаницы, чем толку.
 */
export const MAX_FALLBACK_UP = 5;

export interface AncestorPiece {
  /** Тайл на столько-то масштабов мельче. */
  tile: TileCoord;
  /** Во сколько раз его растянуть. */
  scale: number;
  /** Какой кусок растянутого — наш: столбец и строка в долях тайла. */
  col: number;
  row: number;
}

/**
 * Кусок более мелкого тайла, который встаёт на место недостающего.
 *
 * Снимок, растянутый вдвое, мутнее, но это тот же снимок того же места:
 * точку по нему поставить можно, а по серой заглушке — нет.
 */
export function ancestorPiece(t: TileCoord, up: number): AncestorPiece | null {
  if (up <= 0 || up > t.z) return null;
  const scale = 2 ** up;
  const x = Math.floor(t.x / scale);
  const y = Math.floor(t.y / scale);
  return { tile: { z: t.z - up, x, y }, scale, col: t.x - x * scale, row: t.y - y * scale };
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
  /** Пришла серая заглушка вместо снимка — не храним. */
  empty: number;
}

/**
 * Скачать квадрат карты.
 *
 * Параллельно, но в меру: шесть запросов — это быстро для города и не
 * добивает мобильную связь в степи. Неудачные тайлы не отменяют остальные:
 * дыра в карте лучше, чем отсутствие карты.
 *
 * Спутник качаем без `blankTile=false`: его 404 браузер выдаёт за обрыв
 * связи, а заглушку с кодом 200 можно прочесть и узнать — и не хранить.
 */
export async function prefetchTiles(
  tiles: TileCoord[],
  template: string,
  onProgress?: (p: PrefetchProgress) => void,
  signal?: { aborted: boolean },
  concurrency = 6,
): Promise<PrefetchProgress> {
  const state: PrefetchProgress = { done: 0, total: tiles.length, failed: 0, empty: 0 };
  const imagery = isEsriImagery(template);
  let next = 0;

  const worker = async () => {
    while (next < tiles.length) {
      if (signal?.aborted) return;
      const t = tiles[next++];
      const url = tileUrl(template, t, 'abc'[next % 3]);
      try {
        const have = await getTile(url);
        if (!have) {
          const res = await fetch(imagery ? withoutBlankParam(url) : url, { mode: 'cors' });
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          if (imagery && await isBlankTile(blob)) state.empty += 1;
          else await putTile(url, blob);
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
