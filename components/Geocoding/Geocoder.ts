export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
  type: string;
  importance: number;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export async function geocode(query: string, limit = 8): Promise<GeocodeResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query, format: 'json', limit: String(limit), 'accept-language': 'ru',
    countrycodes: 'kz,ru,uz,kg,tj,by,ua',
  });
  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((d: any) => ({
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      displayName: d.display_name,
      type: d.type,
      importance: d.importance || 0,
    }));
  } catch {
    return [];
  }
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ru`,
    );
    if (!res.ok) return '';
    const data = await res.json();
    return data.display_name || '';
  } catch {
    return '';
  }
}

export interface ReverseAddress {
  road?: string;
  houseNumber?: string;
  neighbourhood?: string;
  suburb?: string;
}

export async function reverseAddress(lat: number, lon: number): Promise<ReverseAddress> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&zoom=18&accept-language=ru`,
    );
    if (!res.ok) return {};
    const data = await res.json();
    const a = data.address ?? {};
    return {
      road: a.road || a.pedestrian || a.footway || a.residential,
      houseNumber: a.house_number,
      neighbourhood: a.neighbourhood || a.quarter,
      suburb: a.suburb || a.city_district,
    };
  } catch {
    return {};
  }
}
