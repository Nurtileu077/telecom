import type { jsPDF } from 'jspdf';

/**
 * Документ в PDF.
 *
 * Word открывается не у всех и не везде, а PDF открывается у всех. Его и
 * просят, когда документ уходит за пределы своей конторы: в акимат, в
 * филиал заказчика, в переписку, где никто ничего не будет править.
 *
 * Делаем снимок свёрстанной страницы и кладём его на листы — так
 * кириллица, таблицы и схема выглядят ровно так, как на бумаге. Но из
 * картинки нельзя ни скопировать номер акта, ни найти в ней «Зеренда»:
 * куратор, получив PDF, перебивал цифры руками. Поэтому поверх снимка
 * лежит невидимый текст — там же, где видимый, как в отсканированном
 * документе с распознаванием. Шрифт для него с кириллицей и казахскими
 * буквами грузится только тогда, когда собирают PDF, а не каждому, кто
 * открывает карту; не загрузился — PDF собирается картинкой, как раньше,
 * и об этом говорится.
 *
 * Листы пронумерованы: акт на пять листов без номеров после степлера
 * собирают в неправильном порядке.
 */

/** Лист A4 в точках экрана при 96 dpi. */
export const A4_PX = {
  portrait: { w: 794, h: 1123 },
  landscape: { w: 1123, h: 794 },
};

/** Поля листа в миллиметрах — те же, что в печатной вёрстке. */
export const PDF_MARGIN_MM = 12;

/**
 * Где резать длинную страницу на листы.
 *
 * Резать ровно по высоте листа нельзя: разрез попадает в середину строки
 * таблицы, и цифра оказывается разрублена между страницами. Поэтому
 * берём места, где резать можно — низ абзаца, низ строки таблицы, — и
 * выбираем из них самое дальнее, которое ещё влезает.
 *
 * Если не влезает ни одно — значит, один кусок выше листа целиком.
 * Тогда режем по высоте: лучше разрубленная таблица, чем пустой лист и
 * потерянный хвост.
 */
export function pageBreaks(
  total: number,
  pagePx: number,
  stops: number[] = [],
  forced: number[] = [],
): number[] {
  if (!(total > 0) || !(pagePx > 0)) return [0];
  // Лист, который в документе начинается с новой страницы (акт по
  // отклонению после основного, схема-приложение), и в PDF начинается с
  // новой: иначе подпись одного акта оказывается на листе другого.
  const cuts = [...new Set(forced)].filter((f) => f > 0 && f < total).sort((a, b) => a - b);
  if (cuts.length > 0) {
    const bounds = [0, ...cuts, total];
    const out: number[] = [];
    for (let k = 0; k + 1 < bounds.length; k += 1) {
      const a = bounds[k];
      const b = bounds[k + 1];
      const local = pageBreaks(b - a, pagePx, stops.filter((x) => x > a && x < b).map((x) => x - a));
      for (const st of local) out.push(a + st);
    }
    return out;
  }
  const sorted = [...new Set(stops)].filter((s) => s > 0 && s < total).sort((a, b) => a - b);
  const starts = [0];
  let top = 0;
  // Совсем мелкий остаток в начале листа не спасает от разреза, а лист
  // тратит: не считаем местом разреза то, что ближе десятой доли листа.
  const minPiece = pagePx * 0.1;

  while (top + pagePx < total) {
    const limit = top + pagePx;
    let cut = 0;
    for (const s of sorted) {
      if (s <= top + minPiece) continue;
      if (s > limit) break;
      cut = s;
    }
    const next = cut > top ? cut : limit;
    if (next <= top) break;
    starts.push(next);
    top = next;
  }
  return starts;
}

/** Сколько листов выйдет. */
export function pdfPageCount(
  total: number,
  pagePx: number,
  stops: number[] = [],
  forced: number[] = [],
): number {
  return pageBreaks(total, pagePx, stops, forced).length;
}

/**
 * Шрифт невидимого текста.
 *
 * DejaVu Serif: в нём есть и казахские буквы двуязычного бланка, и знак
 * тенге, и «№». У Liberation, близкого к Times по ширине, нет ₸ — суммы
 * в КС-2 не находились бы поиском. Ширину подгоняем под строку сами,
 * поэтому совпадение с Times не нужно.
 */
export const PDF_TEXT_FONT_URL = '/fonts/DejaVuSerif.ttf';
const PDF_TEXT_FONT = 'DejaVuSerif';

/** Номер листа внизу — только когда листов больше одного. */
export function pageLabel(index: number, count: number): string {
  return count > 1 ? `${index + 1} / ${count}` : '';
}

