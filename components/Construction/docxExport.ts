import { dataUrlBytes, imageSize, fitOnPage } from './imageSize';
/**
 * Настоящий .docx вместо HTML с расширением .doc.
 *
 * HTML, названный документом Ворда, открывается на компьютере в офисе —
 * и с жёлтой полосой «файл повреждён» в новом Ворде, и совсем никак в
 * Ворде на телефоне и в Гугл-Документах. А документ с объекта уходит
 * куратору, который читает его с телефона в машине.
 *
 * Поэтому собираем настоящий пакет: zip с OOXML внутри. Разбираем при
 * этом не любой HTML, а свой собственный — у наших документов словарь
 * закрытый: заголовок, абзац, жирный кусок, таблица. Чужой HTML сюда не
 * попадает, и угадывать не приходится.
 */

export interface DocRun {
  text: string;
  bold?: boolean;
}

export type DocAlign = 'left' | 'center' | 'right' | 'both';

export interface DocParagraph {
  type: 'h1' | 'p';
  runs: DocRun[];
  align?: DocAlign;
  /** Абзац с красной строки. */
  indent?: boolean;
}

export interface DocCell {
  runs: DocRun[];
  align?: DocAlign;
  /** Доля ширины таблицы в процентах — их сумма по строке даёт 100. */
  widthPct?: number;
}

export interface DocTable {
  type: 'table';
  rows: DocCell[][];
  /** Таблица без рамок — так вёрстка подписей внизу листа. */
  borderless?: boolean;
}

export interface DocImage {
  type: 'image';
  /** data-URL снимка: другого источника в наших документах нет. */
  src: string;
  /** Подпись под снимком — где снято и когда. */
  caption?: string;
}

export type DocBlock = DocParagraph | DocTable | DocImage;

// ── Разбор нашего HTML ───────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', laquo: '«', raquo: '»',
};

export function unescapeHtml(s: string): string {
  return s.replace(/&(#?\w+);/g, (m, code: string) => ENTITIES[code] ?? m);
}

/**
 * Куски абзаца: обычный текст и жирный.
 *
 * `<br/>` — это перевод строки внутри абзаца, а не новый абзац: в
 * подписях «Составил / фамилия» вторая строка держится на первой.
 */
export function parseRuns(inner: string): DocRun[] {
  const runs: DocRun[] = [];
  const re = /<span\b[^>]*class="[^"]*\bb\b[^"]*"[^>]*>([\s\S]*?)<\/span>|<br\s*\/?>/gi;
  let last = 0;
  let m: RegExpExecArray | null;

  /**
   * Перевод строки в исходнике — это вёрстка, а не разрыв в тексте.
   *
   * Наши генераторы пишут разметку многострочными шаблонами, с отступами.
   * Оставить их как есть значит получить в документе жёсткий разрыв и
   * восемь пробелов посреди фразы. Настоящий разрыв ставится тегом
   * `<br/>`, и только он.
   */
  const plain = (chunk: string) => {
    const text = unescapeHtml(chunk.replace(/<[^>]+>/g, ''))
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/ {2,}/g, ' ');
    if (text) runs.push({ text });
  };

  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(inner)) !== null) {
    plain(inner.slice(last, m.index));
    if (m[1] !== undefined) {
      const text = unescapeHtml(m[1].replace(/<[^>]+>/g, ''))
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/ {2,}/g, ' ');
      if (text) runs.push({ text, bold: true });
    } else {
      runs.push({ text: '\n' });
    }
    last = m.index + m[0].length;
  }
  plain(inner.slice(last));
  return runs;
}

function alignFrom(attrs: string, fallback: DocAlign = 'both'): DocAlign {
  // Выключка в атрибуте style бьёт класс: в шапке письма номер прижат
  // влево, а адресат вправо — именно этим, а не классом.
  const inline = attrs.match(/text-align\s*:\s*(left|center|right|justify)/i);
  if (inline) return inline[1].toLowerCase() === 'justify' ? 'both' : inline[1].toLowerCase() as DocAlign;
  if (/\bcenter\b|\bobj\b|\bcap\b/.test(attrs)) return 'center';
  if (/\bright\b/.test(attrs)) return 'right';
  if (/\bval\b/.test(attrs)) return 'center';
  if (/\blbl\b|\bunit\b/.test(attrs)) return 'left';
  return fallback;
}

/** Ни одна колонка не должна стать уже этого: иначе текст в ней встаёт столбиком. */
const MIN_COLUMN_PCT = 12;

