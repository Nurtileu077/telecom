import { describe, it, expect } from 'vitest';
import {
  lonToX, latToY, tilesForBounds, tileUrl, estimateBytes, fmtSize, prefetchTiles,
  tileKey, ancestorPiece, MAX_FALLBACK_UP,
} from './tileCache';
import { ESRI_TILE_URL, ESRI_BLANK } from './imagery';

/** Байты с размером и отпечатком серой заглушки Esri (см. imagery.test.ts). */
function fakeBlank(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(ESRI_BLANK.size);
  bytes.set([186, 147, 212, 72, 3], ESRI_BLANK.size - 5);
  return bytes;
}

describe('математика тайлов', () => {
  it('нулевой масштаб — один тайл на весь мир', () => {
    expect(lonToX(0, 0)).toBe(0);
    expect(latToY(0, 0)).toBe(0);
    expect(tilesForBounds({ north: 80, south: -80, east: 179, west: -179 }, [0]))
      .toHaveLength(1);
  });

  it('координаты Кокшетау попадают в известный тайл', () => {
    // 53.28, 69.39 на z=10 — проверяемое значение по формуле Меркатора.
    expect(lonToX(69.39, 10)).toBe(709);
    expect(latToY(53.28, 10)).toBe(332);
  });

  it('квадрат накрывается сеткой тайлов на каждом масштабе', () => {
    const b = { north: 51.6, south: 51.5, east: 71.6, west: 71.5 };
    const t12 = tilesForBounds(b, [12]);
    const t13 = tilesForBounds(b, [13]);
    expect(t12.length).toBeGreaterThan(0);
    // На следующем масштабе тайлов примерно вчетверо больше.
    expect(t13.length).toBeGreaterThan(t12.length);
    expect(t12.every((t) => t.z === 12)).toBe(true);
  });

  it('перепутанные границы не ломают расчёт', () => {
    const a = tilesForBounds({ north: 51.5, south: 51.6, east: 71.5, west: 71.6 }, [12]);
    const b = tilesForBounds({ north: 51.6, south: 51.5, east: 71.6, west: 71.5 }, [12]);
    expect(a).toEqual(b);
  });

  it('полюса не уводят расчёт в бесконечность', () => {
    expect(Number.isFinite(latToY(90, 10))).toBe(true);
    expect(Number.isFinite(latToY(-90, 10))).toBe(true);
  });

  it('адрес тайла собирается по шаблону', () => {
    expect(tileUrl('https://{s}.tiles/{z}/{x}/{y}.png', { z: 10, x: 709, y: 330 }, 'b'))
      .toBe('https://b.tiles/10/709/330.png');
  });

  it('вес считается заранее — «скачиваю карту» без числа съедает гигабайт', () => {
    expect(estimateBytes(1000)).toBe(18_000_000);
    expect(fmtSize(18_000_000)).toBe('17.2 МБ');
    expect(fmtSize(500_000)).toBe('488 КБ');
  });
});

describe('скачивание', () => {
  it('неудачный тайл не отменяет остальные', async () => {
    const originalFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => {
      n += 1;
      if (n === 2) throw new Error('сеть пропала');
      return { ok: true, blob: async () => new Blob(['x']) } as unknown as Response;
    }) as typeof fetch;

    const res = await prefetchTiles(
      [{ z: 1, x: 0, y: 0 }, { z: 1, x: 1, y: 0 }, { z: 1, x: 0, y: 1 }],
      'https://{s}.t/{z}/{x}/{y}.png',
      undefined, undefined, 1,
    );
    globalThis.fetch = originalFetch;

    expect(res.total).toBe(3);
    expect(res.done).toBe(3);
    expect(res.failed).toBe(1);
  });

  it('отмена останавливает скачивание', async () => {
    const originalFetch = globalThis.fetch;
    const signal = { aborted: false };
    globalThis.fetch = (async () => {
      signal.aborted = true;
      return { ok: true, blob: async () => new Blob(['x']) } as unknown as Response;
    }) as typeof fetch;

    const res = await prefetchTiles(
      Array.from({ length: 50 }, (_, i) => ({ z: 5, x: i, y: 0 })),
      'https://{s}.t/{z}/{x}/{y}.png',
      undefined, signal, 1,
    );
    globalThis.fetch = originalFetch;
    expect(res.done).toBeLessThan(50);
  });
});

describe('ключ тайла в хранилище', () => {
  it('спутник с blankTile=false находит скачанное раньше без него', () => {
    const base = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/42754/90714';
    expect(tileKey(`${base}?blankTile=false`)).toBe(tileKey(base));
    expect(tileKey(base)).toBe(base);
  });

  it('Карто с любой буквы сервера — один ключ: скачанное под «b» карта искала под «d»', () => {
    const keys = ['a', 'b', 'c', 'd']
      .map((s) => tileKey(`https://${s}.basemaps.cartocdn.com/dark_all/10/709/330.png`));
    expect(new Set(keys).size).toBe(1);
    expect(tileKey('https://c.tile.opentopomap.org/10/709/330.png'))
      .toBe(tileKey('https://a.tile.opentopomap.org/10/709/330.png'));
  });

  it('не адрес — ключом остаётся как есть', () => {
    expect(tileKey('не адрес')).toBe('не адрес');
  });
});

describe('снимок крупнее, чем он есть', () => {
  it('19-й тайл берёт свой кусок из 17-го: вчетверо крупнее и со сдвигом', () => {
    const p = ancestorPiece({ z: 19, x: 362858, y: 171017 }, 2)!;
    expect(p.tile).toEqual({ z: 17, x: 90714, y: 42754 });
    expect(p.scale).toBe(4);
    expect(p.col).toBe(362858 - 90714 * 4);
    expect(p.row).toBe(171017 - 42754 * 4);
  });

  it('выше нулевого масштаба и «на ноль ступеней» предка нет', () => {
    expect(ancestorPiece({ z: 1, x: 0, y: 0 }, 2)).toBeNull();
    expect(ancestorPiece({ z: 5, x: 3, y: 3 }, 0)).toBeNull();
  });

  it('искать замену дальше пяти ступеней не станем — дальше пятно, а не снимок', () => {
    expect(MAX_FALLBACK_UP).toBe(5);
  });
});

describe('спутник на устройство', () => {
  it('заглушку не храним и называем отдельно от «не скачалось»', async () => {
    const originalFetch = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      const body = url.includes('/18/') ? fakeBlank() : new Uint8Array([1, 2, 3]);
      return { ok: true, blob: async () => new Blob([body]) } as unknown as Response;
    }) as typeof fetch;

    const res = await prefetchTiles(
      [{ z: 17, x: 90714, y: 42754 }, { z: 18, x: 181429, y: 85508 }],
      ESRI_TILE_URL, undefined, undefined, 1,
    );
    globalThis.fetch = originalFetch;

    expect(res.empty).toBe(1);
    expect(res.failed).toBe(0);
    // Качаем без blankTile: его 404 браузер выдаёт за обрыв связи.
    expect(asked.every((u) => !u.includes('blankTile'))).toBe(true);
  });
});