/**
 * Чужие стили документа — только внутри документа.
 *
 * У акта фиксации, протокола мобильной группы и тетради стили написаны
 * для отдельного файла: «td { border }», «body { font-family }». Вставленные
 * в страницу как есть, они на время сборки PDF обводили рамкой все
 * таблицы приложения и меняли шрифт всему экрану. Здесь каждое правило
 * привязывается к обёртке документа, а «body» становится самим документом.
 * Правила печати (@page, @media print) снимку не нужны и выбрасываются.
 */
export function scopeCss(css: string, scope: string, root: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    // Конец блока — по счёту скобок: в @media внутри есть свои.
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    const body = css.slice(open + 1, j - 1);
    i = j;
    if (!head) continue;
    if (/^@page\b/i.test(head) || /^@media\s+print\b/i.test(head)) continue;
    if (head.startsWith('@')) {
      // Прочие @-правила (@media screen и подобные) — со своими правилами внутри.
      out.push(/^@media\b/i.test(head)
        ? `${head} { ${scopeCss(body, scope, root)} }`
        : `${head} { ${body} }`);
      continue;
    }
    const selectors = head.split(',').map((x) => x.trim()).filter(Boolean).map((sel) => {
      if (/^(html|body)\b/i.test(sel)) return sel.replace(/^(html\s+body|html|body)\b/i, `${scope} > ${root}`);
      return `${scope} ${sel}`;
    });
    out.push(`${selectors.join(', ')} { ${body.trim()} }`);
  }
  return out.join('\n');
}

