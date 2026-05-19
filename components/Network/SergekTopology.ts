import { CableType, SplitterRatio } from '@/types/network';

/**
 * Эталонная топология Sergek (схема заказчика):
 *   OLT ──16F──► L1 1:8 ──2F──► ×8 ОРКСП (внутри 1:8) ──16F──► до 8 ONT/камер
 *   8 × 8 = 64 камеры на порт OLT.
 */
export const SERGEK_PORT_CAPACITY = 64;
export const SERGEK_L1_DEFAULT: SplitterRatio = '1:8';
export const SERGEK_L2_FOR_1X8: SplitterRatio = '1:8';

/** OLT → муфта L1 (питание каскада 1), 16 волокон. */
export const CABLE_OLT_FEEDER: CableType = 'ОК-16';
/** Муфта L1 → ОРКСП: 2F (1 раб. + 1 рез.). */
export const CABLE_L1_BRANCH: CableType = 'ОК-4';
/** ОРКСП → группа ONT (до 8 на ветке), 16 волокон. */
export const CABLE_ORK_DISTRIBUTION: CableType = 'ОК-16';

export type EntityRole = 'olt' | 'tb' | 'ork' | 'box' | 'sub' | 'joint' | 'other';

function inferRole(id: string, roles: Map<string, EntityRole>): EntityRole {
  const hit = roles.get(id);
  if (hit) return hit;
  if (id.startsWith('J-')) return 'joint';
  if (id.startsWith('BOX-')) return 'box';
  if (id.startsWith('ОРКСП-')) return 'ork';
  if (id.startsWith('Муфта-')) return 'tb';
  if (id.startsWith('OLT-')) return 'olt';
  return 'other';
}

/** Жильность сегмента 2-го прохода с учётом ролей концов (не везде ОК-16). */
export function pickSegmentCableType(
  subsCount: number,
  fromId: string,
  toId: string,
  roles: Map<string, EntityRole>,
): CableType {
  const from = inferRole(fromId, roles);
  const to = inferRole(toId, roles);

  if (from === 'olt' && to === 'tb') return CABLE_OLT_FEEDER;
  if (from === 'tb' && to === 'ork') return CABLE_L1_BRANCH;
  if (from === 'ork' && to === 'tb') return CABLE_L1_BRANCH;

  if (subsCount <= 1) return 'ОК-4';
  if (from === 'ork' || to === 'ork' || from === 'box' || to === 'box') {
    return CABLE_ORK_DISTRIBUTION;
  }
  if (subsCount <= 8) return CABLE_ORK_DISTRIBUTION;
  return CABLE_OLT_FEEDER;
}

/** @deprecated use pickSegmentCableType */
export function pickSergekSharedCableType(subsCount: number): CableType {
  if (subsCount <= 1) return 'ОК-4';
  if (subsCount <= 8) return CABLE_ORK_DISTRIBUTION;
  return CABLE_OLT_FEEDER;
}

/** Участок цепочки бокс→бокс внутри одного ОРКСП. */
export function pickOrkChainCableType(camerasRemaining: number): CableType {
  if (camerasRemaining <= 1) return 'ОК-4';
  return CABLE_ORK_DISTRIBUTION;
}
