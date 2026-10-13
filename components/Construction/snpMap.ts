import {
  SnpProgress, SnpStage, SNP_STAGES, StageStatus,
  DrillLogEntry, PlanRoute, MapArea, prevStage,
} from '@/types/construction';
import { stageState, stageStatus, snpCompletion } from './stageTasks';
import { routeViews } from './routeStyle';

/**
 * Этапы на карте.
 *
 * Список этапов отвечает на вопрос «что закрыто», карта — на вопрос «где».
 * Прораб думает вторым: ему нужно видеть, что ГНБ ждёт вот в этих трёх сёлах
 * вдоль одной дороги, а не искать их по КАТО в таблице.
 *
 * Координат у населённого пункта в журнале нет — их там никогда и не было.
 * Поэтому точку берём из того, что уже привязано к месту: из проколов ГНБ
 * (у них координаты с поля) и из проектных трасс KML. Если ни того, ни
 * другого нет, СНП на карту не ставим — выдумывать место нельзя.
 */

export interface SnpMapPoint {
  kato: string;
  snp: string;
  oblast?: string;
  rayon?: string;
  lat: number;
  lon: number;
  /** Этап, на котором сейчас стоит СНП. null — всё закрыто. */
  stage: SnpStage | null;
  status: StageStatus;
  blockReason?: string;
  /** Доля закрытых этапов, 0..1. */
  completion: number;
  /** Фронт передан и его не взяли: предыдущий этап закрыт, этот — нет. */
  waiting: boolean;
  /** Откуда координата — чтобы не выдавать привязку за замер. */
  from: 'drill' | 'plan';
}

/** Точность у источников разная, и об этом стоит говорить прямо. */
export const SNP_POINT_SOURCE: Record<SnpMapPoint['from'], string> = {
  drill: 'по проколам ГНБ',
  plan: 'по проектной трассе',
};

/**
 * Имена в журнале и в KML пишут по-разному: «Еленовка», «с. Еленовка»,
 * «ЕЛЕНОВКА (МКТ)». Сравниваем по буквам, остальное отбрасываем.
 */
function normName(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
}

function centroid(pts: { lat: number; lon: number }[]): { lat: number; lon: number } | null {
  const ok = pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (ok.length === 0) return null;
  const lat = ok.reduce((s, p) => s + p.lat, 0) / ok.length;
  const lon = ok.reduce((s, p) => s + p.lon, 0) / ok.length;
  return { lat, lon };
}

export interface SnpMapContext {
  drills?: DrillLogEntry[];
  planRoutes?: PlanRoute[];
  /**
   * Сёла журнала: по ним трасса узнаёт своё село, а среди тёзок — по
   * обводкам, папкам района и проколам (см. routeVillage).
   */
  progress?: SnpProgress[];
  areas?: MapArea[];
}

/**
 * Текущий этап СНП: тот, что в работе; если такого нет — первый незакрытый.
 * Так на карте видно место очереди, а не последний успех.
 */
export function currentStage(p: SnpProgress): SnpStage | null {
  return SNP_STAGES.find((s) => stageStatus(p, s) === 'in_progress')
    ?? SNP_STAGES.find((s) => stageStatus(p, s) !== 'done')
    ?? null;
}

export interface KatoPlace {
  lat: number;
  lon: number;
  from: SnpMapPoint['from'];
}

/**
 * Где искать место населённого пункта.
 *
 * Отдельная функция, потому что место нужно не только доске этапов: по
 * нему же ставится колонна, отчитавшаяся за этот участок.
 */
