import type { DailyWorkEntry, PlanRoute, ShiftStop } from '@/types/construction';
import { routeLengthM, pointAtDistanceM, type SectionProgress } from './routeProgress';
import { nearestOnRoute } from './measureTool';
import { SHIFT_SNAP_M } from './shiftMeasure';
import { normName } from './areaImport';

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
 * - смена без отметки продолжает предыдущую смену своей колонны: колонна
 *   идёт вдоль линии. Чужую — нет: одно село часто ведут две колонны, и
 *   вторая, не отметившая место, иначе закрашивала бы километры за первой;
 * - «Верно» под посчитанной точкой — согласие со счётом, и если до этого
 *   колонна место на линии не называла, то и с тем, что шла от её начала;
 * - смены, место которых не назвал никто, на линию не кладём. Они пройдены,
 *   но где — неизвестно, и карта так и показывает: долей по всей линии, а
 *   не закраской от начала. Закраска от начала с пометкой «место не
 *   указано» всё равно рисует место — глаз читает цвет, а не пометку.
 *   Назвать место задним числом можно с карточки трассы: откуда колонна
 *   начала — это отметка первой из этих смен (см. stopForRunStart).
 *
 * Направление у каждой колонны своё. Две бригады часто идут по селу
 * навстречу: одна от ОМ, другая от школы. Пока счёт шёл только «от начала
 * линии», вторая без отметок уходила в обратную сторону от того места,
 * где стояла. Отметка `back` — «шли к началу линии»: смена кончается в
 * отметке, а начинается на свои метры дальше от начала, и смены без
 * отметок продолжают в ту же сторону. Направление считается от счёта
 * линии: «Считать с другого конца» разворачивает его всем колоннам сразу.
 *
 * Пока смены не пишут «с ПК по ПК», это всё, что о месте известно.
 */

/** Метры по способам — то, что ложится на линию. */
function metersOf(e: DailyWorkEntry): number {
  let m = 0;
  for (const v of Object.values(e.byMethod ?? {})) m += v ?? 0;
  return m;
}

/**
 * Чья смена: подрядчик и колонна — как и в проверке на дубль.
 *
 * Одно имя колонны без подрядчика не годится: «1-колонна» есть почти у
 * каждого субподрядчика. Ошибка в другую сторону дешевле: смена, которую
 * не признали своей, остаётся без места и видна штрихом, а признанная
 * чужой закрашивает не то место.
 */
export function crewOf(e: Pick<DailyWorkEntry, 'contractor' | 'column'>): string {
  return `${normName(e.contractor ?? '')}|${normName(e.column ?? '')}`;
}

/** Как назвать колонну смены человеку. */
export function crewLabel(e: Pick<DailyWorkEntry, 'contractor' | 'column'>): string {
  const column = (e.column ?? '').trim();
  const contractor = (e.contractor ?? '').trim();
  if (column && contractor) return `${column} (${contractor})`;
  return column || contractor;
}

export interface PlacedShift {
  entryId: string;
  date: string;
  /** Колонна смены — см. crewOf. */
  crew: string;
  /** Метры от начала трассы; `fromM` всегда ближе к началу, чем `toM`. */
  fromM: number;
  toM: number;
  /** Шли к началу линии: смена начата у `toM`, кончена у `fromM`. */
  back?: boolean;
  /** Метры смены как записаны — в линию они могут и не влезть. */
  meters: number;
  byMethod: DailyWorkEntry['byMethod'];
}

export interface UnplacedShift {
  entryId: string;
  date: string;
  crew: string;
  meters: number;
  byMethod: DailyWorkEntry['byMethod'];
}

export interface RoutePlacement {
  /** Смены с известным местом — по порядку дней. */
  placed: PlacedShift[];
  /** Пройдено, а где — не названо. По порядку дней. */
  unplaced: UnplacedShift[];
  /** Где кончилась последняя смена с известным местом; null — места не знаем. */
  endM: number | null;
  /** Где стоит каждая колонна, место которой известно (ключ — crewOf). */
  endByCrew: Map<string, number>;
  /** Колонны, идущие к началу линии (ключ — crewOf). */
  backByCrew: Set<string>;
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
  // Счёт у каждой колонны свой: где стоит она, куда идёт и что прошла
  // без отметок.
  const cursor = new Map<string, number>();
  const backward = new Set<string>();
  const pending = new Map<string, DailyWorkEntry[]>();

