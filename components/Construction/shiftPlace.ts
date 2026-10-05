import type { DailyWorkEntry, PlanRoute } from '@/types/construction';
import { routeLengthM, pointAtDistanceM, type SectionProgress } from './routeProgress';
import { nearestOnRoute } from './measureTool';
import { SHIFT_SNAP_M } from './shiftMeasure';

/**
 * Где на линии копали.
 *
 * Метры смены говорят «сколько», но не «где». Карта откладывала их подряд
 * от начала линии, и бригада, начавшая с середины и прошедшая км 6–9,
 * закрашивала км 0–3, а метка колонны стояла в шести километрах от неё.
 * Где копали, знает только человек на объекте, и называет он это одной
 * отметкой в форме смены — «остановились здесь». Отсюда и счёт:
 *
 * - отметка, поставленная рукой на карте, — это место: смена кончается в
 *   ней, а начинается на свои метры раньше;
 * - смена без отметки продолжает предыдущую: колонна идёт вдоль линии;
 * - «Верно» под посчитанной точкой — согласие со счётом, и если до этого
 *   на линии ничего не отмечали, то и с тем, что шли от её начала;
 * - смены, место которых не назвал никто, на линию не кладём. Они пройдены,
 *   но где — неизвестно, и карта так и показывает: долей по всей линии, а
 *   не закраской от начала. Закраска от начала с пометкой «место не
 *   указано» всё равно рисует место — глаз читает цвет, а не пометку.
 *
 * Пока смены не пишут «с ПК по ПК», это всё, что о месте известно.
 */

/** Метры по способам — то, что ложится на линию. */
function metersOf(e: DailyWorkEntry): number {
  let m = 0;
  for (const v of Object.values(e.byMethod ?? {})) m += v ?? 0;
  return m;
}

export interface PlacedShift {
  entryId: string;
  date: string;
  /** Метры от начала трассы. */
  fromM: number;
  toM: number;
  /** Метры смены как записаны — в линию они могут и не влезть. */
  meters: number;
  byMethod: DailyWorkEntry['byMethod'];
}

export interface UnplacedShift {
  entryId: string;
  date: string;
  meters: number;
  byMethod: DailyWorkEntry['byMethod'];
}

export interface RoutePlacement {
  /** Смены с известным местом — по порядку дней. */
  placed: PlacedShift[];
  /** Пройдено, а где — не названо. */
  unplaced: UnplacedShift[];
  /** Где кончилась последняя смена с известным местом; null — места не знаем. */
  endM: number | null;
  /** Длина линии по координатам. */
  totalM: number;
}

/** По дням, а в один день — по времени записи: так шла и колонна. */
function chronological(a: DailyWorkEntry, b: DailyWorkEntry): number {
  return (a.date ?? '').localeCompare(b.date ?? '')
    || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    || a.id.localeCompare(b.id);
}

export function placeShifts(
  route: Pick<PlanRoute, 'id' | 'coords'>,
  shifts: DailyWorkEntry[],
): RoutePlacement {
  const totalM = routeLengthM(route.coords);
  const clamp = (v: number) => Math.min(Math.max(0, v), totalM);
  const list = shifts.filter((e) => metersOf(e) > 0).sort(chronological);

  const placed: PlacedShift[] = [];
  const unplaced: UnplacedShift[] = [];
  let cursor: number | null = null;
  let pending: DailyWorkEntry[] = [];

  const put = (e: DailyWorkEntry, fromM: number, toM: number) => {
    placed.push({
      entryId: e.id, date: e.date, fromM: clamp(fromM), toM: clamp(toM),
      meters: metersOf(e), byMethod: e.byMethod,
    });
    return clamp(toM);
  };
  const drop = (e: DailyWorkEntry) => {
    unplaced.push({ entryId: e.id, date: e.date, meters: metersOf(e), byMethod: e.byMethod });
  };

  for (const e of list) {
    const m = metersOf(e);
    const stop = e.stop?.routeId === route.id ? e.stop : undefined;
    const hit = stop?.manual ? nearestOnRoute(stop, route.coords) : null;

    if (hit) {
      // Место названо рукой. Смены до неё без отметок так и остаются без
      // места: назад от отметки не считаем — бригада могла прийти сюда
      // с другого конца села, и закрасить за неё чужой кусок нельзя.
      for (const p of pending) drop(p);
      pending = [];
      cursor = put(e, hit.atM - m, hit.atM);
      continue;
    }

    if (cursor === null && stop) {
      // «Верно» под точкой, посчитанной от начала линии: значит, шли от
      // начала — и эта смена, и все до неё на этой линии.
      let at = 0;
      for (const p of pending) at = put(p, at, at + metersOf(p));
      pending = [];
      cursor = put(e, at, at + m);
      continue;
    }

    if (cursor !== null) {
      cursor = put(e, cursor, cursor + m);
      continue;
    }
    pending.push(e);
  }
  for (const p of pending) drop(p);

  return { placed, unplaced, endM: cursor, totalM };
}

