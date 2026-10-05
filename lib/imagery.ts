import type { TileCoord } from './tileCache';

/**
 * Спутник без серых заглушек.
 *
 * Над сёлами настоящий снимок Esri кончается на 17-м масштабе, а дальше
 * сервер отдаёт не ошибку, а серую картинку «Map data not yet available»
 * с кодом 200. Карта рисовала её как снимок: точку ставить не по чему, а
 * карта, скачанная на телефон с 16-го масштаба на четыре вглубь, на 94 %
 * состояла из таких заглушек (16-й — 1 тайл, 17-й — 4, 18-й и 19-й — 16
 * и 64 заглушки).
 *
 * Сервер умеет сказать честно: с `blankTile=false` вместо заглушки — 404,
 * а по адресу `tilemap` — где снимок есть, блоком тайлов сразу. Первое
 * нужно карте: не нашла тайл — берёт ближайший более мелкий и растягивает.
 * Второе — скачиванию: заглушки не качаем и заранее говорим, сколько
 * снимка будет на телефоне. Проверено 05.10.2026 на Зеренде и степи под
 * Астаной (снимок до 17-го) и центре Астаны (до 19-го).
 */

export const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';

/** Адрес тайлов спутника для карты: недостающий тайл приходит честным 404. */
export const ESRI_TILE_URL = `${ESRI_IMAGERY}/tile/{z}/{y}/{x}?blankTile=false`;

export function isEsriImagery(url: string): boolean {
  return url.startsWith(`${ESRI_IMAGERY}/tile/`);
}

/**
 * Тот же адрес без `blankTile=false`.
 *
 * Скачиванию нужен ответ, который можно прочесть: 404 приходит без
 * разрешения для чужого сайта, и браузер выдаёт его как обрыв связи —
 * «нет снимка» не отличить от «нет сети». Заглушку же с кодом 200 прочесть
 * можно, и её узнаём по содержимому.
 */
export function withoutBlankParam(url: string): string {
  return url.replace(/([?&])blankTile=false(&|$)/, (_, sep: string, tail: string) => (tail ? sep : ''));
}

/** FNV-1a: дешёвый отпечаток байтов — криптография тут не нужна. */
export function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Fingerprint { size: number; fnv: number }

/**
 * Серая заглушка Esri: одна картинка на все масштабы и места, 2521 байт.
 * Если Esri её заменит, отпечаток перестанет совпадать — и карта станет
 * не хуже, чем была: 404 на просмотре это не задевает.
 */
export const ESRI_BLANK: Fingerprint = { size: 2521, fnv: 0x92d9118f };

export function matchesFingerprint(bytes: Uint8Array, fp: Fingerprint): boolean {
  return bytes.length === fp.size && fnv1a(bytes) === fp.fnv;
}

/** Заглушка ли это вместо снимка. Размер сверяем раньше байтов: читать каждый тайл незачем. */
export async function isBlankTile(blob: Blob, fp: Fingerprint = ESRI_BLANK): Promise<boolean> {
  if (blob.size !== fp.size) return false;
  try {
    return matchesFingerprint(new Uint8Array(await blob.arrayBuffer()), fp);
  } catch {
    return false;
  }
}

// ── Где снимок есть ─────────────────────────────────────────────────────────

/**
 * Блок, о котором спрашиваем `tilemap`.
 *
 * Сервер не отвечает за пределами своей связки в 128 тайлов и молча
 * обрезает запрос по её краю. Блок в 32 тайла, выровненный по 32, внутри
 * одной связки помещается всегда — и ответ по нему не обрезается.
 */
export const TILEMAP_BLOCK = 32;

export interface TilemapRequest { z: number; top: number; left: number; width: number; height: number }

export function tilemapUrl(r: TilemapRequest): string {
  // Порядок в адресе — строка, столбец, ширина, высота: проверено на
  // неквадратном запросе.
  return `${ESRI_IMAGERY}/tilemap/${r.z}/${r.top}/${r.left}/${r.width}/${r.height}`;
}

