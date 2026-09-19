/**
 * Координаты и время съёмки прямо из файла фотографии.
 *
 * Телефон записывает их в EXIF при съёмке. Это важнее, чем положение
 * телефона в момент, когда фото прикрепили: снимок могли сделать утром на
 * трассе, а приложить вечером в вагончике. Спрашивать геолокацию в этот
 * момент — значит записать место вагончика и назвать его местом работ.
 *
 * Поэтому сначала читаем EXIF, и только если его нет — берём положение
 * устройства, честно помечая, откуда взялись координаты.
 *
 * Разбираем ровно то, что нужно: APP1 → TIFF → GPS IFD и дату съёмки.
 * Полноценная библиотека EXIF весит больше, чем вся эта задача.
 */

export interface ExifGps {
  lat: number;
  lon: number;
  /** Высота, м — если записана. */
  alt?: number;
  /** Дата и время съёмки, ISO. */
  takenAt?: string;
}

const TAG_GPS_IFD = 0x8825;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME = 0x0132;

const GPS_LAT_REF = 0x0001;
const GPS_LAT = 0x0002;
const GPS_LON_REF = 0x0003;
const GPS_LON = 0x0004;
const GPS_ALT_REF = 0x0005;
const GPS_ALT = 0x0006;

interface Reader {
  u16(at: number): number;
  u32(at: number): number;
  ascii(at: number, len: number): string;
  rational(at: number): number;
  size: number;
}

function reader(view: DataView, tiff: number, little: boolean): Reader {
  return {
    u16: (at) => view.getUint16(tiff + at, little),
    u32: (at) => view.getUint32(tiff + at, little),
    ascii: (at, len) => {
      let s = '';
      for (let i = 0; i < len; i++) {
        const c = view.getUint8(tiff + at + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    },
    rational: (at) => {
      const num = view.getUint32(tiff + at, little);
      const den = view.getUint32(tiff + at + 4, little);
      return den === 0 ? 0 : num / den;
    },
    size: view.byteLength - tiff,
  };
}

interface Entry { tag: number; type: number; count: number; valueAt: number }

/** Разбор одной директории тегов. Возвращает записи и смещение следующей. */
function readIfd(r: Reader, at: number): Entry[] {
  const out: Entry[] = [];
  if (at + 2 > r.size) return out;
  const count = r.u16(at);
  // Директория с тысячей тегов — признак того, что мы не там: не читаем.
  if (count > 512) return out;
  for (let i = 0; i < count; i++) {
    const e = at + 2 + i * 12;
    if (e + 12 > r.size) break;
    const tag = r.u16(e);
    const type = r.u16(e + 2);
    const n = r.u32(e + 4);
    const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const bytes = (SIZES[type] ?? 1) * n;
    const valueAt = bytes > 4 ? r.u32(e + 8) : e + 8;
    out.push({ tag, type, count: n, valueAt });
  }
  return out;
}

/**
 * Значение-указатель: у тегов GPS IFD и EXIF IFD оно лежит прямо в поле
 * записи (четыре байта), и это смещение следующей директории, а не адрес
 * данных. Спутать одно с другим — и EXIF «не читается».
 */
function pointerOf(r: Reader, e: Entry): number {
  return e.type === 3 ? r.u16(e.valueAt) : r.u32(e.valueAt);
}

function dms(r: Reader, e: Entry): number | null {
  // Градусы, минуты, секунды — три рациональных числа подряд.
  if (e.count < 3 || e.valueAt + 24 > r.size) return null;
  const d = r.rational(e.valueAt);
  const m = r.rational(e.valueAt + 8);
  const s = r.rational(e.valueAt + 16);
  return d + m / 60 + s / 3600;
}

/** «2026:09:17 08:41:03» → ISO. Часовой пояс EXIF не пишет — берём местное. */
export function exifDateToIso(s: string): string | undefined {
  const m = s.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, sec] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Ищем сегмент APP1 с меткой Exif. Он не всегда первый после SOI. */
function findApp1(view: DataView): number | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) return null;
    const marker = view.getUint8(at + 1);
    // Начались данные изображения — EXIF дальше не будет.
    if (marker === 0xda || marker === 0xd9) return null;
    const len = view.getUint16(at + 2);
    if (len < 2) return null;
    if (marker === 0xe1 && at + 10 <= view.byteLength) {
      let sig = '';
      for (let i = 0; i < 4; i++) sig += String.fromCharCode(view.getUint8(at + 4 + i));
      if (sig === 'Exif') return at + 10;
    }
    at += 2 + len;
  }
  return null;
}

/**
 * Координаты и время съёмки из JPEG. Возвращает null, если их там нет —
 * это нормально: часть камер и почти все мессенджеры EXIF вырезают.
 */
export function readExifGps(buf: ArrayBuffer): ExifGps | null {
  try {
    const view = new DataView(buf);
    const tiff = findApp1(view);
    if (tiff === null || tiff + 8 > view.byteLength) return null;

    const order = view.getUint16(tiff);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const little = order === 0x4949;
    const r = reader(view, tiff, little);
    if (r.u16(2) !== 42) return null;

    const ifd0 = readIfd(r, r.u32(4));
    let takenAt: string | undefined;

    const dt0 = ifd0.find((e) => e.tag === TAG_DATETIME);
    if (dt0) takenAt = exifDateToIso(r.ascii(dt0.valueAt, dt0.count));

    const exifPtr = ifd0.find((e) => e.tag === TAG_EXIF_IFD);
    if (exifPtr) {
      const exif = readIfd(r, pointerOf(r, exifPtr));
      const dto = exif.find((e) => e.tag === TAG_DATETIME_ORIGINAL);
      // Время съёмки вернее времени файла: файл мог быть пересохранён.
      if (dto) takenAt = exifDateToIso(r.ascii(dto.valueAt, dto.count)) ?? takenAt;
    }

    const gpsPtr = ifd0.find((e) => e.tag === TAG_GPS_IFD);
    if (!gpsPtr) return takenAt ? { lat: NaN, lon: NaN, takenAt } : null;

    const gps = readIfd(r, pointerOf(r, gpsPtr));
    const latE = gps.find((e) => e.tag === GPS_LAT);
    const lonE = gps.find((e) => e.tag === GPS_LON);
    if (!latE || !lonE) return takenAt ? { lat: NaN, lon: NaN, takenAt } : null;

    let lat = dms(r, latE);
    let lon = dms(r, lonE);
    if (lat === null || lon === null) return takenAt ? { lat: NaN, lon: NaN, takenAt } : null;

    const latRef = gps.find((e) => e.tag === GPS_LAT_REF);
    const lonRef = gps.find((e) => e.tag === GPS_LON_REF);
    if (latRef && r.ascii(latRef.valueAt, 2).toUpperCase().startsWith('S')) lat = -lat;
    if (lonRef && r.ascii(lonRef.valueAt, 2).toUpperCase().startsWith('W')) lon = -lon;

    let alt: number | undefined;
    const altE = gps.find((e) => e.tag === GPS_ALT);
    if (altE) {
      alt = r.rational(altE.valueAt);
      const altRef = gps.find((e) => e.tag === GPS_ALT_REF);
      // 1 — ниже уровня моря.
      if (altRef && view.getUint8(tiff + altRef.valueAt) === 1) alt = -alt;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return takenAt ? { lat: NaN, lon: NaN, takenAt } : null;
    }
    return { lat, lon, alt, takenAt };
  } catch {
    // Битый EXIF не должен мешать приложить фотографию.
    return null;
  }
}
