import { Subscriber } from '@/types/network';

let idCounter = 0;
function newId() { return `sub-csv-${++idCounter}`; }

// "40.777, 68.32"  →  [40.777, 68.32]
function parseLatLngString(s: string): [number, number] | null {
  if (!s) return null;
  const m = s.trim().match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lon = parseFloat(m[2].replace(',', '.'));
  if (isNaN(lat) || isNaN(lon)) return null;
  return [lat, lon];
}

// Parses CSV / TSV / pasted Excel table
export function parseTabular(text: string, defaultDistrict = 'Импорт'): Subscriber[] {
  idCounter = 0;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Detect delimiter: tab > semicolon > comma  (but if the line is one combined
  // "lat, lng \t desc" pair, tab wins and the first cell will contain commas).
  const sample = lines[0];
  const delim = sample.includes('\t') ? '\t' : sample.includes(';') ? ';' : ',';

  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === delim && !inQuote) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  };

  const rows = lines.map(parseRow);

  // Detect header: first row has no parseable lat in either column 0 alone or
  // as a combined "lat, lng" string in column 0.
  const first = rows[0];
  const firstLat = parseFloat((first[0] ?? '').replace(',', '.'));
  const firstCombined = parseLatLngString(first[0] ?? '');
  const hasHeader = isNaN(firstLat) && !firstCombined;

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const subs: Subscriber[] = [];

  for (const row of dataRows) {
    if (row.length < 1) continue;

    let lat: number | null = null;
    let lon: number | null = null;
    let descIdx = 2;
    let districtIdx = 3;

    // (A) "lat, lng" combined in col 0
    const combined = parseLatLngString(row[0] || '');
    if (combined) {
      [lat, lon] = combined;
      descIdx = 1;
      districtIdx = 2;
    } else {
      // (B) lat/lon in separate columns
      if (row.length < 2) continue;
      const a = parseFloat((row[0] || '').replace(',', '.'));
      const b = parseFloat((row[1] || '').replace(',', '.'));
      if (isNaN(a) || isNaN(b)) continue;
      lat = a;
      lon = b;
      descIdx = 2;
      districtIdx = 3;
    }

    if (lat === null || lon === null) continue;
    if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;

    const desc = (row[descIdx] || '').trim();
    const district = (row[districtIdx] || '').trim() || defaultDistrict;

    subs.push({
      id: newId(),
      lat, lon,
      desc: desc || `Або. ${subs.length + 1}`,
      district,
      fibers: { working: 2, spare: 1 },
    });
  }
  return subs;
}

export async function importCsv(file: File): Promise<Subscriber[]> {
  const text = await file.text();
  return parseTabular(text, file.name.replace(/\.\w+$/, ''));
}
