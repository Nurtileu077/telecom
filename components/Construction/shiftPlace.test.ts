import { describe, it, expect } from 'vitest';
import type { DailyWorkEntry, PlanRoute } from '@/types/construction';
import {
  placeShifts, shiftsOnRoute, proposeStop, stopPositionM, describeStop, crewOf, crewLabel,
  unplacedRuns, describeRun, unplacedNote, stopForRunStart,
} from './shiftPlace';
import { routeLengthM, pointAtDistanceM } from './routeProgress';
import {
  emptyJournal, reversePlanRoute, setSectionProgress, placeRunFrom, restoreShape,
  type JournalState,
} from './journalStore';
import { changeFeed } from './changeLog';
import { mergeJournalStates } from './journalSync';

const now = '2026-09-18T00:00:00.000Z';
/** Прямая на восток, около 14 км: место на ней читается по долготе. */
const LINE: [number, number][] = [[51, 71], [51, 71.2]];
const TOTAL = routeLengthM(LINE);
const lonAt = (m: number) => 71 + (m / TOTAL) * 0.2;

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'r1', name: 'ОМ — Еленовка', uchastok: 'Еленовка',
    coords: LINE, lengthM: TOTAL,
    source: 'тест', createdAt: now, updatedAt: now, ...over,
  };
}

let seq = 0;
function shift(date: string, meters: number, over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  seq += 1;
  return {
    kind: 'ground', id: `g${seq}`, date, smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': meters }, materials: {},
    createdAt: `${date}T10:00:00.000Z`, updatedAt: now, ...over,
  };
}

/** «Остановились здесь», поставленное рукой на карте, — в стольких-то метрах от начала. */
const atMap = (m: number, routeId = 'r1') => ({ stop: { routeId, lat: 51, lon: lonAt(m), manual: true } });
/** «Верно» под посчитанной точкой. */
const agreed = (routeId = 'r1') => ({ stop: { routeId, lat: 51, lon: 71 } });

describe('где на линии копали', () => {
  it('смены без отметок места не получают — пройдено, но где, неизвестно', () => {
    const pl = placeShifts(route(), [shift('2026-09-01', 800), shift('2026-09-02', 700)]);
    expect(pl.placed).toHaveLength(0);
    expect(pl.unplaced.map((u) => u.meters)).toEqual([800, 700]);
    expect(pl.endM).toBeNull();
  });

  it('«Верно» под точкой от начала кладёт от начала и её, и смены до неё', () => {
    const pl = placeShifts(route(), [
      shift('2026-09-01', 800),
      shift('2026-09-02', 700, agreed()),
      shift('2026-09-03', 500),
    ]);
    expect(pl.unplaced).toHaveLength(0);
    expect(pl.placed.map((p) => [p.fromM, p.toM])).toEqual([[0, 800], [800, 1500], [1500, 2000]]);
    expect(pl.endM).toBe(2000);
  });

  it('бригада начала с середины и прошла км 6–9 — на линии км 6–9, а не 0–3', () => {
    const pl = placeShifts(route(), [
      shift('2026-09-01', 1000, atMap(7000)),
      shift('2026-09-02', 1000),
      shift('2026-09-03', 1000),
    ]);
    expect(pl.placed[0].fromM).toBeCloseTo(6000, -1);
    expect(pl.placed[2].toM).toBeCloseTo(9000, -1);
    expect(pl.endM).toBeCloseTo(9000, -1);
  });

  it('смены до отметки рукой остаются без места: назад от отметки не считаем', () => {
    const pl = placeShifts(route(), [
      shift('2026-09-01', 1500),
      shift('2026-09-02', 500, atMap(9000)),
    ]);
    expect(pl.unplaced.map((u) => u.meters)).toEqual([1500]);
    expect(pl.placed).toHaveLength(1);
    expect(pl.placed[0].fromM).toBeCloseTo(8500, -1);
  });

  it('бригаду перекинули на другой край — новая отметка рукой переносит и счёт', () => {
    const pl = placeShifts(route(), [
      shift('2026-09-01', 1000, agreed()),
      shift('2026-09-02', 1000, atMap(12000)),
      shift('2026-09-03', 500),
    ]);
    expect(pl.placed.map((p) => Math.round(p.fromM / 100) * 100)).toEqual([0, 11000, 12000]);
    expect(pl.endM).toBeCloseTo(12500, -1);
  });

  it('отметка ближе к началу, чем метры смены, — кусок обрезается началом линии', () => {
    const pl = placeShifts(route(), [shift('2026-09-01', 1000, atMap(300))]);
    expect(pl.placed[0].fromM).toBe(0);
    expect(pl.placed[0].toM).toBeCloseTo(300, -1);
    // Метры смены остаются как записаны: расхождение видно, а не спрятано.
    expect(pl.placed[0].meters).toBe(1000);
  });

  it('метры сверх линии не уводят закраску за её конец', () => {
    const pl = placeShifts(route(), [shift('2026-09-01', Math.round(TOTAL * 2), agreed())]);
    expect(pl.placed[0].toM).toBeCloseTo(TOTAL, 3);
    expect(pl.endM).toBeCloseTo(TOTAL, 3);
  });

  it('в один день смены идут в порядке записи, а не в порядке списка', () => {
    const later = shift('2026-09-01', 300, { createdAt: '2026-09-01T18:00:00.000Z' });
    const first = shift('2026-09-01', 700, { createdAt: '2026-09-01T09:00:00.000Z', ...agreed() });
    const pl = placeShifts(route(), [later, first]);
    expect(pl.placed[0].entryId).toBe(first.id);
    expect(pl.placed[1].fromM).toBe(700);
  });

  it('дни простоя на линию не ложатся и счёт не сбивают', () => {
    const pl = placeShifts(route(), [
      shift('2026-09-01', 1000, agreed()),
      shift('2026-09-02', 0, { byMethod: {}, downtime: 'дождь' }),
      shift('2026-09-03', 500),
    ]);
    expect(pl.placed.map((p) => p.toM)).toEqual([1000, 1500]);
  });
});

