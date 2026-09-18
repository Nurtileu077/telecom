import { MapArea, AreaKind, SettlementOrder } from '@/types/construction';
import { importKmzRaw, type KmlRawPolygon } from '@/components/Import/KmzImporter';

/**
 * Загрузка обведённых районов и сёл из KML/KMZ.
 *
 * Границы уже нарисованы: в Google Earth районы обведены, внутри них —
 * сёла. Система их не выдумывает и не перерисовывает, а читает и связывает
 * с реестром по названию. После этого по карте видно то же, что видит
 * прораб у себя в телефоне, только с ходом работ поверх.
 */

/**
 * «Зерендинский район», «Акмолинская обл.», «с. Еленовка» — по названию.
 *
 * Границы слов (\b) здесь не годятся: в JavaScript они считаются по
 * латинице, и на кириллице просто не срабатывают. Поэтому ищем подстроку.
 */
const RAYON_RE = /район|аудан|р-н|р\.н\./i;
const OBLAST_RE = /област|облыс|обл\./i;

export function areaKindOf(name: string, path: string[] = []): AreaKind {
  const n = name.toLowerCase();
  if (RAYON_RE.test(n)) return 'rayon';
  if (OBLAST_RE.test(n)) return 'oblast';
  // Название может молчать, а путь папок — нет: полигон, лежащий прямо в
  // папке области, это скорее район, чем село.
  const parent = (path[path.length - 1] ?? '').toLowerCase();
  if (OBLAST_RE.test(parent) && path.length <= 1) return 'rayon';
  return 'snp';
}

/**
 * Сравнение названий: «с. Еленовка», «ЕЛЕНОВКА», «Еленовка (МКТ)» — одно село.
 *
 * Тип населённого пункта отбрасываем только в начале: внутри названия
 * «аул» или «станция» могут быть его частью («Красный Аул»), и вырезать
 * их означало бы склеить разные сёла.
 */
const PLACE_PREFIX = new Set([
  'с', 'село', 'аул', 'ауыл', 'ст', 'станция', 'пос', 'поселок', 'п',
  'г', 'город', 'разъезд', 'зимовка',
]);

export function normName(s: string): string {
  const tokens = s.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length - 1 && PLACE_PREFIX.has(tokens[i])) i++;
  return tokens.slice(i).join('');
}

/**
 * Сравнение названий районов и областей.
 *
 * В KML пишут «Зерендинский район», в журнале — просто «Зерендинский», и
 * наоборот. Слово вида отбрасываем, иначе обводка района никогда не
 * сойдётся с записями по нему.
 */
const REGION_WORDS = /\s*(район|ауданы|аудан|р-н|р\.н\.|область|области|обл\.|облысы)\s*/gi;

export function normRegion(s: string): string {
  return normName(s.replace(REGION_WORDS, ' '));
}

/** Область и район из пути папок — там они и лежат. */
function placeFromPath(path: string[]): { oblast?: string; rayon?: string } {
  let oblast: string | undefined;
  let rayon: string | undefined;
  for (const raw of path) {
    const p = raw.trim();
    if (!p) continue;
    const kind = areaKindOf(p, []);
    if (kind === 'oblast' && !oblast) oblast = p;
    else if (kind === 'rayon' && !rayon) rayon = p;
  }
  return { oblast, rayon };
}

export interface AreaImportResult {
  areas: MapArea[];
  /** Сколько сёл удалось связать с реестром по названию. */
  matched: number;
  /** Полигоны, отброшенные как вырожденные. */
  skipped: number;
  byKind: Record<AreaKind, number>;
}

export function buildAreas(
  polygons: KmlRawPolygon[],
  orders: SettlementOrder[],
  source: string,
  now = new Date().toISOString(),
): AreaImportResult {
  // Реестр по нормализованному имени: один КАТО на название. Дубли имён
  // по разным областям разводим по области, когда она известна.
  const byName = new Map<string, SettlementOrder[]>();
  for (const o of orders) {
    const key = normName(o.snp);
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(o);
    byName.set(key, list);
  }

  const areas: MapArea[] = [];
  const byKind: Record<AreaKind, number> = { oblast: 0, rayon: 0, snp: 0 };
  let matched = 0;
  let skipped = 0;

  polygons.forEach((p, i) => {
    const coords = p.coords.filter(
      (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
    );
    if (coords.length < 3) { skipped++; return; }

    const path = p.folderPath ?? [];
    const name = (p.name || p.folder || `Контур ${i + 1}`).trim();
    const kind = areaKindOf(name, path);
    const place = placeFromPath(path);

    let kato: string | undefined;
    if (kind === 'snp') {
      const hits = byName.get(normName(name)) ?? [];
      // Одноимённых сёл в Казахстане много, поэтому при нескольких
      // совпадениях выбираем по области из пути папок. Не выбрали —
      // оставляем без КАТО: неверная привязка хуже её отсутствия.
      const exact = hits.length === 1
        ? hits[0]
        : hits.find((o) => place.oblast && normName(o.oblast) === normName(place.oblast))
          ?? hits.find((o) => place.rayon && o.rayon && normName(o.rayon) === normName(place.rayon));
      if (exact) { kato = exact.kato; matched++; }
    }

    byKind[kind]++;
    areas.push({
      // Детерминированный id: повторная загрузка того же файла обновит
      // контуры, а не удвоит их.
      id: `area-${source}-${i}`,
      kind,
      name,
      path: path.length ? path : undefined,
      oblast: kind === 'oblast' ? name : place.oblast,
      rayon: kind === 'rayon' ? name : place.rayon,
      kato,
      coords,
      source,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { areas, matched, skipped, byKind };
}

export async function importMapAreas(
  file: File,
  orders: SettlementOrder[],
): Promise<AreaImportResult> {
  const { polygons } = await importKmzRaw(file);
  return buildAreas(polygons, orders, file.name);
}
