import { describe, it, expect } from 'vitest';
import { prepareSectionAct, sectionActDocInput, actFieldsOf } from './actInput';
import { actDocHtml } from './actDocument';
import type { Contractor, DailyWorkEntry, Deviation } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function entry(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: 'g1', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', rayon: 'Аршалынский',
    uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 11100 },
    materials: { 'Лента': 11100, 'ФИТИНГ': 20 },
    contractor: 'TERRA TECH',
    createdAt: now, updatedAt: now, ...over,
  };
}

function deviation(over: Partial<Deviation> = {}): Deviation {
  return {
    id: 'd1', kind: 'depth', date: '2026-09-11',
    oblast: 'Акмолинская область', rayon: 'Аршалынский',
    uchastok: 'Еленовка', kato: '191',
    lengthM: 50, designDepthM: 1.2, actualDepthM: 0.5,
    reason: 'Скальный грунт',
    protocol: { number: '17', date: '2026-09-12' },
    author: 'Ербол', createdAt: now, updatedAt: now, ...over,
  };
}

const contractors: Contractor[] = [
  { id: 'ttk', name: 'Транстелеком' },
  { id: 'fav', name: 'СК Фаворит', fullName: 'ТОО «СК Фаворит инжиниринг»', worksUnder: 'Транстелеком' },
  { id: 'tt', name: 'TERRA TECH', worksUnder: 'СК Фаворит' },
];

const journal = {
  ground: [
    entry(),
    entry({ id: 'g2', uchastok: 'Обалы', kato: '192', byMethod: { 'бар': 3000 } }),
  ],
  deviations: [
    // Скала в соседнем селе — к Еленовке отношения не имеет.
    deviation({ id: 'd-obaly', uchastok: 'Обалы', lengthM: 400, actualDepthM: 0.6 }),
  ],
  actFields: { 'Еленовка': { actNumber: 'АСР-2026-0001', actDate: '2026-09-20' } },
  contractors,
};

describe('акт по участку — один для «Закрытия» и для пакета', () => {
  it('отклонение соседнего села не вычитается из участка и не даёт лишнего листа', () => {
    const p = prepareSectionAct(journal, 'Еленовка');
    expect(p.deviations).toEqual([]);
    expect(p.totals.variants).toHaveLength(1);
    expect(p.totals.variants[0].lengthM).toBe(11100);
    const html = actDocHtml(sectionActDocInput(p, 'ASR'));
    expect(html).not.toContain('уменьшение глубины');
    expect(html.match(/class="sheet"/g)).toHaveLength(1);
  });

  it('своё отклонение по-прежнему закрывается отдельным листом', () => {
    const p = prepareSectionAct(
      { ...journal, deviations: [...journal.deviations, deviation()] },
      'Еленовка',
    );
    expect(p.totals.variants.map((v) => v.lengthM)).toEqual([11050, 50]);
  });

  it('исполнитель в акте назван, а не оставлен прочерком', () => {
    const html = actDocHtml(sectionActDocInput(prepareSectionAct(journal, 'Еленовка'), 'ASR'));
    expect(html).toContain('Произвела осмотр работ, выполненных TERRA TECH');
  });

  it('подрядчик по документам поднимается по цепочке субподряда', () => {
    const p = prepareSectionAct(journal, 'Еленовка');
    expect(p.performer).toBe('TERRA TECH');
    expect(p.contractor).toBe('ТОО «СК Фаворит инжиниринг»');
  });

  it('поля бланка берутся с постоянными строками, как в «Закрытии»', () => {
    const p = prepareSectionAct(journal, 'Еленовка');
    expect(p.fields.actNumber).toBe('АСР-2026-0001');
    expect(p.fields.materials).toContain('kCl-SRV-G');
  });

  it('поля участка находятся, даже если ключ записан другим регистром', () => {
    expect(actFieldsOf({ 'еленовка ': { city: 'Астана' } }, 'Еленовка')?.city).toBe('Астана');
    expect(actFieldsOf({ 'Обалы': { city: 'Астана' } }, 'Еленовка')).toBeUndefined();
  });

  it('область и район берутся из смен самого участка', () => {
    const p = prepareSectionAct(journal, 'Обалы');
    expect(p.oblast).toBe('Акмолинская область');
    expect(p.totals.totalM).toBe(3000);
  });
});

describe('рекультивация в пакете и в «Закрытии»', () => {
  it('без отметки графа пустая в обоих местах, а не «выполнена» в одном из них', () => {
    const p = prepareSectionAct(journal, 'Еленовка');
    expect(p.fields.recultivation).toBeUndefined();
    const html = actDocHtml(sectionActDocInput(p, 'OSR'));
    expect(html).not.toMatch(/Выполнена/);
  });

  it('отмеченная рекультивация уходит в акт как отмечена', () => {
    const p = prepareSectionAct({
      ...journal,
      actFields: { 'Еленовка': { actNumber: 'АСР-2026-0001', recultivation: 'не выполнена' } },
    }, 'Еленовка');
    expect(actDocHtml(sectionActDocInput(p, 'OSR'))).toContain('Не выполнена');
  });
});