/** Слово на листе: где в тексте узла и где на экране. */
export interface WordBox {
  start: number;
  end: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Строка невидимого текста: что и в каком прямоугольнике снимка. */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Слова одного куска текста — в строки.
 *
 * Абзац на листе переносится, и одна строка невидимого текста на весь
 * абзац легла бы поверх первой строки, а остальные остались бы
 * немыми. Новая строка начинается, когда слово ушло ниже или вернулось
 * левее предыдущего.
 */
export function linesOfWords(text: string, words: WordBox[]): TextRun[] {
  const out: TextRun[] = [];
  let cur: { first: WordBox; last: WordBox; left: number; top: number; right: number; bottom: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const t = text.slice(cur.first.start, cur.last.end).replace(/\s+/g, ' ').trim();
    if (t) out.push({ text: t, x: cur.left, y: cur.top, w: cur.right - cur.left, h: cur.bottom - cur.top });
    cur = null;
  };
  for (const w of words) {
    if (!(w.right > w.left) || !(w.bottom > w.top)) continue;
    if (cur) {
      const h = cur.bottom - cur.top;
      const wrapped = w.top >= cur.top + h * 0.6 || w.left < cur.right - h * 0.5;
      if (wrapped) flush();
    }
    if (!cur) {
      cur = { first: w, last: w, left: w.left, top: w.top, right: w.right, bottom: w.bottom };
      continue;
    }
    cur.last = w;
    cur.right = Math.max(cur.right, w.right);
    cur.top = Math.min(cur.top, w.top);
    cur.bottom = Math.max(cur.bottom, w.bottom);
  }
  flush();
  return out;
}

/** Строка, разложенная на свой лист, в миллиметрах от угла листа. */
export interface PlacedRun {
  page: number;
  text: string;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

/**
 * На какой лист и куда ложится строка.
 *
 * Лист выбирается по середине строки: строку, через которую прошёл
 * разрез, всё равно видно на одном из двух листов целиком только там,
 * где лежит большая её часть.
 */
export function placeRuns(
  runs: TextRun[],
  starts: number[],
  total: number,
  pxToMm: number,
  marginMm: number,
): PlacedRun[] {
  const out: PlacedRun[] = [];
  for (const r of runs) {
    if (!r.text || !(r.h > 0) || !(r.w > 0)) continue;
    const mid = r.y + r.h / 2;
    if (mid < 0 || mid >= total) continue;
    let page = 0;
    for (let i = 0; i < starts.length; i += 1) if (starts[i] <= mid) page = i;
    out.push({
      page,
      text: r.text,
      xMm: marginMm + r.x * pxToMm,
      yMm: marginMm + (r.y - starts[page]) * pxToMm,
      wMm: r.w * pxToMm,
      hMm: r.h * pxToMm,
    });
  }
  return out;
}

export function pdfFileName(name: string): string {
  return name.replace(/\.(docx?|pdf)$/i, '') + '.pdf';
}

export interface PdfOptions {
  landscape?: boolean;
  /**
   * Подробность снимка.
   *
   * Двойка — читаемый текст при разумном весе файла. Выше растёт вес, а
   * на печати разницы уже не видно.
   */
  scale?: number;
}

/**
 * Свёрстанную страницу — в PDF.
 *
 * Работает только в браузере: снимок делает он же. В тестах проверяется
 * раскладка по листам, она отсюда вынесена нарочно.
 */
/**
 * Стили из самого документа.
 *
 * У фотоотчёта свои правила для снимков, у схемы — свои для рисунка. Они
 * живут в `<style>` этого документа, а не в общем наборе. Собрать PDF
 * только с общим значит получить фотоотчёт, где снимки во всю ширину
 * экрана, а не во всю ширину листа.
 */
export function stylesOf(html: string): string {
  const out: string[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m = re.exec(html);
  while (m) {
    out.push(m[1]);
    m = re.exec(html);
  }
  return out.join('\n');
}

export async function htmlToPdfBlob(
  html: string,
  css: string,
  opts: PdfOptions = {},
): Promise<Blob> {
  return (await htmlToPdf(html, css, opts)).blob;
}

/** Шрифт текстового слоя — один раз на сеанс: файл в полмегабайта. */
let fontCache: Promise<string | null> | null = null;

function loadTextFont(): Promise<string | null> {
  if (!fontCache) {
    fontCache = (async () => {
      try {
        const res = await fetch(PDF_TEXT_FONT_URL);
        if (!res.ok) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin);
      } catch {
        return null;
      }
    })();
    // Без связи шрифт не пришёл — в следующий раз пробуем снова, а не
    // помним неудачу до перезагрузки.
    fontCache.then((v) => { if (!v) fontCache = null; });
  }
  return fontCache;
}

/**
 * PDF и то, вышел ли в нём текст.
 *
 * `searchable: false` — шрифт не загрузился (нет связи), и PDF вышел
 * картинкой: скопировать из него нельзя, и человеку это говорят.
 */
export async function htmlToPdf(
  html: string,
  css: string,
  opts: PdfOptions = {},
): Promise<{ blob: Blob; searchable: boolean }> {
  if (typeof window === 'undefined') throw new Error('PDF собирается только в браузере');

  const page = opts.landscape ? A4_PX.landscape : A4_PX.portrait;
  const scale = opts.scale ?? 2;
  // Поля вычитаем из ширины: вёрстка внутри должна знать, сколько ей дали.
  const mmToPx = 96 / 25.4;
  const inner = Math.round(page.w - PDF_MARGIN_MM * 2 * mmToPx);

  const host = document.createElement('div');
  // За экраном, но не display:none: скрытое не измеряется и снимка не даёт.
  host.style.cssText = `position:fixed; left:-10000px; top:0; width:${inner}px;`
    + ' background:#fff; z-index:-1;';
  // Свои стили документа важнее общих и идут после них: у фотоотчёта
  // свои правила для снимков, у схемы — свои для рисунка.
  const own = scopeCss(stylesOf(html), '.pdf-scope', '.pdf-root');
  host.innerHTML = `<style>${css}</style>${own ? `<style>${own}</style>` : ''}`
    + `<div class="pdf-scope"><div class="act-doc pdf-root">${bodyOf(html)}</div></div>`;
  document.body.appendChild(host);
  const fontLoad = loadTextFont();

  try {
    const root = host.querySelector('.pdf-root') as HTMLElement;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(root, { scale, backgroundColor: '#ffffff', logging: false });

    // Снимок мог выйти не ровно в scale раз шире: берём то, что вышло.
    const real = canvas.width / inner;
    const stops = breakStops(root, real);
    const pageH = Math.round((page.h - PDF_MARGIN_MM * 2 * mmToPx) * real);
    const starts = pageBreaks(canvas.height, pageH, stops, forcedBreaks(root, real));

    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({
      orientation: opts.landscape ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    const pageW = doc.internal.pageSize.getWidth();
    const pageHmm = doc.internal.pageSize.getHeight();
    const sheetW = pageW - PDF_MARGIN_MM * 2;
    const pxToMm = sheetW / canvas.width;

    // Текст меряем здесь же, пока документ на странице: после снимка его
    // уберут, а мерить нечего.
    const runs = placeRuns(textRuns(root, real), starts, canvas.height, pxToMm, PDF_MARGIN_MM);
    const font = await fontLoad;
    if (font) registerTextFont(doc, font);

    // Пустые куски листами не считаем — иначе номера листов поедут.
    const pages = starts
      .map((from, i) => ({ from, to: i + 1 < starts.length ? starts[i + 1] : canvas.height, index: i }))
      .filter((p) => p.to - p.from > 0);

    for (let n = 0; n < pages.length; n += 1) {
      const { from, to, index: i } = pages[n];
      const h = to - from;

      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      const ctx = slice.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, from, canvas.width, h, 0, 0, canvas.width, h);

      if (n > 0) doc.addPage();
      doc.addImage(
        slice.toDataURL('image/jpeg', 0.92),
        'JPEG',
        PDF_MARGIN_MM,
        PDF_MARGIN_MM,
        sheetW,
        (h * sheetW) / canvas.width,
      );

      if (font) addTextLayer(doc, runs.filter((r) => r.page === i));
      addPageLabel(doc, pageLabel(n, pages.length), pageW, pageHmm);
    }

    return { blob: doc.output('blob'), searchable: !!font };
  } finally {
    host.remove();
  }
}

/** Шрифт текстового слоя — в документ, под своим именем. */
export function registerTextFont(doc: jsPDF, base64: string): void {
  doc.addFileToVFS(`${PDF_TEXT_FONT}.ttf`, base64);
  doc.addFont(`${PDF_TEXT_FONT}.ttf`, PDF_TEXT_FONT, 'normal', 'normal', 'Identity-H');
}

/**
 * Невидимый текст поверх снимка листа.
 *
 * Высота строки на экране — это кегль с межстрочным запасом; ширину
 * подгоняем растяжкой, чтобы выделение мышью легло на те же слова, что
 * видны на снимке.
 */
export function addTextLayer(doc: jsPDF, runs: PlacedRun[]): void {
  if (runs.length === 0) return;
  doc.setFont(PDF_TEXT_FONT, 'normal');
  for (const r of runs) {
    const sizePt = Math.max(2, r.hMm / 0.3528 / 1.16);
    doc.setFontSize(sizePt);
    const natural = doc.getTextWidth(r.text);
    const stretch = natural > 0 ? Math.min(3, Math.max(0.3, r.wMm / natural)) : 1;
    doc.text(r.text, r.xMm, r.yMm, {
      renderingMode: 'invisible', baseline: 'top', horizontalScale: stretch,
    });
  }
}

/**
 * Номер листа внизу по центру.
 *
 * Цифры — встроенным шрифтом PDF: латиница в нём есть всегда, и номер
 * листа не зависит от того, загрузился ли шрифт текста.
 */
export function addPageLabel(doc: jsPDF, label: string, pageW: number, pageH: number): void {
  if (!label) return;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text(label, pageW / 2, pageH - PDF_MARGIN_MM / 2, { align: 'center', baseline: 'middle' });
  doc.setTextColor(0, 0, 0);
}

/**
 * Строки текста документа — в точках снимка.
 *
 * Меряем каждое слово отдельно: только так видно, где абзац перенёсся.
 * Текст в `<style>` не печатается и в слой не идёт.
 */
function textRuns(root: HTMLElement, scale: number): TextRun[] {
  const base = root.getBoundingClientRect();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const out: TextRun[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    if (!text.trim()) continue;
    const tag = node.parentElement?.tagName.toLowerCase();
    if (tag === 'style' || tag === 'script') continue;
    const words: WordBox[] = [];
    const re = /\S+/g;
    let m = re.exec(text);
    while (m) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        words.push({
          start: m.index,
          end: m.index + m[0].length,
          left: (r.left - base.left) * scale,
          top: (r.top - base.top) * scale,
          right: (r.right - base.left) * scale,
          bottom: (r.bottom - base.top) * scale,
        });
      }
      m = re.exec(text);
    }
    out.push(...linesOfWords(text, words));
  }
  return out;
}

/** Тело документа: со страницы Ворда снимаем только то, что печатается. */
function bodyOf(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1] : html;
}

/** Где документ сам требует новую страницу: page-break-before. */
function forcedBreaks(root: HTMLElement, scale: number): number[] {
  const top = root.getBoundingClientRect().top;
  const out: number[] = [];
  root.querySelectorAll<HTMLElement>('[style*="page-break-before"]').forEach((el) => {
    if (!/page-break-before\s*:\s*always/i.test(el.getAttribute('style') ?? '')) return;
    out.push(Math.round((el.getBoundingClientRect().top - top) * scale));
  });
  return out;
}

/**
 * Места, где страницу можно резать.
 *
 * Низ каждого абзаца, заголовка и строки таблицы: между ними разрез
 * никого не рассечёт.
 */
function breakStops(root: HTMLElement, scale: number): number[] {
  const top = root.getBoundingClientRect().top;
  const out: number[] = [];
  root.querySelectorAll('p, h1, h2, tr, div').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    out.push(Math.round((r.bottom - top) * scale));
  });
  return out;
}
