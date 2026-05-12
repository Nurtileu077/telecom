import { District, Cable, Materials, ProjectSettings, ValidationIssue, CABLE_SIZES, CableType } from '@/types/network';
import { haversineM } from './KMeans';

export function calculateMaterials(
  districts: District[],
  cables: Cable[],
  settings: ProjectSettings,
  extraJoints: number = 0,
): Materials {
  const reserve = settings.cableReserve;

  // Build cables object dynamically
  const cablesByType = {} as Record<CableType, number>;
  for (const t of CABLE_SIZES) cablesByType[t] = 0;
  for (const c of cables) {
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

  // Стыковочные муфты на длинных перегонах + транзитные муфты от консолидации
  // (точки расхождения магистрали на ответвления).
  const spliceJoints = Math.ceil(totalKm / 2);
  const totalMufta = tbCount + spliceJoints + extraJoints;

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
