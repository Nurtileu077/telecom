import { describe, it, expect } from 'vitest';
import type { MapArea, PlanRoute, SiteObject, SnpProgress } from '@/types/construction';
import {
  emptyJournal, addPlanRoutes, reversePlanRoute, swapRouteEnds, restoreShape,
  updateRouteCoords, realignProgress, loadPlanRoutes, planLoadNote, setSectionProgress,
  type JournalState,
} from './journalStore';
import { mergeJournalStates } from './journalSync';
import {
  routeViews, countFromText, placeNames, directionHint, routeEnds, samePlace,
} from './routeStyle';
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

/**
 * Повторная загрузка разворачивала пришедшие координаты вслепую — по
 * одной отметке у трассы с тем же номером. Исправленный файл, присланный
 * уже от магистрали, система разворачивала обратно, а номер — это место
 * линии в файле, и отметка уезжала на чужую трассу.
 */
describe('повторная загрузка решает по самой линии', () => {
  const WORK_ORDER: [number, number][] = [...FILE_COORDS].reverse();

  it('тот же файл снова — счёт остаётся развёрнутым, и говорить не о чем', () => {
    const turned = reversePlanRoute(withRoute(), 'r1', 'И');
    const load = loadPlanRoutes(turned, [route()]);
    expect(load.state.planRoutes[0].coords).toEqual(WORK_ORDER);
    expect(load.state.planRoutes[0].reversed).toBe(true);
    expect(load.notes).toEqual([]);
    expect(load.warn).toBe(false);
  });

  it('тот же файл с поправленной вершиной разворачивается как прежде', () => {
    const turned = reversePlanRoute(withRoute(), 'r1', 'И');
    const edited = route({ coords: [[0, 0], [0.0003, 0.005], [0, 0.01]] });
    const r = loadPlanRoutes(turned, [edited]).state.planRoutes[0];
    expect(r.reversed).toBe(true);
    expect(r.coords[0]).toEqual([0, 0.01]);
  });

  it('исправленный файл, нарисованный уже от магистрали, обратно не разворачивается', () => {
    const turned = reversePlanRoute(withRoute(), 'r1', 'И');
    const load = loadPlanRoutes(turned, [route({ coords: WORK_ORDER })]);
    const r = load.state.planRoutes[0];
    expect(r.coords).toEqual(WORK_ORDER);
    expect(r.reversed).toBeUndefined();
    expect(load.notes[0]).toContain('уже нарисованной от нужного конца');
    expect(load.warn).toBe(false);
    // Счёт как шёл от магистрали, так и идёт — точке колонны ехать некуда.
    expect(load.state.sectionProgress['111']).toEqual(turned.sectionProgress['111']);
  });

  it('под тем же номером пришла другая линия — её не разворачивают, отметки снимают и говорят', () => {
    const marked = swapRouteEnds(reversePlanRoute(withRoute(), 'r1', 'И'), 'r1', 'И');
    const other = route({ name: 'Кенжеколь — Акбеит', coords: [[1, 1], [1, 1.005], [1, 1.01]] });
    const load = loadPlanRoutes(marked, [other]);
    const r = load.state.planRoutes[0];
    expect(r.coords).toEqual(other.coords);
    expect(r.reversed).toBeUndefined();
    expect(r.endsSwapped).toBeUndefined();
    expect(load.warn).toBe(true);
    expect(load.notes.join(' ')).toContain('концы не совпали с прежней линией');
    expect(load.notes.join(' ')).toContain('подписи концов снова как в названии');
  });

  it('подписи наоборот переживают загрузку той же линии под тем же названием', () => {
    const swapped = swapRouteEnds(withRoute(), 'r1', 'И');
    const load = loadPlanRoutes(swapped, [route()]);
    expect(load.state.planRoutes[0].endsSwapped).toBe(true);
    expect(load.notes).toEqual([]);
  });

  it('файл перерисован с другого конца без разворота — счёт меняется, колонна вслед, и это сказано', () => {
    const load = loadPlanRoutes(withRoute(), [route({ coords: WORK_ORDER })]);
    expect(load.state.planRoutes[0].coords).toEqual(WORK_ORDER);
    expect(load.warn).toBe(true);
    expect(load.notes[0]).toContain('нарисована с другого конца');
    // 300 м теперь от другого конца линии.
    expect(load.state.sectionProgress['111'].lon).toBeGreaterThan(0.0071);
    // Поставленная руками точка остаётся, где стоит колонна.
    expect(load.state.sectionProgress['222']).toEqual(withRoute().sectionProgress['222']);
  });

  it('сообщение после загрузки называет первые пять, остальные — числом', () => {
    expect(planLoadNote([])).toBe('');
    const many = Array.from({ length: 7 }, (_, i) => `«Т${i + 1}»: снято`);
    const text = planLoadNote(many);
    expect(text).toContain('«Т5»: снято');
    expect(text).not.toContain('«Т6»');
    expect(text).toContain('и ещё 2');
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

/**
 * Карта брала концы из названия одним разбором, схема — другим. На
 * «ОМ — Акбеит» с Акбеитом в журнале карта ставила «Акбеит» на начало
 * линии, схема — «ОМ», и ни разворот, ни смена подписей не делали
 * правильными обе сразу: в подписываемом листе «Акбеит» вставал на
 * конец ОМ.
 */
describe('карта и схема называют одни и те же концы', () => {
  // Акбеит есть в журнале — его узнают в названии как село.
  const progress: SnpProgress[] = [{ kato: '1', snp: 'Акбеит', stages: {}, updatedAt: now }];
  const places = placeNames(progress);
  // Трасса без папки: участок в KML не указан.
  const plain = (over: Partial<PlanRoute> = {}) => withRoute({ uchastok: undefined, ...over });

  function ends(j: JournalState) {
    const r = j.planRoutes[0];
    const [v] = routeViews([r], { progress });
    const s = buildScheme(r, [], { places });
    return {
      v,
      map: [v.from, v.to],
      scheme: [s.marks[0].label, s.marks[s.marks.length - 1].label],
      // Какая точка линии стоит под подписью «откуда».
      startAt: r.coords[0],
    };
  }

  it('как в файле: и на карте, и в схеме начало счёта подписано «ОМ»', () => {
    const e = ends(plain());
    expect(e.map).toEqual(['ОМ', 'Акбеит']);
    expect(e.scheme).toEqual(e.map);
  });

  it('после разворота подписи те же, а линия под ними перевёрнута — «ОМ» встал на магистраль', () => {
    const e = ends(reversePlanRoute(plain(), 'r1', 'И'));
    expect(e.map).toEqual(['ОМ', 'Акбеит']);
    expect(e.scheme).toEqual(e.map);
    // Магистраль — последняя точка файла.
    expect(e.startAt).toEqual(FILE_COORDS[FILE_COORDS.length - 1]);
  });

  it('после смены подписей карта и схема вместе ставят «Акбеит» на начало', () => {
    const e = ends(swapRouteEnds(reversePlanRoute(plain(), 'r1', 'И'), 'r1', 'И'));
    expect(e.map).toEqual(['Акбеит', 'ОМ']);
    expect(e.scheme).toEqual(e.map);
  });

  it('карточка на карте пишет тот же конец, с которого начинается лист', () => {
    const e = ends(plain());
    expect(countFromText(e.v)).toBe(`Счёт метров от «${e.scheme[0]}» к «${e.scheme[1]}»`);
  });

  it('дефис внутри названия села — не разделитель: конец «Кызыл-Жар», а не «Жар»', () => {
    const kzh: SnpProgress[] = [{ kato: '2', snp: 'Кызыл-Жар', stages: {}, updatedAt: now }];
    for (const known of [placeNames(kzh), new Set<string>()]) {
      const r = route({ name: 'ОМ — Кызыл-Жар', uchastok: undefined });
      expect(routeEnds(r, known)).toEqual({ from: 'ОМ', to: 'Кызыл-Жар' });
      const s = buildScheme(r, [], { places: known });
      expect(s.marks[s.marks.length - 1].label).toBe('Кызыл-Жар');
    }
  });

  it('«ОМ-Акбеит» без пробелов — это два конца: магистраль и село', () => {
    expect(routeEnds(route({ name: 'ОМ-Акбеит' }), places)).toEqual({ from: 'ОМ', to: 'Акбеит' });
  });

  it('«сущ. ОМ - Акбеит» и «ОМ Акбеит» без тире называют те же концы', () => {
    expect(routeEnds(route({ name: 'сущ. ОМ - Акбеит' }), places)).toEqual({ from: 'ОМ', to: 'Акбеит' });
    expect(routeEnds(route({ name: 'ОМ Акбеит' }), places)).toEqual({ from: 'ОМ', to: 'Акбеит' });
    expect(routeEnds(route({ name: 'ОМ Акбеит' }), new Set())).toEqual({ from: 'ОМ', to: 'Акбеит' });
  });

  it('без сёл в журнале концы читаются по тире, и карта их тоже подписывает', () => {
    const r = route({ name: 'Акбеит — Кенжеколь' });
    const [v] = routeViews([r], { progress: [] });
    expect([v.from, v.to]).toEqual(['Акбеит', 'Кенжеколь']);
    const s = buildScheme(r, []);
    expect([s.marks[0].label, s.marks[1].label]).toEqual(['Акбеит', 'Кенжеколь']);
  });

  it('название без мест не превращается в подпись обоих концов', () => {
    const s = buildScheme(route({ name: 'Трасса 3' }), [], { places });
    expect([s.marks[0].label, s.marks[1].label]).toEqual(['Начало', 'Конец']);
  });
});

/**
 * Подписи берутся из названия, и карточка «Счёт метров от ОМ» сама по
 * себе не показывала, что линию нарисовали от села, — хотя ради этого
 * её и делали. Обводки сёл из KML знают, где село на самом деле.
 */
describe('линия нарисована от села', () => {
  // Обводка Акбеита вокруг первой точки файла.
  const akbeit: MapArea = {
    id: 'a1', kind: 'snp', name: 'с. Акбеит',
    coords: [[-0.001, -0.001], [-0.001, 0.002], [0.001, 0.002], [0.001, -0.001]],
    source: 'plan.kml', createdAt: now, updatedAt: now,
  };
  const view = (j: JournalState, areas: MapArea[] = [akbeit]) => routeViews(j.planRoutes, { progress: [], areas })[0];

  it('по обводке видно, что счёт начинается в селе, куда трасса ведёт', () => {
    const v = view(withRoute());
    expect(v.startIn).toBe('с. Акбеит');
    expect(v.endIn).toBeUndefined();
    const hint = directionHint(v)!;
    expect(hint).toContain('Счёт начинается в селе «с. Акбеит»');
    expect(hint).toContain('от «ОМ»');
    expect(hint).toContain('⇄ Считать с другого конца');
  });

  it('после разворота село в конце линии, и предупреждения нет', () => {
    const v = view(reversePlanRoute(withRoute(), 'r1', 'И'));
    expect(v.endIn).toBe('с. Акбеит');
    expect(directionHint(v)).toBeNull();
  });

  it('подписи перепутаны, а линия верная — тоже видно: конец в селе, откуда по подписям начало', () => {
    const turned = reversePlanRoute(withRoute(), 'r1', 'И');
    const v = view(swapRouteEnds(turned, 'r1', 'И'));
    expect(directionHint(v)).toContain('Линия кончается в селе «с. Акбеит»');
  });

  it('без обводок ничего не утверждает: где село, по названию не угадать', () => {
    const v = view(withRoute(), []);
    expect(v.startIn).toBeUndefined();
    expect(directionHint(v)).toBeNull();
  });

  it('трасса целиком внутри села предупреждения не получает', () => {
    const big: MapArea = { ...akbeit, coords: [[-1, -1], [-1, 1], [1, 1], [1, -1]] };
    const v = view(withRoute(), [big]);
    expect(v.startIn).toBe('с. Акбеит');
    expect(v.endIn).toBe('с. Акбеит');
    expect(directionHint(v)).toBeNull();
  });

  it('одно место узнаётся как бы его ни записали, а похожее — нет', () => {
    expect(samePlace('с. Акбеит', 'Акбеит')).toBe(true);
    expect(samePlace('сущ. ОМ - Акбеит', 'АКБЕИТ')).toBe(true);
    expect(samePlace('Аксу', 'Аксуат')).toBe(false);
    expect(samePlace('Трасса 2', 'СМУ 2')).toBe(false);
  });
});

/**
 * Разворот переносил посчитанную точку колонны, но не менял её дату, а
 * обмен решал спор по дате и при равенстве оставлял свою запись.
 * Развёрнутая трасса доходила до второго устройства, точка — нет, и
 * устройства перетягивали её каждое к себе: колонна стояла не на том
 * конце — то самое, что разворот и должен был исправить.
 */
describe('точка колонны после разворота на другом устройстве', () => {
  const shared = withRoute();

  it('после разворота на одном устройстве посчитанная точка на другом переезжает', () => {
    const turnedHere = reversePlanRoute(shared, 'r1', 'И');
    const there = mergeJournalStates(shared, turnedHere).merged;
    expect(there.planRoutes[0].reversed).toBe(true);
    // 300 м от магистрали, а не от села.
    expect(there.sectionProgress['111'].lon).toBeCloseTo(turnedHere.sectionProgress['111'].lon, 9);
    expect(there.sectionProgress['111'].lon).toBeGreaterThan(0.0071);
    // Дата продвижения прежняя: в день разворота никто не шёл.
    expect(there.sectionProgress['111'].date).toBe('2026-09-01');
  });

  it('устройства больше не перетягивают точку каждое к себе', () => {
    const a = reversePlanRoute(shared, 'r1', 'И');
    const server1 = mergeJournalStates(a, shared).merged;
    const b = mergeJournalStates(shared, server1).merged;
    const aAgain = mergeJournalStates(a, b).merged;
    const bAgain = mergeJournalStates(b, aAgain).merged;
    expect(aAgain.sectionProgress['111']).toEqual(bAgain.sectionProgress['111']);
    expect(bAgain.sectionProgress['111'].lon).toBeGreaterThan(0.0071);
  });

  it('смена, записанная там по старому направлению, встаёт по развёрнутой линии', () => {
    // На втором устройстве разворота ещё нет: 500 м отложены от села.
    const there = setSectionProgress(shared, '111', {
      routeId: 'r1', doneM: 500, lat: 0, lon: 0.0045, date: '2026-09-02',
    });
    const here = reversePlanRoute(shared, 'r1', 'И');
    for (const merged of [
      mergeJournalStates(there, here).merged,
      mergeJournalStates(here, there).merged,
    ]) {
      const p = merged.sectionProgress['111'];
      // Метры — того, кто записал позже; место — по развёрнутой линии.
      expect(p.doneM).toBe(500);
      expect(p.lon).toBeCloseTo(0.01 - 500 / 111_320, 4);
    }
  });

  it('поставленная руками точка при слиянии не переезжает', () => {
    const merged = mergeJournalStates(shared, reversePlanRoute(shared, 'r1', 'И')).merged;
    expect(merged.sectionProgress['222']).toEqual(shared.sectionProgress['222']);
  });

  it('при одной дате побеждает поздняя правка, а не своя', () => {
    const mine = setSectionProgress(emptyJournal(), '111', {
      routeId: 'r1', doneM: 300, lat: 0, lon: 0.0027, date: '2026-09-01',
    });
    const theirs: JournalState = {
      ...emptyJournal(),
      sectionProgress: {
        111: {
          routeId: 'r1', doneM: 300, lat: 0, lon: 0.0073, date: '2026-09-01',
          updatedAt: '2099-01-01T00:00:00.000Z',
        },
      },
    };
    expect(mergeJournalStates(mine, theirs).merged.sectionProgress['111'].lon).toBe(0.0073);
    // Позже дошли — дальше прошли: дата продвижения важнее времени правки.
    const later = setSectionProgress(emptyJournal(), '111', {
      routeId: 'r1', doneM: 800, lat: 0, lon: 0.0072, date: '2026-09-05',
    });
    expect(mergeJournalStates(later, theirs).merged.sectionProgress['111'].doneM).toBe(800);
  });
});
