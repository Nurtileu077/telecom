import { describe, it, expect } from 'vitest';
import {
  ESRI_TILE_URL, ESRI_BLANK, isEsriImagery, withoutBlankParam, fnv1a, matchesFingerprint,
  isBlankTile, tilemapRequests, tilemapUrl, parseTilemap, Availability, fetchAvailability,
  planImagery, describeImageryPlan, countTiles, purgedNote, upscaledNote, LazyAvailability,
} from './imagery';
import { tilesForBounds, type TileCoord } from './tileCache';

/**
 * Байты с тем же размером и отпечатком, что у серой заглушки Esri.
 *
 * Саму картинку в репозиторий не кладём — она чужая. Отпечаток FNV-1a не
 * криптографический, и такие байты подбираются за доли секунды; для
 * проверки «узнаём ли заглушку» этого достаточно.
 */
function fakeBlank(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(ESRI_BLANK.size);
  bytes.set([186, 147, 212, 72, 3], ESRI_BLANK.size - 5);
  return bytes;
}

const NBSP = ' ';

describe('заглушка вместо снимка', () => {
  it('карта просит спутник так, чтобы вместо заглушки пришёл честный 404', () => {
    expect(ESRI_TILE_URL).toContain('blankTile=false');
    expect(isEsriImagery(ESRI_TILE_URL)).toBe(true);
    expect(isEsriImagery('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png')).toBe(false);
  });

  it('скачиванию нужен адрес без blankTile: 404 без разрешения браузер выдаёт за обрыв связи', () => {
    const base = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/1/2';
    expect(withoutBlankParam(`${base}?blankTile=false`)).toBe(base);
    expect(withoutBlankParam(`${base}?a=1&blankTile=false`)).toBe(`${base}?a=1`);
    expect(withoutBlankParam(`${base}?blankTile=false&a=1`)).toBe(`${base}?a=1`);
    expect(withoutBlankParam(base)).toBe(base);
  });

  it('отпечаток FNV-1a совпадает с образцовыми значениями', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(fnv1a(enc(''))).toBe(0x811c9dc5);
    expect(fnv1a(enc('a'))).toBe(0xe40c292c);
    expect(fnv1a(enc('foobar'))).toBe(0xbf9cf968);
  });

  it('заглушку узнаём по размеру и отпечатку, а снимок того же размера — нет', () => {
    const blank = fakeBlank();
    expect(matchesFingerprint(blank, ESRI_BLANK)).toBe(true);
    const other = blank.slice();
    other[0] = 1;
    expect(matchesFingerprint(other, ESRI_BLANK)).toBe(false);
  });

  it('тайл другого размера байты не читает и заглушкой не считается', async () => {
    expect(await isBlankTile(new Blob([new Uint8Array(18_000)]))).toBe(false);
    expect(await isBlankTile(new Blob([fakeBlank()]))).toBe(true);
  });
});

describe('где снимок есть', () => {
  it('тайлы одного блока спрашиваются одним запросом, выровненным по 32', () => {
    const reqs = tilemapRequests([
      { z: 18, x: 181429, y: 85508 },
      { z: 18, x: 181430, y: 85509 },
      { z: 17, x: 90714, y: 42754 },
    ]);
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toEqual({ z: 18, top: 85504, left: 181408, width: 32, height: 32 });
    expect(tilemapUrl(reqs[0])).toMatch(/\/tilemap\/18\/85504\/181408\/32\/32$/);
  });

  it('ответ читается по строкам: так он устроен у сервера', () => {
    // Край снимка под Астаной: в блоке 128×128 нижние строки — без снимка.
    // Проверено по отдельным тайлам: (строка 120, столбец 10) — 404,
    // (строка 10, столбец 120) — есть.
    const data = Array.from({ length: 128 * 128 }, (_, i) => (Math.floor(i / 128) < 100 ? 1 : 0));
    const block = parseTilemap(18, {
      data, valid: true, location: { top: 87680, left: 183168, width: 128, height: 128 },
    })!;
    const a = new Availability();
    a.add(block);
    expect(a.has({ z: 18, x: 183168 + 10, y: 87680 + 120 })).toBe(false);
    expect(a.has({ z: 18, x: 183168 + 120, y: 87680 + 10 })).toBe(true);
    // Вне блока и на другом масштабе — не знаем, а не «нет».
    expect(a.has({ z: 18, x: 183000, y: 87680 })).toBeUndefined();
    expect(a.has({ z: 19, x: 366400, y: 175400 })).toBeUndefined();
  });

  it('место берём из ответа: сервер мог подвинуть блок', () => {
    const b = parseTilemap(18, {
      data: [1, 0], valid: true, adjusted: true, location: { top: 10, left: 20, width: 2, height: 1 },
    })!;
    expect(b.left).toBe(20);
    expect(b.width).toBe(2);
  });

  it('негодный ответ не принимаем за «снимка нет»', () => {
    expect(parseTilemap(18, { valid: false, data: [], location: {} })).toBeNull();
    expect(parseTilemap(18, { data: [1, 1, 1], location: { top: 0, left: 0, width: 2, height: 2 } }))
      .toBeNull();
    expect(parseTilemap(18, 'ошибка')).toBeNull();
  });

  it('без связи блок остаётся «не знаем», и скачивание его не пропускает', async () => {
    const tiles: TileCoord[] = [{ z: 18, x: 181429, y: 85508 }, { z: 17, x: 90714, y: 42754 }];
    const fake = (async (url: string) => {
      if (url.includes('/tilemap/18/')) throw new Error('сети нет');
      return {
        ok: true,
        json: async () => ({ data: new Array(1024).fill(1), valid: true,
          location: { top: 42752, left: 90688, width: 32, height: 32 } }),
      } as unknown as Response;
    }) as typeof fetch;
    const a = await fetchAvailability(tiles, fake);
    expect(a.has(tiles[0])).toBeUndefined();
    expect(a.has(tiles[1])).toBe(true);
    expect(planImagery(tiles, a).fetch).toHaveLength(2);
  });
});

