import { Subscriber } from '@/types/network';
import type { KmlPoint, KmlLine } from './KmlStructured';

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

export interface KmlRawLine {
  coords: [number, number][]; // [lat, lon]
  name: string;
  folder: string;
}

/**
 * Полигон из KML: у заказчика в Google Earth так обведены районы и сёла.
 * Их не нужно рисовать заново — их нужно прочитать.
 */
/** Что нашлось в файле — чтобы «ничего не загрузилось» можно было объяснить. */
export interface KmlParseStats {
  placemarks: number;
  points: number;
  lines: number;
  polygons: number;
  /** Сколько координат не удалось разобрать. */
  droppedCoords: number;
}

export interface KmlRawPolygon {
  coords: [number, number][]; // [lat, lon], внешний контур
  name: string;
  folder: string;
  folderPath: string[];
}

interface ParseOpts {
  defaultDistrict?: string;
  resetIds?: boolean;
}

function folderNameOf(pm: Element, fallback: string): string {
  let parent = pm.parentElement;
  while (parent) {
    if (parent.tagName === 'Folder') {
      const fn = parent.querySelector(':scope > name')?.textContent?.trim();
      if (fn && !['Абоненты', 'Subscribers', 'Points', 'Полигоны'].includes(fn)) return fn;
      break;
    }
    parent = parent.parentElement;
  }
  return fallback;
}

// Parse the Document-level <Schema> mapping  field-id → displayName, so we
// can later expose ExtendedData / SimpleData values under human-readable
// keys ("itemType", "category", …) instead of opaque "COL5C42A1F37390183C".
function parseSchemaFields(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  const schemas = doc.getElementsByTagName('Schema');
  for (let i = 0; i < schemas.length; i++) {
    const fields = schemas[i].querySelectorAll(':scope > SimpleField');
    for (const f of fields) {
      const id = f.getAttribute('name');
      const disp = f.querySelector(':scope > displayName')?.textContent?.trim();
      if (id && disp) map.set(id, disp);
    }
  }
  return map;
}

// Read all <SimpleData> / <Data> children of a Placemark's <ExtendedData>
// into a plain string → string dict keyed by displayName when available.
function extDataOf(pm: Element, schemaMap: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const ext = pm.querySelector(':scope > ExtendedData');
  if (!ext) return out;
  for (const sd of ext.querySelectorAll(':scope > SchemaData > SimpleData')) {
    const id = sd.getAttribute('name') ?? '';
    const key = schemaMap.get(id) ?? id;
    out[key] = (sd.textContent ?? '').trim();
  }
  for (const d of ext.querySelectorAll(':scope > Data')) {
    const id = d.getAttribute('name') ?? '';
    const v = d.querySelector(':scope > value')?.textContent?.trim() ?? '';
    if (id) out[id] = v;
  }
  return out;
}

// Full ancestor chain of <Folder> names from the document root down to the
// placemark.  Drives the smart classifier — different vendors use slightly
// different folder structures and the deeper folder name is usually the most
// specific (e.g. ["Туркестан", "Магистраль", "ОК-48"]).
function folderPathOf(pm: Element): string[] {
  const path: string[] = [];
  let parent: Element | null = pm.parentElement;
  while (parent) {
    if (parent.tagName === 'Folder') {
      const fn = parent.querySelector(':scope > name')?.textContent?.trim();
      if (fn) path.unshift(fn);
    }
    parent = parent.parentElement;
  }
  return path;
}

/**
 * Координаты KML: тройки «долгота,широта,высота», разделённые пробелами.
 *
 * Раньше здесь стоял фильтр по границам Казахстана, и всё за его
 * пределами молча выбрасывалось. Молча — самое плохое слово: файл
 * загружался «успешно», а линий на карте не было, и понять почему было
 * нельзя. Теперь отбрасываем только то, что не является координатой,
 * а сколько отбросили — считаем и показываем.
 */
let lastDropped = 0;

