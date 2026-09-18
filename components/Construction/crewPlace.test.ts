import { describe, it, expect } from 'vitest';
import { placeCrews } from './crewPlace';
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
