import { describe, it, expect } from 'vitest';
import {
  parseRuns, parseDocHtml, documentXml, docxParts, docxFileName, unescapeHtml, xmlEsc,
} from './docxExport';
import { letterPage } from './fieldDocs';
import { buildScheme, schemeDocPage } from './asBuilt';
import type { PlanRoute } from '@/types/construction';

describe('unescapeHtml', () => {
  it('возвращает буквы, которые экранировали при печати', () => {
    expect(unescapeHtml('ТОО &laquo;Фаворит&raquo; &amp; К&deg;'))
      .toBe('ТОО «Фаворит» & К&deg;');
    expect(unescapeHtml('1&nbsp;200')).toBe('1 200');
  });
});

describe('parseRuns', () => {
  it('делит абзац на обычный текст и жирный', () => {
    const runs = parseRuns('Всего <span class="b">1 240</span> метров');
    expect(runs).toEqual([
      { text: 'Всего ' },
      { text: '1 240', bold: true },
      { text: ' метров' },
    ]);
  });

  it('br — перевод строки внутри абзаца, а не новый абзац', () => {
    expect(parseRuns('Составил<br/>Иванов')).toEqual([
      { text: 'Составил' }, { text: '\n' }, { text: 'Иванов' },
    ]);
  });

  it('прочие теги выбрасывает, а текст из них оставляет', () => {
    expect(parseRuns('до <i>22</i> мая')).toEqual([{ text: 'до 22 мая' }]);
  });

  it('не путает класс b с буквой b внутри другого класса', () => {
    const runs = parseRuns('<span class="lbl">Участок</span> готов');
    expect(runs.every((r) => !r.bold)).toBe(true);
  });

  it('пустой абзац не даёт пустых кусков', () => {
    expect(parseRuns('')).toEqual([]);
    expect(parseRuns('<br/>')).toEqual([{ text: '\n' }]);
  });
});

