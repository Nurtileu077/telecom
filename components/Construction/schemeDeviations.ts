import type { Deviation, PlanRoute } from '@/types/construction';
import { nearestOnRoute } from './measureTool';
import { routeLengthM, pointAtDistanceM } from './routeProgress';
import { sliceByDistance } from './routeSegments';
import { sectionMatchesRoute } from './routeSection';
import { fmtDate } from './actDocument';

/**
 * Отклонения по трассе в исполнительной схеме.
 *
 * Болото обошли в стороне от проекта, обход нарисовали на карте, протокол
 * мобильной группы подписали — а схема по-прежнему рисовала проектную
 * линию с проектной длиной. Заказчик получал лист, который спорил с его
 * же протоколом.
 *
 * Какую схему ждут, решает заказчик, и ответ был «и так и так, на выбор»:
 *
 * - по факту — линия идёт обходом, пролёты и протяжённость фактические;
 * - по проекту — линия проектная, а отклонение отмечено на ней и сведено
 *   в таблицу с фактической длиной и протоколом.
 *
 * В обоих видах таблица отклонений одна и та же: по ней схему сверяют
 * с протоколами.
 */

export type SchemeMode = 'fact' | 'project';

export const SCHEME_MODES: SchemeMode[] = ['fact', 'project'];

export const SCHEME_MODE_LABEL: Record<SchemeMode, string> = {
  fact: 'По факту',
  project: 'По проекту с отклонениями',
};

export const SCHEME_MODE_HINT: Record<SchemeMode, string> = {
  fact: 'Линия идёт обходом, пролёты и протяжённость — фактические.',
  project: 'Линия и пролёты проектные, отклонения отмечены и сведены в таблицу.',
};

const MODE_KEY = 'optiq-scheme-mode-v1';

/** Вид схемы — настройка того, кто собирает документы, а не журнала. */
export function loadSchemeMode(): SchemeMode {
  if (typeof window === 'undefined') return 'fact';
  try {
    return window.localStorage.getItem(MODE_KEY) === 'project' ? 'project' : 'fact';
  } catch {
    return 'fact';
  }
}

export function saveSchemeMode(m: SchemeMode): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(MODE_KEY, m); } catch { /* приватный режим */ }
}

/**
 * Какие отклонения относятся к схеме этой трассы.
 *
 * Только по трассе — отклонение по глубине линию не двигает, оно живёт
 * в актах. Участок сверяем тем же правилом, что и у объектов схемы:
 * чужое отклонение в листе — это чужая длина под нашей подписью.
 */
export function schemeDeviationsFor(
  deviations: Deviation[],
  route: Pick<PlanRoute, 'name' | 'uchastok' | 'folder'> | null | undefined,
): { own: Deviation[]; others: Deviation[] } {
  const own: Deviation[] = [];
  const others: Deviation[] = [];
  for (const d of deviations) {
    if (d.kind !== 'route') continue;
    if (route && sectionMatchesRoute(d.uchastok, route)) own.push(d);
    else others.push(d);
  }
  return { own, others };
}

export interface PlacedDeviation {
  dev: Deviation;
  /** Номер на схеме — по порядку вдоль линии. */
  n: number;
  /** Где обход ушёл с проекта и где вернулся — метры по проектной линии. */
  fromM: number;
  toM: number;
  /** Длина обхода — та, что записана в карточке и в протоколе. */
  factM: number;
  /** Сколько проектной линии обход заменил. */
  projectM: number;
  /** Путь обхода: от точки ухода с проекта через снятые точки до точки возврата. */
  path: [number, number][];
}

export interface DeviationLayout {
  placed: PlacedDeviation[];
  /** Чего на схему не положить — с причиной, словами. */
  unplaced: string[];
}

