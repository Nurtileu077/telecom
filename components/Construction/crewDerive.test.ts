import { describe, it, expect } from 'vitest';
import { crewsFromJournal, crewCountByKind } from './crewDerive';
import type {
  Crew, DailyWorkEntry, AerialWorkEntry, DrillLogEntry,
} from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';
const TODAY = '2026-09-18';

function ground(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: 'g1', date: '2026-09-17', smu: '', column: '1-колонна',
    contractor: 'TERRA TECH',
    oblast: 'Акмолинская область', rayon: 'Зерендинский',
    uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 1200 }, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

function aerial(over: Partial<AerialWorkEntry> = {}): AerialWorkEntry {
  return {
    kind: 'aerial', id: 'a1', date: '2026-09-17', smu: '', column: '5-колонна',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byCable: {}, materials: {}, totalM: 800,
    createdAt: now, updatedAt: now, ...over,
  };
}

function drill(over: Partial<DrillLogEntry> = {}): DrillLogEntry {
  return {
    kind: 'drill', id: 'd1', date: '2026-09-17', smu: '', column: '3-колонна',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    drillKind: 'ГНБ', meters: 72, count: 1, points: [],
    createdAt: now, updatedAt: now, ...over,
  };
}

function ctx(over: Partial<Parameters<typeof crewsFromJournal>[0]> = {}) {
  return { ground: [], aerial: [], drills: [], crews: [], ...over };
}

describe('колонны по журналу', () => {
  it('колонна из отчётов появляется сама', () => {
    const out = crewsFromJournal(ctx({ ground: [ground()] }), TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('1-колонна');
    expect(out[0].kind).toBe('mkt');
    expect(out[0].contractor).toBe('TERRA TECH');
    expect(out[0].derived).toBe(true);
  });

  it('вид работ берётся из записи: подвес и проколы — свои бригады', () => {
    const out = crewsFromJournal(ctx({
      ground: [ground()], aerial: [aerial()], drills: [drill()],
    }), TODAY);
    expect(out.map((c) => c.kind).sort()).toEqual(['gnb', 'mkt', 'podves']);
  });

  it('задували и не клали — это бригада задувки', () => {
    const out = crewsFromJournal(ctx({
      ground: [ground({ byMethod: {}, blowingM: 3000 })],
    }), TODAY);
    expect(out[0].kind).toBe('zaduvka');
  });

  it('смены складываются, место берётся из последнего отчёта', () => {
    const out = crewsFromJournal(ctx({
      ground: [
        ground(),
        ground({ id: 'g2', date: '2026-09-16', uchastok: 'Кусеп', kato: '190' }),
      ],
    }), TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].days).toBe(2);
    expect(out[0].uchastok).toBe('Еленовка');
    expect(out[0].lastDate).toBe('2026-09-17');
  });

  it('молчит больше трёх дней — значит стоит', () => {
    const fresh = crewsFromJournal(ctx({ ground: [ground()] }), TODAY);
    const stale = crewsFromJournal(ctx({ ground: [ground({ date: '2026-09-01' })] }), TODAY);
    expect(fresh[0].status).toBe('working');
    expect(stale[0].status).toBe('idle');
  });

  it('заведённая руками колонна выведенной не дублируется', () => {
    const manual: Crew = {
      id: 'c1', kind: 'mkt', name: '1-колонна', status: 'working',
      members: [], equipment: {}, updatedAt: now,
    };
    expect(crewsFromJournal(ctx({ ground: [ground()], crews: [manual] }), TODAY)).toHaveLength(0);
  });

  it('без номера колонна опознаётся по подрядчику', () => {
    const out = crewsFromJournal(ctx({
      ground: [ground({ column: undefined })],
    }), TODAY);
    expect(out[0].name).toBe('TERRA TECH');
  });

  it('ни номера, ни подрядчика — колонну не выдумываем', () => {
    const out = crewsFromJournal(ctx({
      ground: [ground({ column: undefined, contractor: undefined })],
    }), TODAY);
    expect(out).toHaveLength(0);
  });

  it('одна бригада и кладёт, и колет — это две записи, как и на месте', () => {
    const out = crewsFromJournal(ctx({
      ground: [ground()], drills: [drill({ column: '1-колонна' })],
    }), TODAY);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.kind).sort()).toEqual(['gnb', 'mkt']);
  });

  it('состав и техника пустые — в дневном отчёте их нет', () => {
    const [c] = crewsFromJournal(ctx({ ground: [ground()] }), TODAY);
    expect(c.members).toEqual([]);
    expect(c.equipment).toEqual({});
    expect(c.note).toContain('по журналу');
    expect(c.note).toContain('смен: 1');
  });
});

describe('сколько бригад в поле', () => {
  it('считает заведённые и выведенные вместе', () => {
    const manual: Crew = {
      id: 'c1', kind: 'mkt', name: '2-колонна', status: 'working',
      members: [], equipment: {}, updatedAt: now,
    };
    const derived = crewsFromJournal(ctx({ ground: [ground()], crews: [manual] }), TODAY);
    const counts = crewCountByKind([manual], derived);
    expect(counts).toEqual([{ kind: 'mkt', total: 2, derived: 1 }]);
  });
});