describe('parseDocHtml', () => {
  const html = '<body class="act-doc">'
    + '<h1>АКТ</h1>'
    + '<p class="center">№ 14</p>'
    + '<p class="ind">Комиссия в составе <span class="b">трёх</span> человек</p>'
    + '<p class="warn">Не хватает подписи</p>'
    + '<table class="act">'
    + '<tr><td class="val b">№</td><td class="lbl b">Работа</td><td class="val b">Объём</td></tr>'
    + '<tr><td class="val">1</td><td class="lbl">Прокладка МКТ</td><td class="val">1 240</td></tr>'
    + '</table>'
    + '<table class="sign"><tr><td class="s">Составил<br/>Иванов</td>'
    + '<td class="s">Проверил<br/>Петров</td></tr></table>'
    + '</body>';

  it('берёт блоки в том порядке, в каком они в документе', () => {
    const blocks = parseDocHtml(html);
    expect(blocks.map((b) => b.type)).toEqual(['h1', 'p', 'p', 'p', 'table', 'table']);
  });

  it('заголовок всегда по центру', () => {
    const [h] = parseDocHtml(html);
    expect(h).toMatchObject({ type: 'h1', align: 'center' });
    expect((h as { runs: { text: string }[] }).runs[0].text).toBe('АКТ');
  });

  it('красная строка переносится из класса ind', () => {
    const blocks = parseDocHtml(html);
    const ind = blocks.find((b) => b.type === 'p' && b.indent);
    expect(ind).toBeTruthy();
  });

  it('предупреждение целиком жирное — его в документе и ищут глазами', () => {
    const blocks = parseDocHtml(html);
    const warn = blocks.find(
      (b) => b.type === 'p' && b.runs.some((r) => r.text.includes('подписи')),
    );
    expect(warn && 'runs' in warn && warn.runs.every((r) => r.bold)).toBe(true);
  });

  it('шапка таблицы остаётся жирной', () => {
    const t = parseDocHtml(html).find((b) => b.type === 'table');
    expect(t && 'rows' in t && t.rows[0].every((c) => c.runs.every((r) => r.bold))).toBe(true);
  });

  it('колонки получают ширину: номер узкий, название широкое', () => {
    const t = parseDocHtml(html).find((b) => b.type === 'table');
    const row = t && 'rows' in t ? t.rows[0] : [];
    expect(row.map((c) => c.widthPct)).toEqual([18, 64, 18]);
  });

  it('таблица подписей — без рамок: это вёрстка, а не данные', () => {
    const tables = parseDocHtml(html).filter((b) => b.type === 'table');
    expect(tables).toHaveLength(2);
    expect('borderless' in tables[0] && tables[0].borderless).toBe(false);
    expect('borderless' in tables[1] && tables[1].borderless).toBe(true);
  });

  it('всё, что вне body, в документ не попадает', () => {
    const blocks = parseDocHtml(
      '<html><head><title>АКТ</title><style>p { color: red }</style></head>'
      + '<body><p>Текст</p></body></html>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'p' });
  });

  it('рисунок пропускает, а соседние блоки оставляет', () => {
    const blocks = parseDocHtml(
      '<body><h1>СХЕМА</h1><div><svg><text x="1">Муфта</text></svg></div>'
      + '<p>Протяжённость 1,2 км</p></body>',
    );
    expect(blocks.map((b) => b.type)).toEqual(['h1', 'p']);
  });
});

describe('documentXml', () => {
  const xml = (html: string, landscape = false) =>
    documentXml(parseDocHtml(html), { landscape });

  it('собирает валидный по структуре документ', () => {
    const x = xml('<body><p>Текст</p></body>');
    expect(x.startsWith('<?xml version="1.0"')).toBe(true);
    expect(x).toContain('<w:document xmlns:w=');
    expect(x).toContain('<w:body>');
    expect(x).toContain('</w:document>');
    expect(x.indexOf('<w:sectPr>')).toBeGreaterThan(x.indexOf('<w:p>'));
  });

  it('спецсимволы XML экранирует, иначе файл не откроется', () => {
    const x = xml('<body><p>Кабель &lt; 2 &amp; &gt; 1</p></body>');
    const texts = [...x.matchAll(/<w:t[^>]*?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    expect(texts).toContain('Кабель &lt; 2 &amp; &gt; 1');
    for (const t of texts) expect(t).not.toMatch(/&(?!(amp|lt|gt|quot|#\d+);)/);
  });

  it('неразрывный пробел в числах доживает до Ворда', () => {
    const x = xml('<body><p>1&nbsp;240 м</p></body>');
    expect(x).toContain('1 240 м');
    expect(x).toContain('xml:space="preserve"');
  });

  it('перевод строки внутри абзаца — это w:br, а не символ', () => {
    const x = xml('<body><p>Составил<br/>Иванов</p></body>');
    expect(x).toContain('<w:br/>');
    expect(x).not.toContain('\n</w:t>');
  });

  it('жирный кусок помечен, остальной текст — нет', () => {
    const x = xml('<body><p>Всего <span class="b">1 240</span> м</p></body>');
    expect(x).toContain('<w:rPr><w:b/></w:rPr>');
    expect(x.match(/<w:b\/>/g)).toHaveLength(1);
  });

  it('в каждой ячейке есть абзац — иначе Ворд объявит файл повреждённым', () => {
    const x = xml('<body><table class="act"><tr><td class="val"></td>'
      + '<td class="lbl">Работа</td></tr></table></body>');
    expect(x.match(/<w:tc>/g)).toHaveLength(2);
    expect(x.match(/<w:tc><w:tcPr>[\s\S]*?<w:p>/g)).toHaveLength(2);
  });

  it('после таблицы идёт пустой абзац: иначе две таблицы склеятся', () => {
    const x = xml('<body><table class="act"><tr><td>А</td></tr></table>'
      + '<table class="act"><tr><td>Б</td></tr></table></body>');
    expect(x).toContain('</w:tbl><w:p/>');
  });

  it('таблица данных с рамками, таблица подписей без', () => {
    const data = xml('<body><table class="act"><tr><td>А</td></tr></table></body>');
    expect(data).toContain('w:val="single"');
    const sign = xml('<body><table class="sign"><tr><td class="s">А</td></tr></table></body>');
    expect(sign).toContain('w:val="none"');
    expect(sign).not.toContain('w:val="single"');
  });

  it('книжный и альбомный лист различаются размером страницы', () => {
    expect(xml('<body><p>А</p></body>')).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    const land = xml('<body><p>А</p></body>', true);
    expect(land).toContain('w:w="16838"');
    expect(land).toContain('w:orient="landscape"');
  });

  it('пустой документ не роняет сборку', () => {
    const x = xml('<body></body>');
    expect(x).toContain('<w:body>');
    expect(x).toContain('<w:sectPr>');
  });
});

describe('docxParts', () => {
  it('в пакете лежит всё, без чего Ворд файл не откроет', () => {
    const parts = docxParts('<body><p>Текст</p></body>').text;
    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ]);
  });

  it('описание типов ссылается на те же части, что лежат в пакете', () => {
    const parts = docxParts('<body><p>Т</p></body>').text;
    expect(parts['[Content_Types].xml']).toContain('/word/document.xml');
    expect(parts['[Content_Types].xml']).toContain('/word/styles.xml');
    expect(parts['_rels/.rels']).toContain('word/document.xml');
    expect(parts['word/_rels/document.xml.rels']).toContain('styles.xml');
  });

  it('шрифт документа — тот же Times, что на бумаге', () => {
    const parts = docxParts('<body><p>Т</p></body>', { fontPt: 12 }).text;
    expect(parts['word/styles.xml']).toContain('Times New Roman');
    // Кегль в OOXML — половинки пункта.
    expect(parts['word/styles.xml']).toContain('<w:sz w:val="24"/>');
  });

  it('каждая часть — самостоятельный XML с объявлением', () => {
    for (const body of Object.values(docxParts('<body><p>Т</p></body>').text)) {
      expect(body.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    }
  });
});

describe('настоящие документы проходят насквозь', () => {
  it('из письма получается документ с его текстом и кавычками', () => {
    const html = letterPage({
      to: 'АО «Транстелеком»',
      subject: 'О выполненных объёмах',
      number: '14',
      date: '2026-05-20',
      from: 'Нуртилеу А.',
      body: 'За период выполнено 1 240 м.\nУчастки: Аксу — Карабулак.',
    });
    const doc = docxParts(html).text['word/document.xml'];
    expect(doc).toContain('О выполненных объёмах');
    expect(doc).toContain('АО «Транстелеком»');
    expect(doc).toContain('Аксу — Карабулак');
    expect(doc).not.toContain('<td');
    expect(doc).not.toContain('class=');
  });

  it('из исполнительной схемы берёт ведомость, рисунок пропускает', () => {
    const route: PlanRoute = {
      id: 'r1',
      name: 'Аксу — Карабулак',
      coords: [[0, 0], [0, 0.01]],
      lengthM: 1113,
      source: 'plan.kml',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    const html = schemeDocPage({
      scheme: buildScheme(route, []),
      contractor: 'ТОО «СК Фаворит Инжиниринг»',
    });
    const doc = docxParts(html, { landscape: true }).text['word/document.xml'];
    expect(doc).toContain('ИСПОЛНИТЕЛЬНАЯ СХЕМА');
    expect(doc).toContain('Фаворит');
    expect(doc).toContain('<w:tbl>');
    expect(doc).not.toContain('<svg');
    expect(doc).not.toContain('<circle');
    expect(doc).toContain('w:orient="landscape"');
  });
});

describe('docxFileName', () => {
  it('меняет расширение, не трогая имя', () => {
    expect(docxFileName('Акт Аксу 2026-05-20.doc')).toBe('Акт Аксу 2026-05-20.docx');
    expect(docxFileName('Акт Аксу.docx')).toBe('Акт Аксу.docx');
    expect(docxFileName('Акт Аксу')).toBe('Акт Аксу.docx');
  });

  it('точку внутри имени за расширение не принимает', () => {
    expect(docxFileName('Акт 1.2 км.doc')).toBe('Акт 1.2 км.docx');
  });
});

describe('xmlEsc', () => {
  it('закрывает всё, чем можно сломать разметку', () => {
    expect(xmlEsc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

describe('выключка в шапке письма', () => {
  it('номер слева, адресат справа — как на бланке', () => {
    const doc = docxParts(letterPage({
      to: 'АО «Транстелеком»', subject: 'Тема', body: 'Текст', number: '14', date: '2026-05-20',
    })).text['word/document.xml'];
    const cells = [...doc.matchAll(/<w:tc>[\s\S]*?<w:jc w:val="(\w+)"\/>[\s\S]*?<\/w:tc>/g)]
      .map((m) => m[1]);
    expect(cells.slice(0, 2)).toEqual(['left', 'right']);
  });
});

/**
 * В КС-2 цифровых колонок пять, и по 18% на каждую названию работ
 * оставляло десять процентов: слово в строку не влезает и встаёт
 * столбиком по букве.
 */
describe('ширины колонок при многих цифровых', () => {
  const widths = (headerHtml: string) => {
    const t = parseDocHtml(`<body><table class="act"><tr>${headerHtml}</tr></table></body>`)
      .find((b) => b.type === 'table');
    return t && 'rows' in t ? t.rows[0].map((c) => c.widthPct ?? 0) : [];
  };

  it('на трёх колонках названию по-прежнему больше половины', () => {
    expect(widths('<td class="val">1</td><td class="lbl">Работа</td><td class="val">2</td>'))
      .toEqual([18, 64, 18]);
  });

  it('на пяти цифровых название не сжимается в букву', () => {
    const w = widths(
      '<td class="val">№</td><td class="lbl">Наименование работ</td>'
      + '<td class="val">Ед</td><td class="val">Кол</td>'
      + '<td class="val">Цена</td><td class="val">Сумма</td>',
    );
    expect(w[1]).toBeGreaterThanOrEqual(40);
    for (const x of w) expect(x).toBeGreaterThanOrEqual(12);
  });

  it('ширины всегда складываются в сто процентов', () => {
    for (const html of [
      '<td class="val">1</td><td class="lbl">А</td>',
      '<td class="val">1</td><td class="lbl">А</td><td class="unit">м</td>',
      '<td class="val">1</td><td class="lbl">А</td><td class="val">2</td><td class="val">3</td>'
        + '<td class="val">4</td><td class="val">5</td>',
      '<td class="lbl">А</td><td class="lbl">Б</td><td class="val">1</td>',
    ]) {
      const w = widths(html);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    }
  });

  /**
   * Девять колонок по двенадцать процентов не помещаются ни при каком
   * дележе. Тогда честнее поровну, чем никак: ровные колонки
   * предсказуемы, а без ширин Ворд раздаёт их по содержимому, и строки
   * пляшут от страницы к странице.
   */
  it('когда минимум не помещается — делит поровну', () => {
    const w = widths(Array.from({ length: 8 }, () => '<td class="val">1</td>').join('')
      + '<td class="lbl">Работа</td>');
    expect(w).toHaveLength(9);
    expect(new Set(w.map((x) => Math.round(x * 100)))).toHaveLength(1);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });
});

/**
 * Фотоотчёт уходил в .docx пустым листом с заголовком: ни снимков, ни
 * подписей под ними. А снимки и есть весь смысл этого документа — ими
 * подтверждают глубину, засыпку, установленную муфту.
 */
describe('снимки в документе', () => {
  /** Настоящий заголовок PNG заданного размера. */
  function pngUrl(width: number, height: number): string {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    Buffer.from('IHDR').copy(b, 12);
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return `data:image/png;base64,${b.toString('base64')}`;
  }

  const report = (n = 2) => '<body class="act-doc"><h1>ФОТООТЧЁТ</h1>'
    + Array.from({ length: n }, (_, i) => '<div class="ph">'
      + `<img src="${pngUrl(1600, 1200)}" alt=""/>`
      + `<div class="cap">Зеренда, 25.07.2026, снимок ${i + 1}</div>`
      + '</div>').join('')
    + '</body>';

  it('снимок становится блоком документа, а не пропадает', () => {
    const blocks = parseDocHtml(report(2));
    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(2);
  });

  it('подпись под снимком сохраняется', () => {
    const img = parseDocHtml(report(1)).find((b) => b.type === 'image');
    expect(img && 'caption' in img && img.caption).toContain('Зеренда');
  });

  it('каждый снимок кладётся в пакет отдельной частью', () => {
    const { media } = docxParts(report(3));
    expect(media).toHaveLength(3);
    expect(new Set(media.map((m) => m.path))).toHaveLength(3);
    expect(media[0].path).toBe('word/media/image1.png');
  });

  it('на снимок есть отношение, и разметка на него ссылается', () => {
    const { text, media } = docxParts(report(1));
    expect(text['word/_rels/document.xml.rels']).toContain(media[0].relId);
    expect(text['word/_rels/document.xml.rels']).toContain('media/image1.png');
    expect(text['word/document.xml']).toContain(`r:embed="${media[0].relId}"`);
  });

  it('тип картинки объявлен — без этого Ворд файл не откроет', () => {
    const { text } = docxParts(report(1));
    expect(text['[Content_Types].xml']).toContain('Extension="png"');
    expect(text['[Content_Types].xml']).toContain('image/png');
  });

  it('лишних типов не объявляет', () => {
    expect(docxParts(report(1)).text['[Content_Types].xml']).not.toContain('image/jpeg');
  });

  it('размер снимка не врёт: пропорции те же, что у файла', () => {
    const { media } = docxParts(report(1));
    expect(media[0].heightEmu / media[0].widthEmu).toBeCloseTo(1200 / 1600, 3);
  });

  it('разметка объявляет пространства имён, без которых картинки не будет', () => {
    const doc = docxParts(report(1)).text['word/document.xml'];
    expect(doc).toContain('xmlns:r=');
    expect(doc).toContain('xmlns:a=');
    expect(doc).toContain('<w:drawing>');
    expect(doc).toContain('<wp:extent');
  });

  it('снимок, который не прочитался, назван вслух, а не пропущен молча', () => {
    const broken = '<body><div class="ph"><img src="/photos/a.jpg"/>'
      + '<div class="cap">Зеренда</div></div></body>';
    const doc = docxParts(broken).text['word/document.xml'];
    expect(doc).toContain('снимок не вложен');
    expect(doc).toContain('Зеренда');
  });

  it('документ без снимков остаётся как был', () => {
    const { text, media } = docxParts('<body><p>Текст</p></body>');
    expect(media).toHaveLength(0);
    expect(text['[Content_Types].xml']).not.toContain('Extension="png"');
    expect(text['word/document.xml']).not.toContain('<w:drawing>');
  });
});

/**
 * Снимок, который не прочитался, не должен сдвигать остальные: подпись
 * под фотографией в акте — это где и когда снято, и чужая подпись под
 * снимком хуже отсутствующего снимка.
 */
describe('битый снимок среди целых', () => {
  function pngUrl(w: number, h: number): string {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); Buffer.from('IHDR').copy(b, 12);
    b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
    return `data:image/png;base64,${b.toString('base64')}`;
  }

  const mixed = '<body>'
    // Первый не прочитается: это не data-URL.
    + '<div class="ph"><img src="/photos/a.jpg"/><div class="cap">Первый</div></div>'
    + `<div class="ph"><img src="${pngUrl(1600, 1200)}"/><div class="cap">Второй</div></div>`
    + `<div class="ph"><img src="${pngUrl(800, 600)}"/><div class="cap">Третий</div></div>`
    + '</body>';

  it('целые снимки попадают в пакет, битый — нет', () => {
    expect(docxParts(mixed).media).toHaveLength(2);
  });

  it('подписи не съезжают: под битым сказано, что его нет', () => {
    const doc = docxParts(mixed).text['word/document.xml'];
    const first = doc.indexOf('Первый');
    expect(doc.slice(Math.max(0, first - 200), first)).toContain('снимок не вложен');
  });

  it('целые снимки остаются при своих подписях', () => {
    const doc = docxParts(mixed).text['word/document.xml'];
    // Между «Второй» и «Третий» должен быть ровно один рисунок.
    const between = doc.slice(doc.indexOf('Второй'), doc.indexOf('Третий'));
    expect(between.match(/<w:drawing>/g)).toHaveLength(1);
  });

  it('число рисунков равно числу целых снимков', () => {
    const doc = docxParts(mixed).text['word/document.xml'];
    expect(doc.match(/<w:drawing>/g)).toHaveLength(2);
  });

  it('каждый рисунок ссылается на своё отношение', () => {
    const { text, media } = docxParts(mixed);
    const doc = text['word/document.xml'];
    const refs = [...doc.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
    expect(refs).toEqual(media.map((m) => m.relId));
    expect(new Set(refs)).toHaveLength(refs.length);
  });
});
