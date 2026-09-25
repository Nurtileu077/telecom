/**
 * Размер картинки из её же байтов.
 *
 * Нужен, чтобы вставить снимок в документ, не растянув и не сплющив: в
 * OOXML размер задаётся числом, а не «по месту», и без настоящих
 * пропорций фотография в акте выглядит кривым зеркалом.
 *
 * Читаем заголовок, а не рисуем на холсте: холста нет ни на сервере, ни
 * в тестах, а заголовок у PNG и JPEG устроен просто и меняться не
 * собирается.
 */

export interface ImageSize {
  width: number;
  height: number;
  /** Расширение для имени части в пакете: png или jpeg. */
  kind: 'png' | 'jpeg';
}

/** Data-URL в байты. Не data-URL — значит, и не картинка. */
export function dataUrlBytes(url: string): Uint8Array | null {
  // [\s\S] вместо флага s: цель сборки его ещё не знает.
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url ?? '');
  if (!m) return null;
  const body = m[3];
  try {
    if (m[2]) {
      const bin = typeof atob === 'function'
        ? atob(body)
        : Buffer.from(body, 'base64').toString('binary');
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    }
    const text = decodeURIComponent(body);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  for (let i = 0; i < PNG_MAGIC.length; i += 1) if (b[i] !== PNG_MAGIC[i]) return null;
  // Размер лежит в IHDR, первым чанком, двумя числами по четыре байта.
  const at = (o: number) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
  const width = at(16);
  const height = at(20);
  if (!width || !height) return null;
  return { width, height, kind: 'png' };
}

/**
 * JPEG: идём по сегментам до того, где записан размер.
 *
 * Их несколько видов (SOF0…SOF15), и телефоны пишут разные. Пропускаем
 * те, что размера не несут, — иначе на снимке с прогрессивной
 * развёрткой разбор остановится ни на чём.
 */
function jpegSize(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    // Заполнители и маркеры без длины.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      if (!width || !height) return null;
      return { width, height, kind: 'jpeg' };
    }
    i += 2 + len;
  }
  return null;
}

/** Размер картинки. Не узнали — так и говорим, а не выдумываем. */
export function imageSize(bytes: Uint8Array | null): ImageSize | null {
  if (!bytes || bytes.length < 4) return null;
  return pngSize(bytes) ?? jpegSize(bytes);
}

export function imageSizeOfDataUrl(url: string): ImageSize | null {
  return imageSize(dataUrlBytes(url));
}

/** Сколько это в EMU — единице, которой меряет размеры OOXML. */
export const EMU_PER_CM = 360_000;

/**
 * Во что превратится снимок на листе.
 *
 * Шире колонки не делаем, и выше трети листа тоже: иначе на страницу
 * влезает один снимок, а в фотоотчёте их сорок.
 */
export function fitOnPage(
  size: ImageSize,
  maxWidthCm = 16,
  maxHeightCm = 9,
): { widthEmu: number; heightEmu: number } {
  const ratio = size.height / size.width;
  let wCm = maxWidthCm;
  let hCm = wCm * ratio;
  if (hCm > maxHeightCm) {
    hCm = maxHeightCm;
    wCm = hCm / ratio;
  }
  return {
    widthEmu: Math.max(1, Math.round(wCm * EMU_PER_CM)),
    heightEmu: Math.max(1, Math.round(hCm * EMU_PER_CM)),
  };
}
