import {
  PlanRoute, SnpProgress, SnpStage, SNP_STAGES,
} from '@/types/construction';
import { stageStatus } from './stageTasks';
import { normName } from './areaImport';

/**
 * Как выглядит трасса на карте.
 *
 * Пунктир говорит «так задумано», сплошная — «так лежит». Пока по участку
 * не было ни одной записи, трасса остаётся пунктиром: это ещё проект.
 * Появились метры — линия становится целой и красится по тому, как далеко
 * зашли: труба проложена — один цвет, кабель задут — другой.
 *
 * Название разбирается на «откуда — куда»: в файле так и подписано —
 * «Шортанды Камышенка», «Путь до Школы». Читать это человеку понятнее,
 * чем «Трасса 137».
 */

/** Цвет по самому дальнему пройденному этапу. */
export const STAGE_LINE_COLOR: Record<SnpStage, string> = {
  mkt: '#fbbf24',      // труба проложена
  gnb: '#fbbf24',      // проколы идут по той же трубе
  zaduvka: '#38bdf8',  // кабель задут
  podves: '#a78bfa',   // подвес
  svarka: '#4ade80',   // сварено
  sdacha: '#2dd4bf',   // сдано
};

/** Ещё не начинали — это проект, а не факт. */
export const PLAN_LINE_COLOR = '#94a3b8';

export interface RouteView {
  id: string;
  name: string;
  coords: [number, number][];
  lengthM: number;
  source: string;
  /** Откуда и куда — разобрано из названия. */
  from?: string;
  to?: string;
  /** Связанный населённый пункт, если название удалось узнать. */
  kato?: string;
  snp?: string;
  /** Самый дальний этап, до которого дошли. null — работ не было. */
  stage: SnpStage | null;
  color: string;
  /** Пунктир — проект; сплошная — построено. */
  dashed: boolean;
}

/**
 * Самый дальний пройденный этап.
 *
 * Именно он задаёт цвет: если кабель уже задут, линия должна быть цветом
 * задувки, даже когда следующий этап ещё не начат.
 */
export function furthestStage(p: SnpProgress): SnpStage | null {
  let last: SnpStage | null = null;
  for (const s of SNP_STAGES) {
    const st = stageStatus(p, s);
    if (st === 'done' || st === 'in_progress') last = s;
  }
  return last;
}

/** Слова, которые в названии трассы не являются именем места. */
const STOP_WORDS = new Set([
  'путь', 'дорога', 'до', 'от', 'к', 'по', 'как', 'на', 'акте', 'акту',
  'альтернативный', 'альтернатива', 'связи', 'с', 'в', 'и', 'без', 'названия',
  'существующий', 'сущ', 'ом', 'трасса', 'участок', 'новый', 'новая',
]);

/**
 * Разбор названия на «откуда — куда».
 *
 * Сначала ищем известные сёла: «Шортанды Камышенка» — это два села, и
 * порядок в названии и есть направление. Если нашлось одно и рядом стоит
 * «до», это конец пути; иначе — начало.
 */
export function parseEndpoints(
  name: string,
  known: Set<string>,
): { from?: string; to?: string } {
  const raw = name.trim();
  if (!raw) return {};

  const words = raw.split(/[^a-zA-Zа-яА-ЯёЁ0-9-]+/).filter(Boolean);
  const hits: { word: string; index: number }[] = [];
  words.forEach((w, i) => {
    const key = normName(w);
    if (!key || STOP_WORDS.has(w.toLowerCase())) return;
    if (known.has(key)) hits.push({ word: w, index: i });
  });

  if (hits.length >= 2) {
    return { from: hits[0].word, to: hits[hits.length - 1].word };
  }

  if (hits.length === 1) {
    const before = words[hits[0].index - 1]?.toLowerCase();
    return before === 'до' || before === 'к'
      ? { to: hits[0].word }
      : { from: hits[0].word };
  }

  // Ни одного известного села: «Путь до Школы» — конец всё равно назван.
  const doIdx = words.findIndex((w) => w.toLowerCase() === 'до');
  if (doIdx >= 0 && words[doIdx + 1]) return { to: words[doIdx + 1] };
  return {};
}

export interface RouteStyleContext {
  progress: SnpProgress[];
}

export function routeViews(routes: PlanRoute[], ctx: RouteStyleContext): RouteView[] {
  const byName = new Map<string, SnpProgress | null>();
  for (const p of ctx.progress) {
    const key = normName(p.snp);
    if (!key) continue;
    // Одноимённые сёла в индекс не берём: покрасить трассу по чужой
    // стройке хуже, чем оставить её серой.
    byName.set(key, byName.has(key) ? null : p);
  }
  const known = new Set(byName.keys());

  return routes.map((r) => {
    const label = r.name || r.uchastok || r.folder || '';
    const ends = parseEndpoints(label, known);

    // Село ищем по обоим концам: трасса принадлежит тому, куда её ведут.
    const candidates = [ends.to, ends.from, r.uchastok, r.folder]
      .filter((v): v is string => !!v);
    let snp: SnpProgress | null = null;
    for (const c of candidates) {
      const hit = byName.get(normName(c));
      if (hit) { snp = hit; break; }
    }

    const stage = snp ? furthestStage(snp) : null;
    return {
      id: r.id,
      name: label || 'Трасса',
      coords: r.coords,
      lengthM: r.lengthM,
      source: r.source,
      from: ends.from,
      to: ends.to,
      kato: snp?.kato,
      snp: snp?.snp,
      stage,
      color: stage ? STAGE_LINE_COLOR[stage] : PLAN_LINE_COLOR,
      dashed: stage === null,
    };
  });
}

/** Подпись «Шортанды → Камышенка» или просто название. */
export function routeTitle(v: RouteView): string {
  if (v.from && v.to) return `${v.from} → ${v.to}`;
  if (v.to) return `→ ${v.to}`;
  if (v.from) return `${v.from} →`;
  return v.name;
}
