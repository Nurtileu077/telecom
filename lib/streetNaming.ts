import { reverseAddress } from '@/components/Geocoding/Geocoder';

function shortStreet(name: string): string {
  return name
    .replace(/^улица\s+/i, 'ул. ')
    .replace(/\s+улица$/i, '')
    .replace(/^проспект\s+/i, 'пр. ')
    .replace(/^переулок\s+/i, 'пер. ')
    .replace(/^микрорайон\s+/i, 'мкр. ')
    .trim();
}

/**
 * Подбирает название узла по улицам: если рядом пересекаются две улицы —
 * «ул. A / ул. B» (перекрёсток), иначе «ул. A, дом N».  Использует обратное
 * геокодирование Nominatim; для перекрёстка пробует точки со смещением.
 */
export async function suggestStreetName(lat: number, lon: number, prefix = ''): Promise<string> {
  const main = await reverseAddress(lat, lon);
  const road1 = main.road;
  const pre = prefix ? `${prefix} ` : '';
  if (!road1) {
    const area = main.neighbourhood || main.suburb;
    return area ? `${pre}${area}`.trim() : '';
  }
  // ~40–50 м в стороны — ищем другую улицу для определения перекрёстка.
  const d = 0.00045;
  const probes: [number, number][] = [[lat + d, lon], [lat - d, lon], [lat, lon + d], [lat, lon - d]];
  for (const [pla, plo] of probes) {
    const a = await reverseAddress(pla, plo);
    if (a.road && a.road !== road1) {
      return `${pre}${shortStreet(road1)} / ${shortStreet(a.road)}`.trim();
    }
  }
  const hn = main.houseNumber ? `, ${main.houseNumber}` : '';
  return `${pre}${shortStreet(road1)}${hn}`.trim();
}
