import { Subscriber, ObjectType, ConnectionType } from '@/types/network';

let idCounter = 0;
function newId() { return `sub-${++idCounter}`; }

const OBJECT_TYPE_MAP: Record<string, ObjectType> = {
  камера: 'камера', camera: 'камера', апк: 'камера', видео: 'камера',
  база: 'база', 'базовая станция': 'база', base: 'база', bs: 'база',
  офис: 'офис', office: 'офис', объект: 'офис',
  абонент: 'абонент', subscriber: 'абонент', жилой: 'абонент',
};

function parseObjectType(val: string): ObjectType | undefined {
  const t = val.toLowerCase().trim();
  for (const [key, type] of Object.entries(OBJECT_TYPE_MAP)) {
    if (t.includes(key)) return type;
  }
  return undefined;
}

export async function importExcel(file: File): Promise<Subscriber[]> {
  idCounter = 0;
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const subscribers: Subscriber[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) continue;

    // Try to find header row and column indices
    const headerRow = rows[0] as string[];
    const headerLow = headerRow.map((h) => String(h).toLowerCase().trim());

    const latIdx  = headerLow.findIndex((h) => ['lat', 'latitude', 'широта', 'ш'].includes(h));
    const lonIdx  = headerLow.findIndex((h) => ['lon', 'lng', 'longitude', 'долгота', 'д'].includes(h));
    const descIdx = headerLow.findIndex((h) => ['desc', 'description', 'name', 'адрес', 'название', 'имя'].includes(h));
    const typeIdx = headerLow.findIndex((h) => ['тип', 'type', 'objecttype', 'объект'].includes(h));
    const connIdx = headerLow.findIndex((h) => ['подключение', 'connection', 'connectiontype', 'сеть'].includes(h));
    const distIdx = headerLow.findIndex((h) => ['район', 'district', 'зона', 'zone', 'city', 'город'].includes(h));

    const hasHeader = latIdx >= 0 && lonIdx >= 0;
    const startRow = hasHeader ? 1 : 1;

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      if (!row || row.length < 2) continue;

      const lat = hasHeader
        ? parseFloat(String(row[latIdx] ?? ''))
        : parseFloat(String(row[0]));
      const lon = hasHeader
        ? parseFloat(String(row[lonIdx] ?? ''))
        : parseFloat(String(row[1]));

      if (isNaN(lat) || isNaN(lon)) continue;
      if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;

      const desc = hasHeader && descIdx >= 0
        ? String(row[descIdx] || '').trim()
        : String(row[2] || '').trim();

      const rawType = hasHeader && typeIdx >= 0 ? String(row[typeIdx] || '') : '';
      const objectType = parseObjectType(rawType);

      const rawConn = hasHeader && connIdx >= 0 ? String(row[connIdx] || '').toLowerCase() : '';
      const connectionType: ConnectionType = rawConn.includes('gpon') ? 'gpon' : 'p2p';

      const district = hasHeader && distIdx >= 0
        ? String(row[distIdx] || sheetName).trim() || sheetName
        : sheetName;

      const fibers = objectType === 'камера'
        ? { working: 2, spare: 0 }
        : objectType === 'база'
          ? { working: 4, spare: 2 }
          : { working: 2, spare: 1 };

      subscribers.push({
        id: newId(),
        lat, lon,
        desc: desc || `Объект ${subscribers.length + 1}`,
        district,
        fibers,
        objectType,
        connectionType,
      });
    }
  }

  return subscribers;
}
