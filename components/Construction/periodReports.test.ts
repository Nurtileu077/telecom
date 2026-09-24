import { describe, it, expect } from 'vitest';
import {
  periodReport, paceChange, periodDocHtml, periodDocFile, periodDocPage,
  snpReadiness, readinessDocHtml, weekRange,
} from './periodReports';
import type { DailyWorkEntry, SnpProgress } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: patch.id ?? 'x', kind: 'ground', date: '2026-07-20', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'Зеренда — Серафимовка', kato: '1',
    byMethod: { 'бар': 400 }, materials: {}, createdAt: '', updatedAt: '',
    contractor: 'Дозер', ...patch,
  } as DailyWorkEntry;
}

const ROWS = [
  e({ id: 'a', date: '2026-07-20', byMethod: { 'бар': 400 } }),
  e({ id: 'b', date: '2026-07-21', byMethod: { 'бар': 600 } }),
  e({
    id: 'c', date: '2026-07-23', byMethod: { 'бар': 1000 },
    uchastok: 'Щучинск — Бурабай', contractor: 'TERRA TECH',
    downtime: 'дождь',
  }),
];

describe('periodReport', () => {
  it('считает метры, смены и дни', () => {
    const r = periodReport(ROWS, { from: '2026-07-20', to: '2026-07-26' });
    expect(r.meters).toBe(2000);
    expect(r.shifts).toBe(3);
    expect(r.days).toBe(3);
  });

  it('раскладывает по участкам от большего', () => {
    const r = periodReport(ROWS);
    expect(r.sections[0].uchastok).toBe('Зеренда — Серафимовка');
    expect(r.sections[0].meters).toBe(1000);
  });

  it('называет дни без работ внутри периода', () => {
    const r = periodReport(ROWS, { from: '2026-07-20', to: '2026-07-26' });
    // Работали 20, 21 и 23 — значит пустых дней четыре.
    expect(r.idleDays).toEqual(['2026-07-22', '2026-07-24', '2026-07-25', '2026-07-26']);
  });

  it('собирает причины простоя', () => {
    const r = periodReport(ROWS);
    expect(r.downtime).toEqual([{ reason: 'дождь', days: 1 }]);
  });

  it('подрядчик сужает выборку', () => {
    const r = periodReport(ROWS, { contractor: 'Дозер' });
    expect(r.meters).toBe(1000);
    expect(r.sections).toHaveLength(1);
  });

  it('пусто — нули, а не деление на ноль', () => {
    const r = periodReport([]);
    expect(r.perShift).toBe(0);
    expect(r.perDay).toBe(0);
  });
});

describe('paceChange', () => {
  const rows = [
    e({ id: 'p1', date: '2026-07-13', byMethod: { 'бар': 500 } }),
    e({ id: 'p2', date: '2026-07-15', byMethod: { 'бар': 500 } }),
    e({ id: 'c1', date: '2026-07-20', byMethod: { 'бар': 1500 } }),
  ];

  it('сравнивает с предыдущим отрезком той же длины', () => {
    const p = paceChange(rows, { from: '2026-07-20', to: '2026-07-26' })!;
    expect(p.previousM).toBe(1000);
    expect(p.currentM).toBe(1500);
    expect(p.change).toBeCloseTo(0.5, 5);
  });

  it('не с чем сравнивать — и не сравниваем', () => {
    expect(paceChange(rows, { from: '2026-01-05', to: '2026-01-11' })).toBeNull();
    expect(paceChange(rows, {})).toBeNull();
  });
});

describe('periodDocHtml', () => {
  const report = periodReport(ROWS, { from: '2026-07-20', to: '2026-07-26' });

  it('называет период, объём и темп', () => {
    const html = periodDocHtml({ report });
    expect(html).toContain('20.07.2026');
    expect(html).toContain('2,00 км');
    expect(html).toContain('По участкам');
  });

  it('показывает изменение темпа со знаком', () => {
    const html = periodDocHtml({
      report, pace: { previousM: 1000, currentM: 1500, change: 0.5 },
    });
    expect(html).toContain('+50%');
  });

  it('отчёт по подрядчику подписан его именем', () => {
    expect(periodDocHtml({ report, contractor: 'Дозер' })).toContain('Дозер');
    expect(periodDocFile({ report, contractor: 'Дозер' })).toContain('Дозер');
  });

  it('страница открывается Word', () => {
    expect(periodDocPage({ report })).toContain('urn:schemas-microsoft-com:office:word');
  });
});