/**
 * Какие смены ложатся на эту трассу.
 *
 * Отметка в смене привязывает её к своей линии прямо: у села бывает
 * основная линия и отвод к школе, и смена, отмеченная на основной, на
 * отвод ложиться не должна. Смены без отметки ложатся на трассы своего
 * села, как и раньше. Отметка на линии, которой больше нет (разрезали,
 * удалили), ничего не привязывает — смена ищет трассу по селу.
 */
export function shiftIndex(
  ground: DailyWorkEntry[],
  liveRouteIds?: Set<string>,
): (routeId: string, kato?: string) => DailyWorkEntry[] {
  const byRoute = new Map<string, DailyWorkEntry[]>();
  const byKato = new Map<string, DailyWorkEntry[]>();
  const push = (m: Map<string, DailyWorkEntry[]>, k: string, e: DailyWorkEntry) => {
    const list = m.get(k);
    if (list) list.push(e); else m.set(k, [e]);
  };
  for (const e of ground) {
    const own = e.stop?.routeId;
    if (own && (!liveRouteIds || liveRouteIds.has(own))) { push(byRoute, own, e); continue; }
    if (e.kato) push(byKato, e.kato, e);
  }
  return (routeId, kato) => [
    ...(byRoute.get(routeId) ?? []),
    ...(kato ? byKato.get(kato) ?? [] : []),
  ];
}

export function shiftsOnRoute(
  routeId: string,
  kato: string | undefined,
  ground: DailyWorkEntry[],
  liveRouteIds?: Set<string>,
): DailyWorkEntry[] {
  return shiftIndex(ground, liveRouteIds)(routeId, kato);
}

export interface StopProposal {
  /** Где окажемся вечером, метры от начала линии. */
  atM: number;
  lat: number;
  lon: number;
  /** Дошли до конца линии. */
  atEnd: boolean;
  /** Откуда считаем сегодняшние метры, метры от начала линии. */
  beforeM: number;
  /**
   * 'place' — от места прошлой смены;
   * 'start' — места на линии не называли ни разу, и считаем от её начала.
   * Это допущение, и человек должен его видеть до того, как скажет «верно».
   */
  from: 'place' | 'start';
  /** День смены, от которой продолжаем. */
  afterDate?: string;
}

/**
 * Где колонна окажется вечером — по тому же счёту, по которому красится
 * карта.
 *
 * Раньше форма считала от суммы всех метров участка, а не от места: инженер
 * передвигал «остановились здесь» с 3-го км на 9-й, а назавтра форма снова
 * предлагала 3-й с хвостиком. Теперь предложение и закраска считаются
 * одним правилом и спорить не могут. Смены позже выбранного дня не в счёт:
 * вчерашний день, закрытый сегодня, продолжает позавчерашний.
 */
