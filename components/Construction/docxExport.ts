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

export type DocBlock = DocParagraph | DocTable;

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
  const re = /<span[^>]*class="[^"]*\bb\b[^"]*"[^>]*>([\s\S]*?)<\/span>|<br\s*\/?>/gi;
  let last = 0;
  let m: RegExpExecArray | null;

  const plain = (chunk: string) => {
    const text = unescapeHtml(chunk.replace(/<[^>]+>/g, ''));
    if (text) runs.push({ text });
  };

  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(inner)) !== null) {
    plain(inner.slice(last, m.index));
    if (m[1] !== undefined) {
      const text = unescapeHtml(m[1].replace(/<[^>]+>/g, ''));
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

function cellWidths(cells: string[]): number[] | null {
  // Колонки в наших таблицах заданы классом, а не процентами. Ширины
  // берём те же, что в печатном CSS: номер узкий, название широкое.
  const w: number[] = cells.map((cls) => {
    if (/\bval\b/.test(cls)) return 18;
    if (/\bunit\b/.test(cls)) return 8;
    return 0;
  });
  const fixed = w.reduce((a, b) => a + b, 0);
  const free = w.filter((x) => x === 0).length;
  if (free === 0 || fixed >= 100) return null;
  const each = (100 - fixed) / free;
  return w.map((x) => (x === 0 ? each : x));
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
  const re = /<h1[^>]*>([\s\S]*?)<\/h1>|<p([^>]*)>([\s\S]*?)<\/p>|<table([^>]*)>([\s\S]*?)<\/table>/gi;
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
    }
  }
  return blocks;
}

function parseTable(inner: string, borderless: boolean): DocTable {
  const rows: DocCell[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let r: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((r = rowRe.exec(inner)) !== null) {
    const cells: DocCell[] = [];
    const classes: string[] = [];
    const cellRe = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
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

export function documentXml(blocks: DocBlock[], opts: DocxOptions = {}): string {
  const body = blocks
    .map((b) => (b.type === 'table' ? tableXml(b) : paraXml(b)))
    .join('');
  const [w, h] = opts.landscape ? [A4.h, A4.w] : [A4.w, A4.h];
  const sect = '<w:sectPr>'
    + `<w:pgSz w:w="${w}" w:h="${h}"${opts.landscape ? ' w:orient="landscape"' : ''}/>`
    + '<w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="1133"'
    + ' w:header="708" w:footer="708" w:gutter="0"/>'
    + '</w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
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

/** Всё содержимое пакета — отдельно от упаковки, чтобы было чем проверять. */
export function docxParts(html: string, opts: DocxOptions = {}): Record<string, string> {
  return {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': ROOT_RELS,
    'word/_rels/document.xml.rels': DOC_RELS,
    'word/styles.xml': stylesXml(opts.fontPt ?? 12),
    'word/document.xml': documentXml(parseDocHtml(html), opts),
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
  for (const [path, content] of Object.entries(docxParts(html, opts))) {
    // Записи-папки в пакете лишние: строгие распаковщики на них спотыкаются.
    zip.file(path, content, { createFolders: false });
  }
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
export type DocFormat = 'doc' | 'docx';

export const DOC_FORMAT_LABEL: Record<DocFormat, string> = {
  docx: 'Word (.docx)',
  doc: 'HTML (.doc)',
};

const FORMAT_KEY = 'optiq-doc-format';

export function loadDocFormat(): DocFormat {
  if (typeof window === 'undefined') return 'docx';
  try {
    return window.localStorage.getItem(FORMAT_KEY) === 'doc' ? 'doc' : 'docx';
  } catch {
    return 'docx';
  }
}

export function saveDocFormat(f: DocFormat): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(FORMAT_KEY, f); } catch { /* приватный режим */ }
}
