/**
 * Ссылка на место на карте.
 *
 * «Посмотри вот тут» сейчас звучит как «открой Optiq, найди Зеренду,
 * промотай на север» — и человек на том конце открывает не то. Адрес
 * должен открывать ровно то место и то приближение, которое видел тот,
 * кто ссылку дал.
 *
 * Формат — как в OpenStreetMap: #зум/широта/долгота. Он короткий,
 * узнаваемый и переживает копирование через мессенджер, где длинные
 * адреса с параметрами любят ломаться.
 */

export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
  /** Что показать открытым: трасса, объект, авария. */
  focus?: string;
}

const MIN_ZOOM = 3;
const MAX_ZOOM = 21;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z)));
}

/** Сколько знаков после запятой имеет смысл хранить на этом приближении. */
function digitsFor(zoom: number): number {
  if (zoom >= 17) return 6;
  if (zoom >= 13) return 5;
  return 4;
}

export function buildMapHash(v: MapView): string {
  const z = clampZoom(v.zoom);
  const d = digitsFor(z);
  const base = `#${z}/${v.lat.toFixed(d)}/${v.lon.toFixed(d)}`;
  return v.focus ? `${base}/${encodeURIComponent(v.focus)}` : base;
}

export function parseMapHash(hash: string): MapView | null {
  const raw = (hash ?? '').replace(/^#/, '').trim();
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts.length < 3) return null;

  const zoom = Number(parts[0]);
  const lat = Number(parts[1]);
  const lon = Number(parts[2]);
  if (!Number.isFinite(zoom) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const focus = parts[3] ? decodeURIComponent(parts.slice(3).join('/')) : undefined;
  return { lat, lon, zoom: clampZoom(zoom), focus: focus || undefined };
}

/**
 * Полный адрес на это место.
 *
 * Всё, что было в адресе до решётки, сохраняется: рабочее пространство и
 * режим просмотра живут в параметрах, и терять их при «дай ссылку» нельзя.
 */
export function mapLinkFor(href: string, v: MapView): string {
  const cut = href.indexOf('#');
  const base = cut >= 0 ? href.slice(0, cut) : href;
  return base + buildMapHash(v);
}
