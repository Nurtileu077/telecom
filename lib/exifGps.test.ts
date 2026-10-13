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
  /** Часовой пояс времени съёмки, «+05:00». */
  offsetOriginal?: string;
  /** Погрешность точки, м. */
  hPosError?: number;
  /** Дата и время спутниковой точки, UTC. */
  gpsDate?: string;
  gpsTime?: [number, number, number];
  little?: boolean;
}): ArrayBuffer {
  const little = opts.little ?? true;
  const put16 = (a: number[], v: number) => {
    if (little) a.push(v & 0xff, (v >> 8) & 0xff);
    else a.push((v >> 8) & 0xff, v & 0xff);
  };
  const put32 = (a: number[], v: number) => {
    if (little) a.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    else a.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  };

  // Запись директории: ASCII, рациональные числа или указатель на директорию.
  type E = { tag: number } & ({ ascii: string } | { rationals: number[] } | { ifd: 'exif' | 'gps' });
  const ascii = (tag: number, v: string): E => ({ tag, ascii: v });
  const rats = (tag: number, v: number[]): E => ({ tag, rationals: v });

  const exifEntries: E[] = [];
  if (opts.dateOriginal) exifEntries.push(ascii(0x9003, opts.dateOriginal));
  if (opts.offsetOriginal) exifEntries.push(ascii(0x9011, opts.offsetOriginal));

  const gpsEntries: E[] = [];
  if (opts.lat && opts.lon) {
    gpsEntries.push(ascii(0x0001, opts.latRef ?? 'N'), rats(0x0002, opts.lat));
    gpsEntries.push(ascii(0x0003, opts.lonRef ?? 'E'), rats(0x0004, opts.lon));
    if (opts.gpsTime) gpsEntries.push(rats(0x0007, opts.gpsTime));
    if (opts.gpsDate) gpsEntries.push(ascii(0x001d, opts.gpsDate));
    if (opts.hPosError !== undefined) gpsEntries.push(rats(0x001f, [opts.hPosError]));
  }

  const ifd0Entries: E[] = [];
  if (exifEntries.length) ifd0Entries.push({ tag: 0x8769, ifd: 'exif' });
  if (gpsEntries.length) ifd0Entries.push({ tag: 0x8825, ifd: 'gps' });

  // Раскладка: IFD0, затем EXIF IFD, GPS IFD и блоки значений.
  const len = (n: number) => (n ? 2 + n * 12 + 4 : 0);
  const ifd0At = 8;
  const exifAt = ifd0At + len(ifd0Entries.length) + (ifd0Entries.length ? 0 : 6);
  const gpsAt = exifAt + len(exifEntries.length);
  const dataAt = gpsAt + len(gpsEntries.length);
  const data: number[] = [];

  const writeIfd = (out: number[], entries: E[]) => {
    put16(out, entries.length);
    for (const e of entries) {
      put16(out, e.tag);
      if ('ifd' in e) {
        put16(out, 4); put32(out, 1); put32(out, e.ifd === 'exif' ? exifAt : gpsAt);
      } else if ('ascii' in e) {
        const bytes = [...e.ascii].map((ch) => ch.charCodeAt(0)).concat(0);
        put16(out, 2); put32(out, bytes.length);
        if (bytes.length <= 4) {
          out.push(...bytes, ...new Array(4 - bytes.length).fill(0));
        } else {
          put32(out, dataAt + data.length);
          data.push(...bytes);
        }
      } else {
        put16(out, 5); put32(out, e.rationals.length); put32(out, dataAt + data.length);
        for (const v of e.rationals) {
          // Три знака после запятой хватает: секунды в EXIF пишут так же.
          put32(data, Math.round(v * 1000));
          put32(data, 1000);
        }
      }
    }
    put32(out, 0);
  };

  const tiff: number[] = [];
  if (little) tiff.push(0x49, 0x49); else tiff.push(0x4d, 0x4d);
  put16(tiff, 42);
  put32(tiff, ifd0At);
  writeIfd(tiff, ifd0Entries);
  if (exifEntries.length) writeIfd(tiff, exifEntries);
  if (gpsEntries.length) writeIfd(tiff, gpsEntries);
  tiff.push(...data);

  // JPEG: SOI + APP1(Exif\0\0 + TIFF)
  const chunks: number[] = [0xff, 0xd8, 0xff, 0xe1];
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

  it('погрешность точки читает, если телефон её записал', () => {
    const gps = readExifGps(jpegWithExif({ lat: [51, 0, 0], lon: [71, 0, 0], hPosError: 8.5 }))!;
    expect(gps.accuracyM).toBeCloseTo(8.5, 3);
  });

  it('нет погрешности в снимке — она неизвестна, а не ноль', () => {
    expect(readExifGps(jpegWithExif({ lat: [51, 0, 0], lon: [71, 0, 0] }))!.accuracyM).toBeUndefined();
    expect(readExifGps(jpegWithExif({ lat: [51, 0, 0], lon: [71, 0, 0], hPosError: 0 }))!.accuracyM)
      .toBeUndefined();
  });

  it('время спутниковой точки собирает из даты и часов UTC', () => {
    const gps = readExifGps(jpegWithExif({
      lat: [51, 0, 0], lon: [71, 0, 0], gpsDate: '2026:09:17', gpsTime: [3, 41, 3],
    }))!;
    expect(gps.fixAt).toBe('2026-09-17T03:41:03.000Z');
  });

  it('часовой пояс из снимка важнее местного', () => {
    // 08:41 по UTC+6 — это 02:41 UTC, хотя тесты идут по Алматы (UTC+5).
    const gps = readExifGps(jpegWithExif({
      lat: [51, 0, 0], lon: [71, 0, 0], dateOriginal: '2026:09:17 08:41:03', offsetOriginal: '+06:00',
    }))!;
    expect(gps.takenAt).toBe('2026-09-17T02:41:03.000Z');
  });

  it('без часового пояса время съёмки считает местным', () => {
    expect(exifDateToIso('2026:09:17 08:41:03')).toBe('2026-09-17T03:41:03.000Z');
  });

  it('дата EXIF переводится в ISO, мусор — нет', () => {
    expect(exifDateToIso('2026:09:17 08:41:03')).toBeTruthy();
    expect(exifDateToIso('не дата')).toBeUndefined();
    expect(exifDateToIso('0000:00:00 00:00:00')).toBeTruthy();
  });
});
