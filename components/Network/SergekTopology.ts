import { CABLE_FIBERS, CABLE_SIZES, CableType, SplitterRatio } from '@/types/network';

/**
 * Топология Sergek:
 * - **Абонент → … → ОРКСП** (цепочка боксов): жильность растёт к ОРК (2→ОК-4, 3–4→ОК-8, …).
 * - **ОРКСП → муфта (L1)** и **муфта → OLT**: фиксированные ОК-4 / ОК-16.
 */
export const SERGEK_PORT_CAPACITY = 64;
export const SERGEK_L1_DEFAULT: SplitterRatio = '1:8';
export const SERGEK_L2_FOR_1X8: SplitterRatio = '1:8';

export const CABLE_OLT_FEEDER: CableType = 'ОК-16';
/** Муфта → ОРКСП: всегда 2F (ОК-4). */
export const CABLE_L1_BRANCH: CableType = 'ОК-4';
/** Метка ОРКСП в UI: пассивный 1:8, не «обязательно ОК-16». */
export const CABLE_ORK_LABEL: CableType = 'ОК-4';

const LADDER: CableType[] = ['ОК-4', 'ОК-8', 'ОК-12', 'ОК-16'];

/**
 * Жильность по числу камер на стороне **абонентов** участка (раб+рез = ×2 волокна):
 * 1–2 → ОК-4, 3–4 → ОК-8, 5–6 → ОК-12, 7–8 → ОК-16.
 */
export function pickCableForDownstreamCount(camerasOnSubscriberSide: number): CableType {
  if (camerasOnSubscriberSide <= 0) return 'ОК-4';
  const fibersNeeded = camerasOnSubscriberSide * 2;
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

  // Муфта (L1) ↔ OLT: ОК-16; муфта ↔ ОРКСП: ОК-4.
  if (from === 'olt' && to === 'tb') return CABLE_OLT_FEEDER;
  if ((from === 'tb' && to === 'ork') || (from === 'ork' && to === 'tb')) {
    return CABLE_L1_BRANCH;
  }

  // Цепочка к камерам / общий участок к OLT: по числу камер на сегменте.
  return pickCableForDownstreamCount(subsCount);
}

/** @deprecated */
export function pickSergekSharedCableType(subsCount: number): CableType {
  return pickCableForDownstreamCount(subsCount);
}

/**
 * Участок цепочки ОРКСП→бокс→…→камера: считаем камеры **от абонента к ОРК**.
 * hopIndexFromOrk: 0 = первый бокс от ОРК, 1 = второй, … → на участке (index+1) камер.
 */
export function pickOrkChainHopCableType(hopIndexFromOrk: number): CableType {
  return pickCableForDownstreamCount(hopIndexFromOrk + 1);
}

/** @deprecated Используйте pickOrkChainHopCableType — не total на ОРК. */
export function pickOrkChainCableType(downstreamCameras: number): CableType {
  return pickCableForDownstreamCount(downstreamCameras);
}

export function pickOrkBoxType(subscriberCount: number): string {
  if (subscriberCount <= 8) return 'Бокс-8';
  if (subscriberCount <= 16) return 'Бокс-16';
  return 'ОРКСп-16';
}
