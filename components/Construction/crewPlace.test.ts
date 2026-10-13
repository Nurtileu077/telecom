import { describe, it, expect } from 'vitest';
import { placeCrews } from './crewPlace';
import { routeLengthM, pointAtDistanceM } from './routeProgress';
import type { Crew, DailyWorkEntry, DrillLogEntry } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function crew(over: Partial<Crew> = {}): Crew {
  return {
    id: 'c1', kind: 'mkt', name: '1-колонна', status: 'working',
    members: [], equipment: {}, updatedAt: '2026-09-01T00:00:00.000Z', ...over,
  };
}

function ground(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: 'g1', date: '2026-09-10', smu: '', column: '1-колонна',
    oblast: 'Акмолинская область', rayon: 'Зерендинский',
    uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 1000 }, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

function drill(over: Partial<DrillLogEntry> = {}): DrillLogEntry {
  return {
    kind: 'drill', id: 'd1', date: '2026-09-11', smu: '', oblast: '', uchastok: 'Еленовка',
    kato: '191', drillKind: 'ГНБ', meters: 72, count: 1,
    points: [{ lat: 51.5, lon: 71.5 }],
    createdAt: now, updatedAt: now, ...over,
  };
}

function ctx(over: Partial<Parameters<typeof placeCrews>[1]> = {}) {
  return { ground: [], aerial: [], drills: [], ...over };
}

describe('колонна встаёт по отчёту', () => {
  it('берёт место последнего участка, с которого отчиталась', () => {
    const [c] = placeCrews([crew()], ctx({
      ground: [ground()], drills: [drill()],
    }));
    expect(c.lat).toBeCloseTo(51.5, 5);
    expect(c.placement?.source).toBe('report');
    expect(c.placement?.uchastok).toBe('Еленовка');
  });

  it('из двух отчётов берёт свежий', () => {
    const [c] = placeCrews([crew()], ctx({
      ground: [
        ground({ id: 'g1', date: '2026-09-05', kato: '191' }),
        ground({ id: 'g2', date: '2026-09-12', kato: '392', uchastok: 'Убаган' }),
      ],
      drills: [drill(), drill({ id: 'd2', kato: '392', uchastok: 'Убаган', points: [{ lat: 52.0, lon: 63.0 }] })],
    }));
    expect(c.lat).toBeCloseTo(52.0, 5);
    expect(c.placement?.date).toBe('2026-09-12');
  });

  it('подтягивает область и участок — иначе колонна числится не там', () => {
    const [c] = placeCrews([crew({ oblast: 'Старая', uchastok: 'Старый' })], ctx({
      ground: [ground()], drills: [drill()],
    }));
    expect(c.oblast).toBe('Акмолинская область');
    expect(c.rayon).toBe('Зерендинский');
    expect(c.uchastok).toBe('Еленовка');
  });

  it('опознаёт колонну по подрядчику, когда номера в отчёте нет', () => {
    const [c] = placeCrews([crew({ name: 'без номера', contractor: 'TERRA TECH' })], ctx({
      ground: [ground({ column: undefined, contractor: 'TERRA TECH' })],
      drills: [drill()],
    }));
    expect(c.placement?.source).toBe('report');
  });

  it('чужой отчёт колонну не двигает', () => {
    const [c] = placeCrews([crew({ name: '2-колонна' })], ctx({
      ground: [ground({ column: '1-колонна' })], drills: [drill()],
    }));
    expect(c.placement).toBeUndefined();
  });
});

describe('рука против отчёта', () => {
  it('перетащили сегодня — вчерашний отчёт метку не утащит', () => {
    const [c] = placeCrews(
      [crew({ lat: 50.0, lon: 70.0, updatedAt: '2026-09-11T08:00:00.000Z' })],
      ctx({ ground: [ground({ date: '2026-09-10' })], drills: [drill()] }),
    );
    expect(c.lat).toBe(50.0);
    expect(c.placement?.source).toBe('manual');
  });

  it('отчёт новее перетаскивания — побеждает отчёт', () => {
    const [c] = placeCrews(
      [crew({ lat: 50.0, lon: 70.0, updatedAt: '2026-09-09T08:00:00.000Z' })],
      ctx({ ground: [ground({ date: '2026-09-10' })], drills: [drill()] }),
    );
    expect(c.lat).toBeCloseTo(51.5, 5);
    expect(c.placement?.source).toBe('report');
  });

  it('утренний отчёт того же дня сильнее вчерашней руки', () => {
    const [c] = placeCrews(
      [crew({ lat: 50.0, lon: 70.0, updatedAt: '2026-09-10T07:00:00.000Z' })],
      ctx({ ground: [ground({ date: '2026-09-10' })], drills: [drill()] }),
    );
    expect(c.placement?.source).toBe('report');
  });
});

describe('когда места нет', () => {
  it('отчёт есть, координат нет — остаётся там, где стояла', () => {
    const [c] = placeCrews([crew({ lat: 50.0, lon: 70.0 })], ctx({ ground: [ground()] }));
    expect(c.lat).toBe(50.0);
    expect(c.placement?.source).toBe('manual');
  });

  it('ни отчёта, ни координат — колонна без места', () => {
    const [c] = placeCrews([crew()], ctx());
    expect(c.placement).toBeUndefined();
    expect(c.lat).toBeUndefined();
  });
});

