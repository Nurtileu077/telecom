/**
 * Документ в PDF.
 *
 * Word открывается не у всех и не везде, а PDF открывается у всех. Его и
 * просят, когда документ уходит за пределы своей конторы: в акимат, в
 * филиал заказчика, в переписку, где никто ничего не будет править.
 *
 * Делаем снимок свёрстанной страницы и кладём его на листы. Так выходит
 * не текстовый PDF, а картинка в PDF — зато в нём кириллица, таблицы и
 * схема выглядят ровно так, как на бумаге. Текстовый PDF потребовал бы
 * зашить в приложение шрифт с кириллицей, а он весит больше, чем всё
 * приложение целиком, и грузится каждому, кто открывает карту.
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
export function pageBreaks(total: number, pagePx: number, stops: number[] = []): number[] {
  if (!(total > 0) || !(pagePx > 0)) return [0];
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
export function pdfPageCount(total: number, pagePx: number, stops: number[] = []): number {
  return pageBreaks(total, pagePx, stops).length;
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
export async function htmlToPdfBlob(
  html: string,
  css: string,
  opts: PdfOptions = {},
): Promise<Blob> {
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
  host.innerHTML = `<style>${css}</style><div class="act-doc pdf-root">${bodyOf(html)}</div>`;
  document.body.appendChild(host);

  try {
    const root = host.querySelector('.pdf-root') as HTMLElement;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(root, { scale, backgroundColor: '#ffffff', logging: false });

    // Снимок мог выйти не ровно в scale раз шире: берём то, что вышло.
    const real = canvas.width / inner;
    const stops = breakStops(root, real);
    const pageH = Math.round((page.h - PDF_MARGIN_MM * 2 * mmToPx) * real);
    const starts = pageBreaks(canvas.height, pageH, stops);

    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({
      orientation: opts.landscape ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    const sheetW = doc.internal.pageSize.getWidth() - PDF_MARGIN_MM * 2;

    for (let i = 0; i < starts.length; i += 1) {
      const from = starts[i];
      const to = i + 1 < starts.length ? starts[i + 1] : canvas.height;
      const h = to - from;
      if (h <= 0) continue;

      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      const ctx = slice.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, from, canvas.width, h, 0, 0, canvas.width, h);

      if (i > 0) doc.addPage();
      doc.addImage(
        slice.toDataURL('image/jpeg', 0.92),
        'JPEG',
        PDF_MARGIN_MM,
        PDF_MARGIN_MM,
        sheetW,
        (h * sheetW) / canvas.width,
      );
    }

    return doc.output('blob');
  } finally {
    host.remove();
  }
}

/** Тело документа: со страницы Ворда снимаем только то, что печатается. */
function bodyOf(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1] : html;
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
