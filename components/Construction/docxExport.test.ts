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
    const parts = docxParts('<body><p>Текст</p></body>');
    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ]);
  });

  it('описание типов ссылается на те же части, что лежат в пакете', () => {
    const parts = docxParts('<body><p>Т</p></body>');
    expect(parts['[Content_Types].xml']).toContain('/word/document.xml');
    expect(parts['[Content_Types].xml']).toContain('/word/styles.xml');
    expect(parts['_rels/.rels']).toContain('word/document.xml');
    expect(parts['word/_rels/document.xml.rels']).toContain('styles.xml');
  });

  it('шрифт документа — тот же Times, что на бумаге', () => {
    const parts = docxParts('<body><p>Т</p></body>', { fontPt: 12 });
    expect(parts['word/styles.xml']).toContain('Times New Roman');
    // Кегль в OOXML — половинки пункта.
    expect(parts['word/styles.xml']).toContain('<w:sz w:val="24"/>');
  });

  it('каждая часть — самостоятельный XML с объявлением', () => {
    for (const body of Object.values(docxParts('<body><p>Т</p></body>'))) {
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
    const doc = docxParts(html)['word/document.xml'];
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
    const doc = docxParts(html, { landscape: true })['word/document.xml'];
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
    }))['word/document.xml'];
    const cells = [...doc.matchAll(/<w:tc>[\s\S]*?<w:jc w:val="(\w+)"\/>[\s\S]*?<\/w:tc>/g)]
      .map((m) => m[1]);
    expect(cells.slice(0, 2)).toEqual(['left', 'right']);
  });
});