describe('что карта узнаёт по ходу', () => {
  const t18: TileCoord = { z: 18, x: 181429, y: 85508 };
  const sibling: TileCoord = { z: 18, x: 181430, y: 85509 };
  const empty = {
    ok: true,
    json: async () => ({ data: new Array(1024).fill(0), valid: true,
      location: { top: 85504, left: 181408, width: 32, height: 32 } }),
  } as unknown as Response;

  it('про блок спрашиваем один раз, сколько бы тайлов из него ни пропало', async () => {
    let asked = 0;
    const a = new LazyAvailability((async () => { asked += 1; return empty; }) as typeof fetch);
    await Promise.all([a.ensure(t18), a.ensure(sibling)]);
    await a.ensure(t18);
    expect(asked).toBe(1);
    // Сервер сказал «нет» — соседний тайл без снимка уже не запрашиваем.
    expect(a.has(sibling)).toBe(false);
  });

  it('сервер не ответил — блок остаётся «не знаем», и в следующий раз спросим снова', async () => {
    let asked = 0;
    const a = new LazyAvailability((async () => {
      asked += 1;
      if (asked === 1) throw new Error('связь пропала');
      return empty;
    }) as typeof fetch);
    await a.ensure(t18);
    expect(a.has(t18)).toBeUndefined();
    await a.ensure(t18);
    expect(asked).toBe(2);
    expect(a.has(t18)).toBe(false);
  });
});

describe('карта на устройство', () => {
  it('над селом с 16-го масштаба на четыре вглубь 94 % — заглушки, и их не качаем', () => {
    // Зеренда: снимок кончается на 17-м.
    const b = { north: 52.9051, south: 52.9049, east: 69.1551, west: 69.1549 };
    const z16 = tilesForBounds(b, [16])[0];
    const tiles: TileCoord[] = [];
    for (let up = 0; up <= 3; up += 1) {
      const n = 2 ** up;
      for (let dx = 0; dx < n; dx += 1) {
        for (let dy = 0; dy < n; dy += 1) tiles.push({ z: 16 + up, x: z16.x * n + dx, y: z16.y * n + dy });
      }
    }
    const a = new Availability();
    for (const z of [16, 17, 18, 19]) {
      for (const r of tilemapRequests(tiles.filter((t) => t.z === z))) {
        a.add({ ...r, data: new Array(r.width * r.height).fill(z <= 17 ? 1 : 0) });
      }
    }
    const plan = planImagery(tiles, a);
    expect(tiles).toHaveLength(85);
    expect(plan.empty.length / tiles.length).toBeCloseTo(0.94, 2);
    expect(plan.fetch).toHaveLength(5);
    expect(plan.deepest).toBe(17);
    expect(plan.blankZooms).toEqual([18, 19]);
    expect(describeImageryPlan(plan)).toBe(
      'Ещё 80 тайлов — серые заглушки, их не качаем: на масштабах 18, 19 снимка здесь нет, '
      + 'ближе карта покажет 17-й крупнее.',
    );
  });

  it('снимок есть везде — про заглушки молчим', () => {
    const t: TileCoord = { z: 18, x: 183085, y: 87611 };
    const a = new Availability();
    for (const r of tilemapRequests([t])) a.add({ ...r, data: new Array(1024).fill(1) });
    expect(describeImageryPlan(planImagery([t], a))).toBe('');
  });

  it('числа говорим по-русски: тайл, тайла, тайлов', () => {
    expect(countTiles(1)).toBe('1 тайл');
    expect(countTiles(3)).toBe('3 тайла');
    expect(countTiles(11)).toBe('11 тайлов');
    expect(countTiles(21)).toBe('21 тайл');
    expect(countTiles(1365)).toBe(`1${NBSP}365 тайлов`);
  });

  it('про убранные заглушки — тоже', () => {
    expect(purgedNote(0)).toBe('');
    expect(purgedNote(1)).toContain('1 серую заглушку');
    expect(purgedNote(3)).toContain('3 серые заглушки');
    expect(purgedNote(12)).toContain('12 серых заглушек');
  });

  it('растянутый снимок подписан: до какого масштаба он настоящий', () => {
    expect(upscaledNote(17)).toContain('до 17-го масштаба');
  });
});
