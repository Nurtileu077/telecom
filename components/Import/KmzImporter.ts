import { Subscriber, ObjectType, ConnectionType } from '@/types/network';

let idCounter = 0;
function newId() { return `sub-kmz-${++idCounter}`; }

async function readKmlText(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith('.kmz')) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlFile = Object.values(zip.files).find(
      (f: any) => (f as any).name.toLowerCase().endsWith('.kml')
    ) as any;
    if (!kmlFile) throw new Error('No KML file found in KMZ');
    return (kmlFile as any).async('text');
  }
  return file.text();
}

// Extract value of a named <Data> element from ExtendedData
function getDataValue(pm: Element, name: string): string {
  const dataEls = pm.querySelectorAll('ExtendedData > Data');
  for (const d of dataEls) {
    if (d.getAttribute('name') === name) {
      return d.querySelector('value')?.textContent?.trim() || '';
    }
  }
  return '';
}

// Map KML itemType to ObjectType
function resolveObjectType(itemType: string): ObjectType | null {
  const t = itemType.toLowerCase();
  if (t.includes('апк') || t.includes('камер') || t.includes('camera') || t.includes('видео')) return 'камера';
  if (t.includes('база') || t.includes('бс') || t.includes('base') || t.includes('station')) return 'база';
  if (t.includes('офис') || t.includes('office') || t.includes('объект') || t.includes('здание')) return 'офис';
  if (t.includes('абонент') || t.includes('жилой') || t.includes('дом') || t.includes('subscriber')) return 'абонент';
  // Infrastructure types — skip, not subscriber endpoints
  if (
    t.includes('бокс') || t.includes('муфта') || t.includes('амс') || t.includes('кросс') ||
    t.includes('ус ') || t === 'ус' || t.includes('узел') || t.includes('шкаф') ||
    t.includes('ок-') || t.includes('кабель') || t.includes('рамс') || t.includes('ррл')
  ) return null;
  return 'абонент'; // default for unknown subscriber-like objects
}

export async function importKmz(file: File): Promise<Subscriber[]> {
  idCounter = 0;
  const kmlText = await readKmlText(file);
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'text/xml');

  const subscribers: Subscriber[] = [];
  const placemarks = doc.querySelectorAll('Placemark');

  for (const pm of placemarks) {
    // Only import Point features — skip LineString (cables) and Polygon
    const point = pm.querySelector('Point');
    if (!point) continue;

    const coordsEl = point.querySelector('coordinates');
    if (!coordsEl) continue;

    const parts = coordsEl.textContent?.trim().split(',') || [];
    if (parts.length < 2) continue;

    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lon)) continue;
    // Kazakhstan bounding box
    if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;

    // Determine object type from ExtendedData itemType
    const itemType = getDataValue(pm, 'itemType');
    const category = getDataValue(pm, 'category');

    // Skip if category is 'line' or infrastructure type
    if (category === 'line') continue;
    const objType = resolveObjectType(itemType);
    if (objType === null) continue; // infrastructure, skip

    // District: prefer city field, then layer, then folder name
    let district = getDataValue(pm, 'city') || getDataValue(pm, 'layer') || '';
    if (!district) {
      // Fall back to parent folder name
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
    }
    if (!district) district = 'Imported';

    const name = getDataValue(pm, 'name') || pm.querySelector('name')?.textContent?.trim() || '';
    const desc = pm.querySelector('description')?.textContent?.trim() || '';
    const label = name && name !== 'Введите название метки' ? name : desc || `Объект ${subscribers.length + 1}`;

    // P2P by default for KMZ imports (user confirmed this is P2P)
    const connectionType: ConnectionType = 'p2p';

    const fibers = objType === 'камера'
      ? { working: 2, spare: 0 }
      : objType === 'база'
        ? { working: 4, spare: 2 }
        : { working: 2, spare: 1 };

    subscribers.push({
      id: newId(),
      lat,
      lon,
      desc: label,
      district,
      fibers,
      objectType: objType,
      connectionType,
    });
  }

  return subscribers;
}
