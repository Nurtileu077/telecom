import {
  Crew, DailyWorkEntry, AerialWorkEntry, DrillLogEntry, PlanRoute, SnpProgress, MapArea,
  SettlementOrder,
} from '@/types/construction';
import { placeFinder, SnpMapContext } from './snpMap';
import type { RouteView } from './routeStyle';
import { crewOf } from './shiftPlace';
import { shiftLines } from './shiftLines';
import { pointAtDistanceM } from './routeProgress';

/**
 * Колонна встаёт туда, откуда она отчиталась.
 *
 * Двигать бригады руками по карте каждый день никто не будет — метки
 * замрут на месте первой расстановки и начнут врать. А отчёт бригада и
 * так сдаёт ежедневно, и в нём написано, на каком участке она работала.
 * Значит, место колонны уже известно: его нужно взять, а не спрашивать.
 *
 * Место на линии у каждой колонны своё — тем же счётом, что и закраска
 * (см. shiftPlace): где кончилась её последняя смена с известным местом.
 * Раньше точка бралась одна на село, и две бригады, идущие навстречу, на
 * карте стояли в одной точке, где нет ни одной. А на магистрали между
 * сёлами КАТО нет вовсе, и «остановились здесь» там молча пропадало: точка
 * хранилась по селу. Теперь место берётся из самих смен и их линий.
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
  /** Линия, на которой стоит колонна, и метры от её начала. */
  routeId?: string;
  atM?: number;
  /** Идёт к началу линии. */
  back?: boolean;
  /**
   * Смена, которой кончилось это место: перетащить метку колонны по её
   * линии — значит поправить «остановились здесь» этой смены.
   */
  entryId?: string;
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
  /** Трассы — по ним видно, куда колонна идёт. */
  planRoutes?: PlanRoute[];
  progress?: SnpProgress[];
  /** Обводки сёл и районов — по ним среди сёл-тёзок видно, чья трасса. */
  areas?: MapArea[];
  /** Реестр: сёла из него узнаются в названиях трасс так же, как на карте. */
  orders?: SettlementOrder[];
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
  /** Смена подземки — по ней ищется место на линии. */
  ground?: DailyWorkEntry;
}

function visits(ctx: CrewPlaceContext, live: Set<string>): Visit[] {
  const out: Visit[] = [];
  const push = (e: {
    date: string; kato: string; uchastok: string; oblast?: string;
    rayon?: string; column?: string; contractor?: string;
  }, ground?: DailyWorkEntry) => {
    // Без КАТО смена тоже говорит, где колонна, если отмечена на линии:
    // на магистрали между сёлами КАТО нет вовсе.
    const onLine = !!ground?.stop?.routeId && live.has(ground.stop.routeId);
    if (!e.date || (!e.kato && !onLine)) return;
    out.push({
      date: e.date, kato: e.kato, uchastok: e.uchastok,
      oblast: e.oblast, rayon: e.rayon, column: e.column, contractor: e.contractor, ground,
    });
  };
  for (const e of ctx.ground) push(e, e);
  for (const a of ctx.aerial) push(a);
  for (const d of ctx.drills) push(d);
  // В один день — подземка с отметкой раньше прочего: по ней место точнее.
  return out.sort((a, b) => b.date.localeCompare(a.date)
    || Number(!!b.ground?.stop) - Number(!!a.ground?.stop)
    || (b.ground?.createdAt ?? '').localeCompare(a.ground?.createdAt ?? ''));
}

/**
 * Момент отчёта в шкале ручных правок: дата без времени считается концом
 * дня, иначе утренний отчёт всегда проигрывал бы вчерашнему перетаскиванию.
 */
function reportMoment(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/**
 * Места колонн на линиях — одним расчётом на всех: по линии placeShifts
 * считается один раз, а колонн на ней бывает несколько.
 */
function lineFinder(ctx: CrewPlaceContext) {
  const lines = shiftLines({ ...ctx, planRoutes: ctx.planRoutes ?? [] });
  return {
    progress: lines.progress,
    /** Где на линии стоит колонна этой смены — или null, если места она не называла. */
    at(e: DailyWorkEntry): {
      route: PlanRoute; view?: RouteView; atM: number; back: boolean; entryId?: string;
    } | null {
      const routeId = lines.lineOf(e);
      if (!routeId) return null;
      const pl = lines.placement(routeId);
      const crew = crewOf(e);
      const atM = pl?.endByCrew.get(crew);
      const route = lines.route(routeId);
      if (!pl || atM === undefined || !route) return null;
      const mine = pl.placed.filter((p) => p.crew === crew);
      return {
        route,
        view: lines.view(routeId),
        atM,
        back: pl.backByCrew.has(crew),
        entryId: mine[mine.length - 1]?.entryId,
      };
    },
    /** Основная линия села — куда колонна идёт, если места на линии не знаем. */
    mainOf(kato: string): RouteView | undefined {
      const id = lines.mainOf(kato);
      return id ? lines.view(id) : undefined;
    },
  };
}

export function placeCrews(
  crews: Crew[],
  ctx: CrewPlaceContext,
): (Crew & { placement?: CrewPlacement; trip?: CrewTrip })[] {
  const lines = lineFinder(ctx);
  const findPlace = placeFinder({ ...ctx, progress: lines.progress });
  const all = visits(ctx, new Set((ctx.planRoutes ?? []).map((r) => r.id)));

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

    // Место на линии точнее центра села: колонна стоит там, где
    // остановилась, а не посередине населённого пункта. И стоит она там,
    // где кончилась её смена, — не соседней колонны того же села.
    const along = last.ground ? lines.at(last.ground) : null;
    const point = along ? pointAtDistanceM(along.route.coords, along.atM) : null;
    const place = point
      ? { lat: point.lat, lon: point.lon }
      : last.kato ? findPlace(last.kato, last.uchastok) : null;
    if (!place) return manual ? { ...c, placement: manual } : c;

    // Откуда вышла: предыдущее село по её же отчётам. Если колонна не
    // переезжала, остаётся начало трассы — оно тоже отвечает на вопрос.
    const prev = all.find((v) => matchesCrew(v, c) && v.kato !== last.kato);
    const view = along?.view ?? (last.kato ? lines.mainOf(last.kato) : undefined);
    const back = !!along?.back;
    const trip: CrewTrip | undefined = view && {
      // Колонна, идущая к началу линии, идёт к её «откуда».
      from: back ? view.to : view.from,
      to: back ? view.from : view.to,
      route: view.name,
      leftM: along ? Math.max(0, Math.round(back ? along.atM : view.lengthM - along.atM)) : undefined,
    };

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
        date: last.date,
        uchastok: last.uchastok, kato: last.kato || undefined,
        oblast: last.oblast, rayon: last.rayon,
        ...(along ? {
          routeId: along.route.id, atM: Math.round(along.atM),
          back: along.back || undefined, entryId: along.entryId,
        } : {}),
      },
    };
  });
}
