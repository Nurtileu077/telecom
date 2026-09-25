import { describe, it, expect } from 'vitest';
import {
  dataUrlBytes, imageSize, imageSizeOfDataUrl, fitOnPage, EMU_PER_CM,
} from './imageSize';

/** Настоящий заголовок PNG: подпись, длина чанка, «IHDR», ширина, высота. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  const put = (o: number, v: number) => {
    b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255;
    b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255;
  };
  put(16, width);
  put(20, height);
  return b;
}

/** Заголовок JPEG с сегментом SOF заданного вида. */
function jpeg(width: number, height: number, marker = 0xc0, before: number[] = []): Uint8Array {
  const head = [0xff, 0xd8, ...before];
  const sof = [
    0xff, marker, 0x00, 0x11, 0x08,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  return new Uint8Array([...head, ...sof]);
}

describe('dataUrlBytes', () => {
  it('разбирает base64', () => {
    const bytes = dataUrlBytes('data:image/png;base64,iVBORw==');
    expect(bytes?.[0]).toBe(0x89);
    expect(bytes?.[1]).toBe(0x50);
  });

  it('не data-URL — значит и не картинка', () => {
    expect(dataUrlBytes('/photos/a.jpg')).toBeNull();
    expect(dataUrlBytes('')).toBeNull();
  });

  it('испорченный base64 не роняет разбор', () => {
    expect(() => dataUrlBytes('data:image/png;base64,!!!!')).not.toThrow();
  });
});

describe('размер PNG', () => {
  it('читает ширину и высоту из заголовка', () => {
    expect(imageSize(png(4032, 3024))).toEqual({ width: 4032, height: 3024, kind: 'png' });
  });

  it('крупные размеры не переполняются', () => {
    expect(imageSize(png(20000, 15000))?.width).toBe(20000);
  });

  it('обрезанный файл — не размер, а «не знаю»', () => {
    expect(imageSize(png(100, 100).slice(0, 12))).toBeNull();
  });

  it('нулевая сторона размером не считается', () => {
    expect(imageSize(png(0, 100))).toBeNull();
  });
});

describe('размер JPEG', () => {
  it('читает обычный снимок с телефона', () => {
    expect(imageSize(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024, kind: 'jpeg' });
  });

  it('находит размер за сегментом EXIF', () => {
    // APP1 с EXIF длиной 8 байт — телефоны пишут его первым.
    const exif = [0xff, 0xe1, 0x00, 0x08, 1, 2, 3, 4, 5, 6];
    expect(imageSize(jpeg(1600, 1200, 0xc0, exif))?.width).toBe(1600);
  });

  it('понимает прогрессивную развёртку', () => {
    expect(imageSize(jpeg(800, 600, 0xc2))?.height).toBe(600);
  });

  it('не принимает таблицу Хаффмана за размер', () => {
    // 0xc4 — таблица, размера в ней нет; настоящий SOF идёт следом.
    const huff = [0xff, 0xc4, 0x00, 0x06, 1, 2, 3, 4];
    expect(imageSize(jpeg(1024, 768, 0xc0, huff))?.width).toBe(1024);
  });

  it('файл без размера — «не знаю», а не выдумка', () => {
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

describe('imageSize вообще', () => {
  it('чужой формат не узнаёт и не притворяется', () => {
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(imageSize(null)).toBeNull();
    expect(imageSize(new Uint8Array([]))).toBeNull();
  });

  it('через data-URL работает так же', () => {
    const b64 = Buffer.from(png(640, 480)).toString('base64');
    expect(imageSizeOfDataUrl(`data:image/png;base64,${b64}`))
      .toEqual({ width: 640, height: 480, kind: 'png' });
  });
});

describe('fitOnPage', () => {
  it('широкий снимок упирается в ширину колонки', () => {
    // Панорама: 16 см в ширину дают всего 6 в высоту — в потолок не упрётся.
    const f = fitOnPage({ width: 4000, height: 1500, kind: 'jpeg' }, 16, 9);
    expect(f.widthEmu).toBe(16 * EMU_PER_CM);
    expect(f.heightEmu).toBe(6 * EMU_PER_CM);
  });

  it('обычный снимок 4:3 упирается в высоту: иначе на лист влезет один', () => {
    const f = fitOnPage({ width: 4000, height: 3000, kind: 'jpeg' }, 16, 9);
    expect(f.heightEmu).toBe(9 * EMU_PER_CM);
    expect(f.widthEmu).toBe(12 * EMU_PER_CM);
  });

  it('высокий снимок упирается в высоту, а не лезет на весь лист', () => {
    const f = fitOnPage({ width: 3000, height: 4000, kind: 'jpeg' }, 16, 9);
    expect(f.heightEmu).toBe(9 * EMU_PER_CM);
    expect(f.widthEmu).toBeLessThan(16 * EMU_PER_CM);
  });

  it('пропорции не врут ни в одном случае', () => {
    for (const [w, h] of [[4000, 3000], [3000, 4000], [1000, 1000], [6000, 1000]]) {
      const f = fitOnPage({ width: w, height: h, kind: 'jpeg' });
      expect(f.heightEmu / f.widthEmu).toBeCloseTo(h / w, 3);
    }
  });

  it('вырожденный снимок не даёт нулевого размера', () => {
    const f = fitOnPage({ width: 10000, height: 1, kind: 'png' });
    expect(f.heightEmu).toBeGreaterThan(0);
    expect(f.widthEmu).toBeGreaterThan(0);
  });
});