function parseCoordList(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const triplet of text.trim().split(/\s+/)) {
    if (!triplet) continue;
    const parts = triplet.split(',');
    if (parts.length < 2) { lastDropped++; continue; }
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)
        || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      lastDropped++;
      continue;
    }
    out.push([lat, lon]);
  }
  return out;
}

interface KmlParsed {
  subscribers: Subscriber[]; lines: KmlRawLine[];
  structuredPoints: KmlPoint[]; structuredLines: KmlLine[];
  polygons: KmlRawPolygon[];
  stats: KmlParseStats;
}

/**
 * Разбор в два шага: сначала готовим обработчик метки, потом его гоняют.
 *
 * Метки можно перебрать разом — так быстрее, — а можно порциями, отдавая
 * браузеру управление между ними. Второе нужно на больших файлах: в
 * рабочем KML тысяча с лишним меток, и разбор всех подряд подвешивает
 * вкладку на секунды, а на слабом планшете — на десятки секунд.
 */
function makeKmlParser(kmlText: string, opts: ParseOpts = {}): {
  count: number;
  step: (i: number) => void;
  done: () => KmlParsed;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'text/xml');
  const schemaMap = parseSchemaFields(doc);

  lastDropped = 0;
  const subscribers: Subscriber[] = [];
  const lines: KmlRawLine[] = [];
  const structuredPoints: KmlPoint[] = [];
  const structuredLines: KmlLine[] = [];
  const polygons: KmlRawPolygon[] = [];
  const fallback = opts.defaultDistrict ?? 'Imported';
  const placemarks = doc.querySelectorAll('Placemark');

  const handle = (pm: Element) => {
    const folder = folderNameOf(pm, fallback);
    const folderPath = folderPathOf(pm);
    const name = pm.querySelector('name')?.textContent?.trim() || '';
    const desc = pm.querySelector('description')?.textContent?.trim() || '';
    const extData = extDataOf(pm, schemaMap);

    const point = pm.querySelector('Point > coordinates');
    if (point) {
      const c = parseCoordList(point.textContent ?? '')[0];
      if (c) {
        subscribers.push({
          id: newId(),
          lat: c[0], lon: c[1],
          desc: name || desc || `Або. ${subscribers.length + 1}`,
          district: folder,
          fibers: { working: 2, spare: 1 },
        });
        structuredPoints.push({
          lat: c[0], lon: c[1],
          name, desc, folderPath, fileDistrict: fallback, extData,
        });
      }
    }

    // Внешний контур полигона. Дырок (innerBoundaryIs) в районных обводках
    // не бывает, поэтому берём только outerBoundaryIs.
    const polyEls = pm.querySelectorAll('Polygon > outerBoundaryIs > LinearRing > coordinates');
    polyEls.forEach((el) => {
      const cs = parseCoordList(el.textContent ?? '');
      if (cs.length >= 3) {
        polygons.push({ coords: cs, name: name || desc, folder, folderPath });
      }
    });

    // Все линии метки, а не первая: в MultiGeometry их бывает несколько,
    // и остальные просто пропадали.
    const lineEls = pm.querySelectorAll('LineString > coordinates');
    lineEls.forEach((el) => {
      const cs = parseCoordList(el.textContent ?? '');
      if (cs.length >= 2) {
        lines.push({ coords: cs, name: name || desc, folder });
        structuredLines.push({
          coords: cs, name: name || desc, folderPath, fileDistrict: fallback, extData,
        });
      }
    });
  };

  return {
    count: placemarks.length,
    step: (i: number) => { handle(placemarks[i]); },
    done: () => ({
      subscribers, lines, structuredPoints, structuredLines, polygons,
      stats: {
        placemarks: placemarks.length,
        points: structuredPoints.length,
        lines: lines.length,
        polygons: polygons.length,
        droppedCoords: lastDropped,
      },
    }),
  };
}

