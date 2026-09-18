import { PlanRoute, SettlementOrder } from '@/types/construction';
import { importKmzRaw } from '@/components/Import/KmzImporter';
import { buildAreas, type AreaImportResult } from './areaImport';

/**
 * Загрузка проектной трассы из KML/KMZ.
 *
 * Берём только линии: точки в плановом файле — это обычно камеры и узлы,
 * они приходят своим путём через импорт абонентов. План хранится отдельно
 * от факта и стройкой не переписывается.
 */

const R = 6371000;

/** Длина ломаной по земной поверхности, метры. */
export function polylineLengthM(coords: [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    const [la1, lo1] = coords[i - 1];
    const [la2, lo2] = coords[i];
    const dLat = ((la2 - la1) * Math.PI) / 180;
    const dLon = ((lo2 - lo1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    sum += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return Math.round(sum);
}

export interface PlanImportResult {
  routes: PlanRoute[];
  /** Линии, отброшенные как вырожденные (меньше двух точек). */
  skipped: number;
  totalM: number;
}

/**
 * Один файл — и трассы, и контуры.
 *
 * В файле из Google Earth лежит и то и другое: линии трассы и обводки
 * районов с сёлами. Просить человека загрузить один и тот же файл дважды,
 * разными кнопками, — значит не понимать, как он работает.
 */
export async function importPlanFile(
  file: File,
  orders: SettlementOrder[] = [],
): Promise<PlanImportResult & { areas: AreaImportResult }> {
  const { lines, polygons } = await importKmzRaw(file);
  const routes = buildRoutes(lines, file.name);
  return {
    ...routes,
    areas: buildAreas(polygons, orders, file.name),
  };
}

export async function importPlanRoutes(file: File): Promise<PlanImportResult> {
  const { lines } = await importKmzRaw(file);
  return buildRoutes(lines, file.name);
}

function buildRoutes(
  lines: { coords: [number, number][]; name: string; folder: string }[],
  source: string,
): PlanImportResult {
  const now = new Date().toISOString();
  const routes: PlanRoute[] = [];
  let skipped = 0;

  lines.forEach((l, i) => {
    const coords = (l.coords ?? []).filter(
      (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
    ) as [number, number][];
    if (coords.length < 2) { skipped++; return; }
    routes.push({
      // Идентификатор детерминированный: повторная загрузка того же файла
      // обновит трассы, а не удвоит их.
      id: `plan-${source}-${i}`,
      name: l.name?.trim() || `Трасса ${i + 1}`,
      folder: l.folder?.trim() || undefined,
      uchastok: l.folder?.trim() || undefined,
      coords,
      lengthM: polylineLengthM(coords),
      source,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { routes, skipped, totalM: routes.reduce((s, r) => s + r.lengthM, 0) };
}
