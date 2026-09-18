import { DrillLogEntry, CrossingKind, DrillPoint } from '@/types/construction';

/**
 * Проколы: план и факт.
 *
 * Метки на карте рождаются здесь, а не приходят из обследования. Тот, кто
 * колет, сначала отмечает, что берёт на сегодня и на неделю, а потом
 * закрывает прокол по факту — с координатами входа и выхода. Разметка
 * годовой давности показывала бы вчерашний день сегодняшним: трасса за
 * время стройки меняется не раз.
 */

/** Запланирован, но ещё не сделан. */
export function isPlanned(d: DrillLogEntry): boolean {
  return d.status === 'planned';
}

/** Сделан: статус закрыт либо запись пришла из журнала до появления статусов. */
export function isDone(d: DrillLogEntry): boolean {
  return d.status !== 'planned';
}

/** Длина прокола по координатам, метры. */
export function drillLengthM(points: DrillPoint[]): number {
  if (points.length < 2) return 0;
  const R = 6371000;
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    sum += R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  return Math.round(sum);
}

export interface DrillPlanFilter {
  /** 'today' — на сегодня, 'week' — на ближайшую неделю, 'all' — весь план. */
  horizon?: 'today' | 'week' | 'all';
  oblast?: string;
  rayon?: string;
  today?: string;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * План проколов.
 *
 * Без даты прокол считается «когда-нибудь» и в сегодняшний список не
 * попадает: иначе в нём окажется всё, что когда-либо наметили, и смотреть
 * туда перестанут.
 */
export function plannedDrills(
  drills: DrillLogEntry[],
  opts: DrillPlanFilter = {},
): DrillLogEntry[] {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const horizon = opts.horizon ?? 'all';
  const weekEnd = addDays(today, 7);

  return drills
    .filter(isPlanned)
    .filter((d) => (!opts.oblast || d.oblast === opts.oblast))
    .filter((d) => (!opts.rayon || d.rayon === opts.rayon))
    .filter((d) => {
      if (horizon === 'all') return true;
      const when = d.plannedFor;
      if (!when) return false;
      if (horizon === 'today') return when <= today;
      return when <= weekEnd;
    })
    .sort((a, b) => (a.plannedFor ?? '9999').localeCompare(b.plannedFor ?? '9999'));
}

export interface DrillSummary {
  planned: number;
  plannedToday: number;
  done: number;
  doneMeters: number;
  /** Сделанные проколы без координат — на карту их не поставить. */
  doneWithoutCoords: number;
  byCrossing: { kind: CrossingKind; count: number; meters: number }[];
}

export function drillSummary(
  drills: DrillLogEntry[],
  today = new Date().toISOString().slice(0, 10),
): DrillSummary {
  const byCrossing = new Map<CrossingKind, { count: number; meters: number }>();
  let done = 0;
  let doneMeters = 0;
  let doneWithoutCoords = 0;

  for (const d of drills) {
    if (!isDone(d)) continue;
    done++;
    doneMeters += d.meters || 0;
    if (d.points.length < 2) doneWithoutCoords++;
    for (const c of d.crossings ?? []) {
      const cur = byCrossing.get(c) ?? { count: 0, meters: 0 };
      cur.count++;
      cur.meters += d.meters || 0;
      byCrossing.set(c, cur);
    }
  }

  return {
    planned: drills.filter(isPlanned).length,
    plannedToday: plannedDrills(drills, { horizon: 'today', today }).length,
    done,
    doneMeters,
    doneWithoutCoords,
    byCrossing: [...byCrossing.entries()]
      .map(([kind, v]) => ({ kind, ...v }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * История проколов по месту.
 *
 * Через три года сюда придёт аварийная бригада, и вопрос будет один:
 * что здесь под землёй и кто это делал.
 */
export function drillHistory(
  drills: DrillLogEntry[],
  kato: string,
): DrillLogEntry[] {
  return drills
    .filter((d) => d.kato === kato && isDone(d))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}
