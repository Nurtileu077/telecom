import { haversineM } from './KMeans';
import { parseLengthFromExtData, parseLengthMetersFromText } from '@/lib/labels';

export function polylineLengthM(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}

export function resolveCableLengthM(
  coords: [number, number][],
  opts: { name?: string; desc?: string; extData?: Record<string, string> } = {},
): number {
  const fromPath = polylineLengthM(coords);
  const fromExt = parseLengthFromExtData(opts.extData);
  const fromName = parseLengthMetersFromText(opts.name ?? '');
  const fromDesc = parseLengthMetersFromText(opts.desc ?? '');
  if (fromPath > 0) return Math.round(fromPath);
  if (fromExt && fromExt > 0) return fromExt;
  if (fromName && fromName > 0) return fromName;
  if (fromDesc && fromDesc > 0) return fromDesc;
  return 0;
}

export function ensureCableLengths(cables: import('@/types/network').Cable[]): import('@/types/network').Cable[] {
  return cables.map((c) => {
    const len = c.lengthM > 0 ? c.lengthM : polylineLengthM(c.coords);
    return len > 0 && len !== c.lengthM ? { ...c, lengthM: len } : c;
  });
}