/** Какие блоки спросить, чтобы узнать про все эти тайлы. */
export function tilemapRequests(tiles: TileCoord[], block = TILEMAP_BLOCK): TilemapRequest[] {
  const seen = new Map<string, TilemapRequest>();
  for (const t of tiles) {
    const top = Math.floor(t.y / block) * block;
    const left = Math.floor(t.x / block) * block;
    const key = `${t.z}/${top}/${left}`;
    if (!seen.has(key)) seen.set(key, { z: t.z, top, left, width: block, height: block });
  }
  return [...seen.values()];
}

export interface TilemapBlock extends TilemapRequest {
  /** 1 — снимок есть; по строкам: data[(y - top) * width + (x - left)]. */
  data: number[];
}

/**
 * Ответ `tilemap` — или null, если по нему ничего нельзя сказать.
 *
 * Место берём из ответа, а не из запроса: сервер мог его подвинуть, и
 * тогда данные лежат не там, где спрашивали.
 */
export function parseTilemap(z: number, json: unknown): TilemapBlock | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { valid?: unknown; data?: unknown; location?: Record<string, unknown> };
  if (j.valid === false || !Array.isArray(j.data) || !j.location) return null;
  const { top, left, width, height } = j.location;
  if (![top, left, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const w = width as number;
  const h = height as number;
  if (w <= 0 || h <= 0 || j.data.length !== w * h) return null;
  return { z, top: top as number, left: left as number, width: w, height: h, data: j.data as number[] };
}

/** Что известно о снимке по ответам `tilemap`. */
export class Availability {
  private blocks = new Map<number, TilemapBlock[]>();

  add(b: TilemapBlock): void {
    const list = this.blocks.get(b.z);
    if (list) list.push(b); else this.blocks.set(b.z, [b]);
  }

  /** true — снимок есть, false — нет, undefined — не знаем. */
  has(t: TileCoord): boolean | undefined {
    for (const b of this.blocks.get(t.z) ?? []) {
      const c = t.x - b.left;
      const r = t.y - b.top;
      if (c < 0 || r < 0 || c >= b.width || r >= b.height) continue;
      return b.data[r * b.width + c] === 1;
    }
    return undefined;
  }
}

/**
 * Где снимок есть — для карты, по мере надобности.
 *
 * Тайл не пришёл: 404 «снимка нет» и обрыв связи браузер показывает
 * одинаково. Запомнить его как «нет» по ошибке значит на весь день
 * показывать вместо снимка мутный кусок мельче — а в поле связь рвётся
 * часто, и браузер при этом считает, что она есть. Поэтому решает не
 * ошибка, а сервер: про блок в 32×32 тайла спрашиваем один раз, и дальше
 * тайлы без снимка в этом блоке даже не запрашиваем. Не ответил — блок
 * остаётся «не знаем», и в следующий раз тайл спросим снова.
 */
export class LazyAvailability extends Availability {
  private pending = new Map<string, Promise<void>>();

  // Своя обёртка, а не сам fetch: вызванный как метод чужого объекта,
  // браузерный fetch падает с «Illegal invocation».
  constructor(private fetchFn: typeof fetch = (input, init) => fetch(input, init)) { super(); }

  ensure(t: TileCoord): Promise<void> {
    const r = tilemapRequests([t])[0];
    const key = `${r.z}/${r.top}/${r.left}`;
    const known = this.pending.get(key);
    if (known) return known;
    const p = (async () => {
      try {
        const res = await this.fetchFn(tilemapUrl(r), { mode: 'cors' });
        const b = res.ok ? parseTilemap(r.z, await res.json()) : null;
        if (b) this.add(b); else this.pending.delete(key);
      } catch {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, p);
    return p;
  }
}

/**
 * Спросить сервер, где снимок есть.
 *
 * Без связи или с ошибкой блок остаётся «не знаем» — скачивание тогда всё
 * равно не возьмёт заглушку: узнает её по содержимому.
 */
export async function fetchAvailability(
  tiles: TileCoord[],
  fetchFn: typeof fetch = fetch,
  concurrency = 4,
): Promise<Availability> {
  const out = new Availability();
  const reqs = tilemapRequests(tiles);
  let next = 0;
  const worker = async () => {
    while (next < reqs.length) {
      const r = reqs[next++];
      try {
        const res = await fetchFn(tilemapUrl(r), { mode: 'cors' });
        if (!res.ok) continue;
        const b = parseTilemap(r.z, await res.json());
        if (b) out.add(b);
      } catch {
        /* блок остаётся «не знаем» */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, reqs.length) }, worker));
  return out;
}

export interface ImageryPlan {
  /** Что качать: снимок есть или о нём не знаем. */
  fetch: TileCoord[];
  /** Где снимка нет — серые заглушки, их не качаем. */
  empty: TileCoord[];
  /** Самый крупный масштаб, на котором снимок есть хоть где-то. */
  deepest?: number;
  /** Масштабы, где снимка нет нигде, — по ним карта покажет мельче, но крупнее. */
  blankZooms: number[];
}

export function planImagery(tiles: TileCoord[], avail: Availability): ImageryPlan {
  const fetch: TileCoord[] = [];
  const empty: TileCoord[] = [];
  const withImagery = new Set<number>();
  const fetchedZooms = new Set<number>();
  const zooms = new Set<number>();
  for (const t of tiles) {
    zooms.add(t.z);
    const has = avail.has(t);
    if (has === false) { empty.push(t); continue; }
    fetch.push(t);
    fetchedZooms.add(t.z);
    if (has) withImagery.add(t.z);
  }
  return {
    fetch,
    empty,
    deepest: withImagery.size ? Math.max(...withImagery) : undefined,
    blankZooms: [...zooms].filter((z) => !fetchedZooms.has(z)).sort((a, b) => a - b),
  };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «1 тайл», «3 тайла», «1 365 тайлов». */
export function countTiles(n: number): string {
  return `${n.toLocaleString('ru')} ${plural(n, 'тайл', 'тайла', 'тайлов')}`;
}

/** Что убрали при открытии: заглушки, скачанные раньше, чем их научились узнавать. */
export function purgedNote(n: number): string {
  if (n <= 0) return '';
  return `Убрал с устройства ${n.toLocaleString('ru')} ${plural(n, 'серую заглушку', 'серые заглушки', 'серых заглушек')}, `
    + 'скачанных раньше: вместо них карта покажет настоящий снимок, только растянутый.';
}

/**
 * Что сказать до скачивания.
 *
 * «Скачаю 1 365 тайлов» звучало честно, а на деле девять десятых из них
 * были серыми заглушками. Число говорим про снимок, а про остальное —
 * что его там нет и что карта покажет вместо него.
 */
export function describeImageryPlan(p: ImageryPlan): string {
  if (p.empty.length === 0) return '';
  const count = countTiles(p.empty.length);
  const where = p.blankZooms.length === 0
    ? 'в части квадрата снимка нет'
    : p.blankZooms.length === 1
      ? `на ${p.blankZooms[0]}-м масштабе снимка здесь нет`
      : `на масштабах ${p.blankZooms.join(', ')} снимка здесь нет`;
  const instead = p.deepest !== undefined ? `, ближе карта покажет ${p.deepest}-й крупнее` : '';
  return `Ещё ${count} — серые заглушки, их не качаем: ${where}${instead}.`;
}

/**
 * Подпись в углу карты, когда снимок растянут.
 *
 * Растянутый 17-й масштаб на 19-м выглядит как снимок, только мутный, и
 * его легко принять за подробный: муфту по нему поставят так же уверенно,
 * как по настоящему. Угол с подписью источника — то место, куда смотрят,
 * когда спрашивают «а чему тут верить».
 */
export function upscaledNote(nativeZ: number): string {
  return `снимок здесь — до ${nativeZ}-го масштаба, ближе он же, растянутый`;
}
