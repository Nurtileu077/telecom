/**
 * Метры, километры и то, что между ними.
 *
 * В поле считают метрами, в отчётности — километрами, а в переписке
 * пишут как придётся: «1,2 км», «1200», «1 200 м». Пока поле принимает
 * только голое число, «1,2» превращается в полтора метра вместо
 * полутора километров — и это всплывает уже в акте.
 *
 * Разбираем то, что человек написал, и показываем, как мы это поняли.
 */

/** Единицы, которые встречаются в записях. */
const KM_WORDS = ['км', 'km', 'километр', 'километра', 'километров'];
const M_WORDS = ['м', 'm', 'метр', 'метра', 'метров', 'пог.м', 'пм'];

export interface ParsedMeters {
  meters: number;
  /** Как именно записали: по этому подписываем поле. */
  unit: 'м' | 'км';
  /** Разобрали ли вообще что-нибудь. */
  ok: boolean;
}

/**
 * Метры из того, что набрали.
 *
 * Без единицы считаем метрами: так пишут почти всегда, а километры
 * называют явно. Пробелы внутри числа — разделители тысяч, а не
 * два разных числа.
 */
export function parseMeters(input: string | number | undefined | null): ParsedMeters {
  if (typeof input === 'number') {
    return { meters: Number.isFinite(input) ? input : 0, unit: 'м', ok: Number.isFinite(input) };
  }
  const raw = (input ?? '').toString().trim().toLowerCase().replace(/ /g, ' ');
  if (!raw) return { meters: 0, unit: 'м', ok: false };

  const m = raw.match(/^([\d\s]*\d(?:[.,]\d+)?)\s*([a-zа-я.]*)$/);
  if (!m) return { meters: 0, unit: 'м', ok: false };

  const value = Number(m[1].replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(value)) return { meters: 0, unit: 'м', ok: false };

  const unit = m[2].replace(/\.$/, '');
  if (KM_WORDS.includes(unit)) {
    return { meters: value * 1000, unit: 'км', ok: true };
  }
  if (unit === '' || M_WORDS.includes(unit)) {
    return { meters: value, unit: 'м', ok: true };
  }
  // Единица есть, но незнакомая: «1200 шт» — это не метры.
  return { meters: 0, unit: 'м', ok: false };
}

/** Число для поля ввода: без единиц, с запятой, как пишут по-русски. */
export function metersToField(meters: number | undefined): string {
  if (meters === undefined || !Number.isFinite(meters) || meters <= 0) return '';
  return Number.isInteger(meters)
    ? String(meters)
    : String(Math.round(meters * 100) / 100).replace('.', ',');
}

/**
 * Подпись «это столько-то» под полем.
 *
 * Показываем перевод только тогда, когда он что-то добавляет: под
 * «480 м» писать «0,48 км» незачем.
 */
export function metersHint(meters: number): string | null {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  if (meters >= 1000) return `${(meters / 1000).toFixed(2).replace('.', ',')} км`;
  return null;
}
