import { Subscriber } from '@/types/network';

let idCounter = 0;
function newId() { return `sub-kmz-${++idCounter}`; }

async function readKmlText(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith('.kmz')) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlFile = Object.values(zip.files).find(
      (f) => f.name.toLowerCase().endsWith('.kml'),
    );
    if (!kmlFile) throw new Error('No KML file found in KMZ');
    return kmlFile.async('text');
  }
  return file.text();
}

export interface KmlRawLine {
  coords: [number, number][]; // [lat, lon]
  name: string;
  folder: string;
}

interface ParseOpts {
  defaultDistrict?: string;
  resetIds?: boolean;
}

// Walk up to find the nearest <Folder>'s <name>.  Falls back to caller-supplied.
function folderNameOf(pm: Element, fallback: string): string {
  let parent = pm.parentElement;
  while (parent) {
    if (parent.tagName === 'Folder') {
      const fn = parent.querySelector(':scope > name')?.textContent?.trim();
      if (fn && !['Абоненты', 'Subscribers', 'Points'].includes(fn)) return fn;
      break;
    }
    parent = parent.parentElement;
  }
  return fallback;
}

// Parse a coordinate triplet block "lon,lat,alt lon,lat,alt …" → [lat, lon][].
function parseCoordList(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const triplet of text.trim().split(/\s+/)) {
    const parts = triplet.split(',');
    if (parts.length < 2) continue;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lon)) continue;
    if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;
    out.push([lat, lon]);
  }
  return out;
}

function parseKmlText(
  kmlText: string,
  opts: ParseOpts = {},
): { subscribers: Subscriber[]; lines: KmlRawLine[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'text/xml');

  const subscribers: Subscriber[] = [];
  const lines: KmlRawLine[] = [];
  const fallback = opts.defaultDistrict ?? 'Imported';
  const placemarks = doc.querySelectorAll('Placemark');

  for (const pm of placemarks) {
    const folder = folderNameOf(pm, fallback);
    const name = pm.querySelector('name')?.textContent?.trim() || '';
    const desc = pm.querySelector('description')?.textContent?.trim() || '';

    // <Point> → subscriber
    const point = pm.querySelector('Point > coordinates');
    if (point) {
      const c = parseCoordList(point.textContent ?? '')[0];
      if (c) {
        subscribers.push({
          id: newId(),
          lat: c[0], lon: c[1],
          desc: name || desc || `Або. ${subscribers.length + 1}`,
          district: folder,
          fibers: { working: 2, spare: 1 },
        });
      }
    }

    // <LineString> → raw line (cable route as the vendor drew it)
    const lineEl = pm.querySelector('LineString > coordinates');
    if (lineEl) {
      const cs = parseCoordList(lineEl.textContent ?? '');
      if (cs.length >= 2) {
        lines.push({ coords: cs, name: name || desc, folder });
      }
    }
  }

  return { subscribers, lines };
}

export async function importKmz(file: File): Promise<Subscriber[]> {
  idCounter = 0;
  const text = await readKmlText(file);
  const fallback = file.name.replace(/\.(kml|kmz)$/i, '').trim() || 'Imported';
  return parseKmlText(text, { defaultDistrict: fallback }).subscribers;
}

// Same as importKmz but returns BOTH points and lines.  Used by the
// "Загрузить как есть" flow that displays the KML 1:1 instead of running
// the auto-build over its points and discarding the original cable routes.
export async function importKmzRaw(file: File): Promise<{ subscribers: Subscriber[]; lines: KmlRawLine[] }> {
  idCounter = 0;
  const text = await readKmlText(file);
  const fallback = file.name.replace(/\.(kml|kmz)$/i, '').trim() || 'Imported';
  return parseKmlText(text, { defaultDistrict: fallback });
}

// Multi-file batch — raw flavour.
export async function importKmzBatchRaw(files: File[]): Promise<{
  subscribers: Subscriber[];
  lines: KmlRawLine[];
  perFile: Array<{ name: string; subs: number; lines: number; error?: string }>;
}> {
  idCounter = 0;
  const allSubs: Subscriber[] = [];
  const allLines: KmlRawLine[] = [];
  const perFile: Array<{ name: string; subs: number; lines: number; error?: string }> = [];

  for (const file of files) {
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.kml') && !ext.endsWith('.kmz')) {
      perFile.push({ name: file.name, subs: 0, lines: 0, error: 'не KML/KMZ' });
      continue;
    }
    try {
      const text = await readKmlText(file);
      const fallback = file.name.replace(/\.(kml|kmz)$/i, '').trim() || file.name;
      const { subscribers, lines } = parseKmlText(text, { defaultDistrict: fallback, resetIds: false });
      allSubs.push(...subscribers);
      allLines.push(...lines);
      perFile.push({ name: file.name, subs: subscribers.length, lines: lines.length });
    } catch (e: any) {
      perFile.push({ name: file.name, subs: 0, lines: 0, error: e?.message ?? 'parse error' });
    }
  }

  return { subscribers: allSubs, lines: allLines, perFile };
}

// Existing batch function — points only, used by the auto-build flow.
export async function importKmzBatch(files: File[]): Promise<{
  subscribers: Subscriber[];
  perFile: Array<{ name: string; count: number; error?: string }>;
}> {
  const { subscribers, perFile } = await importKmzBatchRaw(files);
  return {
    subscribers,
    perFile: perFile.map((p) => ({ name: p.name, count: p.subs, error: p.error })),
  };
}
