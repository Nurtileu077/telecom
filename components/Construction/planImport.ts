import { PlanRoute } from '@/types/construction';
import { importKmzRaw } from '@/components/Import/KmzImporter';

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

export async function importPlanRoutes(file: File): Promise<PlanImportResult> {
  const { lines } = await importKmzRaw(file);
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
      id: `plan-${file.name}-${i}`,
      name: l.name?.trim() || `Трасса ${i + 1}`,
      folder: l.folder?.trim() || undefined,
      uchastok: l.folder?.trim() || undefined,
      coords,
      lengthM: polylineLengthM(coords),
      source: file.name,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { routes, skipped, totalM: routes.reduce((s, r) => s + r.lengthM, 0) };
}