/** Разбор разом — для файлов, которые и так читаются мгновенно. */
function parseKmlText(kmlText: string, opts: ParseOpts = {}): KmlParsed {
  const p = makeKmlParser(kmlText, opts);
  for (let i = 0; i < p.count; i += 1) p.step(i);
  return p.done();
}

/** Сколько меток разбираем, не отдавая управление браузеру. */
const CHUNK = 400;

/**
 * Разбор порциями.
 *
 * Между порциями отдаём управление браузеру: страница продолжает
 * отвечать, а человек видит, что файл читается, а не завис.
 */
export async function parseKmlTextChunked(
  kmlText: string,
  opts: ParseOpts = {},
  onProgress?: (done: number, total: number) => void,
): Promise<KmlParsed> {
  const p = makeKmlParser(kmlText, opts);
  for (let i = 0; i < p.count; i += 1) {
    p.step(i);
    if ((i + 1) % CHUNK === 0) {
      onProgress?.(i + 1, p.count);
      // Один кадр браузеру: без этого «порции» ничего не дают.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
  }
  onProgress?.(p.count, p.count);
  return p.done();
}

export async function importKmz(file: File): Promise<Subscriber[]> {
  idCounter = 0;
  const text = await readKmlText(file);
  const fallback = file.name.replace(/\.(kml|kmz)$/i, '').trim() || 'Imported';
  return parseKmlText(text, { defaultDistrict: fallback }).subscribers;
}

export async function importKmzRaw(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<{
  subscribers: Subscriber[];
  lines: KmlRawLine[];
  structuredPoints: KmlPoint[];
  structuredLines: KmlLine[];
  polygons: KmlRawPolygon[];
  stats: KmlParseStats;
}> {
  idCounter = 0;
  const text = await readKmlText(file);
  const fallback = file.name.replace(/\.(kml|kmz)$/i, '').trim() || 'Imported';
  // Порциями: в рабочем файле тысяча с лишним меток, и разбор всех подряд
  // подвешивает вкладку, а на планшете — надолго.
  return parseKmlTextChunked(text, { defaultDistrict: fallback }, onProgress);
}

export async function importKmzBatchRaw(files: File[]): Promise<{
  subscribers: Subscriber[];
  lines: KmlRawLine[];
  structuredPoints: KmlPoint[];
  structuredLines: KmlLine[];
  perFile: Array<{ name: string; subs: number; lines: number; error?: string }>;
}> {
  idCounter = 0;
  const allSubs: Subscriber[] = [];
  const allLines: KmlRawLine[] = [];
  const allSP: KmlPoint[] = [];
  const allSL: KmlLine[] = [];
  const perFile: Array<{ name: string; subs: number; lines: number; error?: string }> = [];

  for (const file of files) {
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.kml') && !ext.endsWith('.kmz')) {
      perFile.push({ name: file.name, subs: 0, lines: 0, error: 'не KML/KMZ' });
      continue;
    }
    try {
      const text = await readKmlText(file);
      const fallback = file.name.replace(/\.(kml|kmz)$/i, '').trim() || file.name;
      const { subscribers, lines, structuredPoints, structuredLines } =
        parseKmlText(text, { defaultDistrict: fallback, resetIds: false });
      allSubs.push(...subscribers);
      allLines.push(...lines);
      allSP.push(...structuredPoints);
      allSL.push(...structuredLines);
      perFile.push({ name: file.name, subs: subscribers.length, lines: lines.length });
    } catch (e: any) {
      perFile.push({ name: file.name, subs: 0, lines: 0, error: e?.message ?? 'parse error' });
    }
  }

  return { subscribers: allSubs, lines: allLines, structuredPoints: allSP, structuredLines: allSL, perFile };
}

export async function importKmzBatch(files: File[]): Promise<{
  subscribers: Subscriber[];
  perFile: Array<{ name: string; count: number; error?: string }>;
}> {
  const { subscribers, perFile } = await importKmzBatchRaw(files);
  return {
    subscribers,
    perFile: perFile.map((p) => ({ name: p.name, count: p.subs, error: p.error })),
  };
}
