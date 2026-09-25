import { describe, it, expect } from 'vitest';
import { parseQuickEntry, parseDate } from '@/components/Construction/quickEntry';
import { rowsToEntries, guessMapping, guessHeaderRow } from '@/components/Construction/sheetMap';
import { toCsv, csvCell } from '@/lib/csv';
import { tableToTabs } from '@/lib/tableExport';
import { plainError } from '@/lib/errors';
import { shrinkPlan } from '@/components/Construction/photoShrink';
import { parseLatLon, formatOne, formatLatLon } from '@/components/Construction/coordFormat';

const today = new Date('2026-07-30T00:00:00Z');

describe('quickEntry probes', () => {
  it('dates', () => {
    console.log('25.07, ->', parseDate('25.07, Дозер 480 м бар', today));
    console.log('(25.07) ->', parseDate('(25.07) Дозер 480 м бар', today));
    console.log('25.07.26г ->', parseDate('25.07.26г Дозер 480 м бар', today));
    console.log('last token 25.07 ->', parseDate('Дозер 480 м бар 25.07', today));
    console.log('range 25.07-26.07 ->', parseDate('25.07-26.07 Дозер 480 м бар', today));
    console.log('за 25.07: ->', parseDate('за 25.07: бар 480', today));
  });
  it('meters', () => {
    console.log('1.5 км бар ->', JSON.stringify(parseQuickEntry('25.07 прошли 1.5 км баром, Зеренда', { today, uchastki: ['Зеренда'] })));
    console.log('12.5 м бар ->', JSON.stringify(parseQuickEntry('25.07 бар 12.5 м, Зеренда', { today, uchastki: ['Зеренда'] })));
    console.log('плоский ->', JSON.stringify(parseQuickEntry('25.07 Дозер 480 м кабелеукладчик, Зеренда, ГНБ 72', { today, uchastki: ['Зеренда'] })));
    console.log('гнб 1.5 ->', JSON.stringify(parseQuickEntry('25.07 ГНБ 45 м, Зеренда', { today, uchastki: ['Зеренда'] })));
  });
});

describe('sheetMap probes', () => {
  const mk = (dateCell: unknown) => rowsToEntries(
    [['Дата', 'Участок', 'Метры'], [dateCell, 'Зеренда', 480]],
    0,
    { date: 0, uchastok: 1, meters: 2 },
    { now: '2026-07-30T00:00:00.000Z' },
  );
  it('dates', () => {
    for (const v of ['25.07.26', '25.07.1899', '45863', '2026-7-5', '25/07/26', '-45863', '25.07.0026', '1.5', '29.02.26', '29.02.24']) {
      const r = mk(v);
      console.log(JSON.stringify(v), '->', r.entries[0]?.date ?? `SKIP ${r.skipped[0]?.why}`);
    }
    const d = new Date(2026, 6, 25);
    console.log('Date obj ->', mk(d).entries[0]?.date);
    console.log('serial number ->', mk(45863).entries[0]?.date);
  });
});

describe('csv/tabs probes', () => {
  it('newline', () => {
    console.log('csv:', JSON.stringify(toCsv(['А', 'Б'], [['есть\nперенос', 5]])));
    console.log('tabs:', JSON.stringify(tableToTabs([{ a: 'есть\nперенос', b: 5 }], [
      { header: 'А', value: (r: any) => r.a }, { header: 'Б', value: (r: any) => r.b },
    ])));
    console.log('cell semicolon-dec:', JSON.stringify(csvCell(1234.5, ';', true)));
  });
});

describe('errors probes', () => {
  it('mix', () => {
    console.log(JSON.stringify(plainError(new Error('NetworkError: quota exceeded'))));
    console.log(JSON.stringify(plainError('Failed to fetch')));
    console.log(JSON.stringify(plainError(new Error('AbortError: The user aborted a request.'))));
    console.log(JSON.stringify(plainError('HTTP 403 Forbidden')));
    console.log(JSON.stringify(plainError('Не удалось загрузить 403 записи')));
  });
});

describe('photoShrink probes', () => {
  it('bytes 0', () => {
    console.log(JSON.stringify(shrinkPlan(4000, 3000, 0)));
    console.log(JSON.stringify(shrinkPlan(800, 600, 0)));
    console.log(JSON.stringify(shrinkPlan(4000, 3000, 300_000)));
  });
});

describe('coord probes', () => {
  it('parse', () => {
    for (const s of ['Муфта 3: 52.12, 71.65', 'ККС 339 — 52.09 69.12', 'точка 7: 69.12 E', 'S 33°55\'12" W 18°25\'30"', '52.0914, 69.1234', '52,0914 69,1234', 'N 52°34\'12" E 69°12\'05"']) {
      console.log(JSON.stringify(s), '->', JSON.stringify(parseLatLon(s)));
    }
  });
  it('format', () => {
    console.log(formatOne(52.99999999, 'lat', 'dms'), '|', formatOne(52.99999999, 'lat', 'dm'));
    console.log(formatOne(-52.5, 'lat', 'dms'), '|', formatOne(9.5, 'lat', 'dm'));
    console.log(formatLatLon({ lat: 52.9999999, lon: 69.9999999 }, 'dms'));
    console.log(formatOne(52.0001, 'lat', 'dms'));
  });
});