/**
 * Ширины колонок.
 *
 * Колонки в наших таблицах заданы классом, а не процентами: номер узкий,
 * название широкое. Но брать 18% на каждую цифровую нельзя вслепую: в
 * КС-2 их пять, и на название работ остаётся десять процентов — слово
 * в строку не влезает и встаёт столбиком по букве.
 *
 * Поэтому цифровые колонки ужимаются, когда их много, а название
 * получает не меньше половины листа: его и читают.
 */
function cellWidths(cells: string[]): number[] | null {
  const kinds = cells.map((cls) => {
    if (/\bval\b/.test(cls)) return 'val';
    if (/\bunit\b/.test(cls)) return 'unit';
    return 'label';
  });
  const labels = kinds.filter((k) => k === 'label').length;
  if (labels === 0) return null;

  // Сначала как в печатном CSS: цифровой колонке 18%, единице 8%.
  const natural: number[] = kinds.map((k) => (k === 'val' ? 18 : k === 'unit' ? 8 : 0));
  const taken = natural.reduce((a, b) => a + b, 0);
  const perLabel = (100 - taken) / labels;

  // На трёх колонках так и выходит: названию шестьдесят с лишним. Но в
  // КС-2 цифровых пять, и названию остаётся десять — слово в строку не
  // влезает и встаёт столбиком по букве. Тогда ужимаем цифровые.
  if (taken < 100 && perLabel >= MIN_COLUMN_PCT * 2) {
    return kinds.map((k, i) => (k === 'label' ? perLabel : natural[i]));
  }

  const forLabels = Math.min(60, 100 - (cells.length - labels) * MIN_COLUMN_PCT);
  // Колонок столько, что минимум не помещается ни при каком дележе.
  // Тогда честнее поровну, чем никак: ровные колонки предсказуемы, а без
  // ширин Ворд раздаёт их по содержимому и строки пляшут от страницы к
  // странице.
  if (forLabels < labels * MIN_COLUMN_PCT) {
    const even = 100 / cells.length;
    return cells.map(() => even);
  }
  const rest = (100 - forLabels) / Math.max(1, cells.length - labels);
  return kinds.map((k) => (k === 'label' ? forLabels / labels : rest));
}

/**
 * Разобрать наш документ на блоки.
 *
 * Картинки пропускаем: SVG-схема в OOXML не вставляется без пересчёта в
 * растр, а рядом с ней в том же документе всегда лежит ведомость с теми
 * же цифрами — её и читают.
 */
export function parseDocHtml(html: string): DocBlock[] {
  const body = html.replace(/[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '');
  const blocks: DocBlock[] = [];
  /**
   * `\b` после имени тега — не придирка: `<path d="…">` начинается с
   * `<p`, и без границы он читается абзацем. В исполнительной схеме
   * таких путей десятки, и каждый проглатывает кусок документа до
   * следующего `</p>`.
   */
  const re = new RegExp(
    '<h1\\b[^>]*>([\\s\\S]*?)<\\/h1>'
    + '|<p\\b([^>]*)>([\\s\\S]*?)<\\/p>'
    + '|<table\\b([^>]*)>([\\s\\S]*?)<\\/table>'
    // Снимок с подписью: в фотоотчёте они и есть весь документ, и без
    // них .docx уходит пустым листом с заголовком.
    + '|<div\\b[^>]*class="[^"]*\\bph\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/div>',
    'gi',
  );
  let m: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(body)) !== null) {
    if (m[1] !== undefined) {
      blocks.push({ type: 'h1', runs: parseRuns(m[1]), align: 'center' });
    } else if (m[3] !== undefined) {
      const cls = m[2] ?? '';
      const runs = parseRuns(m[3]);
      if (runs.length === 0) continue;
      blocks.push({
        type: 'p',
        runs: /\bwarn\b/.test(cls) ? runs.map((r) => ({ ...r, bold: true })) : runs,
        align: alignFrom(cls),
        indent: /\bind\b/.test(cls),
      });
    } else if (m[5] !== undefined) {
      const table = parseTable(m[5], /\bsign\b/.test(m[4] ?? ''));
      if (table.rows.length > 0) blocks.push(table);
    } else if (m[6] !== undefined) {
      const src = /<img\b[^>]*\ssrc="([^"]+)"/i.exec(m[6])?.[1];
      // Закрывающий блочный тег — это граница строки, а не пустое место:
      // без пробела «[снимок не вложен]» слипается со следующей подписью.
      const inner = m[6]
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/<\/(p|div|h\d)>/gi, ' ');
      const caption = parseRuns(inner).map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
      if (src) blocks.push({ type: 'image', src, caption: caption || undefined });
      else if (caption) blocks.push({ type: 'p', runs: [{ text: caption }], align: 'center' });
    }
  }
  return blocks;
}

