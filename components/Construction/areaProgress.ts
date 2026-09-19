import {
  MapArea, AreaKind, SnpProgress, SnpStage, StageStatus, SNP_STAGES,
} from '@/types/construction';
import { stageStatus, snpCompletion } from './stageTasks';
import { currentStage } from './snpMap';
import { normRegion, normName } from './areaImport';

/**
 * Ход работ поверх обведённых границ.
 *
 * Контур сам по себе — просто фигура. Ценность появляется, когда село
 * закрашивается по мере прохождения этапов, а район показывает, сколько
 * сёл в нём уже закрыто: тогда на карту можно смотреть вместо таблицы.
 */

export interface AreaMapItem {
  id: string;
  kind: AreaKind;
  name: string;
  coords: [number, number][];
  oblast?: string;
  rayon?: string;
  kato?: string;
  /** Файл, из которого пришёл контур: он же слой на карте. */
  source: string;
  /** Доля пройденных этапов, 0..1. null — по этой территории данных нет. */
  completion: number | null;
  /** Текущий этап села. Для района и области — null. */
  stage: SnpStage | null;
  status: StageStatus | null;
  /**
   * Сёла, узнанные в названии обводки. У перегона их два: «зеренди
   * серафимовка». Показываем оба, чтобы было видно, по какому из них
   * посчитано.
   */
  via?: string[];
  /** Сёл закрыто из скольких — для района и области. */
  doneSnp: number;
  totalSnp: number;
  activeSnp: number;
  blockedSnp: number;
}

/**
 * Село считается «внутри» района по названию, а не по геометрии: точных
 * координат у большинства сёл нет, зато район в записях подписан. Слово
 * «район» при сравнении отбрасывается — в KML оно есть, в журнале обычно нет.
 */
function matches(a: MapArea, p: SnpProgress): boolean {
  if (a.kind === 'rayon') {
    return !!p.rayon && normRegion(p.rayon) === normRegion(a.name);
  }
  if (a.kind === 'oblast') {
    return !!p.oblast && normRegion(p.oblast) === normRegion(a.name);
  }
  return false;
}

/**
 * Слишком короткие куски названия в поиск не берём: «до», «п», «к» — это
 * предлоги и сокращения, а не сёла.
 */
const MIN_TOKEN = 3;

/**
 * Одно и то же село в разных падежах: «до Серафимовки» — это Серафимовка.
 *
 * Полноценного склонения тут не нужно и не будет: достаточно того, что
 * названия расходятся только хвостом. Общее начало не меньше шести букв,
 * хвост не длиннее двух — «Серафимовки» и «Серафимовка» сойдутся, а
 * «Ивановка» и «Ивановский» останутся разными сёлами, как и должно быть.
 */
const STEM_MIN = 6;
const TAIL_MAX = 2;

export function sameSnpName(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= STEM_MIN && a.length - i <= TAIL_MAX && b.length - i <= TAIL_MAX;
}

/**
 * Обводка, подписанная двумя сёлами, — это перегон между ними: в файле их
 * подписывают «зеренди серафимовка». Такой контур целиком не совпадёт ни
 * с одним селом, и половина карты осталась бы серой.
 *
 * Правило то же, что у трасс: перегон принадлежит тому, куда он ведёт, —
 * последнему названному селу. Оба названия возвращаем, чтобы в карточке
 * было видно, по какому из них посчитано, а не «откуда-то взялось».
 */
function snpByTokens(
  name: string,
  byName: Map<string, SnpProgress | null>,
): { hit?: SnpProgress; via: string[] } {
  const tokens = name.toLowerCase().replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN);

  const hits: SnpProgress[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const key = normName(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Одноимённые сёла лежат в индексе как null: приписать контуру чужую
    // стройку хуже, чем оставить его серым.
    let p = byName.get(key);
    if (p === undefined) {
      // Точного совпадения нет — пробуем падеж: «до Серафимовки».
      for (const [k, v] of byName) {
        if (!sameSnpName(key, k)) continue;
        // Под правило подошли двое — значит, мы не знаем, кто из них.
        if (p !== undefined) { p = null; break; }
        p = v;
      }
    }
    if (p) hits.push(p);
  }
  return { hit: hits[hits.length - 1], via: hits.map((h) => h.snp) };
}

