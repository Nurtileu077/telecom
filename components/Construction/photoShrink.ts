/**
 * Сжатие снимков.
 *
 * Телефон снимает в четыре-шесть мегабайт, а снимков за день сорок.
 * Двести мегабайт в память браузера не влезают: она кончается, и вместе
 * с ней перестаёт сохраняться журнал — тот самый, ради которого всё.
 *
 * При этом снимок в акте смотрят с экрана или печатают на А4 через
 * полстраницы. Для этого хватает стороны в 1600 точек: разница с
 * оригиналом видна только при увеличении, которого никто не делает.
 *
 * Не трогаем то, что и так мало: пережимать снимок в 300 КБ значит
 * потерять в качестве и ничего не выиграть в месте.
 */

/** Длинная сторона после сжатия. */
export const MAX_SIDE = 1600;
/** Меньше этого не пережимаем — нечего выигрывать. */
export const SKIP_BELOW_BYTES = 600_000;
/** Качество JPEG: выше — разница не видна, ниже — видна. */
export const QUALITY = 0.82;

export interface ShrinkPlan {
  /** Нужно ли вообще пережимать. */
  shrink: boolean;
  width: number;
  height: number;
  why: string;
}

/**
 * Во что превратится снимок.
 *
 * Отдельно от самого сжатия, чтобы решение можно было проверить, не
 * поднимая браузер: холста и картинок в тестах нет.
 */
export function shrinkPlan(
  width: number,
  height: number,
  bytes: number,
  maxSide = MAX_SIDE,
): ShrinkPlan {
  const keep = (why: string): ShrinkPlan => ({ shrink: false, width, height, why });

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return keep('размер снимка неизвестен');
  }
  if (bytes > 0 && bytes < SKIP_BELOW_BYTES) return keep('снимок и так небольшой');

  const longest = Math.max(width, height);
  if (longest <= maxSide) return keep('снимок и так некрупный');

  const k = maxSide / longest;
  return {
    shrink: true,
    // Округляем вниз и не даём стороне схлопнуться в ноль на очень
    // узких снимках — панораму тоже приносят.
    width: Math.max(1, Math.floor(width * k)),
    height: Math.max(1, Math.floor(height * k)),
    why: `${width}×${height} — крупнее, чем нужно для акта`,
  };
}

/** Сколько места сэкономили — это и есть ответ на «зачем». */
export function savedText(before: number, after: number): string {
  if (!(before > 0) || after >= before) return 'без изменений';
  const share = Math.round((1 - after / before) * 100);
  return `${share}% меньше`;
}

export interface ShrinkResult {
  blob: Blob;
  shrunk: boolean;
  before: number;
  after: number;
  why: string;
}

/**
 * Сжать снимок.
 *
 * Только в браузере: рисует его на холсте. Если что-то не вышло —
 * возвращаем оригинал, а не ошибку: снимок с объекта важнее
 * сэкономленных мегабайт.
 */
export async function shrinkPhoto(file: Blob, maxSide = MAX_SIDE): Promise<ShrinkResult> {
  const before = file.size;
  const asIs = (why: string): ShrinkResult => (
    { blob: file, shrunk: false, before, after: before, why }
  );

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return asIs('сжатие работает только в браузере');
  }
  // PNG со схемой и HEIC с телефона оставляем как есть: у первого
  // пережатие в JPEG портит линии, второй браузер и не откроет.
  if (file.type && !/^image\/(jpe?g|webp)$/i.test(file.type)) {
    return asIs('этот вид снимка не пережимаем');
  }
  if (before > 0 && before < SKIP_BELOW_BYTES) return asIs('снимок и так небольшой');

  try {
    const bitmap = await createImageBitmap(file);
    const plan = shrinkPlan(bitmap.width, bitmap.height, before, maxSide);
    if (!plan.shrink) {
      bitmap.close?.();
      return asIs(plan.why);
    }

    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return asIs('холст недоступен'); }
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
    bitmap.close?.();

    const out = await new Promise<Blob | null>((res) => {
      canvas.toBlob((b) => res(b), 'image/jpeg', QUALITY);
    });
    // Пережатое оказалось больше оригинала — так бывает на уже сжатых
    // снимках. Тогда оригинал и оставляем.
    if (!out || out.size >= before) return asIs('пережатие не дало выигрыша');

    return { blob: out, shrunk: true, before, after: out.size, why: plan.why };
  } catch {
    return asIs('не получилось пережать');
  }
}
