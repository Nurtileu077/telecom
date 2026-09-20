import { routeLengthM } from './routeProgress';

/**
 * Померить по карте.
 *
 * По прямой меряют редко: кабель идёт по трассе, и «сколько отсюда
 * досюда» — это сколько по линии, а не через поле. Поэтому клик рядом с
 * трассой прилипает к ней, и расстояние считается вдоль.
 *
 * Тот же прилипающий клик нужен и при рисовании: новая линия, начатая
 * рядом с существующей, должна к ней цепляться, иначе в стыке остаётся
 * метровый разрыв, которого на земле нет.
 */

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export interface LatLon { lat: number; lon: number }

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Ближайшая точка отрезка — в плоскости, развёрнутой вокруг самой точки.
 *
 * На отрезках в сотни метров кривизна земли не важна, а считать проекцию
 * на сфере ради этого — лишняя сложность там, где ошибка меньше
 * сантиметра.
 */
function nearestOnSegment(
  p: LatLon,
  a: [number, number],
  b: [number, number],
): { lat: number; lon: number; t: number } {
  const kx = Math.cos(rad(p.lat));
  const ax = (a[1] - p.lon) * kx;
  const ay = a[0] - p.lat;
  const bx = (b[1] - p.lon) * kx;
  const by = b[0] - p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { lat: a[0], lon: a[1], t: 0 };
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return {
    lat: a[0] + (b[0] - a[0]) * t,
    lon: a[1] + (b[1] - a[1]) * t,
    t,
  };
}

export interface SnapHit {
  lat: number;
  lon: number;
  /** Метры от начала трассы. */
  atM: number;
  /** Насколько клик промахнулся мимо линии. */
  deviationM: number;
  /** Номер звена, на которое попали. */
  index: number;
}

/** Куда на этой трассе попадает клик. */
export function nearestOnRoute(p: LatLon, coords: [number, number][]): SnapHit | null {
  if (coords.length < 2) return null;
  let best: SnapHit | null = null;
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineM(
      { lat: coords[i - 1][0], lon: coords[i - 1][1] },
      { lat: coords[i][0], lon: coords[i][1] },
    );
    const near = nearestOnSegment(p, coords[i - 1], coords[i]);
    const dev = haversineM(p, near);
    if (!best || dev < best.deviationM) {
      best = { lat: near.lat, lon: near.lon, atM: acc + seg * near.t, deviationM: dev, index: i - 1 };
    }
    acc += seg;
  }
  return best;
}

export interface RouteRef { id: string; coords: [number, number][] }
export type RouteSnap = SnapHit & { routeId: string };

/**
 * Прилипание: ближайшая трасса, если клик промахнулся не сильно.
 *
 * Допуск задаётся в метрах и приходит от карты — на общем плане пиксель
 * это сотни метров, и прилипать к линии за километр было бы враньём.
 */
export function snapToRoutes(
  p: LatLon,
  routes: RouteRef[],
  maxM: number,
): RouteSnap | null {
  let best: RouteSnap | null = null;
  for (const r of routes) {
    const hit = nearestOnRoute(p, r.coords);
    if (!hit || hit.deviationM > maxM) continue;
    if (!best || hit.deviationM < best.deviationM) best = { ...hit, routeId: r.id };
  }
  return best;
}

export interface LineMeasure {
  /** Длина ломаной. */
  totalM: number;
  /** Длины звеньев. */
  legs: number[];
  /** Напрямую от первой точки до последней. */
  straightM: number;
}

export function measureLine(coords: [number, number][]): LineMeasure {
  const legs: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    legs.push(haversineM(
      { lat: coords[i - 1][0], lon: coords[i - 1][1] },
      { lat: coords[i][0], lon: coords[i][1] },
    ));
  }
  const first = coords[0];
  const last = coords[coords.length - 1];
  return {
    totalM: legs.reduce((s, v) => s + v, 0),
    legs,
    straightM: coords.length >= 2
      ? haversineM({ lat: first[0], lon: first[1] }, { lat: last[0], lon: last[1] })
      : 0,
  };
}

export interface AlongRouteMeasure {
  /** По трассе между двумя прилипшими точками. */
  alongM: number;
  /** По прямой между ними же — для сравнения. */
  straightM: number;
  fromM: number;
  toM: number;
}

/** Сколько по трассе между двумя точками на ней. */
export function measureAlongRoute(
  coords: [number, number][],
  a: SnapHit,
  b: SnapHit,
): AlongRouteMeasure {
  const fromM = Math.min(a.atM, b.atM);
  const toM = Math.max(a.atM, b.atM);
  return {
    alongM: toM - fromM,
    straightM: haversineM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }),
    fromM,
    toM,
  };
}

/**
 * Площадь замкнутого контура.
 *
 * Формула через сферический избыток: площадки под рекультивацию и
 * пропорку считают в гектарах, и разница между плоской и сферической
 * на таких размерах невелика, но на области — уже заметна.
 */
export function polygonAreaM2(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const ring = [...coords];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);

  let sum = 0;
  for (let i = 1; i < ring.length; i++) {
    const [lat1, lon1] = ring[i - 1];
    const [lat2, lon2] = ring[i];
    sum += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((sum * R * R) / 2);
}

/** Периметр контура — замкнутый, в отличие от ломаной. */
export function perimeterM(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const ring = [...coords, coords[0]];
  return routeLengthM(ring);
}

/**
 * Прямоугольник по двум противоположным углам.
 *
 * Зону работ обводят прямоугольником чаще, чем многоугольником: это
 * площадка, склад, участок под рекультивацию. Двадцать кликов ради
 * четырёх углов никто делать не станет.
 */
export function rectCoords(
  a: [number, number],
  b: [number, number],
): [number, number][] {
  if (a[0] === b[0] && a[1] === b[1]) return [];
  return [[a[0], a[1]], [a[0], b[1]], [b[0], b[1]], [b[0], a[1]]];
}

/**
 * Круг по центру и точке на краю — многоугольником.
 *
 * Настоящей окружности в KML нет, да она и не нужна: контур в сорок
 * восемь вершин на любом приближении читается как круг, зато его можно
 * править, резать и выгружать как всё остальное.
 */
export function circleCoords(
  center: [number, number],
  edge: [number, number],
  steps = 48,
): [number, number][] {
  const radius = haversineM(
    { lat: center[0], lon: center[1] },
    { lat: edge[0], lon: edge[1] },
  );
  if (radius <= 0) return [];

  const dLat = (radius / R) * (180 / Math.PI);
  const cos = Math.cos(rad(center[0]));
  const dLon = Math.abs(cos) < 1e-9 ? dLat : dLat / cos;

  const out: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    out.push([center[0] + dLat * Math.cos(a), center[1] + dLon * Math.sin(a)]);
  }
  return out;
}

/** «840 м²», «3,2 га», «18,5 км²» — как считают на стройке. */
export function formatArea(m2: number): string {
  const v = Math.max(0, m2);
  if (v < 10_000) return `${Math.round(v).toLocaleString('ru')} м²`;
  if (v < 1_000_000) return `${(v / 10_000).toFixed(2).replace('.', ',')} га`;
  return `${(v / 1_000_000).toFixed(2).replace('.', ',')} км²`;
}