export function placeFinder(ctx: SnpMapContext = {}): (kato: string, snp?: string) => KatoPlace | null {
  // Проколы — точка с поля, поэтому они в приоритете над проектом.
  const byKato = new Map<string, { lat: number; lon: number }[]>();
  for (const d of ctx.drills ?? []) {
    if (!d.kato) continue;
    const list = byKato.get(d.kato) ?? [];
    for (const pt of d.points) list.push({ lat: pt.lat, lon: pt.lon });
    if (list.length) byKato.set(d.kato, list);
  }

  // Середина трассы ближе к селу, чем её край: край уходит в поле.
  const mid = (coords: [number, number][]) => {
    const m = coords[Math.floor(coords.length / 2)];
    return { lat: m[0], lon: m[1] };
  };

  // Трассы — по селу, к которому они привязаны. Раньше ключом было имя,
  // и два Акбулака из разных районов складывали свои трассы в одну
  // кучу: точка села вставала посередине между ними, где нет ни того,
  // ни другого.
  const routes = (ctx.planRoutes ?? []).filter((r) => r.coords.length > 0);
  const views = routeViews(routes, {
    progress: ctx.progress ?? [], areas: ctx.areas, drills: ctx.drills,
  });
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const boundByKato = new Map<string, { lat: number; lon: number }[]>();
  const byName = new Map<string, { lat: number; lon: number }[]>();
  for (const v of views) {
    const r = routeById.get(v.id);
    if (!r) continue;
    if (v.kato) {
      const list = boundByKato.get(v.kato) ?? [];
      list.push(mid(r.coords));
      boundByKato.set(v.kato, list);
      continue;
    }
    // Трасса ничья, потому что её село — тёзка другого: по имени её не
    // берём никому, иначе снова склеим.
    if (v.namesakes?.length) continue;
    const label = normName(r.uchastok || r.folder || r.name || '');
    if (label.length < 3) continue;
    const list = byName.get(label) ?? [];
    list.push(mid(r.coords));
    byName.set(label, list);
  }

  // Имена, которые носят несколько сёл журнала: по имени их не ищем.
  const namesakes = new Set<string>();
  const seen = new Set<string>();
  for (const p of ctx.progress ?? []) {
    const key = normName(p.snp);
    if (!key) continue;
    if (seen.has(key)) namesakes.add(key); else seen.add(key);
  }

  return (kato: string, snp?: string): KatoPlace | null => {
    const drill = centroid(byKato.get(kato) ?? []);
    if (drill) return { ...drill, from: 'drill' };

    const bound = centroid(boundByKato.get(kato) ?? []);
    if (bound) return { ...bound, from: 'plan' };

    const key = normName(snp ?? '');
    if (key.length < 3 || namesakes.has(key)) return null;
    let hits = byName.get(key);
    if (!hits && key.length >= 4) {
      // Частичное совпадение — только когда имя длинное: короткие
      // основы («Уй», «Ащы») склеивают разные сёла в одну точку.
      for (const [name, list] of byName) {
        if (namesakes.has(name)) continue;
        if (name.includes(key) || key.includes(name)) { hits = list; break; }
      }
    }
    const plan = centroid(hits ?? []);
    return plan ? { ...plan, from: 'plan' } : null;
  };
}

export function snpMapPoints(progress: SnpProgress[], ctx: SnpMapContext = {}): SnpMapPoint[] {
  const findPlace = placeFinder({ ...ctx, progress: ctx.progress ?? progress });

  const out: SnpMapPoint[] = [];
  for (const p of progress) {
    const place = findPlace(p.kato, p.snp);
    if (!place) continue;
    const pos = { lat: place.lat, lon: place.lon };
    const from = place.from;

    const stage = currentStage(p);
    const st = stage ? stageState(p, stage) : { status: 'done' as StageStatus };
    const before = stage ? prevStage(stage) : null;
    out.push({
      kato: p.kato, snp: p.snp, oblast: p.oblast, rayon: p.rayon,
      lat: pos.lat, lon: pos.lon,
      stage,
      status: st.status,
      blockReason: st.blockReason,
      completion: snpCompletion(p),
      waiting: !!stage && st.status === 'not_started'
        && !!before && stageStatus(p, before) === 'done',
      from,
    });
  }
  return out;
}

/** Сколько СНП не удалось поставить на карту — это не ошибка, а пробел в данных. */
export function unplacedCount(progress: SnpProgress[], points: SnpMapPoint[]): number {
  return Math.max(0, progress.length - points.length);
}
