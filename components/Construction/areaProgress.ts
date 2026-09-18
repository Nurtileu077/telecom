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
  /** Доля пройденных этапов, 0..1. null — по этой территории данных нет. */
  completion: number | null;
  /** Текущий этап села. Для района и области — null. */
  stage: SnpStage | null;
  status: StageStatus | null;
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
      oblast: a.oblast, rayon: a.rayon, kato: a.kato,
    };

    if (a.kind === 'snp') {
      const p = (a.kato ? byKato.get(a.kato) : undefined)
        ?? byName.get(normName(a.name))
        ?? undefined;
      if (!p) {
        return {
          ...base, completion: null, stage: null, status: null,
          doneSnp: 0, totalSnp: 0, activeSnp: 0, blockedSnp: 0,
        };
      }
      const stage = currentStage(p);
      return {
        ...base,
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
