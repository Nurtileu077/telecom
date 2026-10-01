import { describe, it, expect } from 'vitest';
import type { PlanRoute, SiteObject, SnpProgress } from '@/types/construction';
import {
  emptyJournal, addPlanRoutes, reversePlanRoute, swapRouteEnds, restoreShape,
  updateRouteCoords, realignProgress, type JournalState,
} from './journalStore';
import { routeViews, countFromText } from './routeStyle';
import { buildScheme } from './asBuilt';
import { advanceAlong } from './routeProgress';
import { changeFeed } from './changeLog';

/**
 * Проектировщик нарисовал линию от села к магистрали, а бригада идёт от
 * магистрали: счёт метров, стрелки и подписи концов перевёрнуты — в
 * исполнительной схеме тоже.
 *
 * Линия по экватору на восток: первая точка — село Акбеит, последняя —
 * магистраль (ОМ). Название, как обычно, «от магистрали к селу».
 */
const now = '2026-09-18T00:00:00.000Z';
const FILE_COORDS: [number, number][] = [[0, 0], [0, 0.005], [0, 0.01]];

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'r1', name: 'ОМ — Акбеит', uchastok: 'Акбеит',
    coords: FILE_COORDS, lengthM: 1113,
    source: 'plan.kml', createdAt: now, updatedAt: now, ...over,
  };
}

function withRoute(over: Partial<PlanRoute> = {}): JournalState {
  return {
    ...emptyJournal(),
    planRoutes: [route(over)],
    sectionProgress: {
      // Посчитанная по метрам точка: 300 м от начала линии.
      111: { routeId: 'r1', doneM: 300, lat: 0, lon: 0.0027, date: '2026-09-01' },
      // Поставленная человеком — где колонна на самом деле.
      222: { routeId: 'r1', doneM: 500, lat: 0, lon: 0.0055, date: '2026-09-01', manual: true },
      // Чужая трасса — не трогаем.
      333: { routeId: 'r2', doneM: 100, lat: 1, lon: 1, date: '2026-09-01' },
    },
  };
}

describe('разворот трассы', () => {
  it('точки встают в обратном порядке, и счёт идёт от другого конца', () => {
    const j = reversePlanRoute(withRoute(), 'r1', 'Инженер');
    const r = j.planRoutes[0];
    expect(r.coords).toEqual([...FILE_COORDS].reverse());
    expect(r.reversed).toBe(true);
    // 100 м от начала — теперь у магистрали, а не у села.
    const at = advanceAlong(r, 0, 100)!;
    expect(at.lon).toBeGreaterThan(0.009);
  });

  it('второй разворот возвращает порядок файла и снимает отметку', () => {
    const twice = reversePlanRoute(reversePlanRoute(withRoute(), 'r1', 'И'), 'r1', 'И');
    expect(twice.planRoutes[0].coords).toEqual(FILE_COORDS);
    expect(twice.planRoutes[0].reversed).toBeUndefined();
  });

  it('посчитанная точка колонны переезжает вслед за счётом, поставленная человеком — нет', () => {
    const j = reversePlanRoute(withRoute(), 'r1', 'И');
    const calc = j.sectionProgress['111'];
    // 300 м от магистрали: ≈ 0,0073° на экваторе.
    expect(calc.lon).toBeGreaterThan(0.0071);
    expect(calc.lon).toBeLessThan(0.0075);
    expect(calc.doneM).toBe(300);
    expect(j.sectionProgress['222']).toEqual(withRoute().sectionProgress['222']);
    expect(j.sectionProgress['333']).toEqual(withRoute().sectionProgress['333']);
  });

  it('пройденные метры от разворота не меняются: это сумма смен', () => {
    const j = reversePlanRoute(withRoute(), 'r1', 'И');
    expect(j.sectionProgress['111'].doneM).toBe(300);
    expect(j.planRoutes[0].lengthM).toBe(1113);
  });

  it('трасса из одной точки не разворачивается и не ломается', () => {
    const base = withRoute({ coords: [[0, 0]] });
    expect(reversePlanRoute(base, 'r1', 'И')).toBe(base);
  });

  it('разворот оставляет след в журнале изменений, и его можно вернуть', () => {
    const j = reversePlanRoute(withRoute(), 'r1', 'Инженер');
    const ch = j.changes![0];
    expect(ch.kind).toBe('route_reverse');
    expect(ch.reversedBefore).toBe(false);
    const feed = changeFeed(j).find((f) => f.changeId === ch.id)!;
    expect(feed.text).toContain('счёт трассы развёрнут');
    expect(feed.restorable).toBe(true);

    const back = restoreShape(j, ch.id, 'Инженер');
    expect(back.planRoutes[0].coords).toEqual(FILE_COORDS);
    expect(back.planRoutes[0].reversed).toBeUndefined();
    // Точка колонны вернулась туда, где была до разворота.
    expect(back.sectionProgress['111'].lon).toBeCloseTo(0.0027, 3);
  });

  it('«как было» до разворота не забывает, что трасса уже была развёрнута', () => {
    const turned = reversePlanRoute(withRoute(), 'r1', 'И');
    const edited = updateRouteCoords(turned, 'r1', [[0, 0.01], [0, 0]], { author: 'И', lengthM: 1113 });
    const editId = edited.changes![0].id;
    expect(edited.changes![0].reversedBefore).toBe(true);
    const back = restoreShape(edited, editId, 'И');
    expect(back.planRoutes[0].reversed).toBe(true);
    expect(back.planRoutes[0].coords).toEqual([...FILE_COORDS].reverse());
  });

  it('повторная загрузка того же файла не разворачивает счёт обратно молча', () => {
    const turned = reversePlanRoute(withRoute(), 'r1', 'И');
    const again = addPlanRoutes(turned, [route()]);
    expect(again.planRoutes[0].reversed).toBe(true);
    expect(again.planRoutes[0].coords).toEqual([...FILE_COORDS].reverse());
  });

  it('трасса, пришедшая уже с отметкой, второй раз не разворачивается', () => {
    const turned = reversePlanRoute(withRoute(), 'r1', 'И');
    const fromBackup = turned.planRoutes[0];
    const again = addPlanRoutes(turned, [fromBackup]);
    expect(again.planRoutes[0].coords).toEqual(fromBackup.coords);
  });

  it('новая трасса из файла приходит как нарисована', () => {
    const j = addPlanRoutes(emptyJournal(), [route()]);
    expect(j.planRoutes[0].coords).toEqual(FILE_COORDS);
    expect(j.planRoutes[0].reversed).toBeUndefined();
  });
});

