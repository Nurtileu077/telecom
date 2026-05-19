// Excel importer for the brownfield workflow: vendor sends a list of NEW
// camera coordinates that need to be added on top of the EXISTING network.
// Recognises camera type (ЛУ / Перекр / ОВН) from either:
//   - a dedicated "тип" / "category" / "kind" column
//   - the camera's description / name
//   - an "АПК"/"ОВН" side column (then we default to ЛУ for АПК)
// Coordinates may be in a single "lat, lon" cell or two columns.

import {
  Subscriber, CameraKind, CAMERA_MIN_BANDWIDTH_MBPS, cameraKindToSide,
} from '@/types/network';

export interface ParsedCameraRow {
  lat: number;
  lon: number;
  desc: string;
  kind: CameraKind;
}

function classifyKind(text: string): CameraKind {
  const t = text.toLowerCase();
  if (/перекрест|перекрёст|intersection|crossroad/.test(t)) return 'intersection';
  if (/(^|[^а-я])лу([^а-я]|$)|линейн.*участок|baseline/.test(t)) return 'lu';
  if (/(^|[^а-я])овн([^а-я]|$)|обществ.*видео|public.*surveil/.test(t)) return 'ovn';
  if (/(^|[^а-я])апк([^а-я]|$)|аппарат/.test(t)) return 'lu'; // АПК без подтипа → ЛУ
  return 'unknown';
}

function parseCoordCell(s: string): [number, number] | null {
  if (!s) return null;
  const m = s.trim().match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lon = parseFloat(m[2].replace(',', '.'));
  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < 35 || lat > 60 || lon < 45 || lon > 90) return null;
  return [lat, lon];
}

let camSeq = 0;

export async function importCameraExcel(file: File): Promise<ParsedCameraRow[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows: ParsedCameraRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (data.length === 0) continue;

    // Detect column layout: scan first 5 rows for a header row
    // that has "lat"/"lon"/"coord"/"тип"/"category" etc.
    let headerRow = 0;
    let cols: Record<string, number> = {};
    for (let r = 0; r < Math.min(5, data.length); r++) {
      const row = (data[r] as unknown[]).map((c) => String(c ?? '').toLowerCase().trim());
      const headerHits: Record<string, number> = {};
      row.forEach((cell, i) => {
        if (/lat|шир/.test(cell)) headerHits.lat = i;
        if (/lon|долг/.test(cell)) headerHits.lon = i;
        if (/coord|координ/.test(cell)) headerHits.coord = i;
        if (/тип|kind|category|категор/.test(cell)) headerHits.kind = i;
        if (/сторон|side|апк|овн/.test(cell)) headerHits.side = i;
        if (/desc|опис|address|адрес|name|назван/.test(cell)) headerHits.desc = i;
      });
      if (Object.keys(headerHits).length >= 2) {
        cols = headerHits;
        headerRow = r;
        break;
      }
    }

    for (let r = headerRow + 1; r < data.length; r++) {
      const row = data[r] as unknown[];
      if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;

      let lat: number | null = null;
      let lon: number | null = null;
      // (A) single coord cell
      if (cols.coord !== undefined) {
        const cc = parseCoordCell(String(row[cols.coord] ?? ''));
        if (cc) { [lat, lon] = cc; }
      }
      // (B) separate lat/lon cells
      if ((lat === null || lon === null) && cols.lat !== undefined && cols.lon !== undefined) {
        const la = parseFloat(String(row[cols.lat] ?? '').replace(',', '.'));
        const lo = parseFloat(String(row[cols.lon] ?? '').replace(',', '.'));
        if (!isNaN(la) && !isNaN(lo)) { lat = la; lon = lo; }
      }
      // (C) fallback: try the FIRST cell as combined "lat, lon"
      if (lat === null || lon === null) {
        const cc = parseCoordCell(String(row[0] ?? ''));
        if (cc) { [lat, lon] = cc; }
      }
      if (lat === null || lon === null) continue;
      if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;

      const kindCell = cols.kind !== undefined ? String(row[cols.kind] ?? '') : '';
      const sideCell = cols.side !== undefined ? String(row[cols.side] ?? '') : '';
      const desc = cols.desc !== undefined ? String(row[cols.desc] ?? '').trim() : '';
      const kindText = [kindCell, sideCell, desc, sheetName].join(' ');
      const kind = classifyKind(kindText);
      rows.push({
        lat, lon, kind,
        desc: desc || `Камера ${++camSeq}`,
      });
    }
  }

  return rows;
}

// Helper to materialise a Subscriber from a parsed row (orkId attached later).
export function rowToSubscriber(row: ParsedCameraRow, id: string, district: string): Subscriber {
  return {
    id,
    lat: row.lat, lon: row.lon,
    desc: row.desc,
    district,
    fibers: { working: 2, spare: 1 },
    kind: row.kind,
    side: cameraKindToSide(row.kind),
    minBandwidthMbps: CAMERA_MIN_BANDWIDTH_MBPS[row.kind],
  };
}