function parseTable(inner: string, borderless: boolean): DocTable {
  const rows: DocCell[][] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let r: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((r = rowRe.exec(inner)) !== null) {
    const cells: DocCell[] = [];
    const classes: string[] = [];
    const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let c: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((c = cellRe.exec(r[1])) !== null) {
      const cls = c[1] ?? '';
      classes.push(cls);
      const bold = /\bb\b/.test(cls);
      const runs = parseRuns(c[2]);
      cells.push({
        runs: bold ? runs.map((x) => ({ ...x, bold: true })) : runs,
        align: alignFrom(cls, borderless ? 'center' : 'left'),
      });
    }
    if (cells.length === 0) continue;
    const widths = borderless ? null : cellWidths(classes);
    if (widths) cells.forEach((cell, i) => { cell.widthPct = widths[i]; });
    rows.push(cells);
  }
  return { type: 'table', rows, borderless };
}

// ── Сборка OOXML ─────────────────────────────────────────────────────────────

export function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ALIGN_VAL: Record<DocAlign, string> = {
  left: 'left', center: 'center', right: 'right', both: 'both',
};

function runXml(r: DocRun, size?: number): string {
  // Перевод строки внутри абзаца — отдельный элемент, а не символ:
  // «\n» в w:t Ворд просто съедает.
  const parts = r.text.split('\n');
  const props = (r.bold || size)
    ? `<w:rPr>${r.bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size}"/>` : ''}</w:rPr>`
    : '';
  const body = parts.map((p, i) => (i > 0 ? '<w:br/>' : '')
    + (p ? `<w:t xml:space="preserve">${xmlEsc(p)}</w:t>` : '')).join('');
  return `<w:r>${props}${body}</w:r>`;
}

function paraXml(p: DocParagraph): string {
  const pr = '<w:pPr>'
    + `<w:jc w:val="${ALIGN_VAL[p.align ?? 'both']}"/>`
    + (p.indent ? '<w:ind w:firstLine="567"/>' : '')
    + (p.type === 'h1' ? '<w:spacing w:before="160" w:after="160"/>' : '')
    + '</w:pPr>';
  const runs = p.runs
    .map((r) => runXml(p.type === 'h1' ? { ...r, bold: true } : r))
    .join('');
  return `<w:p>${pr}${runs}</w:p>`;
}

function cellXml(c: DocCell, borderless: boolean): string {
  const w = c.widthPct
    ? `<w:tcW w:w="${Math.round(c.widthPct * 50)}" w:type="pct"/>`
    : '';
  const valign = borderless ? '<w:vAlign w:val="bottom"/>' : '<w:vAlign w:val="center"/>';
  // Ячейка без абзаца делает файл нечитаемым — пустая всё равно получает
  // свой w:p.
  const body = `<w:p><w:pPr><w:jc w:val="${ALIGN_VAL[c.align ?? 'left']}"/></w:pPr>`
    + c.runs.map((r) => runXml(r)).join('') + '</w:p>';
  return `<w:tc><w:tcPr>${w}${valign}</w:tcPr>${body}</w:tc>`;
}

function tableXml(t: DocTable): string {
  const borders = t.borderless
    ? '<w:tblBorders>'
      + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((s) => `<w:${s} w:val="none" w:sz="0" w:space="0"/>`).join('')
      + '</w:tblBorders>'
    : '<w:tblBorders>'
      + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('')
      + '</w:tblBorders>';
  const pr = '<w:tblPr><w:tblW w:w="5000" w:type="pct"/>'
    + borders
    + '<w:tblCellMar>'
    + '<w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
    + '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/>'
    + '</w:tblCellMar></w:tblPr>';
  const rows = t.rows
    .map((r) => `<w:tr>${r.map((c) => cellXml(c, !!t.borderless)).join('')}</w:tr>`)
    .join('');
  // Пустой абзац после таблицы: две таблицы подряд Ворд склеивает в одну.
  return `<w:tbl>${pr}${rows}</w:tbl><w:p/>`;
}

export interface DocxOptions {
  landscape?: boolean;
  /** Кегль основного текста в пунктах. */
  fontPt?: number;
}

/** А4 в твипах: 1 дюйм = 1440, лист 210 × 297 мм. */
const A4 = { w: 11906, h: 16838 };

/**
 * Снимки, собранные из блоков.
 *
 * Каждый становится отдельной частью пакета со своим отношением: так
 * устроен OOXML, картинку внутрь разметки не положишь.
 */
export interface DocxMedia {
  /**
   * Номер блока документа, к которому относится снимок.
   *
   * Не порядковый номер среди снимков: один снимок мог не прочитаться, и
   * тогда все следующие съезжают на подпись назад. Подпись под
   * фотографией в акте — это где и когда снято, и чужая подпись хуже
   * отсутствующего снимка.
   */
  blockIndex: number;
  /** Путь внутри пакета: word/media/image1.jpeg. */
  path: string;
  /** Идентификатор отношения, по которому на неё ссылается разметка. */
  relId: string;
  /** Байты самого файла. */
  bytes: Uint8Array;
  ext: 'png' | 'jpeg';
  widthEmu: number;
  heightEmu: number;
}

export function collectMedia(blocks: DocBlock[]): DocxMedia[] {
  const out: DocxMedia[] = [];
  blocks.forEach((b, blockIndex) => {
    if (b.type !== 'image') return;
    const bytes = dataUrlBytes(b.src);
    const size = imageSize(bytes);
    // Снимок, размер которого не прочитался, не вставляем: без
    // настоящих пропорций он встанет в документ кривым зеркалом.
    if (!bytes || !size) return;
    const n = out.length + 1;
    const fit = fitOnPage(size);
    out.push({
      blockIndex,
      path: `word/media/image${n}.${size.kind}`,
      relId: `rIdImg${n}`,
      bytes,
      ext: size.kind,
      widthEmu: fit.widthEmu,
      heightEmu: fit.heightEmu,
    });
  });
  return out;
}

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

function imageXml(m: DocxMedia, n: number, caption?: string): string {
  const pic = `<pic:pic xmlns:pic="${PIC_NS}">`
    + `<pic:nvPicPr><pic:cNvPr id="${n}" name="Снимок ${n}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${m.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/>'
    + `<a:ext cx="${m.widthEmu}" cy="${m.heightEmu}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

  const drawing = '<w:drawing>'
    + `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="${WP_NS}">`
    + `<wp:extent cx="${m.widthEmu}" cy="${m.heightEmu}"/>`
    + `<wp:docPr id="${n}" name="Снимок ${n}"/>`
    + `<a:graphic xmlns:a="${DRAWING_NS}"><a:graphicData uri="${PIC_NS}">${pic}</a:graphicData></a:graphic>`
    + '</wp:inline></w:drawing>';

  const body = `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120"/></w:pPr>`
    + `<w:r>${drawing}</w:r></w:p>`;
  if (!caption) return body;
  // Подпись под снимком — мельче и по центру, как в печатном отчёте.
  return body
    + '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="160"/></w:pPr>'
    + `<w:r><w:rPr><w:sz w:val="18"/></w:rPr>`
    + `<w:t xml:space="preserve">${xmlEsc(caption)}</w:t></w:r></w:p>`;
}