  /** Смена от `startM` на `m` метров по ходу колонны; ответ — где кончилась. */
  const put = (e: DailyWorkEntry, crew: string, startM: number, m: number, back: boolean) => {
    const endM = clamp(back ? startM - m : startM + m);
    const a = clamp(startM);
    placed.push({
      entryId: e.id, date: e.date, crew,
      fromM: Math.min(a, endM), toM: Math.max(a, endM), back: back || undefined,
      meters: metersOf(e), byMethod: e.byMethod,
    });
    cursor.set(crew, endM);
    return endM;
  };
  const drop = (e: DailyWorkEntry, crew: string) => {
    unplaced.push({ entryId: e.id, date: e.date, crew, meters: metersOf(e), byMethod: e.byMethod });
  };

  for (const e of list) {
    const crew = crewOf(e);
    const m = metersOf(e);
    const stop = e.stop?.routeId === route.id ? e.stop : undefined;
    // Направление называет отметка; без неё колонна идёт, как шла.
    if (stop) {
      if (stop.back) backward.add(crew); else backward.delete(crew);
    }
    const back = backward.has(crew);
    const hit = stop?.manual ? nearestOnRoute(stop, route.coords) : null;
    const waiting = pending.get(crew) ?? [];

    if (hit) {
      // Место названо рукой. Смены до неё без отметок так и остаются без
      // места: назад от отметки не считаем — бригада могла прийти сюда
      // с другого конца села, и закрасить за неё чужой кусок нельзя.
      for (const p of waiting) drop(p, crew);
      pending.delete(crew);
      put(e, crew, back ? hit.atM + m : hit.atM - m, m, back);
      continue;
    }

    const at = cursor.get(crew);
    if (at === undefined && stop) {
      // «Верно» под точкой, посчитанной от начала линии (или от конца —
      // если колонна идёт к началу): значит, колонна шла оттуда — и в эту
      // смену, и во все свои до неё на этой линии.
      let from = back ? totalM : 0;
      for (const p of waiting) from = put(p, crew, from, metersOf(p), back);
      pending.delete(crew);
      put(e, crew, from, m, back);
      continue;
    }

    if (at !== undefined) {
      put(e, crew, at, m, back);
      continue;
    }
    pending.set(crew, [...waiting, e]);
  }
  for (const [crew, rest] of pending) for (const p of rest) drop(p, crew);

  // Смены, положенные по «Верно» задним числом, встали в список позже
  // чужих смен тех же дней — возвращаем порядок дней.
  const order = new Map(list.map((e, i) => [e.id, i]));
  const byDay = (a: { entryId: string }, b: { entryId: string }) =>
    (order.get(a.entryId) ?? 0) - (order.get(b.entryId) ?? 0);
  placed.sort(byDay);
  unplaced.sort(byDay);

  const last = placed[placed.length - 1];
  return {
    placed,
    unplaced,
    endM: last ? cursor.get(last.crew) ?? null : null,
    endByCrew: cursor,
    backByCrew: backward,
    totalM,
  };
}

/** Смены одной колонны, пройденные без места, — с первой из них и кладём. */
export interface UnplacedRun {
  crew: string;
  /** «1-колонна (Дозер)»; пусто — колонну в сменах не называли. */
  crewName: string;
  firstEntryId: string;
  fromDate: string;
  toDate: string;
  shifts: number;
  meters: number;
}

/**
 * Что из пройденного осталось без места — по колоннам.
 *
 * Место назначают первой смене колонны: остальные без отметок продолжают
 * её сами, тем же правилом, что и закраска. Без места остаются только
 * смены, которые колонна прошла до своей первой отметки, — поэтому
 * первая из них всегда и есть начало пути.
 */
export function unplacedRuns(pl: RoutePlacement, shifts: DailyWorkEntry[]): UnplacedRun[] {
  const byId = new Map(shifts.map((e) => [e.id, e]));
  const runs = new Map<string, UnplacedRun>();
  for (const u of pl.unplaced) {
    const run = runs.get(u.crew);
    if (run) {
      run.shifts += 1;
      run.meters += u.meters;
      if (u.date > run.toDate) run.toDate = u.date;
      continue;
    }
    const e = byId.get(u.entryId);
    runs.set(u.crew, {
      crew: u.crew,
      crewName: e ? crewLabel(e) : '',
      firstEntryId: u.entryId,
      fromDate: u.date,
      toDate: u.date,
      shifts: 1,
      meters: u.meters,
    });
  }
  return [...runs.values()];
}

