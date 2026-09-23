import { describe, it, expect } from 'vitest';
import { parseQuickEntry, parseDate } from './quickEntry';
import { rowsToEntries, guessMapping, guessHeaderRow } from './sheetMap';
import { parseMeters } from './units';
import { searchGlossary, termsIn, lookup } from './glossary';
import { matchRank, searchJournal } from './journalSearch';
import { sortEntries, planFact, weekStart, groupByWeek } from './entriesTable';
import { parseWeather, formatWeather } from './weather';
import type { DailyWorkEntry } from '@/types/construction';

const CTX = {
  contractors: ['Дозер'],
  uchastki: ['Зеренда — Серафимовка', 'Зеренда'],
  columns: ['1-колонна'],
  today: new Date('2026-07-26T10:00:00Z'),
};

describe('scratch', () => {
  it('A: дата перед способом', () => {
    console.log('A1', JSON.stringify(parseQuickEntry('25.07 бар 480 м, Зеренда', CTX)));
    console.log('A2', JSON.stringify(parseQuickEntry('25.07 кабелеукладчик 900, Зеренда', CTX)));
    console.log('A3', JSON.stringify(parseQuickEntry('25.07 ГНБ 72, Зеренда', CTX)));
    console.log('A4', JSON.stringify(parseQuickEntry('25.07 задувка 2400, Зеренда', CTX)));
    console.log('A5', JSON.stringify(parseQuickEntry('Зеренда, 25.07, бар 480', CTX)));
  });

  it('C: ложная дата из числа', () => {
    console.log('C1', parseDate('проложено 1.2 км', CTX.today));
    console.log('C2', parseDate('задувка 3.5 км', CTX.today));
    console.log('C3', parseDate('25.07.202', CTX.today));
    console.log('C4', parseDate('31.02', CTX.today));
    console.log('C5', JSON.stringify(parseQuickEntry('Зеренда 1.2 км баром', CTX)));
  });

  it('D: Excel дата объектом (локальная полночь)', () => {
    console.log('TZ offset min', new Date(2026, 6, 25).getTimezoneOffset());
    const rows: unknown[][] = [
      ['Дата', 'Участок', 'Метры'],
      [new Date(2026, 6, 25), 'У1', 100],
    ];
    const res = rowsToEntries(rows, 0, guessMapping(rows[0]));
    console.log('D1', res.entries[0]?.date, JSON.stringify(res.skipped));
  });

  it('E: невозможный месяц из таблицы', () => {
    const rows: unknown[][] = [
      ['Дата', 'Участок', 'Метры'],
      ['07/25/2026', 'У1', 100],
      ['32.13.2026', 'У2', 100],
      ['25.07.26', 'У3', 100],
      ['25.7.2026', 'У4', 100],
    ];
    const res = rowsToEntries(rows, 0, guessMapping(rows[0]));
    console.log('E', JSON.stringify(res.entries.map((e) => e.date)), JSON.stringify(res.skipped));
    console.log('E-dates-valid', res.entries.map((e) => new Date(`${e.date}T00:00:00Z`).toString()));
  });

  it('F: словарь', () => {
    console.log('F1', termsIn('по ккс-колодцу и МКТ').map((t) => t.term));
    console.log('F2', termsIn('ККС, МКТ.').map((t) => t.term));
    console.log('F3', lookup('ККС,')?.term);
    console.log('F4', searchGlossary('').length);
    console.log('F5', searchGlossary('колодц').map((t) => t.term));
    console.log('F6', searchGlossary('ё').map((t) => t.term));
  });

  it('G: поиск по журналу', () => {
    console.log('G1', matchRank('Серафимовка', 'сера'), matchRank('Новосерафимовка', 'сера'));
    console.log('G2', JSON.stringify(searchJournal('зеренда', {
      snpPoints: [{ kato: '1', snp: 'Зерендa', lat: 1, lon: 1 }],
    })));
    console.log('G3', JSON.stringify(searchJournal('  сера  ', {
      snpPoints: [{ kato: '1', snp: 'Серафимовка', lat: 1, lon: 1 }],
    }).map((h) => h.rank)));
    console.log('G4', JSON.stringify(searchJournal('сера фим', {
      snpPoints: [{ kato: '1', snp: 'Серафимовка', lat: 1, lon: 1 }],
    })));
    console.log('G5', JSON.stringify(searchJournal('Щучинск', {
      crews: [{ id: 'c', name: 'Колонна', kind: 'ку', contractor: 'x', lat: 1, lon: 1 } as never],
    })));
  });

  it('H: сортировка', () => {
    const e = (p: Partial<DailyWorkEntry>): DailyWorkEntry => ({
      id: 'x', kind: 'ground', date: '2026-07-25', smu: '', oblast: '',
      uchastok: '', kato: '', byMethod: {}, materials: {},
      createdAt: '', updatedAt: '', ...p,
    } as DailyWorkEntry);
    const rows = [
      e({ id: 'a', uchastok: 'Ёлкино' }),
      e({ id: 'b', uchastok: 'Елкино' }),
      e({ id: 'c', uchastok: 'Железная' }),
      e({ id: 'd', uchastok: '' }),
    ];
    console.log('H1', sortEntries(rows, 'uchastok', 'asc').map((r) => r.uchastok));
    console.log('H2', sortEntries(rows, 'uchastok', 'desc').map((r) => r.uchastok));
    const pf = planFact([
      e({ id: '1', uchastok: 'с. Еленовка', byMethod: { бар: 800 } }),
      e({ id: '2', uchastok: 'Еленовка', byMethod: { бар: 800 } }),
    ], [{ id: 'r', name: 'Еленовка', coords: [], lengthM: 1500, source: '', createdAt: '', updatedAt: '' } as never]);
    console.log('H3', JSON.stringify(pf));
  });

  it('I: метры', () => {
    console.log('I1', JSON.stringify(parseMeters('1 200,5 м')));
    console.log('I2', JSON.stringify(parseMeters('1,200')));
    console.log('I3', JSON.stringify(parseMeters('480 М')));
    console.log('I4', JSON.stringify(parseMeters('480м.')));
    console.log('I5', JSON.stringify(parseMeters('-5')));
    console.log('I6', JSON.stringify(parseMeters('480 км.')));
    console.log('I7', JSON.stringify(parseMeters('1.2.3')));
    console.log('I8', JSON.stringify(parseMeters('480 пог. м')));
  });

  it('J: погода', () => {
    console.log('J1', JSON.stringify(parseWeather({
      daily: {
        time: ['2026-07-20'],
        temperature_2m_max: [30], temperature_2m_min: [15],
        precipitation_sum: [0], weathercode: [0],
      },
    }, '2026-07-25')));
    console.log('J2', formatWeather({ date: 'x', tMinC: -0.4, tMaxC: 5, source: 'manual' }));
    console.log('J3', formatWeather({ date: 'x', tMinC: 12, tMaxC: 3, source: 'manual' }));
  });

  it('K: недели/заголовки', () => {
    console.log('K1', weekStart('2026-13-45'));
    console.log('K2', JSON.stringify(groupByWeek([{ date: 'мусор', byMethod: {} } as never]).map((g) => g.label)));
    console.log('K3', guessHeaderRow([['Дата', 'Участок'], ['25.07.2026', 'У1', 'х', 'у', 'z']]));
  });
});