/** Прямая на северо-восток около 13 км — линия села Еленовка. */
const LINE: [number, number][] = [[51.5, 71.5], [51.6, 71.6]];
const TOTAL = routeLengthM(LINE);
const at = (m: number) => pointAtDistanceM(LINE, m)!;
const elenovka = {
  id: 'r1', name: 'Еленовка Ивановка', coords: LINE,
  lengthM: TOTAL, source: 'kml', createdAt: now, updatedAt: now,
};
const elenovkaProgress = [{
  kato: '191', snp: 'Еленовка', oblast: 'Акмолинская область', rayon: 'Зерендинский',
  stages: {}, updatedAt: now,
}];
/** «Остановились здесь», поставленное рукой, в стольких-то метрах от начала. */
const stopAt = (m: number, over: Partial<NonNullable<DailyWorkEntry['stop']>> = {}) => ({
  stop: { routeId: 'r1', lat: at(m).lat, lon: at(m).lon, manual: true, ...over },
});

describe('продвижение по трассе точнее центра села', () => {
  it('колонна встаёт туда, докуда дошла, а не в середину села', () => {
    const [c] = placeCrews([crew()], ctx({
      ground: [ground(stopAt(4200))],
      drills: [drill()],
      planRoutes: [elenovka], progress: elenovkaProgress,
    }));
    expect(c.lat).toBeCloseTo(at(4200).lat, 5);
    expect(c.placement).toMatchObject({ source: 'progress', routeId: 'r1', atM: 4200, entryId: 'g1' });
  });

  it('без продвижения остаётся место участка', () => {
    const [c] = placeCrews([crew()], ctx({ ground: [ground()], drills: [drill()] }));
    expect(c.placement?.source).toBe('report');
  });
});

/**
 * Точка была одна на село: две бригады, идущие навстречу, стояли на карте
 * в одном месте, где нет ни одной, а на магистрали без КАТО отметка
 * «остановились здесь» пропадала вовсе.
 */
describe('своя точка у каждой колонны', () => {
  const A = crew({ id: 'a', name: '1-колонна' });
  const B = crew({ id: 'b', name: '2-колонна' });

  it('две колонны навстречу по одному селу стоят каждая на своём месте', () => {
    const [a, b] = placeCrews([A, B], ctx({
      ground: [
        ground({ id: 'a1', column: '1-колонна', ...stopAt(3000) }),
        // Вторая идёт от Ивановки к Еленовке: начала у конца линии.
        ground({ id: 'b1', column: '2-колонна', ...stopAt(TOTAL - 1000, { back: true }) }),
        ground({ id: 'a2', date: '2026-09-11', column: '1-колонна', byMethod: { 'кабелеукладчик': 500 } }),
        ground({ id: 'b2', date: '2026-09-11', column: '2-колонна', byMethod: { 'кабелеукладчик': 700 } }),
      ],
      planRoutes: [elenovka], progress: elenovkaProgress,
    }));
    expect(a.placement?.atM).toBe(3500);
    // Смена без отметки продолжает в её сторону — к началу линии.
    expect(b.placement?.atM).toBe(Math.round(TOTAL - 1700));
    expect(b.trip?.to).toBe('Еленовка');
    expect(b.trip?.leftM).toBe(Math.round(TOTAL - 1700));
    expect(a.lat).not.toBeCloseTo(b.lat as number, 3);
  });

  it('колонна, не назвавшая места, не встаёт на место соседней', () => {
    const [, b] = placeCrews([A, B], ctx({
      ground: [
        ground({ id: 'a1', column: '1-колонна', ...stopAt(9000) }),
        ground({ id: 'b1', column: '2-колонна', date: '2026-09-11' }),
      ],
      drills: [drill()],
      planRoutes: [elenovka], progress: elenovkaProgress,
    }));
    expect(b.placement?.source).toBe('report');
    expect(b.lat).toBeCloseTo(51.5, 5);
  });

  it('на магистрали без КАТО отметка не пропадает — колонна встаёт по ней', () => {
    const trunk = { ...elenovka, id: 't1', name: 'Астана — Алматы' };
    const [c] = placeCrews([crew()], ctx({
      ground: [ground({
        kato: '', uchastok: 'Магистраль',
        stop: { routeId: 't1', lat: at(6000).lat, lon: at(6000).lon, manual: true },
      })],
      planRoutes: [trunk], progress: [],
    }));
    expect(c.placement).toMatchObject({ source: 'progress', routeId: 't1', atM: 6000 });
  });
});

describe('откуда и куда едет колонна', () => {
  const route = elenovka;
  const progress = elenovkaProgress;

  it('называет конец трассы и сколько до него осталось', () => {
    const [c] = placeCrews([crew()], ctx({
      ground: [ground(stopAt(4200))], drills: [drill()],
      planRoutes: [route], progress,
    }));
    expect(c.trip?.to).toBe('Ивановка');
    // Остаток — от длины линии по координатам, той же, что в схеме.
    expect(c.trip?.leftM).toBe(Math.round(TOTAL - 4200));
  });

  it('откуда — предыдущее село по её же отчётам, а не начало трассы', () => {
    const [c] = placeCrews([crew()], ctx({
      ground: [
        ground(),
        ground({ id: 'g0', date: '2026-09-08', uchastok: 'Кусеп', kato: '190' }),
      ],
      drills: [drill()],
      planRoutes: [route], progress,
    }));
    expect(c.trip?.from).toBe('Кусеп');
  });

  it('трассы нет — направление не выдумывается', () => {
    const [c] = placeCrews([crew()], ctx({ ground: [ground()], drills: [drill()] }));
    expect(c.trip).toBeUndefined();
  });
});
