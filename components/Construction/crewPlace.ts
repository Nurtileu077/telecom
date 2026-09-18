import {
  Crew, DailyWorkEntry, AerialWorkEntry, DrillLogEntry, PlanRoute, SnpProgress,
} from '@/types/construction';
import { placeFinder, SnpMapContext } from './snpMap';
import { routeViews } from './routeStyle';

/**
 * Колонна встаёт туда, откуда она отчиталась.
 *
 * Двигать бригады руками по карте каждый день никто не будет — метки
 * замрут на месте первой расстановки и начнут врать. А отчёт бригада и
 * так сдаёт ежедневно, и в нём написано, на каком участке она работала.
 * Значит, место колонны уже известно: его нужно взять, а не спрашивать.
 *
 * Ручная расстановка не отменяется: если колонну передвинули позже, чем
 * пришёл последний отчёт, остаётся рука. Отчёт новее — побеждает отчёт.
 */

export interface CrewPlacement {
  lat: number;
  lon: number;
  /**
   * 'progress' — по метражу вдоль трассы (точнее всего),
   * 'report' — по участку последнего отчёта,
   * 'manual' — поставлена рукой.
   */
  source: 'progress' | 'report' | 'manual';
  /** Дата отчёта, по которому встала. */
  date?: string;
  uchastok?: string;
  kato?: string;
  oblast?: string;
  rayon?: string;
}

/**
 * Откуда и куда едет колонна.
 *
 * Вопрос «где её ждать» задают каждый день, и отвечает на него не точка на
 * карте, а направление. Откуда вышли — видно по её же отчётам: предыдущее
 * село, из которого она отчитывалась. Куда идёт — по трассе, на которой
 * стоит: у трассы есть конец, и до него остались метры.
 */
export interface CrewTrip {
  /** Откуда вышла — предыдущий участок по отчётам или начало трассы. */
  from?: string;
  /** Куда идёт — конец трассы. */
  to?: string;
  /** Название трассы, по которой идёт. */
  route?: string;
  /** Сколько осталось до конца трассы, метры. */
  leftM?: number;
}

export interface CrewPlaceContext extends SnpMapContext {
  ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[];
  drills: DrillLogEntry[];
  /** Докуда дошли по трассе — точка вернее центра села. */
  sectionProgress?: Record<string, { lat: number; lon: number; date: string; doneM: number }>;
  /** Трассы — по ним видно, куда колонна идёт. */
  planRoutes?: PlanRoute[];
  progress?: SnpProgress[];
}

/** Сопоставление «эта запись — про эту колонну». */
function matchesCrew(
  e: { column?: string; contractor?: string; smu?: string },
  crew: Crew,
): boolean {
  const norm = (v?: string) => (v ?? '').trim().toLowerCase();
  const name = norm(crew.name);
  if (name && norm(e.column) === name) return true;
  // Колонна без номера в отчётах опознаётся по подрядчику: у субподрядчика
  // обычно одна бригада своего вида на область.
  const contractor = norm(crew.contractor);
  return !!contractor && norm(e.contractor) === contractor;
}

/** Все дневные записи как «где были» — с датой и местом. */
interface Visit {
  date: string;
  kato: string;
  uchastok: string;
  oblast?: string;
  rayon?: string;
  column?: string;
  contractor?: string;
}

function visits(ctx: CrewPlaceContext): Visit[] {
  const out: Visit[] = [];
  const push = (e: {
    date: string; kato: string; uchastok: string; oblast?: string;
    rayon?: string; column?: string; contractor?: string;
  }) => {
    if (!e.date || !e.kato) return;
    out.push({
      date: e.date, kato: e.kato, uchastok: e.uchastok,
      oblast: e.oblast, rayon: e.rayon, column: e.column, contractor: e.contractor,
    });
  };
  for (const e of ctx.ground) push(e);
  for (const a of ctx.aerial) push(a);
  for (const d of ctx.drills) push(d);
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Момент отчёта в шкале ручных правок: дата без времени считается концом
 * дня, иначе утренний отчёт всегда проигрывал бы вчерашнему перетаскиванию.
 */
function reportMoment(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/**
 * Трасса, по которой сейчас идёт колонна, — самая длинная у этого села.
 * Коротких отводов на селе несколько, но едет колонна по основной.
 */
function tripFinder(ctx: CrewPlaceContext) {
  const routes = ctx.planRoutes ?? [];
  if (routes.length === 0) return () => undefined;
  const views = routeViews(routes, { progress: ctx.progress ?? [] });
  const byKato = new Map<string, (typeof views)[number]>();
  for (const v of views) {
    if (!v.kato) continue;
    const prev = byKato.get(v.kato);
    if (!prev || v.lengthM > prev.lengthM) byKato.set(v.kato, v);
  }

  return (kato: string, doneM?: number): CrewTrip | undefined => {
    const v = byKato.get(kato);
    if (!v) return undefined;
    const left = doneM === undefined ? undefined : Math.max(0, Math.round(v.lengthM - doneM));
    return { from: v.from, to: v.to, route: v.name, leftM: left };
  };
}

export function placeCrews(
  crews: Crew[],
  ctx: CrewPlaceContext,
): (Crew & { placement?: CrewPlacement; trip?: CrewTrip })[] {
  const findPlace = placeFinder(ctx);
  const findTrip = tripFinder(ctx);
  const all = visits(ctx);

  return crews.map((c) => {
    const last = all.find((v) => matchesCrew(v, c));
    const manual = typeof c.lat === 'number' && typeof c.lon === 'number'
      ? { lat: c.lat, lon: c.lon, source: 'manual' as const }
      : null;

    if (!last) return manual ? { ...c, placement: manual } : c;

    // Рука новее отчёта — значит, бригаду только что перекинули, и отчёт
    // за прошлый день не должен утаскивать метку обратно.
    if (manual && c.updatedAt && c.updatedAt > reportMoment(last.date)) {
      return { ...c, placement: manual };
    }

    // Продвижение по трассе точнее центра села: колонна стоит там, где
    // остановилась, а не посередине населённого пункта.
    const along = ctx.sectionProgress?.[last.kato];
    const place = along
      ? { lat: along.lat, lon: along.lon, from: 'drill' as const }
      : findPlace(last.kato, last.uchastok);
    if (!place) return manual ? { ...c, placement: manual } : c;

    // Откуда вышла: предыдущее село по её же отчётам. Если колонна не
    // переезжала, остаётся начало трассы — оно тоже отвечает на вопрос.
    const prev = all.find((v) => matchesCrew(v, c) && v.kato !== last.kato);
    const trip = findTrip(last.kato, along?.doneM);

    return {
      ...c,
      trip: trip && { ...trip, from: prev?.uchastok || trip.from },
      lat: place.lat,
      lon: place.lon,
      // Область и участок подтягиваем из отчёта: иначе в карточке останется
      // место прошлого заезда, и колонна будет числиться не там, где она есть.
      oblast: last.oblast || c.oblast,
      rayon: last.rayon || c.rayon,
      uchastok: last.uchastok || c.uchastok,
      placement: {
        lat: place.lat, lon: place.lon,
        source: along ? 'progress' : 'report',
        date: along?.date ?? last.date,
        uchastok: last.uchastok, kato: last.kato,
        oblast: last.oblast, rayon: last.rayon,
      },
    };
  });
}
