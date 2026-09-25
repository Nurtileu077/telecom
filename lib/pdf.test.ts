import { describe, it, expect } from 'vitest';
import { pageBreaks, pdfPageCount, pdfFileName, stylesOf, A4_PX } from './pdf';

/**
 * Резать ровно по высоте листа нельзя: разрез попадает в середину строки
 * таблицы, и цифра оказывается разрублена между страницами.
 */
describe('pageBreaks', () => {
  it('короткая страница — один лист', () => {
    expect(pageBreaks(500, 1000)).toEqual([0]);
    expect(pdfPageCount(500, 1000)).toBe(1);
  });

  it('ровно в лист — тоже один', () => {
    expect(pageBreaks(1000, 1000)).toEqual([0]);
  });

  it('без мест разреза режет по высоте листа', () => {
    expect(pageBreaks(2500, 1000)).toEqual([0, 1000, 2000]);
  });

  it('режет по последнему месту, которое влезает', () => {
    // Строки таблицы кончаются каждые 120 точек.
    const stops = Array.from({ length: 30 }, (_, i) => (i + 1) * 120);
    const starts = pageBreaks(2400, 1000, stops);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBe(960);
    expect(starts[2]).toBe(1920);
    for (const s of starts.slice(1)) expect(stops).toContain(s);
  });

  it('ни один разрез не приходится на середину строки', () => {
    const stops = Array.from({ length: 40 }, (_, i) => (i + 1) * 97);
    for (const start of pageBreaks(3800, 1000, stops).slice(1)) {
      expect(stops).toContain(start);
    }
  });

  it('листы идут подряд и ничего не теряют', () => {
    const stops = Array.from({ length: 30 }, (_, i) => (i + 1) * 120);
    const total = 2400;
    const starts = pageBreaks(total, 1000, stops);
    const ends = [...starts.slice(1), total];
    let covered = 0;
    for (let i = 0; i < starts.length; i += 1) covered += ends[i] - starts[i];
    expect(covered).toBe(total);
  });

  it('ни один лист не выше листа', () => {
    const stops = Array.from({ length: 30 }, (_, i) => (i + 1) * 120);
    const total = 2400;
    const starts = pageBreaks(total, 1000, stops);
    const ends = [...starts.slice(1), total];
    for (let i = 0; i < starts.length; i += 1) {
      expect(ends[i] - starts[i]).toBeLessThanOrEqual(1000);
    }
  });

  it('кусок выше листа режет по высоте, а не теряет хвост', () => {
    // Одна картинка на 2500 точек: резать её негде.
    const starts = pageBreaks(2500, 1000, [2500]);
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('мелкий остаток в начале листа местом разреза не считает', () => {
    // Разрез на 50-й точке оставил бы лист почти пустым.
    const starts = pageBreaks(2000, 1000, [50, 900]);
    expect(starts).toContain(900);
    expect(starts).not.toContain(50);
  });

  it('места разреза вне страницы не учитывает', () => {
    const starts = pageBreaks(2000, 1000, [-10, 0, 900, 5000]);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBe(900);
    expect(starts.every((x) => x >= 0 && x < 2000)).toBe(true);
  });

  it('пустая или испорченная высота не зацикливает', () => {
    expect(pageBreaks(0, 1000)).toEqual([0]);
    expect(pageBreaks(1000, 0)).toEqual([0]);
    expect(pageBreaks(NaN, 1000)).toEqual([0]);
  });

  it('на длинном документе листов столько, сколько ожидаешь', () => {
    const stops = Array.from({ length: 200 }, (_, i) => (i + 1) * 60);
    expect(pdfPageCount(12_000, 1000, stops)).toBe(13);
  });
});

describe('лист A4', () => {
  it('альбомный — это тот же лист, повёрнутый', () => {
    expect(A4_PX.landscape.w).toBe(A4_PX.portrait.h);
    expect(A4_PX.landscape.h).toBe(A4_PX.portrait.w);
  });

  it('пропорции сходятся с бумагой', () => {
    expect(A4_PX.portrait.h / A4_PX.portrait.w).toBeCloseTo(297 / 210, 2);
  });
});

describe('pdfFileName', () => {
  it('меняет расширение, не трогая имя', () => {
    expect(pdfFileName('Акт Аксу 2026-05-20.doc')).toBe('Акт Аксу 2026-05-20.pdf');
    expect(pdfFileName('Акт Аксу.docx')).toBe('Акт Аксу.pdf');
    expect(pdfFileName('Акт Аксу')).toBe('Акт Аксу.pdf');
    expect(pdfFileName('Акт Аксу.pdf')).toBe('Акт Аксу.pdf');
  });

  it('точку внутри имени за расширение не принимает', () => {
    expect(pdfFileName('Акт 1.2 км.doc')).toBe('Акт 1.2 км.pdf');
  });
});

/**
 * У фотоотчёта свои правила для снимков, у схемы — свои для рисунка. Они
 * живут в `<style>` самого документа, а не в общем наборе. Собрать PDF
 * только с общим значит получить фотоотчёт, где снимки во всю ширину
 * экрана, а не во всю ширину листа.
 */
describe('stylesOf', () => {
  it('забирает стили документа', () => {
    const html = '<html><head><style>.ph img { width: 100%; }</style></head>'
      + '<body><p>Текст</p></body></html>';
    expect(stylesOf(html)).toContain('.ph img');
  });

  it('забирает все блоки, а не первый', () => {
    const html = '<head><style>a{}</style><style>b{}</style></head><body></body>';
    const css = stylesOf(html);
    expect(css).toContain('a{}');
    expect(css).toContain('b{}');
  });

  it('документ без своих стилей даёт пустоту, а не мусор', () => {
    expect(stylesOf('<body><p>Текст</p></body>')).toBe('');
  });

  it('слово style внутри текста за стили не принимает', () => {
    expect(stylesOf('<body><p>style="x" в тексте</p></body>')).toBe('');
  });

  it('атрибуты тега не мешают', () => {
    expect(stylesOf('<style type="text/css" media="print">.a{}</style>')).toContain('.a{}');
  });
});
