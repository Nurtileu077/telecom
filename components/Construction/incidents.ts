import {
  Incident, IncidentCause, DailyWorkEntry, Deviation, SiteObject,
  LAY_METHODS, LAY_METHOD_LABEL, DESIGN_DEPTH_M,
} from '@/types/construction';
import { haversineM } from '@/components/Network/KMeans';

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
  /** Кто вёл работы. */
  contractor?: string;
  /** Когда строили. */
  builtAt?: string;
  /** Причина отклонения, если здесь оно было. */
  deviation?: string;
  /** Ближайший объект сети. */
  object?: SiteObject;
}

export interface IncidentContextInput {
  ground: DailyWorkEntry[];
  deviations: Deviation[];
  objects: SiteObject[];
}

/**
 * Что известно про это место по журналу стройки.
 *
 * Ищем по двум признакам: по координатам (отклонения и объекты сняты с
 * точкой) и по селу (дневные записи точки не имеют, но КАТО у них есть).
 * Чего не нашли — того не пишем: «глубина 1,2 м» без основания в такой
 * карточке опаснее пустоты.
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

  // Как строили: по селу. Берём последнюю смену с метрами — она и есть
  // та, что дошла до этого места.
  const here = ctx.ground
    .filter((e) => (i.kato && e.kato === i.kato)
      || (!!i.uchastok && e.uchastok.trim().toLowerCase() === i.uchastok.trim().toLowerCase()))
    .filter((e) => LAY_METHODS.some((m) => (e.byMethod[m] ?? 0) > 0))
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  if (here) {
    const best = LAY_METHODS
      .map((m) => ({ m, v: here.byMethod[m] ?? 0 }))
      .sort((a, b) => b.v - a.v)[0];
    if (best?.v) out.method = LAY_METHOD_LABEL[best.m];
    out.contractor = here.contractor || here.smu || undefined;
    out.builtAt = here.date;
  }

  if (out.depthM === undefined && (here || obj)) {
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
