import { describe, it, expect } from 'vitest';
import {
  volumeSheet, costSheet, volumeDocHtml, volumeDocPage, volumeDocFile,
} from './volumeDocs';
import type { DailyWorkEntry } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: patch.id ?? 'x', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'Зеренда — Серафимовка', kato: '1',
    byMethod: { 'бар': 400 }, materials: {}, createdAt: '', updatedAt: '',
    contractor: 'Дозер', ...patch,
  } as DailyWorkEntry;
}

const ROWS = [
  e({ id: 'a', date: '2026-07-25', byMethod: { 'бар': 400 }, drillM: 72, drillCount: 2 }),
  e({ id: 'b', date: '2026-07-27', byMethod: { 'вручную': 150, 'бар': 600 }, materials: { 'МКТ': 1000 } }),
  e({
    id: 'c', date: '2026-08-02', contractor: 'TERRA TECH',
    uchastok: 'Щучинск — Бурабай', byMethod: { 'кабелеукладчик': 2000 },
  }),
];

describe('volumeSheet', () => {
  it('складывает метры по способам', () => {
    const s = volumeSheet(ROWS);
    expect(s.rows.find((r) => r.key === 'бар')?.quantity).toBe(1000);
    expect(s.rows.find((r) => r.key === 'вручную')?.quantity).toBe(150);
    expect(s.totalM).toBe(3150);
  });

  it('чего не делали — того в ведомости нет', () => {
    const s = volumeSheet(ROWS);
    expect(s.rows.some((r) => r.key === 'экскаватор')).toBe(false);
  });

  it('переходы считает и метрами, и штуками', () => {
    const s = volumeSheet(ROWS);
    expect(s.rows.find((r) => r.key === 'drillM')?.quantity).toBe(72);
    expect(s.rows.find((r) => r.key === 'drillCount')?.quantity).toBe(2);
  });

  it('материалы попадают в ведомость своими единицами', () => {
    const s = volumeSheet(ROWS);
    const mkt = s.rows.find((r) => r.key === 'mat-МКТ');
    expect(mkt?.quantity).toBe(1000);
    expect(mkt?.unit).toBe('м');
  });

  it('период сужает выборку', () => {
    const s = volumeSheet(ROWS, { from: '2026-08-01' });
    expect(s.totalM).toBe(2000);
    expect(s.sections).toEqual(['Щучинск — Бурабай']);
  });

  it('подрядчик сужает выборку', () => {
    const s = volumeSheet(ROWS, { contractor: 'Дозер' });
    expect(s.shifts).toBe(2);
  });

  it('период берётся из данных, если его не задали', () => {
    const s = volumeSheet(ROWS);
    expect(s.from).toBe('2026-07-25');
    expect(s.to).toBe('2026-08-02');
  });

  it('пусто — пустая ведомость, а не падение', () => {
    const s = volumeSheet([]);
    expect(s.rows).toEqual([]);
    expect(s.totalM).toBe(0);
  });
});

describe('costSheet', () => {
  const sheet = volumeSheet(ROWS);

  it('считает сумму по расценкам', () => {
    const c = costSheet(sheet, { 'бар': 300, 'вручную': 800 });
    expect(c.rows.find((r) => r.key === 'бар')?.sum).toBe(300_000);
    expect(c.total).toBe(300_000 + 120_000);
  });

  it('позиция без расценки стоит не ноль, а неизвестно сколько', () => {
    const c = costSheet(sheet, { 'бар': 300 });
    expect(c.unpriced.length).toBeGreaterThan(0);
    expect(c.rows.find((r) => r.key === 'вручную')?.sum).toBeUndefined();
    expect(c.total).toBe(300_000);
  });

  it('нулевая расценка — это тоже «нет расценки»', () => {
    const c = costSheet(sheet, { 'бар': 0 });
    expect(c.total).toBe(0);
    expect(c.unpriced).toContain('Бар');
  });
});

describe('volumeDocHtml', () => {
  const sheet = volumeSheet(ROWS);

  it('без денег — ведомость объёмов', () => {
    const html = volumeDocHtml({ sheet });
    expect(html).toContain('ВЕДОМОСТЬ ОБЪЁМОВ');
    expect(html).not.toContain('Цена, ₸');
    expect(html).toContain('Итого проложено');
  });

  it('с расценками — акт приёмки с суммой', () => {
    const html = volumeDocHtml({ sheet, cost: costSheet(sheet, { 'бар': 300 }) });
    expect(html).toContain('ПРИЁМКЕ ВЫПОЛНЕННЫХ РАБОТ');
    expect(html).toContain('Цена, ₸');
    expect(html).toContain('Без расценки');
  });

  it('названия участков экранируются', () => {
    const html = volumeDocHtml({
      sheet: { ...sheet, sections: ['ВОЛС «А» <до> Б'] },
    });
    expect(html).toContain('«А» &lt;до&gt; Б');
  });

  it('страница открывается Word и печатается на A4', () => {
    const page = volumeDocPage({ sheet });
    expect(page).toContain('urn:schemas-microsoft-com:office:word');
    expect(page).toContain('size: A4');
  });

  it('имя файла говорит, что внутри и за какой период', () => {
    expect(volumeDocFile({ sheet })).toBe('Ведомость объёмов 2026-07-25—2026-08-02.doc');
    expect(volumeDocFile({ sheet, cost: costSheet(sheet, {}) })).toContain('КС-2');
  });
});
