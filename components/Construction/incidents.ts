import {
  Incident, IncidentCause, DailyWorkEntry, Deviation, SiteObject, PlanRoute, LayMethod,
  LAY_METHODS, LAY_METHOD_LABEL, DESIGN_DEPTH_M,
} from '@/types/construction';
import { haversineM } from '@/components/Network/KMeans';
import { nearestOnRoute } from './measureTool';
import { shiftLines, type ShiftLinesContext } from './shiftLines';
import { crewLabel, crewOf } from './shiftPlace';

/**
 * Аварии и то, что о них уже известно.
 *
 * Обычная система учёта аварий знает про аварию только саму аварию: где,
 * когда, кто чинил. Здесь под ней лежит вся стройка: на какой глубине
 * труба в этом месте, каким способом её клали, кто, и не было ли тут
 * отклонения. Это тот самый случай, ради которого стоило вести журнал —
 * «кабель на 0,5 м, потому что скальник» читается через три года той
 * бригадой, которая приехала на обрыв.
 *
 * Карта проблемных мест собирается из того же: если по одному месту
 * трижды «экскаватор», там нет знаков, а не «не везёт».
 */

/** Насколько близко считать «тем же местом». */
export const SAME_SPOT_M = 300;

export function isOpen(i: Incident): boolean {
  return !i.fixedAt;
}

export function openIncidents(list: Incident[]): Incident[] {
  return list.filter(isOpen)
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}

/**
 * Часы на устранение.
 *
 * Если их проставили руками — верим руке: она знает про дорогу и про то,
 * что бригада выехала не сразу. Иначе считаем по времени заявки и
 * закрытия, и это честное приближение, а не выдумка.
 */
export function incidentHours(i: Incident): number | null {
  if (i.hours !== undefined) return i.hours;
  if (!i.fixedAt) return null;
  const a = Date.parse(i.reportedAt);
  const b = Date.parse(i.fixedAt);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round(((b - a) / 3_600_000) * 10) / 10;
}

/** Что уже случалось в этом месте — история, а не список за период. */
export function nearbyIncidents(
  list: Incident[],
  lat: number,
  lon: number,
  radiusM = SAME_SPOT_M,
  exceptId?: string,
): Incident[] {
  return list
    .filter((i) => i.id !== exceptId && haversineM(lat, lon, i.lat, i.lon) <= radiusM)
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}

// ── Контекст стройки под аварией ─────────────────────────────────────────────

export interface IncidentContext {
  /** Глубина заложения в этом месте, м. */
  depthM?: number;
  /** Откуда она известна. */
  depthFrom?: 'отклонение' | 'объект' | 'проект';
  /** Каким способом клали. */
  method?: string;
  /** В смене несколько способов, и где какой — не записано. */
  methodMixed?: boolean;
  /** Кто вёл работы. */
  contractor?: string;
  /** Колонна. */
  column?: string;
  /** Когда строили; с `builtTo` — с какого по какой день. */
  builtAt?: string;
  builtTo?: string;
  /**
   * Откуда известно, как строили: 'place' — смена, закрасившая это место
   * на линии; 'village' — по селу: место смен на линии не названо, и
   * сказать можно только то, что в селе было одно на всех; 'elsewhere' —
   * место всех смен линии названо, и это место среди них не значится: по
   * журналу здесь не копали.
   */
  builtFrom?: 'place' | 'village' | 'elsewhere';
  /** Линия под аварией и место на ней, метры от начала. */
  routeName?: string;
  atM?: number;
  /**
   * Кто работал в селе, когда по месту смену не найти, — «1-колонна
   * (Дозер), 01.07–20.07». Без «это они», только кто там был.
   */
  crews?: string[];
  /** Причина отклонения, если здесь оно было. */
  deviation?: string;
  /** Ближайший объект сети. */
  object?: SiteObject;
}

export interface IncidentContextInput extends Partial<Omit<ShiftLinesContext, 'ground'>> {
  ground: DailyWorkEntry[];
  deviations: Deviation[];
  objects: SiteObject[];
}

/** Как далеко от линии авария ещё считается аварией на ней — промах телефона. */
export const INCIDENT_ON_LINE_M = 100;

const dayRu = (iso: string) => iso.split('-').reverse().join('.');

function methodsOf(e: DailyWorkEntry): LayMethod[] {
  return LAY_METHODS.filter((m) => (e.byMethod[m] ?? 0) > 0);
}

/** Кто работал: «1-колонна (Дозер), 01.07.2026–20.07.2026». */
function crewsOf(shifts: DailyWorkEntry[]): string[] {
  const by = new Map<string, { name: string; from: string; to: string }>();
  for (const e of shifts) {
    const name = crewLabel(e) || e.smu || 'колонна не названа';
    const key = crewOf(e) + e.smu;
    const prev = by.get(key);
    if (!prev) { by.set(key, { name, from: e.date, to: e.date }); continue; }
    if (e.date < prev.from) prev.from = e.date;
    if (e.date > prev.to) prev.to = e.date;
  }
  return [...by.values()]
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((c) => `${c.name}, ${c.from === c.to ? dayRu(c.from) : `${dayRu(c.from)}–${dayRu(c.to)}`}`);
}

