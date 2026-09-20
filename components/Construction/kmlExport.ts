/**
 * Выгрузка того, что нарисовано, обратно в KML.
 *
 * Файл приходит от проектировщика, правится на стройке и должен уйти к
 * нему обратно — иначе поправки живут только у нас, а в проекте остаётся
 * вчерашняя трасса. KML открывается и в Google Earth, и в SAS.Планете, и
 * в том, чем пользуется заказчик, поэтому отдаём в нём же.
 */

export interface KmlLine {
  name: string;
  coords: [number, number][];
  /** Цвет линии в обычной записи #rrggbb. */
  color?: string;
  description?: string;
  /** Замкнуть контур: площадь рисуется полигоном, а не ломаной. */
  closed?: boolean;
}

export interface KmlPoint {
  name: string;
  lat: number;
  lon: number;
  description?: string;
}

export interface KmlFolder {
  name: string;
  lines?: KmlLine[];
  points?: KmlPoint[];
}

export interface KmlDoc {
  name: string;
  description?: string;
  folders: KmlFolder[];
}

export function escapeXml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Цвет в KML записывается задом наперёд и с прозрачностью впереди:
 * aabbggrr. Перепутать байты легче лёгкого, поэтому перевод здесь один
 * на весь файл.
 */
export function kmlColor(hex: string | undefined, opacity = 1): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return 'ff2dd4bf';
  const rr = m[1].slice(0, 2);
  const gg = m[1].slice(2, 4);
  const bb = m[1].slice(4, 6);
  const aa = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16).padStart(2, '0');
  return (aa + bb + gg + rr).toLowerCase();
}

/** Координаты в KML идут долготой вперёд — и это главный источник ошибок. */
function coordsBlock(coords: [number, number][]): string {
  return coords.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)},0`).join(' ');
}

function styleId(color: string): string {
  return `s_${kmlColor(color)}`;
}

function lineXml(l: KmlLine): string {
  const ring = l.closed && l.coords.length >= 3
    ? [...l.coords, l.coords[0]]
    : l.coords;
  const geometry = l.closed && l.coords.length >= 3
    ? `<Polygon><outerBoundaryIs><LinearRing><tessellate>1</tessellate>`
      + `<coordinates>${coordsBlock(ring)}</coordinates>`
      + `</LinearRing></outerBoundaryIs></Polygon>`
    : `<LineString><tessellate>1</tessellate>`
      + `<coordinates>${coordsBlock(ring)}</coordinates></LineString>`;

  return `      <Placemark>\n`
    + `        <name>${escapeXml(l.name)}</name>\n`
    + (l.description ? `        <description>${escapeXml(l.description)}</description>\n` : '')
    + `        <styleUrl>#${styleId(l.color ?? '#2dd4bf')}</styleUrl>\n`
    + `        ${geometry}\n`
    + `      </Placemark>\n`;
}

function pointXml(p: KmlPoint): string {
  return `      <Placemark>\n`
    + `        <name>${escapeXml(p.name)}</name>\n`
    + (p.description ? `        <description>${escapeXml(p.description)}</description>\n` : '')
    + `        <Point><coordinates>${p.lon.toFixed(6)},${p.lat.toFixed(6)},0</coordinates></Point>\n`
    + `      </Placemark>\n`;
}

export function buildKml(doc: KmlDoc): string {
  const colors = new Set<string>();
  for (const f of doc.folders) for (const l of f.lines ?? []) colors.add(l.color ?? '#2dd4bf');

  const styles = [...colors].map((c) => (
    `    <Style id="${styleId(c)}">\n`
    + `      <LineStyle><color>${kmlColor(c)}</color><width>3</width></LineStyle>\n`
    + `      <PolyStyle><color>${kmlColor(c, 0.25)}</color></PolyStyle>\n`
    + `    </Style>\n`
  )).join('');

  const folders = doc.folders
    .filter((f) => (f.lines?.length ?? 0) + (f.points?.length ?? 0) > 0)
    .map((f) => (
      `    <Folder>\n`
      + `      <name>${escapeXml(f.name)}</name>\n`
      + (f.lines ?? []).map(lineXml).join('')
      + (f.points ?? []).map(pointXml).join('')
      + `    </Folder>\n`
    )).join('');

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
    + '  <Document>\n'
    + `    <name>${escapeXml(doc.name)}</name>\n`
    + (doc.description ? `    <description>${escapeXml(doc.description)}</description>\n` : '')
    + styles
    + folders
    + '  </Document>\n'
    + '</kml>\n';
}

/** Имя файла, по которому его потом найдут: с датой и без пробелов. */
export function kmlFileName(base: string, date = new Date()): string {
  const iso = date.toISOString().slice(0, 10);
  const safe = (base || 'optiq')
    .trim()
    .replace(/[^0-9a-zA-Zа-яА-ЯёЁ _-]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return `${safe || 'optiq'}_${iso}.kml`;
}