/** «Отклонение от 12.09.2026 «Обход болота», 640 м» — как его найти в списке. */
export function deviationTitle(d: Deviation): string {
  const when = d.date ? ` от ${fmtDate(d.date)}` : '';
  const why = d.reason?.trim() ? ` «${d.reason.trim()}»` : '';
  const len = d.lengthM > 0 ? `, ${Math.round(d.lengthM).toLocaleString('ru')} м` : '';
  return `Отклонение${when}${why}${len}`;
}

/** Протокол мобильной группы одной строкой — или прямо, что его нет. */
export function deviationProtocol(d: Deviation): string {
  const p = d.protocol;
  if (!p?.number?.trim()) return 'протокол МГ не оформлен';
  return `протокол МГ №${p.number.trim()}${p.date ? ` от ${fmtDate(p.date)}` : ''}`;
}

const finite = (p: { lat: number; lon: number } | undefined): p is { lat: number; lon: number } =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/**
 * Где на проектной линии лежит каждое отклонение.
 *
 * Обход начинается и кончается на проекте: там, где ушли с линии, и там,
 * где на неё вернулись. Поэтому концы обхода проецируем на трассу, а сам
 * обход между ними берём из снятых точек. Концы, лежащие дальше
 * `maxOffsetM` от линии, — это уже не отклонение этой трассы, а ошибка
 * точки или другая линия, и притягивать их нельзя: в листе появилась бы
 * длина, которой нет.
 *
 * Отклонение с одной точкой на схему не ложится: неизвестно, где обход
 * вернулся на проект, и сколько проекта он заменил — тоже. Так и пишем.
 */
export function placeDeviations(
  coords: [number, number][],
  deviations: Deviation[],
  maxOffsetM: number,
): DeviationLayout {
  const unplaced: string[] = [];
  const candidates: Omit<PlacedDeviation, 'n'>[] = [];

  for (const d of deviations) {
    const pts = (d.coords ?? []).filter(finite);
    if (!(d.lengthM > 0)) {
      unplaced.push(`${deviationTitle(d)}: не указана протяжённость`);
      continue;
    }
    if (pts.length === 0) {
      unplaced.push(`${deviationTitle(d)}: нет координат — где оно, неизвестно`);
      continue;
    }
    if (pts.length === 1) {
      unplaced.push(`${deviationTitle(d)}: снята одна точка — где обход вернулся на трассу, неизвестно`);
      continue;
    }
    const first = pts[0];
    const last = pts[pts.length - 1];
    const a = nearestOnRoute(first, coords);
    const b = nearestOnRoute(last, coords);
    if (!a || !b) {
      unplaced.push(`${deviationTitle(d)}: у трассы нет линии`);
      continue;
    }
    const far = Math.max(a.deviationM, b.deviationM);
    if (far > maxOffsetM) {
      unplaced.push(`${deviationTitle(d)}: ${a.deviationM >= b.deviationM ? 'начало' : 'конец'} `
        + `в ${Math.round(far).toLocaleString('ru')} м от линии`);
      continue;
    }

    // Обход могли нарисовать и против хода трассы — ведём его по ходу.
    const forward = a.atM <= b.atM;
    const from = forward ? a : b;
    const to = forward ? b : a;
    const ordered = forward ? pts : [...pts].reverse();
    const start = pointAtDistanceM(coords, from.atM);
    const end = pointAtDistanceM(coords, to.atM);
    if (!start || !end) continue;
    candidates.push({
      dev: d,
      fromM: from.atM,
      toM: to.atM,
      factM: d.lengthM,
      projectM: to.atM - from.atM,
      path: [
        [start.lat, start.lon],
        ...ordered.map((p) => [p.lat, p.lon] as [number, number]),
        [end.lat, end.lon],
      ],
    });
  }

  // Два обхода одного и того же куска — это не два отклонения, а
  // повторная запись или ошибка точки. Вычесть проект дважды значит
  // напечатать длину, которой нет; берём первое и называем второе.
  candidates.sort((x, y) => x.fromM - y.fromM);
  const placed: PlacedDeviation[] = [];
  for (const c of candidates) {
    const prev = placed[placed.length - 1];
    if (prev && c.fromM < prev.toM - 0.5) {
      unplaced.push(`${deviationTitle(c.dev)}: перекрывается с отклонением №${prev.n}`);
      continue;
    }
    placed.push({ ...c, n: placed.length + 1 });
  }
  return { placed, unplaced };
}

