import { describe, it, expect } from 'vitest';
import { regionProgress, pace, addWorkdays, attention, daysSince } from './management';
import type {
  SettlementOrder, DailyWorkEntry, AerialWorkEntry, SnpProgress, Crew, Deviation,
} from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function ground(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: 'g1', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 1000 }, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

function aerial(over: Partial<AerialWorkEntry> = {}): AerialWorkEntry {
  return {
    kind: 'aerial', id: 'a1', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    totalM: 500, byCable: {}, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

function order(over: Partial<SettlementOrder> = {}): SettlementOrder {
  return { kato: '191', oblast: 'Акмолинская область', snp: 'Еленовка', planVolsM: 10000, ...over };
}

function snp(over: Partial<SnpProgress> = {}): SnpProgress {
  return {
    kato: '191', snp: 'Еленовка', oblast: 'Акмолинская область',
    stages: {}, updatedAt: now, ...over,
  };
}

const done = { status: 'done' as const, doneAt: now };
const allDone = {
  mkt: done, gnb: done, zaduvka: done, podves: done, svarka: done, sdacha: done,
};

function ctx(over: Partial<Parameters<typeof regionProgress>[0]> = {}) {
  return {
    orders: [], ground: [], aerial: [], progress: [], crews: [], deviations: [],
    ...over,
  };
}

describe('план против факта по областям', () => {
  it('план берёт из реестра, факт — из подземки и подвеса', () => {
    const rows = regionProgress(ctx({
      orders: [order()], ground: [ground()], aerial: [aerial()],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].planM).toBe(10000);
    expect(rows[0].factM).toBe(1500);
    expect(rows[0].pct).toBeCloseTo(0.15, 5);
    expect(rows[0].remainingM).toBe(8500);
  });

  it('без плана процент не выдумывается', () => {
    const rows = regionProgress(ctx({ ground: [ground()] }));
    expect(rows[0].pct).toBeNull();
  });

  it('перевыполнение не создаёт отрицательный остаток', () => {
    const rows = regionProgress(ctx({
      orders: [order({ planVolsM: 500 })], ground: [ground()],
    }));
    expect(rows[0].remainingM).toBe(0);
    expect(rows[0].pct).toBe(2);
  });

  it('считает закрытые, активные и стоящие СНП', () => {
    const rows = regionProgress(ctx({
      progress: [
        snp({ kato: 'a', stages: allDone }),
        snp({ kato: 'b', stages: { mkt: { status: 'in_progress' } } }),
        snp({ kato: 'c', stages: { mkt: { status: 'blocked', blockReason: 'Нет трубы' } } }),
        snp({ kato: 'd' }),
      ],
    }));
    expect(rows[0].snpTotal).toBe(4);
    expect(rows[0].snpDone).toBe(1);
    expect(rows[0].snpActive).toBe(1);
    expect(rows[0].snpBlocked).toBe(1);
  });

  it('область без названия показывается явно, а не теряется', () => {
    const rows = regionProgress(ctx({ ground: [ground({ oblast: '' })] }));
    expect(rows[0].name).toBe('Не указано');
  });

  it('первой идёт область, где больше всего осталось', () => {
    const rows = regionProgress(ctx({
      orders: [
        order({ kato: '1', oblast: 'Малая', planVolsM: 2000 }),
        order({ kato: '2', oblast: 'Большая', planVolsM: 50000 }),
      ],
    }));
    expect(rows.map((r) => r.name)).toEqual(['Большая', 'Малая']);
  });

  it('колонны и открытые отклонения попадают в строку области', () => {
    const crew: Crew = {
      id: 'c1', kind: 'gnb', name: '1-колонна', status: 'working',
      oblast: 'Акмолинская область', members: [], equipment: {}, updatedAt: now,
    };
    const dev: Deviation = {
      id: 'd1', kind: 'depth', date: '2026-09-10', oblast: 'Акмолинская область',
      uchastok: 'Еленовка', kato: '191', lengthM: 50, reason: 'скальник',
      author: 'Ербол', createdAt: now, updatedAt: now,
    };
    const rows = regionProgress(ctx({ crews: [crew], deviations: [dev] }));
    expect(rows[0].crews).toBe(1);
    expect(rows[0].openDeviations).toBe(1);
  });
});

describe('темп и прогноз', () => {
  it('темп считается по рабочим дням, а не по календарю', () => {
    const p = pace(ctx({
      orders: [order({ planVolsM: 10000 })],
      // Две записи с промежутком в месяц: календарно это 1000/30,
      // но работали два дня, значит темп — 1000 в день.
      ground: [ground({ date: '2026-08-01', byMethod: { 'кабелеукладчик': 1000 } }),
               ground({ id: 'g2', date: '2026-09-01', byMethod: { 'кабелеукладчик': 1000 } })],
    }));
    expect(p.workingDays).toBe(2);
    expect(p.metersPerDay).toBe(1000);
    expect(p.remainingM).toBe(8000);
    expect(p.daysLeft).toBe(8);
  });

  it('без выработки прогноза нет — прочерк честнее выдуманной даты', () => {
    const p = pace(ctx({ orders: [order()] }));
    expect(p.metersPerDay).toBe(0);
    expect(p.daysLeft).toBeNull();
    expect(p.finishDate).toBeNull();
  });

  it('окно ограничивает расчёт последними днями', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ground({
      id: `g${i}`,
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      byMethod: { 'кабелеукладчик': i < 10 ? 100 : 1000 },
    }));
    const p = pace(ctx({ orders: [order()], ground: rows }), 10);
    expect(p.workingDays).toBe(10);
    expect(p.metersPerDay).toBe(1000);
  });

  it('подвес участвует в темпе наравне с подземкой', () => {
    const p = pace(ctx({
      orders: [order()],
      ground: [ground({ date: '2026-09-01' })],
      aerial: [aerial({ date: '2026-09-01', totalM: 500 })],
    }));
    expect(p.metersPerDay).toBe(1500);
  });
});

describe('рабочие дни', () => {
  it('выходные пропускаются', () => {
    // 2026-09-18 — пятница; один рабочий день вперёд это понедельник 21-го.
    expect(addWorkdays('2026-09-18', 1)).toBe('2026-09-21');
  });

  it('пять рабочих дней — это календарная неделя', () => {
    expect(addWorkdays('2026-09-21', 5)).toBe('2026-09-28');
  });

  it('несуразно далёкий прогноз не выдаётся', () => {
    expect(addWorkdays('2026-09-18', 99999)).toBeNull();
  });

  it('кривую дату не превращаем в дату', () => {
    expect(addWorkdays('не дата', 5)).toBeNull();
  });
});

describe('что требует решения', () => {
  const base = {
    openDeviations: 0, blocked: [], lowStock: [], negativeStock: 0, unknownStock: 0,
    pendingCorrections: 0, daysSinceLastEntry: null,
  };

  it('в спокойной обстановке список пуст', () => {
    expect(attention(base)).toHaveLength(0);
  });

  it('отклонение без протокола — красное и ведёт в отклонения', () => {
    const rows = attention({ ...base, openDeviations: 3 });
    expect(rows[0].tone).toBe('danger');
    expect(rows[0].view).toBe('deviations');
    expect(rows[0].text).toContain('3');
  });

  it('материалы на исходе называют срок', () => {
    const rows = attention({ ...base, lowStock: [{ material: 'МКТ', daysLeft: 4 }] });
    expect(rows[0].text).toContain('4');
    expect(rows[0].view).toBe('materials');
  });

  it('простои показываются с причиной', () => {
    const rows = attention({ ...base, blocked: [{ snp: 'Еленовка', reason: 'Нет трубы' }] });
    expect(rows[0].text).toBe('Еленовка: стоит — Нет трубы');
  });

  it('длинный список простоев обрезается — иначе его перестанут читать', () => {
    const blocked = Array.from({ length: 12 }, (_, i) => ({ snp: `С${i}`, reason: 'ждём' }));
    expect(attention({ ...base, blocked })).toHaveLength(5);
  });

  it('молчание журнала — тоже сигнал', () => {
    const rows = attention({ ...base, daysSinceLastEntry: 5 });
    expect(rows[0].kind).toBe('idle');
  });

  it('вчерашняя запись сигналом не считается', () => {
    expect(attention({ ...base, daysSinceLastEntry: 1 })).toHaveLength(0);
  });
});

describe('дней с последней записи', () => {
  it('считает календарные дни', () => {
    expect(daysSince('2026-09-15', new Date('2026-09-18T10:00:00Z'))).toBe(3);
  });

  it('будущая дата не даёт отрицательных дней', () => {
    expect(daysSince('2026-09-20', new Date('2026-09-18T10:00:00Z'))).toBe(0);
  });

  it('пустая дата — нет ответа', () => {
    expect(daysSince('')).toBeNull();
  });
});
