import { Subscriber } from '@/types/network';

let idCounter = 0;
function newId() { return `sub-kmz-${++idCounter}`; }

async function readKmlText(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith('.kmz')) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlFile = Object.values(zip.files).find(
      (f) => f.name.toLowerCase().endsWith('.kml')
    );
    if (!kmlFile) throw new Error('No KML file found in KMZ');
    return kmlFile.async('text');
  }
  return file.text();
}

export async function importKmz(file: File): Promise<Subscriber[]> {
  idCounter = 0;
  const kmlText = await readKmlText(file);
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'text/xml');

  const subscribers: Subscriber[] = [];
  const placemarks = doc.querySelectorAll('Placemark');

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

    // Determine district from parent folder name
    let district = 'Imported';
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
