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

interface ParseOpts {
  // Used as the district name when no enclosing <Folder> provides one.
  // For multi-KML imports we pass the file name (без расширения) so each
  // KML becomes its own layer/district instead of all collapsing to "Imported".
  defaultDistrict?: string;
  // Continue numbering across multiple KML files in one batch.
  resetIds?: boolean;
}

function parseKmlText(kmlText: string, opts: ParseOpts = {}): Subscriber[] {
  if (opts.resetIds !== false) {
    // default behaviour for single-file flow: reset.  Batch caller passes false.
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'text/xml');

  const subscribers: Subscriber[] = [];
  const placemarks = doc.querySelectorAll('Placemark');
  const fallback = opts.defaultDistrict ?? 'Imported';

  for (const pm of placemarks) {
    const point = pm.querySelector('Point');
    if (!point) continue;

    const coordsEl = point.querySelector('coordinates');
    if (!coordsEl) continue;

    const parts = coordsEl.textContent?.trim().split(',') || [];
    if (parts.length < 2) continue;

    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lon)) continue;
    if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;

    const name = pm.querySelector('name')?.textContent?.trim() || '';
    const desc = pm.querySelector('description')?.textContent?.trim() || '';

    // Determine district from parent folder name; fall back to opts.defaultDistrict.
    let district = fallback;
    let parent = pm.parentElement;
    while (parent) {
      if (parent.tagName === 'Folder') {
        const folderName = parent.querySelector(':scope > name')?.textContent?.trim();
        if (folderName && !['Абоненты', 'Subscribers', 'Points'].includes(folderName)) {
          district = folderName;
        }
        break;
      }
      parent = parent.parentElement;
    }

    subscribers.push({
      id: newId(),
      lat,
      lon,
      desc: name || desc || `Або. ${subscribers.length + 1}`,
      district,
      fibers: { working: 2, spare: 1 },
    });
  }

  return subscribers;
}

export async function importKmz(file: File): Promise<Subscriber[]> {
  idCounter = 0;
  const text = await readKmlText(file);
  // Use the file name (sans extension) as the fallback district — the same
  // file name will be reused as the layer name on the map.
  const fallback = file.name.replace(/\.(kml|kmz)$/i, '').trim() || 'Imported';
  return parseKmlText(text, { defaultDistrict: fallback });
}

// Multi-file import: 15 KMLs in a folder → one combined Subscriber[] where each
// KML's points carry the file's name as their district (when the KML itself
// doesn't expose a Folder name).  IDs are globally unique across the batch.
export async function importKmzBatch(files: File[]): Promise<{
  subscribers: Subscriber[];
  perFile: Array<{ name: string; count: number; error?: string }>;
}> {
  idCounter = 0;
  const all: Subscriber[] = [];
  const perFile: Array<{ name: string; count: number; error?: string }> = [];

  for (const file of files) {
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.kml') && !ext.endsWith('.kmz')) {
      perFile.push({ name: file.name, count: 0, error: 'не KML/KMZ' });
      continue;
    }
    try {
      const text = await readKmlText(file);
      const fallback = file.name.replace(/\.(kml|kmz)$/i, '').trim() || file.name;
      const subs = parseKmlText(text, { defaultDistrict: fallback, resetIds: false });
      all.push(...subs);
      perFile.push({ name: file.name, count: subs.length });
    } catch (e: any) {
      perFile.push({ name: file.name, count: 0, error: e?.message ?? 'parse error' });
    }
  }

  return { subscribers: all, perFile };
}
