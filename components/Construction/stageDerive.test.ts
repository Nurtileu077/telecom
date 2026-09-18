import { describe, it, expect } from 'vitest';
import { deriveStages, applyDerived, effectiveProgress, factsByKato } from './stageDerive';
import { stageStatus } from './stageTasks';
import type {
  SettlementOrder, DailyWorkEntry, AerialWorkEntry, DrillLogEntry, SnpProgress,
} from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function ground(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: 'g1', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', rayon: 'Зерендинский',
    uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 5000 }, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

function aerial(over: Partial<AerialWorkEntry> = {}): AerialWorkEntry {
  return {
    kind: 'aerial', id: 'a1', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    totalM: 800, byCable: {}, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

function drill(over: Partial<DrillLogEntry> = {}): DrillLogEntry {
  return {
    kind: 'drill', id: 'd1', date: '2026-09-11', smu: '', oblast: '', uchastok: '',
    kato: '191', drillKind: 'ГНБ', meters: 72, count: 2, points: [],
    createdAt: now, updatedAt: now, ...over,
  };
}

const order: SettlementOrder = {
  kato: '191', oblast: 'Акмолинская область', rayon: 'Зерендинский',
  snp: 'Еленовка', planVolsM: 10000, planMktM: 10000,
};

function ctx(over: Partial<Parameters<typeof applyDerived>[1]> = {}) {
  return { orders: [], ground: [], aerial: [], drills: [], ...over };
}

function snp(over: Partial<SnpProgress> = {}): SnpProgress {
  return { kato: '191', snp: 'Еленовка', stages: {}, updatedAt: now, ...over };
}

describe('факт по КАТО', () => {
  it('складывает метры, задувку, подвес и проколы', () => {
    const f = factsByKato(ctx({
      ground: [ground({ blowingM: 1200 }), ground({ id: 'g2', date: '2026-09-12' })],
      aerial: [aerial()],
      drills: [drill()],
    })).get('191')!;
    expect(f.laidM).toBe(10000);
    expect(f.blownM).toBe(1200);
    expect(f.aerialM).toBe(800);
    expect(f.drills).toBe(2);
    expect(f.lastDate).toBe('2026-09-12');
  });

  it('записи без КАТО не создают призрачных сёл', () => {
    expect(factsByKato(ctx({ ground: [ground({ kato: '' })] })).size).toBe(0);
  });
});

describe('выведение этапов из журнала', () => {
  it('есть метры — МКТ в работе', () => {
    const d = deriveStages({ laidM: 5000, blownM: 0, aerialM: 0, drills: 0, lastDate: '' }, order);
    expect(d.mkt).toBe('in_progress');
  });

  it('факт добрал план — МКТ закрыта', () => {
    const d = deriveStages({ laidM: 10000, blownM: 0, aerialM: 0, drills: 0, lastDate: '' }, order);
    expect(d.mkt).toBe('done');
  });

  it('98% плана — это сделано, а не «почти»', () => {
    const d = deriveStages({ laidM: 9800, blownM: 0, aerialM: 0, drills: 0, lastDate: '' }, order);
    expect(d.mkt).toBe('done');
  });

  it('без плана закрыть этап нечем — только «в работе»', () => {
    const d = deriveStages({ laidM: 5000, blownM: 0, aerialM: 0, drills: 0, lastDate: '' }, undefined);
    expect(d.mkt).toBe('in_progress');
  });

  it('проколы включают ГНБ', () => {
    const d = deriveStages({ laidM: 0, blownM: 0, aerialM: 0, drills: 3, lastDate: '' }, order);
    expect(d.gnb).toBe('in_progress');
  });

  it('пошла задувка — значит труба уже лежит', () => {
    const d = deriveStages({ laidM: 100, blownM: 500, aerialM: 0, drills: 0, lastDate: '' }, order);
    expect(d.zaduvka).toBe('in_progress');
    expect(d.mkt).toBe('done');
  });

  it('пустой журнал — пустой вывод, ничего не выдумываем', () => {
    expect(deriveStages(undefined, order)).toEqual({});
    expect(deriveStages({ laidM: 0, blownM: 0, aerialM: 0, drills: 0, lastDate: '' }, order)).toEqual({});
  });
});

describe('наложение на карточки', () => {
  it('серая доска оживает сама, без ручных отметок', () => {
    const rows = applyDerived([snp()], ctx({ orders: [order], ground: [ground()] }));
    expect(stageStatus(rows[0], 'mkt')).toBe('in_progress');
    expect(rows[0].stages.mkt?.derived).toBe(true);
  });

  it('ручная отметка сильнее выведенной', () => {
    const manual = snp({ stages: { mkt: { status: 'blocked', blockReason: 'Нет трубы', by: 'Ербол' } } });
    const rows = applyDerived([manual], ctx({ orders: [order], ground: [ground()] }));
    expect(stageStatus(rows[0], 'mkt')).toBe('blocked');
    expect(rows[0].stages.mkt?.blockReason).toBe('Нет трубы');
  });

  it('ранее выведенное обновляется новым фактом', () => {
    const before = snp({ stages: { mkt: { status: 'in_progress', derived: true } } });
    const rows = applyDerived([before], ctx({
      orders: [order], ground: [ground({ byMethod: { 'кабелеукладчик': 10000 } })],
    }));
    expect(stageStatus(rows[0], 'mkt')).toBe('done');
  });

  it('село, о котором в журнале ничего нет, остаётся как было', () => {
    const rows = applyDerived([snp({ kato: '999' })], ctx({ ground: [ground()] }));
    expect(stageStatus(rows[0], 'mkt')).toBe('not_started');
  });
});

describe('карточки без «завести этапы»', () => {
  it('берёт сёла из реестра и журнала и сразу считает этапы', () => {
    const rows = effectiveProgress([], ctx({
      orders: [order],
      ground: [ground({ kato: '392', uchastok: 'Убаган' })],
    }));
    expect(rows.map((r) => r.kato).sort()).toEqual(['191', '392']);
    expect(stageStatus(rows.find((r) => r.kato === '392')!, 'mkt')).toBe('in_progress');
  });

  it('уже заведённые карточки не задваиваются', () => {
    const rows = effectiveProgress([snp()], ctx({ orders: [order] }));
    expect(rows).toHaveLength(1);
  });

  it('подвес засчитывает прокладку — по опорам без трассы не ходят', () => {
    const rows = effectiveProgress([], ctx({ orders: [order], aerial: [aerial()] }));
    expect(stageStatus(rows[0], 'podves')).toBe('in_progress');
    expect(stageStatus(rows[0], 'mkt')).toBe('done');
  });
});