export function areaMapItems(areas: MapArea[], progress: SnpProgress[]): AreaMapItem[] {
  const byKato = new Map(progress.map((p) => [p.kato, p]));
  // Запасной ключ — имя: в KML обводка подписана как «с. Кусеп», а КАТО у
  // неё нет. Имена, встречающиеся дважды, в этот индекс не попадают: лучше
  // оставить контур без данных, чем приписать ему чужую стройку.
  const byName = new Map<string, SnpProgress | null>();
  for (const p of progress) {
    const key = normName(p.snp);
    if (!key) continue;
    byName.set(key, byName.has(key) ? null : p);
  }

  return areas.map((a) => {
    const base = {
      id: a.id, kind: a.kind, name: a.name, coords: a.coords,
      oblast: a.oblast, rayon: a.rayon, kato: a.kato, source: a.source,
    };

    if (a.kind === 'snp') {
      // Сначала целиком: «Красный Аул» — одно село, а не «красный» и «аул».
      const direct = (a.kato ? byKato.get(a.kato) : undefined)
        ?? byName.get(normName(a.name))
        ?? undefined;
      const tokens = direct ? null : snpByTokens(a.name, byName);
      const p = direct ?? tokens?.hit;
      if (!p) {
        return {
          ...base, completion: null, stage: null, status: null,
          doneSnp: 0, totalSnp: 0, activeSnp: 0, blockedSnp: 0,
        };
      }
      const stage = currentStage(p);
      return {
        ...base,
        via: tokens && tokens.via.length > 1 ? tokens.via : undefined,
        completion: snpCompletion(p),
        stage,
        status: stage ? stageStatus(p, stage) : 'done',
        doneSnp: snpCompletion(p) >= 1 ? 1 : 0,
        totalSnp: 1,
        activeSnp: SNP_STAGES.some((s) => stageStatus(p, s) === 'in_progress') ? 1 : 0,
        blockedSnp: SNP_STAGES.some((s) => stageStatus(p, s) === 'blocked') ? 1 : 0,
      };
    }

    // Район и область — это сумма сёл внутри. Считаем по названию: КАТО у
    // обводки нет, а район в записях подписан.
    const inside = progress.filter((p) => matches(a, p));
    if (inside.length === 0) {
      return {
        ...base, completion: null, stage: null, status: null,
        doneSnp: 0, totalSnp: 0, activeSnp: 0, blockedSnp: 0,
      };
    }
    const done = inside.filter((p) => snpCompletion(p) >= 1).length;
    const active = inside.filter(
      (p) => SNP_STAGES.some((s) => stageStatus(p, s) === 'in_progress'),
    ).length;
    const blocked = inside.filter(
      (p) => SNP_STAGES.some((s) => stageStatus(p, s) === 'blocked'),
    ).length;
    const completion = inside.reduce((s, p) => s + snpCompletion(p), 0) / inside.length;

    return {
      ...base,
      completion,
      stage: null,
      status: null,
      doneSnp: done,
      totalSnp: inside.length,
      activeSnp: active,
      blockedSnp: blocked,
    };
  });
}

/**
 * Цвет заливки по доле пройденного.
 *
 * Серый — данных нет, и это честнее зелёного «ничего не начато»: пустая
 * территория и нетронутая территория выглядят одинаково только у того, кто
 * не собирается туда ехать.
 */
export function areaColor(completion: number | null, blocked = false): string {
  if (blocked) return '#f87171';
  if (completion === null) return '#64748b';
  if (completion >= 1) return '#2dd4bf';
  if (completion >= 0.6) return '#4ade80';
  if (completion > 0) return '#fbbf24';
  return '#475569';
}

// ── Глубина по зуму ──────────────────────────────────────────────────────────

/**
 * Какие контуры показывать на этом приближении.
 *
 * Восемь десятков контуров разом — каша, в которой не видно ни трассы, ни
 * работы. Издали нужна область, ближе районы, ещё ближе сёла: так ведёт
 * себя любая карта, и так же об этом думает человек.
 *
 * Если в файле один уровень — показываем его на любом зуме. Прятать
 * единственное, что есть, незачем: человек решит, что контуры пропали.
 */
export function areaDepthFor(zoom: number): 0 | 1 | 2 {
  if (zoom < 8) return 0;
  if (zoom < 10) return 1;
  return 2;
}

const AREA_LEVEL: Record<AreaKind, 0 | 1 | 2> = { oblast: 0, rayon: 1, snp: 2 };

export function visibleAtZoom<T extends { kind: AreaKind }>(items: T[], zoom: number): T[] {
  const kinds = new Set(items.map((a) => a.kind));
  if (kinds.size <= 1) return items;
  const depth = areaDepthFor(zoom);
  return items.filter((a) => AREA_LEVEL[a.kind] <= depth);
}