describe('realignProgress', () => {
  it('без затронутых точек отдаёт то же самое, а не копию', () => {
    const p = withRoute().sectionProgress;
    expect(realignProgress(p, 'нет-такой', FILE_COORDS)).toBe(p);
  });
});

describe('подписи концов', () => {
  const known: SnpProgress[] = [
    { kato: '1', snp: 'Шортанды', stages: {}, updatedAt: now },
    { kato: '2', snp: 'Камышенка', stages: {}, updatedAt: now },
  ];

  it('подписи идут по названию: первое слово — на начало счёта', () => {
    const [v] = routeViews([route({ name: 'Шортанды Камышенка' })], { progress: known });
    expect(v.from).toBe('Шортанды');
    expect(v.to).toBe('Камышенка');
  });

  it('название против хода работ — подписи меняют местами, название не трогаем', () => {
    const j = swapRouteEnds(withRoute({ name: 'Шортанды Камышенка' }), 'r1', 'И');
    expect(j.planRoutes[0].name).toBe('Шортанды Камышенка');
    expect(j.planRoutes[0].endsSwapped).toBe(true);
    const [v] = routeViews(j.planRoutes, { progress: known });
    expect(v.from).toBe('Камышенка');
    expect(v.to).toBe('Шортанды');
    expect(j.changes![0].kind).toBe('route_ends');
  });

  it('повторная замена подписей возвращает как в названии', () => {
    const j = swapRouteEnds(swapRouteEnds(withRoute(), 'r1', 'И'), 'r1', 'И');
    expect(j.planRoutes[0].endsSwapped).toBeUndefined();
  });

  it('карточка говорит словами, откуда идёт счёт', () => {
    expect(countFromText({ from: 'ОМ', to: 'Акбеит' })).toBe('Счёт метров от «ОМ» к «Акбеит»');
    expect(countFromText({ from: 'ОМ', to: 'Акбеит', reversed: true }))
      .toBe('Счёт метров от «ОМ» к «Акбеит» — развёрнут против файла');
    expect(countFromText({})).toBe('Счёт метров от первой точки линии');
    expect(countFromText({ to: 'Школа' })).toBe('Счёт метров к «Школа»');
  });
});

describe('исполнительная схема после разворота', () => {
  const muftaAtVillage: SiteObject = {
    id: 'm1', kind: 'mufta', name: 'Муфта у села', lat: 0, lon: 0.001,
    uchastok: 'Акбеит', createdAt: now, updatedAt: now,
  };

  it('схема по файлу начинается от села — так и было неправильно', () => {
    const s = buildScheme(route(), [muftaAtVillage]);
    expect(s.marks.find((m) => m.label === 'Муфта у села')!.atM).toBeLessThan(200);
  });

  it('после разворота муфта у села оказывается в конце схемы, а начало — у магистрали', () => {
    const j = reversePlanRoute(withRoute(), 'r1', 'И');
    const s = buildScheme(j.planRoutes[0], [muftaAtVillage]);
    const m = s.marks.find((x) => x.label === 'Муфта у села')!;
    expect(m.atM).toBeGreaterThan(900);
    expect(s.marks[0]).toMatchObject({ kind: 'start', label: 'ОМ' });
    expect(s.marks[s.marks.length - 1]).toMatchObject({ kind: 'end', label: 'Акбеит' });
  });

  it('подписи концов наоборот доходят и до схемы', () => {
    const s = buildScheme(route({ endsSwapped: true }), []);
    expect(s.marks[0].label).toBe('Акбеит');
    expect(s.marks[1].label).toBe('ОМ');
  });

  it('пролёт по замеру считается от предыдущей отметки уже в новом порядке', () => {
    const near: SiteObject = { ...muftaAtVillage, id: 'm2', name: 'ККС у магистрали', kind: 'kks', lon: 0.009, spanM: 120 };
    const j = reversePlanRoute(withRoute(), 'r1', 'И');
    const s = buildScheme(j.planRoutes[0], [near]);
    const sp = s.spans.find((x) => x.to === 'ККС у магистрали')!;
    expect(sp.from).toBe('ОМ');
    expect(sp.meters).toBe(120);
  });
});
