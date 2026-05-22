import type { BBox } from '@/components/Network/Selection';

const SUBDOMAINS = ['a', 'b', 'c', 'd'];
const MAX_TILES = 600;

export interface TilePreloadProgress {
  done: number;
  total: number;
  failed: number;
}

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * (2 ** z));
}

function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (2 ** z));
}

function cartoDarkUrl(z: number, x: number, y: number): string {
  const s = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
  return `https://${s}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
}

function tilesForBBox(bb: BBox, minZ: number, maxZ: number): { z: number; x: number; y: number }[] {
  const out: { z: number; x: number; y: number }[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = lonToTileX(bb.lonMin, z);
    const x1 = lonToTileX(bb.lonMax, z);
    const y0 = latToTileY(bb.latMax, z);
    const y1 = latToTileY(bb.latMin, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        out.push({ z, x, y });
        if (out.length >= MAX_TILES) return out;
      }
    }
  }
  return out;
}

/** Предзагрузка тайлов в Cache API (нужен включённый optiq-sw.js). */
export async function preloadTilesForBBox(
  bb: BBox,
  opts?: {
    minZoom?: number;
    maxZoom?: number;
    signal?: AbortSignal;
    onProgress?: (p: TilePreloadProgress) => void;
  },
): Promise<TilePreloadProgress> {
  const minZ = opts?.minZoom ?? 12;
  const maxZ = opts?.maxZoom ?? 16;
  const tiles = tilesForBBox(bb, minZ, maxZ);
  let done = 0;
  let failed = 0;
  const total = tiles.length;

  const report = () => opts?.onProgress?.({ done, total, failed });

  report();
  for (const { z, x, y } of tiles) {
    if (opts?.signal?.aborted) break;
    const url = cartoDarkUrl(z, x, y);
    try {
      await fetch(url, { mode: 'cors', cache: 'force-cache', signal: opts?.signal });
    } catch {
      failed++;
    }
    done++;
    if (done % 20 === 0 || done === total) report();
  }
  return { done, total, failed };
}