export function documentXml(
  blocks: DocBlock[],
  opts: DocxOptions = {},
  media: DocxMedia[] = [],
): string {
  // Снимок ищем по номеру его блока, а не по порядку среди снимков:
  // один мог не прочитаться, и тогда все следующие съехали бы на
  // подпись назад.
  const byBlock = new Map(media.map((m, i) => [m.blockIndex, { m, n: i + 1 }]));
  const body = blocks.map((b, blockIndex) => {
    if (b.type === 'table') return tableXml(b);
    if (b.type === 'image') {
      const hit = byBlock.get(blockIndex);
      if (!hit) {
        // Снимок не вложился — говорим об этом в документе, а не молчим
        // пустым местом там, где должна быть фотография.
        return paraXml({
          type: 'p',
          runs: [{ text: b.caption ? `[снимок не вложен] ${b.caption}` : '[снимок не вложен]' }],
          align: 'center',
        });
      }
      return imageXml(hit.m, hit.n, b.caption);
    }
    return paraXml(b);
  }).join('');
  const [w, h] = opts.landscape ? [A4.h, A4.w] : [A4.w, A4.h];
  const sect = '<w:sectPr>'
    + `<w:pgSz w:w="${w}" w:h="${h}"${opts.landscape ? ' w:orient="landscape"' : ''}/>`
    + '<w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="1133"'
    + ' w:header="708" w:footer="708" w:gutter="0"/>'
    + '</w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document'
    + ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ` xmlns:a="${DRAWING_NS}">`
    + `<w:body>${body}${sect}</w:body></w:document>`;
}

