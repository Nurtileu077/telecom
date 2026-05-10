import { District, Cable, Materials, ProjectSettings } from '@/types/network';
import { haversineM } from './KMeans';

function cableLength(cables: Cable[], type: Cable['type']): number {
  return cables.filter((c) => c.type === type).reduce((s, c) => s + c.lengthM, 0);
}

export function calculateMaterials(
  districts: District[],
  cables: Cable[],
  settings: ProjectSettings
): Materials {
  const reserve = settings.cableReserve;

  const okb10M = cableLength(cables, 'ОКБ-10') * reserve;
  const oksnн8M = cableLength(cables, 'ОКСНН-8') * reserve;
  const oksnн4M = cableLength(cables, 'ОКСНН-4') * reserve;
  const oka2M = cableLength(cables, 'ОКА-2') * reserve;
  const totalM = okb10M + oksnн8M + oksnн4M + oka2M;
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
  const totalMufta = tbCount + spliceJoints;

  const pigtailSCAPC = totalMufta * 12 + subCount;
  const kdzsGilzy = Math.ceil(totalKm * 4) + 200;
  const aerialM = (oksnн8M + oksnн4M);
  const clamps = Math.ceil(aerialM / 50);
  const cable_reserve_m = totalM - (totalM / reserve);

  return {
    cables: {
      'ОКБ-10': Math.round(okb10M),
      'ОКСНН-8': Math.round(oksnн8M),
      'ОКСНН-4': Math.round(oksnн4M),
      'ОКА-2': Math.round(oka2M),
      total: Math.round(totalM),
    },
    equipment: {
      oltUnits,
      splitter_1x4_L1: oltUnits,
      splitter_1x4_L2,
      splitter_1x8_L2,
      splitter_1x16_L2,
      muftaMTOK96A: totalMufta,
      orkBox: orkCount,
      boxORB32: subCount,
      ontZTE_F601: subCount,
      pigtailSCAPC,
      patchcord: subCount,
      kdzsGilzy,
      clamps,
      cable_reserve_m: Math.round(cable_reserve_m),
    },
  };
}

export function validateNetwork(districts: District[], cables: Cable[]) {
  const issues: Array<{ type: 'warning' | 'error'; message: string; entityId?: string }> = [];

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
  const dropCables = cables.filter((c) => c.type === 'ОКА-2' && c.lengthM > 300);
  for (const c of dropCables.slice(0, 10)) {
    issues.push({
      type: 'warning',
      message: `Дроп ${c.id}: длина ${Math.round(c.lengthM)} м > 300 м (потери сигнала)`,
      entityId: c.id,
    });
  }

  return issues;
}
