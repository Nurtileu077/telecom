import { describe, it, expect } from 'vitest';
import type { DailyWorkEntry, PlanRoute } from '@/types/construction';
import {
  placeShifts, shiftsOnRoute, proposeStop, stopPositionM, describeStop,
} from './shiftPlace';
import { routeLengthM, pointAtDistanceM } from './routeProgress';
import {
  emptyJournal, reversePlanRoute, setSectionProgress, type JournalState,
} from './journalStore';
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