/**
 * Отметка для первой смены колонны, если колонна начала в этой точке.
 *
 * Старым сменам «остановились здесь» никто уже не поставит: в тот вечер
 * формы с ней не было, а быстрая строка и таблица её не ставят вовсе.
 * Зато инженер знает, откуда колонна пошла: «от школы», «от ОМ». Этого
 * хватает — первая смена кончается на свои метры дальше, остальные идут
 * следом.
 *
 * `start === 'line'` — шли от начала линии: это согласие со счётом, как
 * «Верно» в форме, и при развороте линии оно уходит вслед за счётом.
 * `'line-end'` — от конца линии к началу: так идёт колонна навстречу.
 * Точка на карте — это место, и отметка ставится как поставленная рукой;
 * `back` у точки — от неё шли к началу линии.
 */
export type RunStart = { lat: number; lon: number; back?: boolean } | 'line' | 'line-end';

export function stopForRunStart(
  route: Pick<PlanRoute, 'id' | 'coords'>,
  first: DailyWorkEntry,
  start: RunStart,
): { stop: ShiftStop; fromM: number; deviationM: number } | null {
  if (route.coords.length < 2) return null;
  const totalM = routeLengthM(route.coords);
  const m = metersOf(first);
  if (start === 'line') {
    const at = pointAtDistanceM(route.coords, Math.min(totalM, m));
    if (!at) return null;
    return { stop: { routeId: route.id, lat: at.lat, lon: at.lon }, fromM: 0, deviationM: 0 };
  }
  if (start === 'line-end') {
    const at = pointAtDistanceM(route.coords, Math.max(0, totalM - m));
    if (!at) return null;
    return {
      stop: { routeId: route.id, lat: at.lat, lon: at.lon, back: true },
      fromM: totalM,
      deviationM: 0,
    };
  }
  const hit = nearestOnRoute(start, route.coords);
  if (!hit) return null;
  const endM = start.back ? Math.max(0, hit.atM - m) : Math.min(totalM, hit.atM + m);
  const at = pointAtDistanceM(route.coords, endM);
  if (!at) return null;
  return {
    stop: {
      routeId: route.id, lat: at.lat, lon: at.lon, manual: true,
      ...(start.back ? { back: true } : {}),
    },
    fromM: hit.atM,
    deviationM: hit.deviationM,
  };
}

/**
 * Что сказать после того, как место назначили.
 *
 * Точку ставят пальцем по карте, и промах мимо линии надо назвать:
 * место берём ближайшее на линии, а человек мог целиться в соседнюю.
 */
export function describeRunPlaced(o: {
  crewName: string;
  fromM: number;
  to?: string;
  deviationM: number;
}): string {
  const who = o.crewName ? `«${o.crewName}»` : 'колонны';
  const toward = o.to ? ` в сторону «${o.to}»` : '';
  const off = o.deviationM > SHIFT_SNAP_M
    ? ` Точка в ${meters(o.deviationM)} от линии — взято ближайшее место на ней.`
    : '';
  return `Смены ${who} легли от ${km(o.fromM)}${toward}.${off}`;
}

/**
 * Какие смены ложатся на эту трассу.
 *
 * Отметка в смене привязывает её к своей линии прямо: у села бывает
 * основная линия и отвод к школе, и смена, отмеченная на основной, на
 * отвод ложиться не должна. Отметка на линии, которой больше нет
 * (разрезали, удалили), ничего не привязывает — смена ищет трассу по селу.
 *
 * Смены без отметки: если известно, на какую линию села каждая ложится
 * (`lineOf`, см. routeMain.lineOfUnmarked), — только на неё. Иначе — на
 * трассы своего села, как раньше: тогда одну смену брали себе и основная
 * линия, и отвод, и альтернативный вариант, и карта показывала втрое
 * больше сделанного.
 */
export function shiftIndex(
  ground: DailyWorkEntry[],
  liveRouteIds?: Set<string>,
  lineOf?: Map<string, string>,
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
    const line = lineOf?.get(e.id);
    if (line) { push(byRoute, line, e); continue; }
    if (e.kato) push(byKato, e.kato, e);
  }
  return (routeId, kato) => [
    ...(byRoute.get(routeId) ?? []),
    ...(kato ? byKato.get(kato) ?? [] : []),
  ];
}

/**
 * На какую линию села легла точка «остановились здесь».
 *
 * Форма смены предлагает линию, на которой колонна стояла в последний
 * раз (или основную), а сегодня колонна могла уйти на отвод к школе.
 * Точку ставят пальцем рядом с отводом — значит, смена на отводе. Берём
 * ближайшую линию села в пределах промаха пальца; дальше от всех — та,
 * что предложена, и промах называется в подписи.
 */
