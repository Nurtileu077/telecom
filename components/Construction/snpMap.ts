import {
  SnpProgress, SnpStage, SNP_STAGES, StageStatus,
  DrillLogEntry, PlanRoute, prevStage,
} from '@/types/construction';
import { stageState, stageStatus, snpCompletion } from './stageTasks';

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

export function snpMapPoints(progress: SnpProgress[], ctx: SnpMapContext = {}): SnpMapPoint[] {
  // Проколы — точка с поля, поэтому они в приоритете над проектом.
  const byKato = new Map<string, { lat: number; lon: number }[]>();
  for (const d of ctx.drills ?? []) {
    if (!d.kato) continue;
    const list = byKato.get(d.kato) ?? [];
    for (const pt of d.points) list.push({ lat: pt.lat, lon: pt.lon });
    if (list.length) byKato.set(d.kato, list);
  }

  // Проектные трассы ключуем по имени: КАТО в KML не бывает.
  const byName = new Map<string, { lat: number; lon: number }[]>();
  for (const r of ctx.planRoutes ?? []) {
    const label = normName(r.uchastok || r.folder || r.name || '');
    if (label.length < 3 || r.coords.length === 0) continue;
    const list = byName.get(label) ?? [];
    // Середина трассы ближе к селу, чем её край: край уходит в поле.
    const mid = r.coords[Math.floor(r.coords.length / 2)];
    list.push({ lat: mid[0], lon: mid[1] });
    byName.set(label, list);
  }

  const out: SnpMapPoint[] = [];
  for (const p of progress) {
    let pos = centroid(byKato.get(p.kato) ?? []);
    let from: SnpMapPoint['from'] = 'drill';
    if (!pos) {
      const key = normName(p.snp);
      let hits = key.length >= 3 ? byName.get(key) : undefined;
      if (!hits && key.length >= 4) {
        // Частичное совпадение — только когда имя длинное: короткие
        // основы («Уй», «Ащы») склеивают разные сёла в одну точку.
        for (const [name, list] of byName) {
          if (name.includes(key) || key.includes(name)) { hits = list; break; }
        }
      }
      pos = centroid(hits ?? []);
      from = 'plan';
    }
    if (!pos) continue;

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
