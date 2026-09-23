import { describe, it, expect } from 'vitest';
import { payroll } from './payroll';
import { drillQueue } from './equipmentUse';
import { planProgress, planSummary } from './weekPlan';
import { timesheet, timesheetTotals } from './timesheet';
import { periodReport, periodDocHtml } from './periodReports';
import type { DailyWorkEntry, WorkRate, Crew, DrillLogEntry } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: 'x', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'У1', kato: '1',
    byMethod: { 'бар': 400 }, materials: {}, createdAt: '', updatedAt: '',
    contractor: 'Дозер',
    ...patch,
  } as DailyWorkEntry;
}

describe('scratch', () => {
  it('A: частичное покрытие расценкой', () => {
    const rates: WorkRate[] = [
      { id: 'r', work: 'бар', price: 300, unit: 'м', from: '2026-08-01', updatedAt: '' },
    ];
    const rows = [
      e({ id: 'a', date: '2026-07-25', byMethod: { 'бар': 400 } }),
      e({ id: 'b', date: '2026-08-05', byMethod: { 'бар': 600 } }),
    ];
    const r = payroll('Дозер', rows, rates, []);
    console.log('LINES', JSON.stringify(r.lines));
    console.log('UNPRICED', JSON.stringify(r.unpriced), 'ACCRUED', r.accrued);
  });

  it('B: цена строки от последней записи', () => {
    const rates: WorkRate[] = [
      { id: 'r1', work: 'бар', price: 300, unit: 'м', from: '2026-01-01', updatedAt: '' },
      { id: 'r2', work: 'бар', price: 350, unit: 'м', from: '2026-08-01', updatedAt: '' },
    ];
    const rows = [
      e({ id: 'a', date: '2026-07-25', byMethod: { 'бар': 400 } }),
      e({ id: 'b', date: '2026-08-05', byMethod: { 'бар': 600 } }),
    ];
    const r = payroll('Дозер', rows, rates, []);
    console.log('B LINES', JSON.stringify(r.lines), 'ACCRUED', r.accrued);
  });

  it('C: drillQueue дни ожидания', () => {
    const drills: DrillLogEntry[] = [{
      id: 'd1', kind: 'drill', drillKind: 'ГНБ', date: '2026-06-01',
      smu: 'СМУ-1', oblast: 'О', uchastok: 'Зеренда', kato: '1',
      meters: 72, count: 1, points: [], createdAt: '', updatedAt: '',
    } as DrillLogEntry];
    const rows = [
      e({ id: 'a', uchastok: 'Зеренда', date: '2026-08-01' }),
      e({ id: 'b', uchastok: 'Аккол', date: '2026-05-01' }),
    ];
    console.log('C', JSON.stringify(drillQueue(drills, rows, '2026-08-01').waiting));
  });

  it('D: два плана на одну бригаду/участок/неделю', () => {
    const rows = [e({ id: 'a', date: '2026-07-20', column: '1-колонна', uchastok: 'Зеренда', byMethod: { 'бар': 4000 } })];
    const plans = [
      { id: 'p1', week: '2026-07-20', crew: '1-колонна', uchastok: 'Зеренда', targetM: 5000, createdAt: '', updatedAt: '' },
      { id: 'p2', week: '2026-07-20', crew: '1-колонна', uchastok: 'Зеренда', targetM: 3000, createdAt: '', updatedAt: '' },
    ];
    const s = planSummary(planProgress(plans, rows));
    console.log('D target', s.targetM, 'done', s.doneM, 'share', s.share);
  });

  it('E: дубликаты карточек колонн', () => {
    const crews: Crew[] = [
      { id: 'c1', kind: 'mkt', name: '1-колонна', status: 'working', members: [{ name: 'А' }], equipment: {}, updatedAt: '' } as Crew,
      { id: 'c2', kind: 'mkt', name: '1 колонна', status: 'working', members: [{ name: 'Б' }], equipment: {}, updatedAt: '' } as Crew,
    ];
    const rows = [e({ id: 'a', column: '1-колонна', byMethod: { 'бар': 5000 } })];
    const t = timesheet(rows, crews);
    console.log('E rows', JSON.stringify(t.map((r) => [r.crew, r.name, r.shifts, r.crewMeters])));
    console.log('E totals', JSON.stringify(timesheetTotals(t)));
  });

  it('F: простои и пустые дни', () => {
    const rows = [
      e({ id: 'a', date: '2026-07-01', downtime: 'дождь' }),
      e({ id: 'b', date: '2026-07-02', downtime: 'дождь' }),
      e({ id: 'c', date: '2026-07-03', downtime: 'дождь' }),
      e({ id: 'd', date: '2026-07-04', downtime: 'дождь' }),
      e({ id: 'f', date: '2026-07-05', downtime: 'дождь' }),
    ];
    const r = periodReport(rows, { from: '2026-07-01', to: '2026-07-07' });
    console.log('F idle', r.idleDays.length, 'downtime', JSON.stringify(r.downtime));
    const html = periodDocHtml({ report: r });
    console.log('F html', html.match(/Дней без работ[^<]*(<[^>]*>)?[^<]*/g));
    const r2 = periodReport(rows, { from: '2026-07-01', to: '2026-07-05' });
    const html2 = periodDocHtml({ report: r2 });
    console.log('F2 idle', r2.idleDays.length, 'downtime', JSON.stringify(r2.downtime), 'htmlHasDowntime', html2.includes('дождь'));
  });

  it('G: пустая колонна в журнале', () => {
    const crews: Crew[] = [
      { id: 'c1', kind: 'mkt', name: '1-колонна', status: 'working', members: [{ name: 'А' }], equipment: {}, updatedAt: '' } as Crew,
    ];
    const rows = [e({ id: 'a', column: undefined, byMethod: { 'бар': 5000 } })];
    console.log('G timesheet', JSON.stringify(timesheet(rows, crews)));
  });
});
