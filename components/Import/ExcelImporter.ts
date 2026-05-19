import { Subscriber, CameraType, CAMERA_MIN_SPEED_MBPS } from '@/types/network';

let idCounter = 0;
function newId() { return `sub-${++idCounter}`; }

// "40.777053, 68.320873" / "40,777053; 68,320873" / "40.78 68.32"  →  [lat, lon]
function parseLatLngString(s: string): [number, number] | null {
  if (!s) return null;
  const t = s.trim();
  let parts: string[] = [];
  if (t.includes(';')) parts = t.split(';');
  else if (t.split(',').length === 2 && /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(t)) {
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

function pickDescription(row: unknown[], startIdx: number): string {
  for (let j = startIdx; j < row.length; j++) {
    const v = String(row[j] ?? '').trim();
    if (v && !/^latitude|^longitude|^description$/i.test(v)) return v;
  }
  return '';
}

// Маппинг текстового значения колонки «тип/type» в CameraType.
// Понимает: 'ЛУ', 'Линейный участок', 'Перекр(ё)сток', 'ОВН', 'АПК', 'apk-lu', etc.
function parseCameraType(s: string): CameraType | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase().trim();
  if (/перекрест|перекрёст|intersection|crossroad/.test(t)) return 'apk-intersection';
  if (/(^|[^а-я])лу([^а-я]|$)|линейн.+участок|baseline|apk-lu/.test(t)) return 'apk-lu';
  if (/(^|[^а-я])овн([^а-я]|$)|public[\s-]?surveil|обществ.*видео|\bovn\b/.test(t)) return 'ovn';
  if (/(^|[^а-я])апк([^а-я]|$)|аппарат|\bapk\b/.test(t)) return 'apk-lu'; // АПК без подтипа → ЛУ
  return undefined;
}

// Парс хедер-строки: возвращает индексы колонок по типу.
// Поддерживаются ru/en варианты.
interface ColumnIndex {
  lat: number;
  lon: number;
  coord: number; // совмещённая колонка "lat, lon"
  type: number;
  district: number;
  desc: number;
}

function detectColumns(headerRow: unknown[]): Partial<ColumnIndex> | null {
  const cols: Partial<ColumnIndex> = {};
  let hits = 0;
  for (let i = 0; i < headerRow.length; i++) {
    const v = String(headerRow[i] ?? '').toLowerCase().trim();
    if (!v) continue;
    if (/^lat\b|шир(от)?а?$/.test(v))                                    { cols.lat = i; hits++; }
    else if (/^lon\b|долг(от)?а?$/.test(v))                              { cols.lon = i; hits++; }
    else if (/coord|координ/.test(v))                                     { cols.coord = i; hits++; }
    else if (/^тип$|^type$|category|категори/.test(v))                    { cols.type = i; hits++; }
    else if (/район|district|город|city/.test(v))                         { cols.district = i; hits++; }
    else if (/^desc|опис|address|адрес|^name$|назван/.test(v))            { cols.desc = i; hits++; }
  }
  return hits >= 2 ? cols : null;
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
    const sheetDistrict = sheetName.trim() || 'Импорт';

    // Пытаемся найти строку с заголовками — типичный header в одной из
    // первых 5 строк.  Если нашли → парсим по индексам колонок.  Иначе
    // фоллбэк на старый позиционный режим.
    let cols: Partial<ColumnIndex> | null = null;
    let headerIdx = -1;
    for (let r = 0; r < Math.min(5, rows.length); r++) {
      const d = detectColumns(rows[r] as unknown[]);
      if (d) { cols = d; headerIdx = r; break; }
    }

    const startRow = cols ? headerIdx + 1 : 0;
    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      if (!row || row.length === 0) continue;

      let lat: number | null = null;
      let lon: number | null = null;
      let descCellIdx = 2;

      if (cols) {
        // (A) header mode
        if (cols.coord !== undefined) {
          const cc = parseLatLngString(String(row[cols.coord] ?? ''));
          if (cc) [lat, lon] = cc;
        }
        if ((lat === null || lon === null) && cols.lat !== undefined && cols.lon !== undefined) {
          const la = parseFloat(String(row[cols.lat] ?? '').replace(',', '.'));
          const lo = parseFloat(String(row[cols.lon] ?? '').replace(',', '.'));
          if (!isNaN(la) && !isNaN(lo)) { lat = la; lon = lo; }
        }
      } else {
        // (B) legacy positional mode — первая ячейка может быть "lat, lon"
        const c0 = String(row[0] ?? '').trim();
        if (!c0) continue;
        const combined = parseLatLngString(c0);
        if (combined) {
          [lat, lon] = combined;
          descCellIdx = 1;
        } else {
          const a = parseFloat(c0.replace(',', '.'));
          const b = parseFloat(String(row[1] ?? '').replace(',', '.'));
          if (isNaN(a) || isNaN(b)) continue;
          lat = a; lon = b;
        }
      }

      if (lat === null || lon === null) continue;
      if (lat < 35 || lat > 60 || lon < 45 || lon > 90) continue;

      const desc = cols?.desc !== undefined
        ? String(row[cols.desc] ?? '').trim()
        : pickDescription(row, descCellIdx);

      // Sergek-domain: тип камеры либо из колонки «тип», либо из описания
      // как fallback (часто заказчик пишет «АПК-ЛУ ул. X» в одной ячейке).
      const typeCell = cols?.type !== undefined ? String(row[cols.type] ?? '') : '';
      const cameraType = parseCameraType(typeCell) ?? parseCameraType(desc);

      // Район: из колонки «район», иначе имя листа.
      const district = (cols?.district !== undefined
        ? String(row[cols.district] ?? '').trim()
        : '') || sheetDistrict;

      subscribers.push({
        id: newId(),
        lat,
        lon,
        desc: desc || `Камера ${subscribers.length + 1}`,
        district,
        fibers: { working: 2, spare: 1 },
        ...(cameraType ? { cameraType, minSpeedMbps: CAMERA_MIN_SPEED_MBPS[cameraType] } : {}),
      });
    }
  }

  return subscribers;
}