/**
 * Смена, закрасившая место аварии.
 *
 * Обрыв на 3-м км, а карточка называла последнюю смену села — её способ,
 * подрядчика и день, хотя 3-й км копали другие и раньше. Место смены на
 * линии знает закраска (см. shiftPlace), и авария берёт оттуда же: линия
 * рядом с точкой аварии, место на ней и смена, которая его закрасила.
 */
function builtHere(
  i: Incident,
  ctx: IncidentContextInput,
): {
  shift?: DailyWorkEntry;
  routeName: string;
  atM: number;
  lineShifts: DailyWorkEntry[];
  /** Смены линии, место которых не названо, — только они и могли копать здесь. */
  unplaced: DailyWorkEntry[];
} | null {
  const routes = ctx.planRoutes ?? [];
  if (routes.length === 0) return null;
  let best: { route: PlanRoute; atM: number; dev: number } | null = null;
  for (const r of routes) {
    const hit = nearestOnRoute({ lat: i.lat, lon: i.lon }, r.coords);
    if (hit && hit.deviationM <= INCIDENT_ON_LINE_M && (!best || hit.deviationM < best.dev)) {
      best = { route: r, atM: hit.atM, dev: hit.deviationM };
    }
  }
  if (!best) return null;
  const lines = shiftLines({ ...ctx, planRoutes: routes });
  const pl = lines.placement(best.route.id);
  const lineShifts = lines.shiftsOn(best.route.id);
  const byId = new Map(lineShifts.map((e) => [e.id, e]));
  // Место закрашено несколькими сменами (отметка разошлась с метрами) —
  // берём первую: трубу кладут один раз, позднее — это счёт, а не работа.
  const cover = (pl?.placed ?? [])
    .filter((p) => p.fromM - 1 <= best!.atM && best!.atM <= p.toM + 1)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  // Линии нет места (меньше двух точек) — место ни одной смены не известно.
  // Метры за концом линии лежат не на ней: здесь они копать не могли.
  const unknownIds = pl
    ? new Set(pl.unplaced.filter((u) => !u.pastEnd).map((u) => u.entryId))
    : new Set(lineShifts.map((e) => e.id));
  return {
    shift: cover ? byId.get(cover.entryId) : undefined,
    routeName: best.route.name || best.route.uchastok || 'трасса',
    atM: best.atM,
    lineShifts,
    unplaced: lineShifts.filter((e) => unknownIds.has(e.id)),
  };
}

/**
 * Что известно про это место по журналу стройки.
 *
 * Глубину и отклонение ищем по координатам — они сняты с точкой. Как
 * строили — по смене, закрасившей это место на линии. Если место смен не
 * названо, говорим только то, что в селе было одно на всех (один способ,
 * один подрядчик), а иначе перечисляем, кто там работал, — без «это
 * они». Если место всех смен линии названо, а это место не закрашено ни
 * одной, — по журналу здесь не копали, и никого не называем. Чего не
 * нашли — того не пишем: «глубина 1,2 м» или «копал такой-то» без
 * основания в такой карточке опаснее пустоты.
 */
