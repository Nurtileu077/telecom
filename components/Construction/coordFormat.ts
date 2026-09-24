import { orderPair } from './coords';

/**
 * Координаты в том виде, в каком их пишут люди.
 *
 * В акт их вписывают градусами с минутами и секундами, в навигатор
 * вбивают десятичными через запятую, в переписке присылают как придётся —
 * «N 52°34'12" E 69°12'05"», «52.0914, 69.1234», «52,0914 69,1234».
 * Все эти записи об одном месте, и система должна понимать их все, а
 * отдавать — ту, которую сейчас просят.
 */

export interface LatLon { lat: number; lon: number }

/** Как показать координату. */
export type CoordStyle = 'decimal' | 'dm' | 'dms' | 'nav';

export const COORD_STYLE_LABEL: Record<CoordStyle, string> = {
  decimal: 'Десятичные',
  dm: 'Градусы и минуты',
  dms: 'Градусы, минуты, секунды',
  nav: 'Для навигатора',
};

export const COORD_STYLE_HINT: Record<CoordStyle, string> = {
  decimal: 'как в таблице',
  dm: 'как в GPS-приёмнике',
  dms: 'как в акте',
  nav: 'вставить в 2ГИС или Google',
};

export const COORD_STYLES: CoordStyle[] = ['decimal', 'dm', 'dms', 'nav'];

// Латиница и кириллица: пишут и «N», и «С», в одном и том же журнале.
const NORTH = 'nс';
const SOUTH = 'sю';
const EAST = 'eв';
const WEST = 'wз';

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Разбор градусов с минутами и секундами.
 *
 * Минуты и секунды берём только с их значком: без него «52 34» — это не
 * «52°34′», а две разные координаты, и угадывать тут нельзя.
 */
const DMS_RE = new RegExp(
  '(\\d+(?:[.,]\\d+)?)\\s*[°º]\\s*'
  + '(?:(\\d+(?:[.,]\\d+)?)\\s*[\'′’]\\s*)?'
  + '(?:(\\d+(?:[.,]\\d+)?)\\s*(?:["″”]|\'\'))?',
  'g',
);

interface RawPart {
  value: number;
  /** Знак полушария, если он был указан. */
  hemi?: 'lat+' | 'lat-' | 'lon+' | 'lon-';
}

function hemiOf(letter: string | undefined): RawPart['hemi'] {
  if (!letter) return undefined;
  const c = letter.trim().toLowerCase();
  if (!c) return undefined;
  if (NORTH.includes(c)) return 'lat+';
  if (SOUTH.includes(c)) return 'lat-';
  if (EAST.includes(c)) return 'lon+';
  if (WEST.includes(c)) return 'lon-';
  return undefined;
}

function dmsParts(text: string): RawPart[] {
  const out: RawPart[] = [];
  DMS_RE.lastIndex = 0;
  let m = DMS_RE.exec(text);
  while (m) {
    const deg = num(m[1]);
    if (deg !== undefined) {
      const value = deg + (num(m[2]) ?? 0) / 60 + (num(m[3]) ?? 0) / 3600;
      // Букву полушария ищем вокруг совпадения, а не внутри: если её
      // захватывать самим выражением, «S 33°… W 18°…» съедает W вместе с
      // первой координатой и долгота остаётся без знака.
      out.push({
        value,
        hemi: hemiOf(letterNear(text, m.index - 1, -1))
          ?? hemiOf(letterNear(text, m.index + m[0].length, 1)),
      });
    }
    m = DMS_RE.exec(text);
  }
  return out;
}

/**
 * Буква полушария рядом с числом.
 *
 * Через запятую не перешагиваем: в «52.09 N, 69.12 E» буква N относится к
 * первому числу, и если её подобрать и ко второму, широта с долготой
 * поменяются местами.
 */
function letterNear(text: string, at: number, step: -1 | 1): string | undefined {
  for (let i = at; i >= 0 && i < text.length; i += step) {
    const c = text[i];
    if (c === ' ' || c === '\t') continue;
    return /[a-zа-яё]/i.test(c) ? c : undefined;
  }
  return undefined;
}

function decimalParts(text: string): RawPart[] {
  const out: RawPart[] = [];
  const re = /-?\d+(?:[.,]\d+)?/g;
  let m = re.exec(text);
  while (m) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({
      value: Number(m[0].replace(',', '.')),
      // Буква полушария стоит то перед числом, то после него.
      hemi: hemiOf(letterNear(text, start - 1, -1)) ?? hemiOf(letterNear(text, end, 1)),
    });
    m = re.exec(text);
  }
  return out;
}

/**
 * Координаты из любой записи.
 *
 * Когда полушарие названо — оно и решает, где широта, а где долгота.
 * Когда нет, порядок восстанавливается по границам Казахстана тем же
 * разбором, что и в журнале ГНБ: одни и те же координаты не должны
 * читаться в двух местах системы по-разному.
 */
