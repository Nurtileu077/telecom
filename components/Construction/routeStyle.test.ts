import { describe, it, expect } from 'vitest';
import {
  routeViews, parseEndpoints, furthestStage, routeTitle,
  STAGE_LINE_COLOR, PLAN_LINE_COLOR,
} from './routeStyle';
import type { PlanRoute, SnpProgress } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';
const done = { status: 'done' as const, doneAt: now };

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'r1', name: 'Шортанды Камышенка',
    coords: [[51, 71], [51.1, 71.2]], lengthM: 12000,
    source: 'plan.kml', createdAt: now, updatedAt: now, ...over,
  };
}

function snp(over: Partial<SnpProgress> = {}): SnpProgress {
  return { kato: '191', snp: 'Камышенка', stages: {}, updatedAt: now, ...over };
}

describe('самый дальний этап', () => {
  it('берётся последний пройденный, а не первый незакрытый', () => {
    const p = snp({ stages: { mkt: done, gnb: done, zaduvka: done } });
    expect(furthestStage(p)).toBe('zaduvka');
  });

  it('этап в работе тоже считается пройденным — работа там идёт', () => {
    const p = snp({ stages: { mkt: done, gnb: { status: 'in_progress' } } });
    expect(furthestStage(p)).toBe('gnb');
  });

  it('нетронутый СНП — этапа нет', () => {
    expect(furthestStage(snp())).toBeNull();
  });

  it('простой не считается пройденным этапом', () => {
    const p = snp({ stages: { mkt: { status: 'blocked', blockReason: 'Нет трубы' } } });
    expect(furthestStage(p)).toBeNull();
  });
});

describe('откуда и куда', () => {
  const known = new Set(['шортанды', 'камышенка', 'еленовка']);

  it('два села в названии — это направление', () => {
    expect(parseEndpoints('Шортанды Камышенка', known))
      .toEqual({ from: 'Шортанды', to: 'Камышенка' });
  });

  it('«до» указывает на конец пути', () => {
    expect(parseEndpoints('Путь до Камышенка', known)).toEqual({ to: 'Камышенка' });
  });

  it('одно село без «до» — это начало', () => {
    expect(parseEndpoints('Еленовка альтернативный путь', known)).toEqual({ from: 'Еленовка' });
  });

  it('незнакомое место после «до» всё равно конец: «Путь до Школы»', () => {
    expect(parseEndpoints('Путь до Школы', known)).toEqual({ to: 'Школы' });
  });

  it('служебные слова местами не считаются', () => {
    expect(parseEndpoints('альтернативный путь как на акте', known)).toEqual({});
  });

  it('пустое название ничего не выдумывает', () => {
    expect(parseEndpoints('', known)).toEqual({});
  });
});

describe('вид трассы', () => {
  it('без работ — пунктир и серый: это ещё проект', () => {
    const [v] = routeViews([route()], { progress: [] });
    expect(v.dashed).toBe(true);
    expect(v.color).toBe(PLAN_LINE_COLOR);
    expect(v.stage).toBeNull();
  });

  it('пошли метры — линия целая и цветом этапа', () => {
    const [v] = routeViews([route()], {
      progress: [snp({ stages: { mkt: done } })],
    });
    expect(v.dashed).toBe(false);
    expect(v.color).toBe(STAGE_LINE_COLOR.mkt);
    expect(v.stage).toBe('mkt');
  });

  it('задули кабель — цвет меняется', () => {
    const [v] = routeViews([route()], {
      progress: [snp({ stages: { mkt: done, gnb: done, zaduvka: done } })],
    });
    expect(v.color).toBe(STAGE_LINE_COLOR.zaduvka);
    expect(v.color).not.toBe(STAGE_LINE_COLOR.mkt);
  });

  it('село берётся по концу пути, а не по началу', () => {
    const [v] = routeViews([route({ name: 'Шортанды Камышенка' })], {
      progress: [snp({ kato: '191', snp: 'Камышенка', stages: { mkt: done } })],
    });
    expect(v.snp).toBe('Камышенка');
    expect(v.kato).toBe('191');
  });

  it('одноимённые сёла трассу не красят — чужая стройка хуже серой линии', () => {
    const [v] = routeViews([route({ name: 'Путь до Еленовка' })], {
      progress: [
        snp({ kato: '1', snp: 'Еленовка', stages: { mkt: done } }),
        snp({ kato: '2', snp: 'Еленовка', stages: { mkt: done } }),
      ],
    });
    expect(v.stage).toBeNull();
    expect(v.dashed).toBe(true);
  });

  it('участок из KML тоже годится для привязки', () => {
    const [v] = routeViews([route({ name: 'Путь без названия', uchastok: 'Камышенка' })], {
      progress: [snp({ snp: 'Камышенка', stages: { mkt: done } })],
    });
    expect(v.stage).toBe('mkt');
  });

  it('длина и источник не теряются', () => {
    const [v] = routeViews([route()], { progress: [] });
    expect(v.lengthM).toBe(12000);
    expect(v.source).toBe('plan.kml');
  });
});

describe('подпись', () => {
  const base = { id: 'r', coords: [], lengthM: 0, source: 's', stage: null, color: '', dashed: true };

  it('«откуда → куда», когда известно и то и другое', () => {
    expect(routeTitle({ ...base, name: 'x', from: 'Шортанды', to: 'Камышенка' }))
      .toBe('Шортанды → Камышенка');
  });

  it('только конец — стрелка слева', () => {
    expect(routeTitle({ ...base, name: 'x', to: 'Школа' })).toBe('→ Школа');
  });

  it('ничего не разобрали — остаётся название', () => {
    expect(routeTitle({ ...base, name: 'альтернативный путь' })).toBe('альтернативный путь');
  });
});
