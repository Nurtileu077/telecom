import { Subscriber } from '@/types/network';

let idCounter = 0;
function newId() { return `sub-${++idCounter}`; }

export async function importExcel(file: File): Promise<Subscriber[]> {
  idCounter = 0;
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const subscribers: Subscriber[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      if (!row || row.length < 2) continue;

      const lat = parseFloat(String(row[0]));
      const lon = parseFloat(String(row[1]));
      const desc = String(row[2] || '').trim();

      if (isNaN(lat) || isNaN(lon)) continue;
      if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;

      subscribers.push({
        id: newId(),
        lat,
        lon,
        desc: desc || `Або. ${subscribers.length + 1}`,
        district: sheetName,
        fibers: { working: 2, spare: 1 },
      });
    }
  }

  return subscribers;
}
