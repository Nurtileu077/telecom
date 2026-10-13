import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { jsPDF } from 'jspdf';
import {
  pageBreaks, pdfPageCount, pdfFileName, stylesOf, A4_PX,
  scopeCss, linesOfWords, placeRuns, pageLabel, registerTextFont, addTextLayer, addPageLabel,
  PDF_TEXT_FONT_URL, type WordBox,
} from './pdf';

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

/**
 * Стили акта фиксации и тетради написаны для отдельного файла: «td {
 * border }», «body { font }». Вставленные как есть, они на время сборки
 * обводили рамкой все таблицы приложения.
 */
describe('scopeCss', () => {
  const css = `
  @page { size: A4 landscape; margin: 1.5cm; }
  body { font-family: "Times New Roman", serif; }
  h1, td.k { font-size: 12pt; }
  .act-doc .ph img { width: 100%; }
  body.act-doc p { margin: 0; }
  @media print { .no-print { display: none; } }`;
  const out = scopeCss(css, '.pdf-scope', '.pdf-root');

  it('правила документа привязывает к документу', () => {
    expect(out).toContain('.pdf-scope h1, .pdf-scope td.k { font-size: 12pt; }');
    expect(out).toContain('.pdf-scope .act-doc .ph img');
  });

  it('«body» становится самим документом, а не страницей приложения', () => {
    expect(out).toContain('.pdf-scope > .pdf-root { font-family');
    expect(out).toContain('.pdf-scope > .pdf-root.act-doc p');
    expect(out).not.toMatch(/(^|[\s,}])body\b/);
  });

  it('правила печати снимку не нужны', () => {
    expect(out).not.toContain('@page');
    expect(out).not.toContain('no-print');
  });

  it('ни одного правила без привязки не остаётся', () => {
    for (const rule of out.split('\n').filter(Boolean)) expect(rule.startsWith('.pdf-scope')).toBe(true);
  });
});

/** Слова строки «Акт фиксации участка» и переноса «прокладки». */
function word(text: string, word: string, left: number, top: number, w: number, h = 16): WordBox {
  const start = text.indexOf(word);
  return { start, end: start + word.length, left, top, right: left + w, bottom: top + h };
}

describe('linesOfWords', () => {
  const text = 'Акт фиксации участка  прокладки';

  it('слова одной строки — одна строка, с пробелами между ними', () => {
    const runs = linesOfWords(text, [
      word(text, 'Акт', 0, 0, 30), word(text, 'фиксации', 36, 0, 70), word(text, 'участка', 112, 1, 60),
    ]);
    expect(runs).toEqual([{ text: 'Акт фиксации участка', x: 0, y: 0, w: 172, h: 17 }]);
  });

  it('перенос абзаца начинает новую строку', () => {
    const runs = linesOfWords(text, [
      word(text, 'Акт', 0, 0, 30), word(text, 'фиксации', 36, 0, 70),
      word(text, 'участка', 112, 0, 60), word(text, 'прокладки', 0, 20, 80),
    ]);
    expect(runs.map((r) => r.text)).toEqual(['Акт фиксации участка', 'прокладки']);
    expect(runs[1]).toMatchObject({ x: 0, y: 20 });
  });

  it('невидимое слово строку не рвёт и в неё не попадает', () => {
    const runs = linesOfWords(text, [word(text, 'Акт', 0, 0, 0), word(text, 'фиксации', 36, 0, 70)]);
    expect(runs.map((r) => r.text)).toEqual(['фиксации']);
  });
});

describe('placeRuns', () => {
  const run = (y: number, h = 20) => ({ text: 'Итого', x: 100, y, w: 50, h });

  it('строку кладёт на лист, где её середина, и считает от верха листа', () => {
    const placed = placeRuns([run(10), run(1005), run(1975)], [0, 1000, 2000], 2500, 0.1, 12);
    expect(placed.map((p) => p.page)).toEqual([0, 1, 1]);
    expect(placed[1].yMm).toBeCloseTo(12 + 0.5, 5);
    expect(placed[0].xMm).toBeCloseTo(12 + 10, 5);
  });

  it('то, что за пределами снимка, не кладёт никуда', () => {
    expect(placeRuns([run(3000)], [0, 1000], 2000, 0.1, 12)).toEqual([]);
  });
});

describe('номер листа', () => {
  it('одностраничный документ не нумерует', () => {
    expect(pageLabel(0, 1)).toBe('');
  });

  it('считает с единицы и называет, сколько всего', () => {
    expect(pageLabel(0, 5)).toBe('1 / 5');
    expect(pageLabel(4, 5)).toBe('5 / 5');
  });
});

/**
 * Настоящий jsPDF со шрифтом из public/fonts: в браузере здесь проверить
 * нельзя, а сломанный шрифт или опция, которой нет в этой версии, молча
 * дали бы PDF без текста.
 */
describe('текст в PDF выделяется', () => {
  const font = readFileSync(join(process.cwd(), 'public', PDF_TEXT_FONT_URL)).toString('base64');

  function cmaps(bytes: Buffer): string {
    const out: string[] = [];
    const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    const bin = bytes.toString('latin1');
    let m = re.exec(bin);
    while (m) {
      const raw = Buffer.from(m[1], 'latin1');
      let text: string;
      try { text = inflateSync(raw).toString('latin1'); } catch { text = raw.toString('latin1'); }
      out.push(text);
      m = re.exec(bin);
    }
    return out.join('\n');
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  registerTextFont(doc, font);
  addTextLayer(doc, [
    { page: 0, text: 'Акт № 17 Зеренда — қазақ 1 200 ₸', xMm: 20, yMm: 30, wMm: 90, hMm: 5 },
  ]);
  addPageLabel(doc, pageLabel(0, 3), 210, 297);
  const streams = cmaps(Buffer.from(doc.output('arraybuffer')));

  it('текст лежит невидимым поверх снимка', () => {
    expect(streams).toMatch(/\b3 Tr\b/);
  });

  it('буквы, казахские буквы, тенге и номер переводятся обратно в текст', () => {
    // Таблица ToUnicode: без неё выделенное копируется пустыми квадратами.
    for (const code of ['0410', '0417', '049b', '20b8', '2116']) {
      expect(streams.toLowerCase()).toContain(`<${code}>`);
    }
  });

  it('номер листа стоит видимым текстом', () => {
    expect(streams).toContain('(1 / 3) Tj');
  });
});

describe('новый лист там, где его требует документ', () => {
  it('акт по отклонению в PDF начинается с нового листа, а не посреди основного', () => {
    const stops = Array.from({ length: 40 }, (_, i) => (i + 1) * 100);
    const starts = pageBreaks(3000, 1000, stops, [1250]);
    expect(starts).toContain(1250);
    // До разрыва основной акт режется как обычно, по строкам.
    expect(starts.filter((s) => s < 1250)).toEqual([0, 1000]);
  });

  it('разрыв в самом начале или за концом пустого листа не даёт', () => {
    expect(pageBreaks(800, 1000, [], [0, 900, 5000])).toEqual([0]);
    expect(pageBreaks(800, 1000, [], [0, 500])).toEqual([0, 500]);
  });

  it('листы после разрыва ничего не теряют', () => {
    const total = 2600;
    const starts = pageBreaks(total, 1000, [], [700, 1500]);
    const ends = [...starts.slice(1), total];
    expect(starts).toEqual([0, 700, 1500, 2500]);
    expect(ends.reduce((s, e, i) => s + (e - starts[i]), 0)).toBe(total);
  });
});