export function parseLatLon(text: string, hint?: LatLon): LatLon | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;

  const parts = /[°º]/.test(raw) ? dmsParts(raw) : decimalParts(raw);
  if (parts.length < 2) return null;

  /**
   * Координаты присылают не голыми: «Муфта 3: 52.12, 71.65», «ККС 339 —
   * 52.09 69.12». Брать просто первые два числа значит взять номер за
   * широту и уехать в Гвинейский залив.
   *
   * Поэтому перебираем соседние пары и берём первую, которую удаётся
   * разобрать уверенно — по букве полушария или по границам Казахстана.
   * Только если ни одна не подошла, возвращаемся к первым двум числам:
   * координаты за пределами страны тоже бывают, и молча отказывать в них
   * нельзя.
   */
  for (let i = 0; i + 1 < parts.length; i += 1) {
    const sure = pairPoint(parts[i], parts[i + 1], hint, true);
    if (sure) return sure;
  }
  return pairPoint(parts[0], parts[1], hint, false);
}

const signed = (p: RawPart) => (p.hemi === 'lat-' || p.hemi === 'lon-' ? -p.value : p.value);

/**
 * Пара чисел в точку.
 *
 * `sure` — брать только то, в чём разбор уверен: полушарие названо или
 * числа ложатся в границы Казахстана. Без него пара принимается, если
 * числа вообще годятся в координаты.
 */
function pairPoint(a: RawPart, b: RawPart, hint: LatLon | undefined, sure: boolean): LatLon | null {
  const aIsLat = a.hemi === 'lat+' || a.hemi === 'lat-';
  const bIsLat = b.hemi === 'lat+' || b.hemi === 'lat-';
  const aIsLon = a.hemi === 'lon+' || a.hemi === 'lon-';
  const bIsLon = b.hemi === 'lon+' || b.hemi === 'lon-';

  // Буква у обоих чисел — разбор однозначен, и границы тут не нужны:
  // координаты бывают и вне Казахстана.
  if (aIsLat && bIsLon) return valid(signed(a), signed(b));
  if (bIsLat && aIsLon) return valid(signed(b), signed(a));

  const ordered = orderPair(signed(a), signed(b), hint);
  if (ordered) return ordered.point;
  // Буква только у одного числа — этого мало, чтобы считать пару своей:
  // в «точка 7: 69.12 E» буква E стоит у долготы, а семёрка — это номер,
  // и широтой она быть не должна.
  if (sure) return null;

  if (aIsLat || bIsLon) return valid(signed(a), signed(b));
  if (bIsLat || aIsLon) return valid(signed(b), signed(a));

  // За границами Казахстана порядок не восстановить — принимаем как есть,
  // если числа вообще годятся в координаты.
  return valid(signed(a), signed(b));
}

function valid(lat: number, lon: number): LatLon | null {
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Градусы, минуты, секунды — уже округлённые.
 *
 * Округлять разряды порознь нельзя: при 52,99999° секунды дают «60,0», и
 * в акт уходит «52°00′60,0″» — запись, которой не бывает. Поэтому
 * округляем младший разряд сразу и переносим переполнение вверх.
 */
function dmsPieces(v: number, secDigits: number): { deg: number; min: number; sec: number } {
  const abs = Math.abs(v);
  let deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  let min = Math.floor(minFull);
  const k = 10 ** secDigits;
  let sec = Math.round((minFull - min) * 60 * k) / k;
  if (sec >= 60) { sec -= 60; min += 1; }
  if (min >= 60) { min -= 60; deg += 1; }
  return { deg, min, sec };
}

/** То же для записи «градусы и минуты»: минуты дробные, разряд один. */
function dmPieces(v: number, minDigits: number): { deg: number; min: number } {
  const abs = Math.abs(v);
  let deg = Math.floor(abs);
  const k = 10 ** minDigits;
  let min = Math.round((abs - deg) * 60 * k) / k;
  if (min >= 60) { min -= 60; deg += 1; }
  return { deg, min };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const ru = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');

/** Одна координата в выбранной записи. */
export function formatOne(value: number, axis: 'lat' | 'lon', style: CoordStyle): string {
  const neg = value < 0;
  const letter = axis === 'lat' ? (neg ? 'ю.ш.' : 'с.ш.') : (neg ? 'з.д.' : 'в.д.');
  const width = axis === 'lat' ? 2 : 3;

  if (style === 'decimal' || style === 'nav') return value.toFixed(6);

  if (style === 'dm') {
    const dm = dmPieces(value, 3);
    return `${pad(dm.deg, width)}°${ru(dm.min, 3).padStart(6, '0')}′ ${letter}`;
  }
  const { deg, min, sec } = dmsPieces(value, 1);
  return `${pad(deg, width)}°${pad(min)}′${ru(sec, 1).padStart(4, '0')}″ ${letter}`;
}

/** Пара координат целиком — то, что кладут в буфер обмена. */
export function formatLatLon(p: LatLon, style: CoordStyle): string {
  if (style === 'nav') return `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  if (style === 'decimal') return `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
  return `${formatOne(p.lat, 'lat', style)} ${formatOne(p.lon, 'lon', style)}`;
}
