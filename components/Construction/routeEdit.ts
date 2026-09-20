import { routeLengthM } from './routeProgress';
import { sliceByDistance } from './routeSegments';
import { haversineM } from './measureTool';

/**
 * Резать и склеивать трассу.
 *
 * В KML трасса приходит так, как её нарисовал проектировщик, а на стройке
 * она живёт иначе: этот кусок делает одна бригада, тот — другая, здесь
 * граница СМУ, а вот эти два обрывка — на самом деле одна линия, просто
 * нарисованная в два приёма. Пока линию нельзя разрезать и свести, всё
 * это держат в голове.
 */

export interface RouteSplit {
  /** От начала до разреза. */
  head: [number, number][];
  /** От разреза до конца. */
  tail: [number, number][];
  headM: number;
  tailM: number;
}

/**
 * Разрез в стольких-то метрах от начала.
 *
 * У самого конца не режем: кусок в полметра — это не участок, а мусор,
 * который потом придётся искать и удалять.
 */
export function splitRoute(
  coords: [number, number][],
  atM: number,
  minPieceM = 5,
): RouteSplit | null {
  if (coords.length < 2) return null;
  const total = routeLengthM(coords);
  if (atM <= minPieceM || atM >= total - minPieceM) return null;

  const head = sliceByDistance(coords, 0, atM);
  const tail = sliceByDistance(coords, atM, total);
  if (head.length < 2 || tail.length < 2) return null;
  return { head, tail, headM: routeLengthM(head), tailM: routeLengthM(tail) };
}

export interface JoinResult {
  coords: [number, number][];
  /** Разрыв между концами, который пришлось перешагнуть. */
  gapM: number;
  /** Пришлось ли развернуть первую или вторую линию. */
  reversedA: boolean;
  reversedB: boolean;
}

function endsGap(a: [number, number][], b: [number, number][]): number {
  const from = a[a.length - 1];
  const to = b[0];
  return haversineM({ lat: from[0], lon: from[1] }, { lat: to[0], lon: to[1] });
}

/**
 * Свести две линии в одну.
 *
 * Какой конец к какому — не спрашиваем: примеряем все четыре сочетания и
 * берём то, где разрыв меньше. Человек знает, что эти две линии одна, а
 * в какую сторону нарисована каждая — не знает и знать не должен.
 */
export function joinRoutes(
  a: [number, number][],
  b: [number, number][],
  maxGapM = 250,
): JoinResult | null {
  if (a.length < 2 || b.length < 2) return null;

  const ra = [...a].reverse();
  const rb = [...b].reverse();
  const options: { first: [number, number][]; second: [number, number][]; ra: boolean; rb: boolean }[] = [
    { first: a, second: b, ra: false, rb: false },
    { first: a, second: rb, ra: false, rb: true },
    { first: ra, second: b, ra: true, rb: false },
    { first: ra, second: rb, ra: true, rb: true },
  ];

  let best: JoinResult | null = null;
  for (const o of options) {
    const gapM = endsGap(o.first, o.second);
    if (best && gapM >= best.gapM) continue;
    // Совпавшие концы не дублируем: лишняя вершина в стыке потом вылезет
    // нулевым звеном в подписях длин.
    const second = gapM < 0.5 ? o.second.slice(1) : o.second;
    best = {
      coords: [...o.first, ...second],
      gapM,
      reversedA: o.ra,
      reversedB: o.rb,
    };
  }

  if (!best || best.gapM > maxGapM) return null;
  return best;
}

/** Имя склеенной линии: «Зеренда — Серафимовка + Серафимовка — Школа». */
export function joinedName(a: string, b: string): string {
  const left = (a || '').trim();
  const right = (b || '').trim();
  if (!left) return right || 'Трасса';
  if (!right || left === right) return left;
  return `${left} + ${right}`;
}

/** Имена двух половин: к исходному добавляем, какая это часть. */
export function splitNames(name: string): [string, string] {
  const base = (name || 'Трасса').trim();
  return [`${base} (1)`, `${base} (2)`];
}
