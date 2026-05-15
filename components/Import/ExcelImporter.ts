import { Subscriber } from '@/types/network';

let idCounter = 0;
function newId() { return `sub-${++idCounter}`; }

// "40.777053, 68.320873" / "40,777053; 68,320873" / "40.78 68.32"  →  [lat, lon]
function parseLatLngString(s: string): [number, number] | null {
  if (!s) return null;
  const t = s.trim();
  // Try splitting on common separators; allow comma as decimal too — only treat
  // a comma as separator if there are >=2 commas OR a semicolon/space present.
  let parts: string[] = [];
  if (t.includes(';')) parts = t.split(';');
  else if (t.split(',').length === 2 && /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(t)) {
    // exact "num.dec, num.dec" — comma is the separator
    parts = t.split(',');
  } else if (t.split(',').length >= 3) {
    parts = t.split(',');
  } else if (/\s/.test(t)) {
    parts = t.split(/\s+/);
  } else {
    parts = t.split(',');
  }
  parts = parts.map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // If the comma is used as decimal mark (e.g. "40,777053 68,320873"), rejoin
  if (parts.length === 4) {
    const a = `${parts[0]}.${parts[1]}`;
    const b = `${parts[2]}.${parts[3]}`;
    const la = parseFloat(a), lo = parseFloat(b);
    if (!isNaN(la) && !isNaN(lo)) return [la, lo];
  }
  const lat = parseFloat(parts[0].replace(',', '.'));
  const lon = parseFloat(parts[1].replace(',', '.'));
  if (isNaN(lat) || isNaN(lon)) return null;
  return [lat, lon];
}

// Pick the first non-empty cell after the coords column as the description.
function pickDescription(row: unknown[], startIdx: number): string {
  for (let j = startIdx; j < row.length; j++) {
    const v = String(row[j] ?? '').trim();
    if (v && !/^latitude|^longitude|^description$/i.test(v)) return v;
  }
  return '';
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
    const district = sheetName.trim() || 'Импорт';

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      if (!row || row.length === 0) continue;

      const c0 = String(row[0] ?? '').trim();
      if (!c0) continue;

      let lat: number | null = null;
      let lon: number | null = null;
      let descStartIdx = 2;

      // (A) Combined "lat, lng" string in column 0  (формат, который чаще всего присылают)
      const combined = parseLatLngString(c0);
      if (combined) {
        [lat, lon] = combined;
        descStartIdx = 1;
      } else {
        // (B) Separate lat / lon columns
        const a = parseFloat(c0.replace(',', '.'));
        const b = parseFloat(String(row[1] ?? '').replace(',', '.'));
        if (isNaN(a) || isNaN(b)) continue;
        lat = a;
        lon = b;
        descStartIdx = 2;
      }

      // Sanity: Kazakhstan bounding box (wide).
      if (lat === null || lon === null) continue;
      if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;

      const desc = pickDescription(row, descStartIdx);

      subscribers.push({
        id: newId(),
        lat,
        lon,
        desc: desc || `Або. ${subscribers.length + 1}`,
        district,
        fibers: { working: 2, spare: 1 },
      });
    }
  }

  return subscribers;
}
