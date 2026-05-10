import { Subscriber } from '@/types/network';

let idCounter = 0;
function newId() { return `sub-csv-${++idCounter}`; }

// Parses CSV / TSV / pasted Excel table
export function parseTabular(text: string, defaultDistrict = 'Импорт'): Subscriber[] {
  idCounter = 0;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Detect delimiter: tab > semicolon > comma
  const sample = lines[0];
  const delim = sample.includes('\t') ? '\t' : sample.includes(';') ? ';' : ',';

  const parseRow = (line: string): string[] => {
    // simple CSV parse with quoted strings
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

  // Try to detect if first row is header
  const first = rows[0];
  const firstLat = parseFloat(first[0].replace(',', '.'));
  const hasHeader = isNaN(firstLat);

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const subs: Subscriber[] = [];

  for (const row of dataRows) {
    if (row.length < 2) continue;
    const lat = parseFloat(row[0].replace(',', '.'));
    const lon = parseFloat(row[1].replace(',', '.'));
    const desc = (row[2] || '').trim();
    const district = (row[3] || '').trim() || defaultDistrict;

    if (isNaN(lat) || isNaN(lon)) continue;
    if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;

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