/** Где на линии схемы лежит обход — в метрах схемы. */
export interface DeviationSpan {
  n: number;
  fromM: number;
  toM: number;
}

/**
 * Линия, вдоль которой стоят отметки схемы.
 *
 * `toScheme` переводит метры по геометрии этой линии в метры листа. Для
 * проекта это одно и то же. Для факта — почти: обход на листе имеет ту
 * длину, что в протоколе, а не ту, что вышла по точкам, снятым
 * телефоном, — иначе схема снова спорила бы с протоколом, только на
 * несколько метров.
 */
export interface SchemeLine {
  coords: [number, number][];
  totalM: number;
  toScheme: (geoM: number) => number;
  deviations: DeviationSpan[];
}

/** Проектная линия: отклонения только отмечены на ней. */
export function projectLine(coords: [number, number][], placed: PlacedDeviation[]): SchemeLine {
  return {
    coords,
    totalM: routeLengthM(coords),
    toScheme: (m) => m,
    deviations: placed.map((p) => ({ n: p.n, fromM: p.fromM, toM: p.toM })),
  };
}

/**
 * Фактическая линия: проект до ухода, обход, проект после возврата.
 *
 * Объекты, поставленные на обходе, проецируются на неё, а не на проект:
 * муфта у болота стоит на обходе, и на проектной линии ей места нет.
 */
export function factLine(coords: [number, number][], placed: PlacedDeviation[]): SchemeLine {
  const out: [number, number][] = [];
  const pieces: { geoFrom: number; geoLen: number; schemeFrom: number; schemeLen: number }[] = [];
  const deviations: DeviationSpan[] = [];
  let geo = 0;
  let scheme = 0;

  const push = (pts: [number, number][], schemeLen?: number) => {
    if (pts.length < 2) return;
    const geoLen = routeLengthM(pts);
    for (const p of pts) {
      const lastPt = out[out.length - 1];
      if (!lastPt || lastPt[0] !== p[0] || lastPt[1] !== p[1]) out.push(p);
    }
    const len = schemeLen ?? geoLen;
    pieces.push({ geoFrom: geo, geoLen, schemeFrom: scheme, schemeLen: len });
    geo += geoLen;
    scheme += len;
  };

  const total = routeLengthM(coords);
  let cursor = 0;
  for (const d of placed) {
    if (d.fromM > cursor) push(sliceByDistance(coords, cursor, d.fromM));
    const at = scheme;
    push(d.path, d.factM);
    deviations.push({ n: d.n, fromM: at, toM: scheme });
    cursor = Math.max(cursor, d.toM);
  }
  if (total > cursor) push(sliceByDistance(coords, cursor, total));

  const toScheme = (m: number): number => {
    for (const p of pieces) {
      if (m <= p.geoFrom + p.geoLen || p === pieces[pieces.length - 1]) {
        const t = p.geoLen > 0 ? Math.min(1, Math.max(0, (m - p.geoFrom) / p.geoLen)) : 0;
        return p.schemeFrom + t * p.schemeLen;
      }
    }
    return 0;
  };

  return { coords: out, totalM: scheme, toScheme, deviations };
}

/**
 * Длина участка по факту — без схемы.
 *
 * Форма нарисованного отклонения раньше говорила «трасса + обход =
 * по участку», прибавляя обход целиком. Обход же заменяет кусок
 * проекта, а не дописывается к нему: схема по факту покажет меньше, и
 * два экрана назовут две разные длины одного участка.
 */
export function lengthWithDeviations(projectM: number, placed: PlacedDeviation[]): number {
  return projectM + placed.reduce((s, p) => s + (p.factM - p.projectM), 0);
}
