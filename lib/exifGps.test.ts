import { describe, it, expect } from 'vitest';
import { readExifGps, exifDateToIso } from './exifGps';

/**
 * Собираем настоящий JPEG-заголовок с EXIF: проверять разбор на
 * выдуманной структуре — значит проверять выдумку.
 */
function jpegWithExif(opts: {
  lat?: [number, number, number]; latRef?: string;
  lon?: [number, number, number]; lonRef?: string;
  dateOriginal?: string;
  little?: boolean;
}): ArrayBuffer {
  const little = opts.little ?? true;
  const chunks: number[] = [];
  const tiff: number[] = [];
  const put16 = (a: number[], v: number) => {
    if (little) a.push(v & 0xff, (v >> 8) & 0xff);
    else a.push((v >> 8) & 0xff, v & 0xff);
  };
  const put32 = (a: number[], v: number) => {
    if (little) a.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    else a.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  };

  // TIFF header
  if (little) tiff.push(0x49, 0x49); else tiff.push(0x4d, 0x4d);
  put16(tiff, 42);
  put32(tiff, 8); // IFD0 at 8

  const hasGps = !!(opts.lat && opts.lon);
  const hasExifIfd = !!opts.dateOriginal;
  const ifd0Entries = (hasGps ? 1 : 0) + (hasExifIfd ? 1 : 0);

  // Раскладка: IFD0, затем EXIF IFD, GPS IFD и блоки значений.
  const ifd0At = 8;
  const ifd0Len = 2 + ifd0Entries * 12 + 4;
  const exifAt = ifd0At + ifd0Len;
  const exifLen = hasExifIfd ? 2 + 12 + 4 : 0;
  const gpsAt = exifAt + exifLen;
  const gpsEntries = hasGps ? 4 : 0;
  const gpsLen = hasGps ? 2 + gpsEntries * 12 + 4 : 0;
  const dataAt = gpsAt + gpsLen;

  const data: number[] = [];
  const pushRationals = (vals: [number, number, number]) => {
    const at = dataAt + data.length;
    for (const v of vals) {
      // Три знака после запятой хватает: секунды в EXIF пишут так же.
      put32(data, Math.round(v * 1000));
      put32(data, 1000);
    }
    return at;
  };
  const pushAscii = (s: string) => {
    const at = dataAt + data.length;
    for (const ch of s) data.push(ch.charCodeAt(0));
    data.push(0);
    return at;
  };

  const latAt = opts.lat ? pushRationals(opts.lat) : 0;
  const lonAt = opts.lon ? pushRationals(opts.lon) : 0;
  const dateAt = opts.dateOriginal ? pushAscii(opts.dateOriginal) : 0;

  // IFD0
  put16(tiff, ifd0Entries);
  if (hasExifIfd) {
    put16(tiff, 0x8769); put16(tiff, 4); put32(tiff, 1); put32(tiff, exifAt);
  }
  if (hasGps) {
    put16(tiff, 0x8825); put16(tiff, 4); put32(tiff, 1); put32(tiff, gpsAt);
  }
  put32(tiff, 0);

  // EXIF IFD: DateTimeOriginal
  if (hasExifIfd) {
    put16(tiff, 1);
    put16(tiff, 0x9003); put16(tiff, 2); put32(tiff, opts.dateOriginal!.length + 1); put32(tiff, dateAt);
    put32(tiff, 0);
  }

  // GPS IFD
  if (hasGps) {
    put16(tiff, 4);
    // LatRef (ascii, 2 байта — влезает в поле значения)
    put16(tiff, 0x0001); put16(tiff, 2); put32(tiff, 2);
    const refN = (opts.latRef ?? 'N').charCodeAt(0);
    tiff.push(refN, 0, 0, 0);
    put16(tiff, 0x0002); put16(tiff, 5); put32(tiff, 3); put32(tiff, latAt);
    put16(tiff, 0x0003); put16(tiff, 2); put32(tiff, 2);
    const refE = (opts.lonRef ?? 'E').charCodeAt(0);
    tiff.push(refE, 0, 0, 0);
    put16(tiff, 0x0004); put16(tiff, 5); put32(tiff, 3); put32(tiff, lonAt);
    put32(tiff, 0);
  }

  tiff.push(...data);

  // JPEG: SOI + APP1(Exif\0\0 + TIFF)
  chunks.push(0xff, 0xd8);
  chunks.push(0xff, 0xe1);
  const app1Len = 2 + 6 + tiff.length;
  chunks.push((app1Len >> 8) & 0xff, app1Len & 0xff);
  chunks.push(0x45, 0x78, 0x69, 0x66, 0x00, 0x00);
  chunks.push(...tiff);
  chunks.push(0xff, 0xd9);
  return new Uint8Array(chunks).buffer;
}

describe('координаты из фотографии', () => {
  it('читает широту и долготу из EXIF', () => {
    const buf = jpegWithExif({ lat: [51, 30, 0], lon: [71, 15, 30] });
    const gps = readExifGps(buf)!;
    expect(gps.lat).toBeCloseTo(51.5, 4);
    expect(gps.lon).toBeCloseTo(71.2583, 3);
  });

  it('южная широта и западная долгота — со знаком минус', () => {
    const gps = readExifGps(jpegWithExif({
      lat: [12, 0, 0], latRef: 'S', lon: [30, 0, 0], lonRef: 'W',
    }))!;
    expect(gps.lat).toBeCloseTo(-12, 5);
    expect(gps.lon).toBeCloseTo(-30, 5);
  });

  it('понимает обратный порядок байтов', () => {
    const gps = readExifGps(jpegWithExif({
      lat: [51, 0, 0], lon: [71, 0, 0], little: false,
    }))!;
    expect(gps.lat).toBeCloseTo(51, 5);
  });

  it('берёт время съёмки, а не время файла', () => {
    const gps = readExifGps(jpegWithExif({
      lat: [51, 0, 0], lon: [71, 0, 0], dateOriginal: '2026:09:17 08:41:03',
    }))!;
    expect(gps.takenAt).toBeTruthy();
    expect(new Date(gps.takenAt!).getFullYear()).toBe(2026);
  });

  it('фото без EXIF — не ошибка, а просто отсутствие координат', () => {
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
    expect(readExifGps(plain)).toBeNull();
  });

  it('мусор вместо файла не роняет разбор', () => {
    expect(readExifGps(new Uint8Array([1, 2, 3, 4, 5]).buffer)).toBeNull();
    expect(readExifGps(new ArrayBuffer(0))).toBeNull();
  });

  it('дата EXIF переводится в ISO, мусор — нет', () => {
    expect(exifDateToIso('2026:09:17 08:41:03')).toBeTruthy();
    expect(exifDateToIso('не дата')).toBeUndefined();
    expect(exifDateToIso('0000:00:00 00:00:00')).toBeTruthy();
  });
});