export function incidentContext(
  i: Incident,
  ctx: IncidentContextInput,
  radiusM = SAME_SPOT_M,
): IncidentContext {
  const out: IncidentContext = {};

  // Отклонение рядом — самое точное, что может быть про глубину.
  const dev = ctx.deviations
    .filter((d) => d.coords?.length
      && d.coords.some((c) => haversineM(i.lat, i.lon, c.lat, c.lon) <= radiusM))
    .sort((a, b) => b.date.localeCompare(a.date))[0]
    ?? (i.kato
      ? ctx.deviations.filter((d) => d.kato === i.kato && d.kind === 'depth')
        .sort((a, b) => b.date.localeCompare(a.date))[0]
      : undefined);

  if (dev) {
    out.deviation = dev.reason;
    if (dev.actualDepthM !== undefined) {
      out.depthM = dev.actualDepthM;
      out.depthFrom = 'отклонение';
    }
  }

  // Объект сети рядом: у муфты может быть записана своя глубина.
  const obj = ctx.objects
    .map((o) => ({ o, d: haversineM(i.lat, i.lon, o.lat, o.lon) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)[0]?.o;
  if (obj) {
    out.object = obj;
    if (out.depthM === undefined && obj.depthM !== undefined) {
      out.depthM = obj.depthM;
      out.depthFrom = 'объект';
    }
  }

  const laid = (e: DailyWorkEntry) => methodsOf(e).length > 0;
  const here = builtHere(i, ctx);
  let built = false;
  if (here) {
    out.routeName = here.routeName;
    out.atM = Math.round(here.atM);
  }
  if (here?.shift) {
    const e = here.shift;
    const methods = methodsOf(e);
    out.method = methods.map((m) => LAY_METHOD_LABEL[m]).join(' / ');
    out.methodMixed = methods.length > 1 || undefined;
    out.contractor = e.contractor || e.smu || undefined;
    out.column = e.column || undefined;
    out.builtAt = e.date;
    out.builtFrom = 'place';
    built = true;
  } else if (here && here.lineShifts.some(laid) && !here.unplaced.some(laid)) {
    // Место каждой смены линии названо, и ни одна сюда не легла: обрыв на
    // 3-м км, а по журналу копали 5–9 км. Раньше карточка шла дальше по
    // селу и называла подрядчика, способ и даты «строили …» — то есть
    // приписывала аварию тем, кто здесь по журналу не копал. Не знаем —
    // так и пишем; проектную глубину тоже не ставим: она ожидание для
    // построенного места, а построенным это место журнал не называет.
    out.builtFrom = 'elsewhere';
  } else {
    // Место смен на линии не названо — по линии, а нет линии — по селу.
    // Смены линии с названным местом здесь не копали: кандидаты — только
    // те, чьё место не известно.
    const pool = (here?.lineShifts.length ? here.unplaced : ctx.ground.filter((e) => (
      (i.kato && e.kato === i.kato)
      || (!!i.uchastok && e.uchastok.trim().toLowerCase() === i.uchastok.trim().toLowerCase())
    ))).filter(laid);
    if (pool.length) {
      built = true;
      out.builtFrom = 'village';
      const methods = new Set(pool.flatMap(methodsOf));
      if (methods.size === 1) out.method = LAY_METHOD_LABEL[[...methods][0]];
      const who = new Set(pool.map((e) => e.contractor || e.smu || ''));
      if (who.size === 1 && [...who][0]) out.contractor = [...who][0];
      const dates = pool.map((e) => e.date).sort();
      out.builtAt = dates[0];
      if (dates[dates.length - 1] !== dates[0]) out.builtTo = dates[dates.length - 1];
      const crews = crewsOf(pool);
      if (crews.length > 1) out.crews = crews;
    }
  }

  if (out.depthM === undefined && (built || obj) && out.builtFrom !== 'elsewhere') {
    // Проектная глубина — не факт, а ожидание. Так и подписываем.
    out.depthM = DESIGN_DEPTH_M;
    out.depthFrom = 'проект';
  }

  return out;
}

// ── Карта проблемных мест ────────────────────────────────────────────────────

export interface ProblemSpot {
  lat: number;
  lon: number;
  count: number;
  /** Самая частая причина в этом месте. */
  topCause?: IncidentCause;
  /** Последняя авария здесь. */
  lastAt: string;
  incidents: Incident[];
  place?: string;
}

/**
 * Места, где рвётся чаще одного раза.
 *
 * Кластеризация самая простая — по расстоянию до уже найденного места:
 * аварий на сети десятки, а не десятки тысяч, и усложнять тут нечего.
 * Одиночные аварии в проблемные места не попадают: одна авария — это
 * событие, а не закономерность.
 */
export function problemSpots(list: Incident[], radiusM = SAME_SPOT_M): ProblemSpot[] {
  const spots: ProblemSpot[] = [];

  for (const i of [...list].sort((a, b) => a.reportedAt.localeCompare(b.reportedAt))) {
    if (!Number.isFinite(i.lat) || !Number.isFinite(i.lon)) continue;
    const hit = spots.find((s) => haversineM(s.lat, s.lon, i.lat, i.lon) <= radiusM);
    if (hit) {
      hit.incidents.push(i);
      hit.count += 1;
      hit.lastAt = i.reportedAt > hit.lastAt ? i.reportedAt : hit.lastAt;
      hit.place = hit.place || i.uchastok;
      continue;
    }
    spots.push({
      lat: i.lat, lon: i.lon, count: 1,
      lastAt: i.reportedAt, incidents: [i], place: i.uchastok,
    });
  }

  for (const s of spots) {
    const byCause = new Map<IncidentCause, number>();
    for (const i of s.incidents) {
      if (!i.cause) continue;
      byCause.set(i.cause, (byCause.get(i.cause) ?? 0) + 1);
    }
    s.topCause = [...byCause.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  return spots
    .filter((s) => s.count > 1)
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

export interface IncidentStats {
  total: number;
  open: number;
  /** Среднее время устранения, часы. */
  avgHours: number | null;
  byCause: { cause: IncidentCause; count: number }[];
  spots: number;
}

export function incidentStats(list: Incident[], radiusM = SAME_SPOT_M): IncidentStats {
  const hours = list.map(incidentHours).filter((h): h is number => h !== null);
  const byCause = new Map<IncidentCause, number>();
  for (const i of list) {
    if (!i.cause) continue;
    byCause.set(i.cause, (byCause.get(i.cause) ?? 0) + 1);
  }
  return {
    total: list.length,
    open: list.filter(isOpen).length,
    avgHours: hours.length
      ? Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 10) / 10
      : null,
    byCause: [...byCause.entries()]
      .map(([cause, count]) => ({ cause, count }))
      .sort((a, b) => b.count - a.count),
    spots: problemSpots(list, radiusM).length,
  };
}
