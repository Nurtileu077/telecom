import { District, Cable, Materials, ProjectSettings, ValidationIssue, CABLE_SIZES, CableType, CABLE_FIBERS, selectCableTypeByFiberCount } from '@/types/network';
import { haversineM } from './KMeans';

/** Не отводы к абоненту — только распределение/магистраль. */
function isTrunkish(c: Cable): boolean {
  return c.type !== 'ОК-4';
}

function chordEndpoints(c: Cable): { s: [number, number]; e: [number, number] } {
  const coords = c.coords;
  if (coords.length < 2) return { s: [0, 0], e: [0, 0] };
  return { s: coords[0], e: coords[coords.length - 1] };
}

function endpointsCloseForMerge(a: Cable, b: Cable, radiusM: number): boolean {
  if (!isTrunkish(a) || !isTrunkish(b)) return false;
  const A = chordEndpoints(a);
  const B = chordEndpoints(b);
  if (haversineM(A.s[0], A.s[1], B.s[0], B.s[1]) > radiusM) return false;
  if (haversineM(A.e[0], A.e[1], B.e[0], B.e[1]) > radiusM) return false;
  const la = a.lengthM;
  const lb = b.lengthM;
  if (la <= 0 || lb <= 0) return false;
  if (Math.abs(la - lb) / Math.max(la, lb) > 0.42) return false;
  return true;
}

/**
 * Группирует параллельные по концам и длине магистрали для учёта метража:
 * один физический участок → max(длины), сумма волокон → один тип кабеля.
 * ОК-4 не трогаем. Геометрия на карте не меняется.
 */
