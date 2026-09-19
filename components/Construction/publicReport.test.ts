import { describe, it, expect } from 'vitest';
import { publicReportHtml, publicReportFileName } from './publicReport';
import { emptyJournal, type JournalState } from './journalStore';
import type { DailyWorkEntry } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${Math.random()}`, date: '2026-09-14', smu: 'СМУ-2',
    contractor: 'TERRA TECH', column: '1-колонна',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 4000 }, materials: {},
    downtime: 'Ждали согласование',
    createdAt: now, updatedAt: now, ...over,
  };
}

const journal: JournalState = {
  ...emptyJournal(),
  orders: [{ kato: '191', oblast: 'Акмолинская область', snp: 'Еленовка', planVolsM: 10000 }],
  ground: [g()],
};

describe('отчёт заказчику', () => {
  it('показывает план, факт и процент по областям', () => {
    const html = publicReportHtml({ journal });
    expect(html).toContain('Ход строительства ВОЛС');
    expect(html).toContain('Акмолинская область');
    expect(html).toContain('40%');
  });

  it('внутренняя кухня наружу не идёт', () => {
    const html = publicReportHtml({ journal });
    // Ни подрядчиков, ни колонн, ни причин простоя — заказчик по ним
    // решений не принимает, а вопросы они порождают.
    expect(html).not.toContain('TERRA TECH');
    expect(html).not.toContain('1-колонна');
    expect(html).not.toContain('Ждали согласование');
    expect(html).not.toContain('СМУ-2');
  });

  it('можно отдать одну область, а не всё сразу', () => {
    const two: JournalState = {
      ...journal,
      orders: [
        ...journal.orders,
        { kato: '471', oblast: 'Мангистауская область', snp: 'Шетпе', planVolsM: 5000 },
      ],
    };
    const html = publicReportHtml({ journal: two, oblast: 'Акмолинская область' });
    expect(html).toContain('Акмолинская область');
    expect(html).not.toContain('Мангистауская область');
  });

  it('без темпа срок не выдумывается', () => {
    const html = publicReportHtml({ journal: emptyJournal() });
    expect(html).toContain('темпа пока нет');
  });

  it('страница открывается сама по себе — без входа и приложения', () => {
    const html = publicReportHtml({ journal });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('prefers-color-scheme');
  });

  it('имя файла содержит дату', () => {
    expect(publicReportFileName('Акмолинская область', '2026-09-18'))
      .toBe('Ход строительства Акмолинская область 2026-09-18.html');
  });
});
