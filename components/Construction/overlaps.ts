import { routeLengthM, pointAtDistanceM } from './routeProgress';
import { haversineM } from './measureTool';

/**
 * Где две трассы легли друг на друга.
 *
 * Файлов с трассами несколько: проект, правки после обследования,
 * альтернативный вариант, чья-то выгрузка из Google Earth. Куски в них
 * повторяются, и на карте это не видно — линии лежат одна под другой.
 * Зато видно в метрах: один и тот же кусок посчитан дважды и в объёмах,
 * и в потребности кабеля.
 *
 * Считаем не пересечение ломаных точно, а приближённо: расставляем
 * точки вдоль каждой линии и смотрим, сколько их попало в ту же клетку.
 * Точность в шаг расстановки — большего для вопроса «эти две линии
 * дублируют друг друга?» не нужно, а сравнивать сотни линий попарно по
 * всем звеньям слишком дорого.
 */

export interface OverlapPair {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** Сколько метров линий идут рядом. */
  sharedM: number;
  /** Доля от более короткой из двух. */
  share: number;
}

export interface OverlapRoute {
  id: string;
  name: string;
  coords: [number, number][];
}

/** Точки вдоль линии с постоянным шагом — включая оба конца. */
export function sampleRoute(
  coords: [number, number][],
  stepM: number,
): { lat: number; lon: number }[] {
  if (coords.length < 2 || stepM <= 0) return [];
  const total = routeLengthM(coords);
  const out: { lat: number; lon: number }[] = [];
  for (let d = 0; d <= total; d += stepM) {
    const p = pointAtDistanceM(coords, d);
    if (p) out.push({ lat: p.lat, lon: p.lon });
  }
  return out;
}

/**
 * Сетка клеток.
 *
 * Косинус берём по строке клеток, а не по самой точке: иначе две точки
 * из одной строки считают ширину клетки по-разному, и сетка перестаёт
 * сходиться сама с собой.
 */
function rowLonStep(row: number, dLat: number): number {
  const cos = Math.max(0.05, Math.cos(((row + 0.5) * dLat * Math.PI) / 180));
  return dLat / cos;
}

function cellKey(lat: number, lon: number, cellM: number): string {
  const dLat = (cellM / 6371000) * (180 / Math.PI);
  const row = Math.floor(lat / dLat);
  return `${row}_${Math.floor(lon / rowLonStep(row, dLat))}`;
}

/**
 * Своя клетка и восемь соседних.
 *
 * Смотреть только свою нельзя: две точки в двадцати метрах друг от друга
 * запросто оказываются по разные стороны границы клетки и пары не
 * находят. На двух линиях, идущих вдоль такой границы, так теряется не
 * одна точка, а половина — и дубль либо недосчитывается, либо не
 * находится вовсе.
 */
function cellKeysAround(lat: number, lon: number, cellM: number): string[] {
  const dLat = (cellM / 6371000) * (180 / Math.PI);
  const row0 = Math.floor(lat / dLat);
  const keys: string[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    const row = row0 + dr;
    const col = Math.floor(lon / rowLonStep(row, dLat));
    for (let dc = -1; dc <= 1; dc += 1) keys.push(`${row}_${col + dc}`);
  }
  return keys;
}

export interface OverlapOptions {
  /** Шаг расстановки точек, метры. Он же точность ответа. */
  stepM?: number;
  /** Насколько близко линии считаются «одной и той же». */
  toleranceM?: number;
  /** Короче этого не сообщаем: пересечение на перекрёстке — не дубль. */
  minSharedM?: number;
}

export function findOverlaps(
  routes: OverlapRoute[],
  opts: OverlapOptions = {},
): OverlapPair[] {
  const stepM = opts.stepM ?? 40;
  const toleranceM = opts.toleranceM ?? 25;
  const minSharedM = opts.minSharedM ?? 150;

  // Клетка крупнее допуска, а просматриваем всё равно девять клеток:
  // так попадание в допуск не зависит от того, куда легли границы сетки.
  const cellM = Math.max(toleranceM * 2, stepM);

  const byCell = new Map<string, { id: string; lat: number; lon: number }[]>();
  const samples = new Map<string, { lat: number; lon: number }[]>();

  for (const r of routes) {
    const pts = sampleRoute(r.coords, stepM);
    samples.set(r.id, pts);
    for (const p of pts) {
      const key = cellKey(p.lat, p.lon, cellM);
      const list = byCell.get(key);
      const entry = { id: r.id, lat: p.lat, lon: p.lon };
      if (list) list.push(entry); else byCell.set(key, [entry]);
    }
  }

  /**
   * Сколько точек одной линии нашли себе пару на другой.
   *
   * Считаем для каждой стороны отдельно. Линии оцифрованы по-разному, и
   * складывать их попадания в одно число значит мерить общий кусок
   * по более подробной из двух — а он не длиннее, чем видит каждая.
   */
  const hits = new Map<string, { a: number; b: number }>();
  for (const r of routes) {
    for (const p of samples.get(r.id) ?? []) {
      const matched = new Set<string>();
      for (const key of cellKeysAround(p.lat, p.lon, cellM)) {
        for (const q of byCell.get(key) ?? []) {
          if (q.id === r.id || matched.has(q.id)) continue;
          if (haversineM(p, q) <= toleranceM) matched.add(q.id);
        }
      }
      for (const other of matched) {
        // Пара всегда в одном порядке: иначе один и тот же дубль
        // посчитается дважды с разных сторон.
        const first = r.id < other;
        const key = first ? `${r.id}|${other}` : `${other}|${r.id}`;
        const acc = hits.get(key) ?? { a: 0, b: 0 };
        if (first) acc.a += 1; else acc.b += 1;
        hits.set(key, acc);
      }
    }
  }

  const byId = new Map(routes.map((r) => [r.id, r]));
  const out: OverlapPair[] = [];
  for (const [key, count] of hits) {
    const [aId, bId] = key.split('|');
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;
    // Общий кусок не длиннее того, что видит каждая из двух линий.
    const sharedM = Math.min(count.a, count.b) * stepM;
    if (sharedM < minSharedM) continue;
    const shorter = Math.min(routeLengthM(a.coords), routeLengthM(b.coords));
    out.push({
      aId, bId, aName: a.name, bName: b.name,
      sharedM,
      share: shorter > 0 ? Math.min(1, sharedM / shorter) : 0,
    });
  }

  return out.sort((x, y) => y.sharedM - x.sharedM);
}

export interface NearbyItem {
  id: string;
  label: string;
  kind: string;
  lat: number;
  lon: number;
}

export interface NearbyHit extends NearbyItem {
  distanceM: number;
}

/**
 * Что рядом с этой точкой.
 *
 * Вопрос на стройке звучит так: «мы вот здесь — где ближайшая муфта и
 * докуда тянуть». Искать ответ глазами по карте дольше, чем спросить.
 */
export function nearby(
  at: { lat: number; lon: number },
  items: NearbyItem[],
  radiusM = 2000,
  limit = 8,
): NearbyHit[] {
  return items
    .map((it) => ({ ...it, distanceM: haversineM(at, it) }))
    .filter((it) => it.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}