export function proposeStop(
  route: Pick<PlanRoute, 'id' | 'coords'>,
  shifts: DailyWorkEntry[],
  addedM: number,
  date?: string,
): StopProposal | null {
  if (route.coords.length < 2) return null;
  const before = date ? shifts.filter((e) => !e.date || e.date <= date) : shifts;
  const pl = placeShifts(route, before);
  const known = pl.endM !== null;
  const beforeM = known
    ? (pl.endM as number)
    : Math.min(pl.totalM, pl.unplaced.reduce((s, u) => s + u.meters, 0));
  const target = beforeM + Math.max(0, addedM);
  const at = pointAtDistanceM(route.coords, target);
  if (!at) return null;
  return {
    atM: Math.min(pl.totalM, target),
    lat: at.lat,
    lon: at.lon,
    atEnd: target >= pl.totalM,
    beforeM,
    from: known ? 'place' : 'start',
    afterDate: known ? pl.placed[pl.placed.length - 1]?.date : undefined,
  };
}

/**
 * Где посчитанная точка «остановились здесь» стоит на линии сейчас.
 *
 * Посчитанная точка — это счёт метров, и когда линию разворачивают, она
 * уходит вслед за счётом. Раньше её откладывали от начала линии на все
 * пройденные метры. Если же место хоть раз называли рукой, счёт идёт от
 * него, и точка колонны должна встать туда же, где кончается закраска,
 * а не в стороне от неё. Смен с отметками нет — прежний счёт.
 */
export function stopPositionM(
  route: Pick<PlanRoute, 'id' | 'coords'>,
  shifts: DailyWorkEntry[],
  p: Pick<SectionProgress, 'date' | 'doneM'>,
): number {
  const upto = shifts.filter((e) => (e.date ?? '') <= (p.date ?? ''));
  return placeShifts(route, upto).endM ?? p.doneM;
}

const km = (m: number) => `${(Math.max(0, m) / 1000).toFixed(2).replace('.', ',')} км`;
const meters = (m: number) => `${Math.round(Math.max(0, m)).toLocaleString('ru')} м`;
const day = (iso?: string) => (iso ? iso.split('-').reverse().join('.') : '');

export interface StopTextInput {
  routeName: string;
  /** Подпись начала линии: «ОМ», «Зеренда». */
  startName?: string;
  proposal: StopProposal;
  /** Метры за день. */
  addedM: number;
  /** Точка поставлена рукой — куда она легла на линии. */
  picked?: { atM: number; deviationM: number } | null;
}

/**
 * Подпись под «остановились здесь».
 *
 * Счёт от начала линии — допущение, а не знание, и сказать это надо до
 * того, как человек нажмёт «верно»: иначе он подтвердит его не читая, и
 * карта закрасит не то место уже с его согласия.
 */
export function describeStop(s: StopTextInput): string {
  const start = s.startName ? ` («${s.startName}»)` : '';
  if (s.picked) {
    const from = Math.max(0, s.picked.atM - s.addedM);
    const off = s.picked.deviationM > SHIFT_SNAP_M
      ? ` Точка в ${meters(s.picked.deviationM)} от линии — берём ближайшее место на ней.`
      : '';
    return `По отметке на карте: ${km(s.picked.atM)} от начала линии${start}. `
      + `Закрасим с ${km(from)} по ${km(s.picked.atM)}.${off}`;
  }
  const p = s.proposal;
  const end = p.atEnd ? ' — трасса пройдена до конца' : '';
  if (p.from === 'place') {
    return `По трассе «${s.routeName}»: прошлая смена${p.afterDate ? ` (${day(p.afterDate)})` : ''} `
      + `кончилась на ${km(p.beforeM)}, за день ${meters(s.addedM)}${end}.`;
  }
  return `По трассе «${s.routeName}»: где копали, на этой линии ещё не отмечали — `
    + `считаем от её начала${start}: до сегодня ${meters(p.beforeM)}, за день ${meters(s.addedM)}${end}. `
    + 'Начали не с начала — укажите на карте, где остановились: закрасим там, где копали.';
}
