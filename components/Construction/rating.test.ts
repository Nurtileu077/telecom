import { describe, it, expect } from 'vitest';
import { rating, planFor, weekBounds, monthBounds } from './rating';
import type { DailyWorkEntry, SnpProgress, SettlementOrder } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-09-14', smu: 'СМУ-2',
    contractor: 'TERRA TECH', column: '1-колонна',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 2000 }, materials: {},
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('рейтинг', () => {
  it('ранжирует по метрам в смену, а не по общей сумме', () => {
    const rows = rating({ ground: [
      // Долго и помногу, но медленно.
      g({ date: '2026-09-14', contractor: 'Медленные', byMethod: { 'кабелеукладчик': 1000 } }),
      g({ date: '2026-09-15', contractor: 'Медленные', byMethod: { 'кабелеукладчик': 1000 } }),
      g({ date: '2026-09-16', contractor: 'Медленные', byMethod: { 'кабелеукладчик': 1000 } }),
      // Одна смена, но быстрая.
      g({ date: '2026-09-16', contractor: 'Быстрые', byMethod: { 'кабелеукладчик': 2500 } }),
    ] });
    expect(rows[0].name).toBe('Быстрые');
    expect(rows[0].perShift).toBe(2500);
    expect(rows[1].perShift).toBe(1000);
  });

  it('две записи за день — одна смена', () => {
    const rows = rating({ ground: [
      g({ date: '2026-09-14', uchastok: 'А' }),
      g({ date: '2026-09-14', uchastok: 'Б' }),
    ] });
    expect(rows[0].shifts).toBe(1);
    expect(rows[0].perShift).toBe(4000);
  });

  it('срывы считаются отдельно и не вычитаются из метров', () => {
    const rows = rating({ ground: [
      g({ date: '2026-09-14' }),
      g({ date: '2026-09-15', downtime: 'Ждали согласование' }),
    ] });
    expect(rows[0].meters).toBe(4000);
    expect(rows[0].stalls).toBe(1);
    expect(rows[0].reliability).toBe(0.5);
  });

  it('без имени в рейтинг не попадают', () => {
    expect(rating({ ground: [g({ contractor: undefined })] })).toHaveLength(0);
  });

  it('считает закрытые сёла по доске этапов', () => {
    const p: SnpProgress = {
      kato: '191', snp: 'Еленовка', oblast: 'Акмолинская область',
      stages: Object.fromEntries(
        ['mkt', 'gnb', 'zaduvka', 'podves', 'svarka', 'sdacha']
          .map((s) => [s, { status: 'done' as const }]),
      ),
      updatedAt: now,
    };
    expect(rating({ ground: [g()], progress: [p] })[0].snpDone).toBe(1);
  });

  it('можно считать по СМУ и по колоннам', () => {
    expect(rating({ ground: [g()], by: 'smu' })[0].name).toBe('СМУ-2');
    expect(rating({ ground: [g()], by: 'column' })[0].name).toBe('1-колонна');
  });
});

describe('план на период', () => {
  const orders: SettlementOrder[] = [{ kato: '191', oblast: 'А', snp: 'Еленовка', planVolsM: 100000 }];

  it('план — это темп, умноженный на рабочие дни и число бригад', () => {
    const ground = [
      g({ date: '2026-09-14', byMethod: { 'кабелеукладчик': 2000 } }),
      g({ date: '2026-09-15', byMethod: { 'кабелеукладчик': 2000 } }),
    ];
    const p = planFor(ground, orders, { days: 6, from: '2026-09-14', to: '2026-09-19' })!;
    // Медиана 2000, одна бригада, шесть дней.
    expect(p.expectedM).toBe(12000);
    expect(p.doneM).toBe(4000);
    expect(p.remainingM).toBe(96000);
    expect(p.shifts).toBe(2);
  });

  it('без наработанного темпа план не выдумывается', () => {
    expect(planFor([], orders, { days: 6, from: 'a', to: 'b' })).toBeNull();
  });
});

describe('границы периодов', () => {
  it('неделя начинается с понедельника', () => {
    // 2026-09-17 — четверг.
    const w = weekBounds('2026-09-17');
    expect(w.from).toBe('2026-09-14');
    expect(w.to).toBe('2026-09-17');
    expect(w.days).toBe(4);
  });

  it('месяц — с первого числа, без воскресений', () => {
    const m = monthBounds('2026-09-17');
    expect(m.from).toBe('2026-09-01');
    // В сентябре 2026 до 17-го два воскресенья: 6 и 13.
    expect(m.days).toBe(15);
  });
});
