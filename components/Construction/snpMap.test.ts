import { describe, it, expect } from 'vitest';
import { snpMapPoints, currentStage, unplacedCount } from './snpMap';
import type { SnpProgress, DrillLogEntry, PlanRoute } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function snp(over: Partial<SnpProgress> = {}): SnpProgress {
  return {
    kato: '191', snp: 'Еленовка', oblast: 'Акмолинская область',
    rayon: 'Аршалынский', stages: {}, updatedAt: now, ...over,
  };
}

const done = { status: 'done' as const, doneAt: now };

function drill(over: Partial<DrillLogEntry> = {}): DrillLogEntry {
  return {
    kind: 'drill', id: 'd1', date: '2026-09-11', smu: '', oblast: '', uchastok: '',
    kato: '191', drillKind: 'ГНБ', meters: 72, count: 1,
    points: [{ lat: 51.0, lon: 71.0 }],
    createdAt: now, updatedAt: now, ...over,
  };
}

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'r1', name: 'Еленовка', uchastok: 'Еленовка',
    coords: [[51.5, 71.5], [51.6, 71.6], [51.7, 71.7]],
    lengthM: 1000, source: 'plan.kml', createdAt: now, updatedAt: now, ...over,
  };
}

describe('текущий этап СНП', () => {
  it('этап в работе важнее первого незакрытого', () => {
    const p = snp({ stages: { mkt: done, gnb: { status: 'in_progress' } } });
    expect(currentStage(p)).toBe('gnb');
  });

  it('без активного — первый незакрытый', () => {
    expect(currentStage(snp({ stages: { mkt: done } }))).toBe('gnb');
  });

  it('всё закрыто — этапа нет', () => {
    const p = snp({
      stages: { mkt: done, gnb: done, zaduvka: done, podves: done, svarka: done, sdacha: done },
    });
    expect(currentStage(p)).toBeNull();
  });
});

describe('СНП на карте', () => {
  it('координату берёт из проколов по КАТО', () => {
    const pts = snpMapPoints([snp()], { drills: [drill()] });
    expect(pts).toHaveLength(1);
    expect(pts[0].lat).toBeCloseTo(51.0, 5);
    expect(pts[0].from).toBe('drill');
  });

  it('несколько проколов усредняются в одну точку села', () => {
    const d = drill({ points: [{ lat: 51.0, lon: 71.0 }, { lat: 51.2, lon: 71.4 }] });
    const pts = snpMapPoints([snp()], { drills: [d] });
    expect(pts[0].lat).toBeCloseTo(51.1, 5);
    expect(pts[0].lon).toBeCloseTo(71.2, 5);
  });

  it('без проколов берёт середину проектной трассы по имени', () => {
    const pts = snpMapPoints([snp()], { planRoutes: [route()] });
    expect(pts[0].from).toBe('plan');
    expect(pts[0].lat).toBeCloseTo(51.6, 5);
  });

  it('имя сверяется по буквам: «с. ЕЛЕНОВКА (МКТ)» — та же Еленовка', () => {
    const pts = snpMapPoints([snp()], { planRoutes: [route({ uchastok: 'с. ЕЛЕНОВКА (МКТ)' })] });
    expect(pts).toHaveLength(1);
    expect(pts[0].from).toBe('plan');
  });

  it('поле важнее проекта: при обоих источниках берём прокол', () => {
    const pts = snpMapPoints([snp()], { drills: [drill()], planRoutes: [route()] });
    expect(pts[0].from).toBe('drill');
    expect(pts[0].lat).toBeCloseTo(51.0, 5);
  });

  it('без координат СНП на карту не ставим — место не выдумываем', () => {
    const pts = snpMapPoints([snp({ kato: '999', snp: 'Безымянное' })], { drills: [drill()] });
    expect(pts).toHaveLength(0);
  });

  it('короткое имя не склеивает разные сёла', () => {
    const pts = snpMapPoints(
      [snp({ kato: '777', snp: 'Уй' })],
      { planRoutes: [route({ uchastok: 'Уялы' })] },
    );
    expect(pts).toHaveLength(0);
  });

  it('передан фронт — точка помечена ожиданием', () => {
    const pts = snpMapPoints([snp({ stages: { mkt: done } })], { drills: [drill()] });
    expect(pts[0].stage).toBe('gnb');
    expect(pts[0].waiting).toBe(true);
  });

  it('непочатый СНП не считается ожидающим — это бэклог', () => {
    const pts = snpMapPoints([snp()], { drills: [drill()] });
    expect(pts[0].stage).toBe('mkt');
    expect(pts[0].waiting).toBe(false);
  });

  it('простой переносит причину на карту', () => {
    const p = snp({ stages: { mkt: { status: 'blocked', blockReason: 'Нет трубы' } } });
    const pts = snpMapPoints([p], { drills: [drill()] });
    expect(pts[0].status).toBe('blocked');
    expect(pts[0].blockReason).toBe('Нет трубы');
  });

  it('закрытый СНП показывает полную готовность', () => {
    const p = snp({
      stages: { mkt: done, gnb: done, zaduvka: done, podves: done, svarka: done, sdacha: done },
    });
    const pts = snpMapPoints([p], { drills: [drill()] });
    expect(pts[0].stage).toBeNull();
    expect(pts[0].completion).toBe(1);
  });

  it('считает, сколько СНП осталось без места', () => {
    const rows = [snp(), snp({ kato: '999', snp: 'Безымянное' })];
    const pts = snpMapPoints(rows, { drills: [drill()] });
    expect(unplacedCount(rows, pts)).toBe(1);
  });
});
