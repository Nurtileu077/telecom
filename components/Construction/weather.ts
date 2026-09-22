/**
 * Погода дня.
 *
 * В АСР есть графа о погодных условиях, и её заполняют по памяти — а
 * помнят обычно «было холодно». Между тем это не формальность: дождь и
 * мороз объясняют и темп, и остановку работ, и по ним потом спорят о
 * сроках.
 *
 * Берём из открытого архива по координатам участка и дате смены.
 * Интернета в поле нет — значит, запись сохраняется и без погоды, а
 * погода подтягивается, когда связь появится.
 */

export interface DayWeather {
  /** Дата, YYYY-MM-DD. */
  date: string;
  tMinC?: number;
  tMaxC?: number;
  /** Осадки, мм. */
  precipMm?: number;
  /** Код погоды WMO — по нему подписываем словами. */
  code?: number;
  /** Откуда взяли: из архива или вписали руками. */
  source: 'archive' | 'manual';
}

/**
 * Коды погоды WMO — словами, которыми пишут в акте.
 *
 * Полный справочник тут не нужен: в графе «погодные условия» пишут
 * «ясно», «дождь», «снег», а не «слабый ливневый дождь малой
 * интенсивности».
 */
export function weatherLabel(code: number | undefined): string {
  if (code === undefined) return '';
  if (code === 0) return 'ясно';
  if (code <= 2) return 'переменная облачность';
  if (code === 3) return 'пасмурно';
  if (code <= 48) return 'туман';
  if (code <= 57) return 'морось';
  if (code <= 67) return 'дождь';
  if (code <= 77) return 'снег';
  if (code <= 82) return 'ливень';
  if (code <= 86) return 'снегопад';
  return 'гроза';
}

/** Строка для акта: «−12…−4 °C, снег, осадки 3 мм». */
export function formatWeather(w: DayWeather | undefined): string {
  if (!w) return '';
  const parts: string[] = [];
  const t = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;
  if (w.tMinC !== undefined && w.tMaxC !== undefined) {
    parts.push(`${t(w.tMinC)}…${t(w.tMaxC)} °C`);
  } else if (w.tMaxC !== undefined) {
    parts.push(`${t(w.tMaxC)} °C`);
  }
  const label = weatherLabel(w.code);
  if (label) parts.push(label);
  if (w.precipMm !== undefined && w.precipMm >= 0.5) {
    parts.push(`осадки ${w.precipMm.toFixed(1).replace('.', ',')} мм`);
  }
  return parts.join(', ');
}

/** Мешала ли погода работать — по этому потом объясняют простой. */
export function weatherHindered(w: DayWeather | undefined): boolean {
  if (!w) return false;
  if ((w.precipMm ?? 0) >= 5) return true;
  if ((w.tMaxC ?? 99) <= -20) return true;
  return (w.code ?? 0) >= 80;
}

export function weatherUrl(lat: number, lon: number, date: string): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode',
    timezone: 'auto',
    start_date: date,
    end_date: date,
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

interface OpenMeteoDaily {
  daily?: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
    weathercode?: (number | null)[];
  };
}

/** Разбор ответа. Отдельно от запроса — чтобы проверять без сети. */
export function parseWeather(json: unknown, date: string): DayWeather | null {
  const d = (json as OpenMeteoDaily)?.daily;
  if (!d?.time || d.time.length === 0) return null;
  const at = d.time.indexOf(date);
  const i = at >= 0 ? at : 0;
  const num = (v: number | null | undefined) => (typeof v === 'number' ? v : undefined);
  const out: DayWeather = {
    date: d.time[i] ?? date,
    tMaxC: num(d.temperature_2m_max?.[i]),
    tMinC: num(d.temperature_2m_min?.[i]),
    precipMm: num(d.precipitation_sum?.[i]),
    code: num(d.weathercode?.[i]),
    source: 'archive',
  };
  // Пустой ответ — это не погода: лучше ничего, чем «0 °C, ясно».
  if (out.tMaxC === undefined && out.code === undefined) return null;
  return out;
}

/**
 * Запрос погоды.
 *
 * Молча возвращает null там, где не получилось: связи в поле нет, и
 * запись не должна из-за этого не сохраниться.
 */
export async function fetchDayWeather(
  lat: number,
  lon: number,
  date: string,
): Promise<DayWeather | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !date) return null;
  try {
    const res = await fetch(weatherUrl(lat, lon, date));
    if (!res.ok) return null;
    return parseWeather(await res.json(), date);
  } catch {
    return null;
  }
}