/** Одно село часто ведут две колонны — у каждой свой путь по линии. */
describe('две колонны на одной линии', () => {
  const A = { contractor: 'Дозер', column: '1-колонна' };
  const B = { contractor: 'Дозер', column: '2-колонна' };

  it('вторая колонна без отметки не продолжает чужую закраску', () => {
    // Колонна A отметила рукой 9-й км, колонна B прошла 500 м у 2-го км и
    // место не назвала. Раньше её смену клали с 9 по 9,5 км.
    const a = shift('2026-09-01', 1000, { ...A, ...atMap(9000) });
    const b = shift('2026-09-02', 500, B);
    const pl = placeShifts(route(), [a, b]);
    expect(pl.placed.map((p) => p.entryId)).toEqual([a.id]);
    expect(pl.unplaced.map((u) => u.entryId)).toEqual([b.id]);
    expect(pl.endByCrew.get(crewOf(B))).toBeUndefined();
  });

  it('смена без отметки продолжает свою колонну, а не последнюю на линии', () => {
    const a1 = shift('2026-09-01', 1000, { ...A, ...atMap(9000) });
    const b1 = shift('2026-09-01', 500, { ...B, ...agreed(), createdAt: '2026-09-01T18:00:00.000Z' });
    const a2 = shift('2026-09-02', 1000, A);
    const pl = placeShifts(route(), [a1, b1, a2]);
    const at = new Map(pl.placed.map((p) => [p.entryId, [Math.round(p.fromM), Math.round(p.toM)]]));
    expect(at.get(b1.id)).toEqual([0, 500]);
    expect(at.get(a2.id)![0]).toBeCloseTo(9000, -2);
    expect(at.get(a2.id)![1]).toBeCloseTo(10000, -2);
  });

  it('«Верно» второй колонны кладёт от начала только её смены', () => {
    const a = shift('2026-09-01', 1000, { ...A, ...atMap(9000) });
    const b1 = shift('2026-09-02', 400, B);
    const b2 = shift('2026-09-03', 300, { ...B, ...agreed() });
    const pl = placeShifts(route(), [a, b1, b2]);
    expect(pl.unplaced).toHaveLength(0);
    expect(pl.placed.filter((p) => p.crew === crewOf(B)).map((p) => [p.fromM, p.toM]))
      .toEqual([[0, 400], [400, 700]]);
    // Порядок дней сохраняется и после «Верно» задним числом.
    expect(pl.placed.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('та же колонна у другого подрядчика — другая колонна', () => {
    const a = shift('2026-09-01', 1000, { ...A, ...atMap(9000) });
    const other = shift('2026-09-02', 500, { contractor: 'TERRA TECH', column: '1-колонна' });
    expect(placeShifts(route(), [a, other]).unplaced.map((u) => u.entryId)).toEqual([other.id]);
  });

  it('«1-колонна» и «1 колонна» — одна колонна', () => {
    expect(crewOf({ contractor: 'Дозер', column: '1-колонна' }))
      .toBe(crewOf({ contractor: ' дозер', column: '1 колонна' }));
  });

  it('форма второй колонны не предлагает место первой и говорит, почему от начала', () => {
    const ground = [shift('2026-09-01', 1000, { ...A, ...atMap(9000) })];
    const p = proposeStop(route(), ground, 500, '2026-09-02', B)!;
    expect(p.from).toBe('start');
    expect(p.beforeM).toBe(0);
    expect(p.atM).toBe(500);
    expect(p.othersOnLine).toBe(true);
    const text = describeStop({
      routeName: 'ОМ — Еленовка', proposal: p, addedM: 500, crewName: crewLabel(B),
    });
    expect(text).toContain('где копала «2-колонна (Дозер)», на этой линии ещё не отмечали');
    expect(text).toContain('Места других колонн на этой линии отмечены');
  });

  it('своей колонне форма предлагает продолжение от её места', () => {
    const ground = [
      shift('2026-09-01', 1000, { ...A, ...atMap(9000) }),
      shift('2026-09-02', 500, { ...B, ...agreed() }),
    ];
    const p = proposeStop(route(), ground, 500, '2026-09-03', A)!;
    expect(p.from).toBe('place');
    expect(p.atM).toBeCloseTo(9500, -1);
    expect(p.afterDate).toBe('2026-09-01');
    const text = describeStop({ routeName: 'ОМ — Еленовка', proposal: p, addedM: 500, crewName: crewLabel(A) });
    expect(text).toContain('прошлая смена колонны «1-колонна (Дозер)» (01.09.2026) кончилась на 9,00 км');
  });

  it('точка участка после разворота — у колонны, поставившей отметку', () => {
    // A отметила 4-й км и ушла дальше «Верно». B идёт от начала, и в тот
    // же день закрыла смену позже, без отметки, — точку участка ставила A.
    const ground = [
      shift('2026-09-01', 1000, { ...A, ...atMap(4000) }),
      shift('2026-09-01', 300, { ...B, ...agreed(), createdAt: '2026-09-01T18:00:00.000Z' }),
      shift('2026-09-02', 1000, { ...A, ...agreed() }),
      shift('2026-09-02', 300, { ...B, createdAt: '2026-09-02T18:00:00.000Z' }),
    ];
    expect(placeShifts(route(), ground).endM).toBe(600);
    expect(stopPositionM(route(), ground, { date: '2026-09-02', doneM: 5000 })).toBeCloseTo(5000, -1);
  });
});

describe('какие смены на трассе', () => {
  it('отметка привязывает смену к своей линии, даже если село то же', () => {
    const ground = [
      shift('2026-09-01', 800, agreed('r1')),
      shift('2026-09-02', 400),
    ];
    expect(shiftsOnRoute('r2', '191', ground).map((e) => e.id)).toEqual([ground[1].id]);
    expect(shiftsOnRoute('r1', '191', ground)).toHaveLength(2);
  });

  it('отметка на линии, которой больше нет, смену не держит — та ищет трассу по селу', () => {
    const ground = [shift('2026-09-01', 800, agreed('удалённая'))];
    expect(shiftsOnRoute('r1', '191', ground, new Set(['r1']))).toHaveLength(1);
  });
});

describe('что предложит форма смены', () => {
  it('продолжает от места прошлой смены, а не от суммы метров участка', () => {
    // Инженер поставил «остановились здесь» на 9-м км, а всего по участку
    // 1 км. Раньше назавтра форма снова предлагала 1,5 км от начала.
    const p = proposeStop(route(), [shift('2026-09-01', 1000, atMap(9000))], 500, '2026-09-02')!;
    expect(p.from).toBe('place');
    expect(p.atM).toBeCloseTo(9500, -1);
    expect(p.lon).toBeCloseTo(lonAt(9500), 4);
    expect(p.afterDate).toBe('2026-09-01');
  });

  it('пока места не называли — считает от начала и говорит это вслух', () => {
    const p = proposeStop(route(), [shift('2026-09-01', 1000)], 500, '2026-09-02')!;
    expect(p.from).toBe('start');
    expect(p.beforeM).toBe(1000);
    expect(p.atM).toBe(1500);
    const text = describeStop({ routeName: 'ОМ — Еленовка', startName: 'ОМ', proposal: p, addedM: 500 });
    expect(text).toContain('считаем от её начала («ОМ»)');
    expect(text).toContain('укажите на карте, где остановились');
  });

  it('вчерашний день, закрытый сегодня, продолжает позавчерашний', () => {
    const p = proposeStop(route(), [
      shift('2026-09-01', 1000, agreed()),
      shift('2026-09-03', 2000),
    ], 500, '2026-09-02')!;
    expect(p.beforeM).toBe(1000);
    expect(p.atM).toBe(1500);
  });

  it('подпись под точкой рукой говорит, какой кусок закрасим', () => {
    const p = proposeStop(route(), [], 800, '2026-09-01')!;
    const text = describeStop({
      routeName: 'ОМ — Еленовка', proposal: p, addedM: 800,
      picked: { atM: 7000, deviationM: 12 },
    });
    expect(text).toContain('Закрасим с 6,20 км по 7,00 км');
    expect(text).not.toContain('от линии');
  });

  it('точку поставили далеко от линии — так и сказано, а место берём на ней', () => {
    const p = proposeStop(route(), [], 800, '2026-09-01')!;
    const text = describeStop({
      routeName: 'ОМ — Еленовка', proposal: p, addedM: 800,
      picked: { atM: 7000, deviationM: 340 },
    });
    expect(text).toContain('Точка в 340 м от линии');
  });

  it('продолжение называет день прошлой смены', () => {
    const p = proposeStop(route(), [shift('2026-09-01', 1000, agreed())], 500, '2026-09-02')!;
    const text = describeStop({ routeName: 'ОМ — Еленовка', proposal: p, addedM: 500 });
    expect(text).toContain('прошлая смена (01.09.2026) кончилась на 1,00 км');
  });
});

describe('точка колонны после разворота трассы', () => {
  function journal(): JournalState {
    const end = pointAtDistanceM(LINE, 5000)!;
    return {
      ...emptyJournal(),
      planRoutes: [route()],
      ground: [
        // Начали с середины: отметка рукой на 4-м км.
        shift('2026-09-01', 1000, atMap(4000)),
        // Назавтра сказали «верно» посчитанной точке — 5-й км.
        shift('2026-09-02', 1000, agreed()),
      ],
      sectionProgress: {
        191: { routeId: 'r1', doneM: 5000, lat: end.lat, lon: end.lon, date: '2026-09-02' },
      },
    };
  }

  it('встаёт туда, где кончается закраска, а не на прежние метры от начала', () => {
    const j = reversePlanRoute(journal(), 'r1', 'Инженер');
    const p = j.sectionProgress['191'];
    // Счёт пошёл навстречу: от отметки на 4-м км бригада ушла к 3-му.
    expect(p.lon).toBeCloseTo(lonAt(3000), 3);
    const pl = placeShifts(j.planRoutes[0], j.ground);
    expect(pl.endM).toBeCloseTo(TOTAL - 3000, -1);
    expect(p.doneM).toBe(Math.round(pl.endM!));
  });

  it('разворот, пришедший с другого устройства, ставит точку по тем же отметкам', () => {
    // Там линию развернули, а здесь тем временем закрыли ещё день.
    const base = journal();
    const there = reversePlanRoute(base, 'r1', 'Инженер');
    const extra = shift('2026-09-03', 500, agreed());
    const at = pointAtDistanceM(LINE, 5500)!;
    const here = setSectionProgress(
      { ...base, ground: [...base.ground, extra] },
      '191',
      { routeId: 'r1', doneM: 5500, lat: at.lat, lon: at.lon, date: '2026-09-03' },
    );
    const merged = mergeJournalStates(here, there).merged;
    expect(merged.planRoutes[0].reversed).toBe(true);
    // От отметки на 4-м км навстречу: 1 + 0,5 км — бригада у 2,5-го км.
    expect(merged.sectionProgress['191'].lon).toBeCloseTo(lonAt(2500), 3);
  });

  it('без смен с отметками — прежний счёт от начала', () => {
    expect(stopPositionM(route(), [shift('2026-09-01', 1000)], { date: '2026-09-01', doneM: 1000 }))
      .toBe(1000);
  });
});

/**
 * Форма ставит «остановились здесь» только новой смене. Смены, закрытые
 * раньше, пришедшие из быстрой строки или таблицы, оставались штрихом, и
 * карточка трассы советовала отметить их в смене — что невыполнимо.
 */
describe('место старым сменам — с карточки трассы', () => {
  const A = { contractor: 'Дозер', column: '1-колонна' };
  const B = { contractor: 'Дозер', column: '2-колонна' };
  function journal(ground: DailyWorkEntry[]): JournalState {
    return { ...emptyJournal(), planRoutes: [route()], ground };
  }
  const placedOf = (j: JournalState) => placeShifts(j.planRoutes[0], j.ground);
  const ok = (r: ReturnType<typeof placeRunFrom>) => {
    if ('error' in r) throw new Error(r.error);
    return r;
  };

  it('без места смены собраны по колоннам, с первой сменой каждой', () => {
    const a1 = shift('2026-09-01', 800, A);
    const b1 = shift('2026-09-01', 300, { ...B, createdAt: '2026-09-01T18:00:00.000Z' });
    const a2 = shift('2026-09-02', 700, A);
    const ground = [a1, b1, a2];
    const runs = unplacedRuns(placeShifts(route(), ground), ground);
    expect(runs.map((r) => [r.crewName, r.firstEntryId, r.shifts, r.meters])).toEqual([
      ['1-колонна (Дозер)', a1.id, 2, 1500],
      ['2-колонна (Дозер)', b1.id, 1, 300],
    ]);
    expect(describeRun(runs[0])).toBe('«1-колонна (Дозер)»: 2 смены, 1\u00a0500 м (01.09.2026–02.09.2026)');
  });

  it('указали, откуда колонна начала, — её смены ложатся подряд от этого места', () => {
    const a1 = shift('2026-09-01', 1000, A);
    const a2 = shift('2026-09-02', 1000, A);
    const a3 = shift('2026-09-03', 500, A);
    const res = ok(placeRunFrom(journal([a1, a2, a3]), 'r1', a1.id, { lat: 51.0003, lon: lonAt(6000) }, {
      author: 'Инженер', to: 'Еленовка',
    }));
    const pl = placedOf(res.state);
    expect(pl.unplaced).toHaveLength(0);
    expect(pl.placed.map((p) => Math.round(p.fromM / 100) * 100)).toEqual([6000, 7000, 8000]);
    expect(pl.endM).toBeCloseTo(8500, -1);
    expect(res.text).toBe('Смены «1-колонна (Дозер)» легли от 6,00 км в сторону «Еленовка».');
  });

  it('«шли от начала линии» кладёт смены колонны от начала', () => {
    const a1 = shift('2026-09-01', 1000, A);
    const a2 = shift('2026-09-02', 400, A);
    const res = ok(placeRunFrom(journal([a1, a2]), 'r1', a1.id, 'line', { author: 'Инженер' }));
    expect(placedOf(res.state).placed.map((p) => [p.fromM, p.toM])).toEqual([[0, 1000], [1000, 1400]]);
  });

  it('смены до отметки рукой получают место, если назначить его первой', () => {
    // Раньше отметка рукой навсегда отправляла все смены до неё в «без места».
    const a1 = shift('2026-09-01', 1000, A);
    const a2 = shift('2026-09-02', 1000, A);
    const a3 = shift('2026-09-03', 500, { ...A, ...atMap(12000) });
    const j = journal([a1, a2, a3]);
    expect(placedOf(j).unplaced.map((u) => u.entryId)).toEqual([a1.id, a2.id]);
    const res = ok(placeRunFrom(j, 'r1', a1.id, { lat: 51, lon: lonAt(2000) }, { author: 'Инженер' }));
    const pl = placedOf(res.state);
    expect(pl.unplaced).toHaveLength(0);
    expect(pl.placed.map((p) => Math.round(p.fromM / 100) * 100)).toEqual([2000, 3000, 11500]);
  });

  it('место одной колонны не трогает другую', () => {
    const a1 = shift('2026-09-01', 1000, A);
    const b1 = shift('2026-09-02', 500, B);
    const res = ok(placeRunFrom(journal([a1, b1]), 'r1', a1.id, 'line', { author: 'Инженер' }));
    expect(placedOf(res.state).unplaced.map((u) => u.entryId)).toEqual([b1.id]);
  });

  it('назначенное место видно в журнале изменений, и его можно вернуть', () => {
    const a1 = shift('2026-09-01', 1000, A);
    const res = ok(placeRunFrom(journal([a1]), 'r1', a1.id, 'line', { author: 'Инженер', from: 'ОМ' }));
    const item = changeFeed(res.state).find((i) => i.text.startsWith('место смен указано'))!;
    expect(item.text).toBe('место смен указано — «1-колонна (Дозер)», смены с 01.09.2026 от «ОМ»');
    expect(item.restorable).toBe(true);
    const back = restoreShape(res.state, item.changeId!, 'Инженер');
    expect(back.ground[0].stop).toBeUndefined();
    expect(placedOf(back).unplaced).toHaveLength(1);
  });

  it('место назначенное на одном устройстве доходит до другого', () => {
    const a1 = shift('2026-09-01', 1000, A);
    const base = journal([a1]);
    const there = ok(placeRunFrom(base, 'r1', a1.id, 'line', { author: 'Инженер' })).state;
    const merged = mergeJournalStates(base, there).merged;
    expect(placedOf(merged).unplaced).toHaveLength(0);
  });

  it('смену удалили, пока карточка была открыта, — так и сказано', () => {
    const r = placeRunFrom(journal([]), 'r1', 'нет-такой', 'line', { author: 'Инженер' });
    expect(r).toEqual({ error: 'Трассы или смены уже нет — обновите карту.' });
  });

  it('промах мимо линии назван, место берётся ближайшее на ней', () => {
    const a1 = shift('2026-09-01', 1000, A);
    const hit = stopForRunStart(route(), a1, { lat: 51.01, lon: lonAt(3000) })!;
    expect(hit.deviationM).toBeGreaterThan(1000);
    const res = ok(placeRunFrom(journal([a1]), 'r1', a1.id, { lat: 51.01, lon: lonAt(3000) }, { author: 'И' }));
    expect(res.text).toContain('от линии — взято ближайшее место на ней');
  });

  it('карточка не советует отметить в смене то, что форма уже не даст', () => {
    const can = unplacedNote(2400, { canPlace: true, to: 'Еленовка' });
    expect(can).toContain('Ещё 2\u00a0400 м пройдено');
    expect(can).toContain('Укажите, откуда колонна начала: её смены лягут подряд от этого места в сторону «Еленовка»');
    expect(can).not.toContain('Отметьте в смене');
    const cannot = unplacedNote(2400, { canPlace: false });
    expect(cannot).toContain('Назначить место можно в рабочем месте «Стройка»');
    expect(cannot).not.toContain('Укажите');
  });
});