export function consolidateTrunksForMaterialsAccounting(cables: Cable[], radiusM: number): Cable[] {
  const drops = cables.filter((c) => !isTrunkish(c));
  const trunks = cables.filter(isTrunkish);
  const clusters: Cable[][] = [];

  for (const c of trunks) {
    let placed = false;
    for (const cl of clusters) {
      if (cl.some((x) => endpointsCloseForMerge(x, c, radiusM))) {
        cl.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([c]);
  }

  const merged: Cable[] = clusters.map((g) => {
    if (g.length === 1) return g[0];
    const maxLen = Math.max(...g.map((x) => x.lengthM));
    const totalFibers = g.reduce((s, x) => s + CABLE_FIBERS[x.type], 0);
    const t = selectCableTypeByFiberCount(totalFibers);
    const ref = g.reduce((a, b) => (a.lengthM >= b.lengthM ? a : b));
    return {
      ...ref,
      id: `acct-merge:${g.map((x) => x.id).join('+')}`,
      type: t,
      fibers: CABLE_FIBERS[t],
      lengthM: maxLen,
      routedByOSRM: g.some((x) => x.routedByOSRM),
    };
  });

  return [...merged, ...drops];
}

export function calculateMaterials(
  districts: District[],
  cables: Cable[],
  settings: ProjectSettings
): Materials {
  const reserve = settings.cableReserve;

  const cablesForSum = settings.consolidateParallelTrunksForMaterials
    ? consolidateTrunksForMaterialsAccounting(
      cables,
      settings.parallelMergeRadiusM > 0 ? settings.parallelMergeRadiusM : 18,
    )
    : cables;

  const nonOk4Before = cables.filter(isTrunkish).length;
  const nonOk4After = cablesForSum.filter(isTrunkish).length;
  const mergeExtraMufta = Math.max(0, nonOk4Before - nonOk4After);

  // Build cables object dynamically
  const cablesByType = {} as Record<CableType, number>;
  for (const t of CABLE_SIZES) cablesByType[t] = 0;
  for (const c of cablesForSum) {
    if (cablesByType[c.type] !== undefined) {
      cablesByType[c.type] = (cablesByType[c.type] || 0) + c.lengthM * reserve;
    }
  }
  const totalM = Object.values(cablesByType).reduce((a, b) => a + b, 0);
  const totalKm = totalM / 1000;

  const oltUnits = districts.length;

  let splitter_1x4_L2 = 0;
  let splitter_1x8_L2 = 0;
  let splitter_1x16_L2 = 0;
  let tbCount = 0;
  let orkCount = 0;
  let subCount = 0;

  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      tbCount++;
      for (const ork of tb.orks) {
        orkCount++;
        if (ork.splitter === '1:4') splitter_1x4_L2++;
        else if (ork.splitter === '1:8') splitter_1x8_L2++;
        else splitter_1x16_L2++;
        subCount += ork.subscribers.length;
      }
    }
  }

  const spliceJoints = Math.ceil(totalKm / 2);
  const totalMufta = tbCount + spliceJoints + mergeExtraMufta;

  const pigtailSCAPC = totalMufta * 12 + subCount;
  const kdzsGilzy = Math.ceil(totalKm * 4) + 200;
  // Use distribution cables (ОК-8 and above) for clamp estimation
  const aerialM = (cablesByType['ОК-8'] || 0) + (cablesByType['ОК-12'] || 0) +
    (cablesByType['ОК-16'] || 0) + (cablesByType['ОК-24'] || 0) +
    (cablesByType['ОК-32'] || 0) + (cablesByType['ОК-48'] || 0) + (cablesByType['ОК-96'] || 0);
  const clamps = Math.ceil(aerialM / 50);
  const cable_reserve_m = totalM - (totalM / reserve);

  return {
    cables: {
      'ОК-4':  Math.round(cablesByType['ОК-4']  || 0),
      'ОК-8':  Math.round(cablesByType['ОК-8']  || 0),
      'ОК-12': Math.round(cablesByType['ОК-12'] || 0),
      'ОК-16': Math.round(cablesByType['ОК-16'] || 0),
      'ОК-24': Math.round(cablesByType['ОК-24'] || 0),
      'ОК-32': Math.round(cablesByType['ОК-32'] || 0),
      'ОК-48': Math.round(cablesByType['ОК-48'] || 0),
      'ОК-96': Math.round(cablesByType['ОК-96'] || 0),
      total: Math.round(totalM),
    },
    equipment: {
      oltUnits,
      splitter_1x4_L1: oltUnits,
      splitter_1x4_L2,
      splitter_1x8_L2,
      splitter_1x16_L2,
      muftaMTOK96A: totalMufta,
      boksCount: orkCount,
      ontZTE_F601: subCount,
      pigtailSCAPC,
      patchcord: subCount,
      kdzsGilzy,
      clamps,
      cable_reserve_m: Math.round(cable_reserve_m),
    },
  };
}

export function validateNetwork(districts: District[], cables: Cable[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        const maxSub = ork.splitter === '1:4' ? 4 : ork.splitter === '1:8' ? 8 : 16;
        if (ork.subscribers.length > maxSub) {
          issues.push({
            type: 'warning',
            message: `${ork.id}: загрузка ${ork.subscribers.length}/${maxSub} (>100%)`,
            entityId: ork.id,
          });
        }
      }

      // OLT → TB distance
      const oltTBDist = haversineM(d.olt.lat, d.olt.lon, tb.lat, tb.lon);
      if (oltTBDist > 10000) {
        issues.push({
          type: 'warning',
          message: `${tb.id}: расстояние от OLT ${Math.round(oltTBDist / 100) / 10} км > 10 км`,
          entityId: tb.id,
        });
      }
    }
  }

  // Drop cables > 300m
  const dropCables = cables.filter((c) => c.type === 'ОК-4' && c.lengthM > 300);
  for (const c of dropCables.slice(0, 10)) {
    issues.push({
      type: 'warning',
      message: `Дроп ${c.id}: длина ${Math.round(c.lengthM)} м > 300 м (потери сигнала)`,
      entityId: c.id,
    });
  }

  return issues;
}