describe('snpReadiness', () => {
  const progress: SnpProgress[] = [
    {
      kato: '1', snp: 'Серафимовка', rayon: 'Зерендинский', updatedAt: '',
      stages: { mkt: { status: 'done' }, gnb: { status: 'done' } },
    },
    { kato: '2', snp: 'Бурабай', stages: {}, updatedAt: '' },
  ];

  it('считает готовность по закрытым этапам', () => {
    const rows = snpReadiness(progress);
    expect(rows[0].snp).toBe('Серафимовка');
    expect(rows[0].done).toBeGreaterThan(0);
    expect(rows[1].done).toBe(0);
  });

  it('говорит, что именно осталось', () => {
    const rows = snpReadiness(progress);
    expect(rows[0].left.length).toBeGreaterThan(0);
  });

  it('в справке видно, сколько сёл закрыто полностью', () => {
    const html = readinessDocHtml(snpReadiness(progress));
    expect(html).toContain('СПРАВКА О ГОТОВНОСТИ');
    expect(html).toContain('Серафимовка');
  });
});

describe('weekRange', () => {
  it('неделя от понедельника до воскресенья', () => {
    expect(weekRange('2026-07-23')).toEqual({ from: '2026-07-20', to: '2026-07-26' });
  });

  it('мусор вместо даты — пустой диапазон', () => {
    expect(weekRange('')).toEqual({ from: '', to: '' });
  });
});

/**
 * Простой пишут в смену, а смена — это работа. Значит день с простоем
 * никогда не бывает днём без работ, и сшивать их в одну фразу
 * («Дней без работ: 2 — дождь (5)») значит писать в отчёт неправду.
 */
describe('простои и пустые дни — разные вещи', () => {
  const rows = [
    e({ id: 'a', date: '2026-07-20', byMethod: { 'бар': 400 }, downtime: 'дождь' }),
    e({ id: 'b', date: '2026-07-21', byMethod: { 'бар': 600 }, downtime: 'дождь' }),
    e({ id: 'c', date: '2026-07-24', byMethod: { 'бар': 300 } }),
  ];
  const report = () => periodReport(rows, { from: '2026-07-20', to: '2026-07-24' });

  it('считает то и другое отдельно', () => {
    const r = report();
    expect(r.idleDays).toEqual(['2026-07-22', '2026-07-23']);
    expect(r.downtime).toEqual([{ reason: 'дождь', days: 2 }]);
  });

  it('в отчёте это две строки, а не одна', () => {
    const html = periodDocHtml({ report: report() });
    expect(html).toContain('Дней без единой смены: <span class="b">2</span>');
    expect(html).toContain('Простои в рабочие дни: дождь — 2 дн');
    expect(html).not.toMatch(/Дней без[^<]*—/);
  });

  it('когда простоев не было, про них не пишет', () => {
    const clean = periodReport(
      [e({ id: 'c', date: '2026-07-24', byMethod: { 'бар': 300 } })],
      { from: '2026-07-24', to: '2026-07-24' },
    );
    const html = periodDocHtml({ report: clean });
    expect(html).not.toContain('Простои в рабочие дни');
    expect(html).not.toContain('Дней без единой смены');
  });
});

describe('участок с разным написанием в отчёте', () => {
  it('сводится в одну строку, а не в две', () => {
    const r = periodReport([
      e({ id: 'a', uchastok: 'Исаковка', byMethod: { 'бар': 400 } }),
      e({ id: 'b', uchastok: 'исаковка ', byMethod: { 'бар': 600 } }),
    ], { from: '2026-07-20', to: '2026-07-24' });
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].uchastok).toBe('Исаковка');
    expect(r.sections[0].meters).toBe(1000);
    expect(r.sections[0].shifts).toBe(2);
  });
});
