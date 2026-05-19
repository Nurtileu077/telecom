import { CABLE_FIBERS, CABLE_SIZES, CableType, SplitterRatio } from '@/types/network';

/**
 * Топология Sergek: от абонента к OLT жильность растёт (ОК-4 → ОК-8 → ОК-12 → ОК-16).
 * На участке, где к OLT «текут» N камер, нужно N×2 волокон (раб+рез).
 */
export const SERGEK_PORT_CAPACITY = 64;
export const SERGEK_L1_DEFAULT: SplitterRatio = '1:8';
export const SERGEK_L2_FOR_1X8: SplitterRatio = '1:8';

export const CABLE_OLT_FEEDER: CableType = 'ОК-16';
/** Муфта → ОРКСП: всегда 2F (ОК-4). */
export const CABLE_L1_BRANCH: CableType = 'ОК-4';
/** Макс. жильность на группу ОРК (метка; участки — по pickOrkChainCableType). */
export const CABLE_ORK_DISTRIBUTION: CableType = 'ОК-16';

const LADDER: CableType[] = ['ОК-4', 'ОК-8', 'ОК-12', 'ОК-16'];

/**
 * Сколько камер «ниже по течению» на этом участке (к OLT) — столько жильности.
 * 1 камера → ОК-4, 2 → ОК-4 (4 вол.), 3 → ОК-8, 4 → ОК-8, 5 → ОК-12, …
 */
export function pickCableForDownstreamCount(downstreamCameras: number): CableType {
  if (downstreamCameras <= 0) return 'ОК-4';
  const fibersNeeded = downstreamCameras * 2;
  for (const t of LADDER) {
    if (CABLE_FIBERS[t] >= fibersNeeded) return t;
  }
  return 'ОК-16';
}

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

/** Тип кабеля на сегменте 2-го прохода. */
export function pickSegmentCableType(
  subsCount: number,
  fromId: string,
  toId: string,
  roles: Map<string, EntityRole>,
): CableType {
  const from = inferRole(fromId, roles);
  const to = inferRole(toId, roles);

  if (from === 'olt' && to === 'tb') return CABLE_OLT_FEEDER;
  if ((from === 'tb' && to === 'ork') || (from === 'ork' && to === 'tb')) {
    return CABLE_L1_BRANCH;
  }

  return pickCableForDownstreamCount(subsCount);
}

/** @deprecated */
export function pickSergekSharedCableType(subsCount: number): CableType {
  return pickCableForDownstreamCount(subsCount);
}

/** Участок цепочки бокс→бокс: N камер ниже по направлению к OLT. */
export function pickOrkChainCableType(downstreamCameras: number): CableType {
  return pickCableForDownstreamCount(downstreamCameras);
}