export function lineForPoint(
  p: { lat: number; lon: number },
  lines: Pick<PlanRoute, 'id' | 'coords'>[],
  currentId: string,
): string {
  let best: { id: string; dev: number } | null = null;
  for (const r of lines) {
    const hit = nearestOnRoute(p, r.coords);
    if (!hit) continue;
    if (!best || hit.deviationM < best.dev) best = { id: r.id, dev: hit.deviationM };
  }
  return best && best.dev <= SHIFT_SNAP_M ? best.id : currentId;
}

export function shiftsOnRoute(
  routeId: string,
  kato: string | undefined,
  ground: DailyWorkEntry[],
  liveRouteIds?: Set<string>,
  lineOf?: Map<string, string>,
): DailyWorkEntry[] {
  return shiftIndex(ground, liveRouteIds, lineOf)(routeId, kato);
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
   * 'place' — от места прошлой смены этой колонны;
   * 'start' — колонна места на линии не называла ни разу, и считаем от её
   * начала. Это допущение, и человек должен его видеть до того, как
   * скажет «верно».
   */
  from: 'place' | 'start';
  /** День смены, от которой продолжаем. */
  afterDate?: string;
  /** На линии стоят другие колонны — от их места не считаем. */
  othersOnLine?: boolean;
  /** Колонна идёт к началу линии — сегодняшние метры откладываем назад. */
  back?: boolean;
  /** Длина линии — от её конца считаем колонну, идущую к началу. */
  totalM?: number;
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
 *
 * Считаем от смен своей колонны (`crew`): вторая колонна на том же селе
 * видела «прошлая смена кончилась на 9 км» — это место первой, — и «Верно»
 * записывало чужое место в её смену как подтверждённое.
 *
 * Направление — то, каким колонна шла (`back` не задан), или выбранное в
 * форме: бригада, идущая навстречу, считается от конца линии к началу.
 */
export function proposeStop(
  route: Pick<PlanRoute, 'id' | 'coords'>,
  shifts: DailyWorkEntry[],
  addedM: number,
  date?: string,
  crew?: Pick<DailyWorkEntry, 'contractor' | 'column'>,
  back?: boolean,
): StopProposal | null {
  if (route.coords.length < 2) return null;
  const before = date ? shifts.filter((e) => !e.date || e.date <= date) : shifts;
  const key = crew ? crewOf(crew) : null;
  const mine = key === null ? before : before.filter((e) => crewOf(e) === key);
  const pl = placeShifts(route, mine);
  const known = pl.endM !== null;
  const lastCrew = pl.placed[pl.placed.length - 1]?.crew;
  const goBack = back ?? (key !== null ? pl.backByCrew.has(key) : !!lastCrew && pl.backByCrew.has(lastCrew));
  const walked = Math.min(pl.totalM, pl.unplaced.reduce((s, u) => s + u.meters, 0));
  const beforeM = known
    ? (pl.endM as number)
    : goBack ? pl.totalM - walked : walked;
  const added = Math.max(0, addedM);
  const target = goBack ? beforeM - added : beforeM + added;
  const at = pointAtDistanceM(route.coords, target);
  if (!at) return null;
  const othersOnLine = key !== null && mine.length !== before.length
    && placeShifts(route, before).placed.some((p) => p.crew !== key);
  return {
    atM: Math.min(pl.totalM, Math.max(0, target)),
    lat: at.lat,
    lon: at.lon,
    atEnd: goBack ? target <= 0 : target >= pl.totalM,
    beforeM,
    from: known ? 'place' : 'start',
    afterDate: known ? pl.placed[pl.placed.length - 1]?.date : undefined,
    othersOnLine: othersOnLine || undefined,
    back: goBack || undefined,
    totalM: pl.totalM,
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
 *
 * Точку на участке ставит смена с отметкой, и стоит она там, где сейчас
 * колонна этой смены, — не та, что последней прошла без отметки.
 */
export function stopPositionM(
  route: Pick<PlanRoute, 'id' | 'coords'>,
  shifts: DailyWorkEntry[],
  p: Pick<SectionProgress, 'date' | 'doneM'>,
): number {
  const upto = shifts.filter((e) => (e.date ?? '') <= (p.date ?? ''));
  const pl = placeShifts(route, upto);
  const marked = new Set(upto.filter((e) => e.stop?.routeId === route.id).map((e) => e.id));
  for (let i = pl.placed.length - 1; i >= 0; i--) {
    if (!marked.has(pl.placed[i].entryId)) continue;
    const at = pl.endByCrew.get(pl.placed[i].crew);
    if (at !== undefined) return at;
  }
  return pl.endM ?? p.doneM;
}

const km = (m: number) => `${(Math.max(0, m) / 1000).toFixed(2).replace('.', ',')} км`;
const meters = (m: number) => `${Math.round(Math.max(0, m)).toLocaleString('ru')} м`;
const day = (iso?: string) => (iso ? iso.split('-').reverse().join('.') : '');

export interface StopTextInput {
  routeName: string;
  /** Подпись начала линии: «ОМ», «Зеренда». */
  startName?: string;
  /** Подпись конца линии — от него считаем колонну, идущую навстречу. */
  endName?: string;
  /** Чья смена — «1-колонна (Дозер)»; пусто — колонну не назвали. */
  crewName?: string;
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
  const p = s.proposal;
  const back = !!p.back;
  if (s.picked) {
    const a = back ? s.picked.atM : Math.max(0, s.picked.atM - s.addedM);
    const b = back ? s.picked.atM + s.addedM : s.picked.atM;
    const off = s.picked.deviationM > SHIFT_SNAP_M
      ? ` Точка в ${meters(s.picked.deviationM)} от линии — берём ближайшее место на ней.`
      : '';
    return `По отметке на карте: ${km(s.picked.atM)} от начала линии${start}. `
      + `Закрасим с ${km(a)} по ${km(b)}.${off}`;
  }
  const end = p.atEnd ? ` — трасса пройдена до ${back ? 'начала' : 'конца'}` : '';
  const crew = s.crewName ? ` колонны «${s.crewName}»` : '';
  if (p.from === 'place') {
    return `По трассе «${s.routeName}»: прошлая смена${crew}${p.afterDate ? ` (${day(p.afterDate)})` : ''} `
      + `кончилась на ${km(p.beforeM)}, за день ${meters(s.addedM)}${end}.`;
  }
  const who = s.crewName ? `где копала «${s.crewName}»` : 'где копали';
  const others = p.othersOnLine
    ? ' Места других колонн на этой линии отмечены, но от них не считаем: это их путь, а не ваш.'
    : '';
  const fromEnd = back
    ? `считаем от её конца${s.endName ? ` («${s.endName}»)` : ''} к началу`
    : `считаем от её начала${start}`;
  // Идущая от конца колонна стоит на «длина − пройдено» от начала.
  const walked = back ? Math.max(0, (p.totalM ?? p.beforeM) - p.beforeM) : p.beforeM;
  return `По трассе «${s.routeName}»: ${who}, на этой линии ещё не отмечали — `
    + `${fromEnd}: до сегодня ${meters(walked)}, за день ${meters(s.addedM)}${end}.${others} `
    + `Начали не с ${back ? 'конца' : 'начала'} — укажите на карте, где остановились: закрасим там, где копали.`;
}

/** Строка колонны на карточке трассы: чья, сколько и за какие дни. */
export function describeRun(run: UnplacedRun): string {
  const who = run.crewName ? `«${run.crewName}»` : 'Колонна не названа';
  const days = run.fromDate === run.toDate
    ? day(run.fromDate)
    : `${day(run.fromDate)}–${day(run.toDate)}`;
  const n = run.shifts;
  const shiftsWord = n % 10 === 1 && n % 100 !== 11 ? 'смена'
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'смены' : 'смен';
  return `${who}: ${n} ${shiftsWord}, ${meters(run.meters)} (${days})`;
}

/**
 * Пояснение к штриху на карточке трассы.
 *
 * Раньше оно советовало «отметьте в смене «остановились здесь»», а для
 * уже закрытых смен это невыполнимо: форма ставит отметку только новой
 * смене. Советуем то, что можно сделать, а где сделать нельзя — так и
 * говорим.
 *
 * `to` — куда идёт счёт: смены лягут от точки начала в эту сторону, и
 * если колонна шла навстречу, линию надо сперва развернуть.
 */
export function unplacedNote(m: number, o: { canPlace: boolean; to?: string }): string {
  const head = `Ещё ${meters(m)} пройдено, но где — в сменах не указано: на линии это штрих.`;
  if (!o.canPlace) {
    return `${head} Назначить место можно в рабочем месте «Стройка», с этой же карточки.`;
  }
  const toward = o.to ? ` в сторону «${o.to}»` : ' по счёту линии';
  return `${head} Укажите, откуда колонна начала: её смены лягут подряд от этого места${toward} `
    + 'или навстречу — у каждой колонны своё направление. '
    + 'Новым сменам место ставят в форме смены: «остановились здесь».';
}