function stylesXml(fontPt: number): string {
  const half = Math.round(fontPt * 2);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:docDefaults><w:rPrDefault><w:rPr>'
    + '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"'
    + ' w:cs="Times New Roman" w:eastAsia="Times New Roman"/>'
    + `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`
    + '<w:lang w:val="ru-RU"/>'
    + '</w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="264" w:lineRule="auto"/>'
    + '</w:pPr></w:pPrDefault></w:docDefaults></w:styles>';
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels"'
  + ' ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-'
  + 'officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-'
  + 'officedocument.wordprocessingml.styles+xml"/>'
  + '</Types>';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Target="word/document.xml"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>'
  + '</Relationships>';

const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Target="styles.xml"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>'
  + '</Relationships>';

/**
 * Всё содержимое пакета — отдельно от упаковки, чтобы было чем проверять.
 *
 * Картинки возвращаются рядом: они двоичные и в строку не лезут, а
 * упаковщик кладёт их теми же байтами, что прочитал из снимка.
 */
export function docxParts(
  html: string,
  opts: DocxOptions = {},
): { text: Record<string, string>; media: DocxMedia[] } {
  const blocks = parseDocHtml(html);
  const media = collectMedia(blocks);

  // Типы картинок объявляем только те, что реально лежат в пакете:
  // лишнее объявление Ворд не любит.
  const exts = [...new Set(media.map((m) => m.ext))];
  const types = CONTENT_TYPES.replace(
    '</Types>',
    exts.map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('') + '</Types>',
  );

  const rels = DOC_RELS.replace(
    '</Relationships>',
    media.map((m) => `<Relationship Id="${m.relId}" Target="${m.path.replace('word/', '')}"`
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>')
      .join('') + '</Relationships>',
  );

  return {
    text: {
      '[Content_Types].xml': types,
      '_rels/.rels': ROOT_RELS,
      'word/_rels/document.xml.rels': rels,
      'word/styles.xml': stylesXml(opts.fontPt ?? 12),
      'word/document.xml': documentXml(blocks, opts, media),
    },
    media,
  };
}

/**
 * Упаковать в .docx.
 *
 * Без сжатия документ тоже открывается, но письмо с ним весит впятеро
 * больше — а отправляют его с телефона в поле.
 */
export async function buildDocx(html: string, opts: DocxOptions = {}): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const { text, media } = docxParts(html, opts);
  for (const [path, content] of Object.entries(text)) {
    // Записи-папки в пакете лишние: строгие распаковщики на них спотыкаются.
    zip.file(path, content, { createFolders: false });
  }
  // Снимки кладём теми же байтами, что прочитали: пережимать их второй
  // раз незачем, они уже ужаты при добавлении в журнал.
  for (const m of media) zip.file(m.path, m.bytes, { createFolders: false, binary: true });
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

/** Имя файла .doc → .docx: расширение меняем, остальное не трогаем. */
export function docxFileName(name: string): string {
  return name.replace(/\.docx?$/i, '') + '.docx';
}

/**
 * В каком виде сохранять документы.
 *
 * Настройка устройства, а не журнала: у инженера в офисе настольный Ворд
 * и привычка к .doc, а прораб шлёт файл с телефона — ему нужен .docx.
 * Выбор помним, чтобы не переключать его при каждом документе.
 */
export type DocFormat = 'doc' | 'docx' | 'pdf';

export const DOC_FORMATS: DocFormat[] = ['docx', 'pdf', 'doc'];

export const DOC_FORMAT_LABEL: Record<DocFormat, string> = {
  docx: 'Word',
  pdf: 'PDF',
  doc: 'HTML (.doc)',
};

export const DOC_FORMAT_HINT: Record<DocFormat, string> = {
  docx: 'Открывается и на телефоне, и в Гугл-Документах. Можно править.',
  pdf: 'Открывается везде и выглядит одинаково. Править нельзя — и это к лучшему, когда документ ушёл.',
  doc: 'Старый формат: открывает только настольный Word, и тот с оговоркой.',
};

const FORMAT_KEY = 'optiq-doc-format';

export function loadDocFormat(): DocFormat {
  if (typeof window === 'undefined') return 'docx';
  try {
    const saved = window.localStorage.getItem(FORMAT_KEY);
    return DOC_FORMATS.includes(saved as DocFormat) ? (saved as DocFormat) : 'docx';
  } catch {
    return 'docx';
  }
}

export function saveDocFormat(f: DocFormat): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(FORMAT_KEY, f); } catch { /* приватный режим */ }
}
