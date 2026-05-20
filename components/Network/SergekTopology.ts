import { CABLE_FIBERS, CableType, SplitterRatio } from '@/types/network';

/**
 * Топология Sergek:
 * - OLT → муфта (L1): ОК по числу **веток на ОРКСП** (1 жила на ОРК).
 * - Муфта → ОРКСП: ОК-4 (одна жила на ветку).
 * - ОРКСП: паук **1:16** (1 жила приходит, до 16 портов).
 * - ОРКСП → бокс → камера: лестница **от абонента к ОРК**.
 */
export const SERGEK_PORT_CAPACITY = 64;
export const SERGEK_MAX_CAMS_PER_ORK = 8;
export const SERGEK_MAX_ORKS_PER_MUFTA = 16;
/** Паук на ОРКСП. */
export const SERGEK_L2_ORK_SPIDER: SplitterRatio = '1:16';
export const CABLE_L1_BRANCH: CableType = 'ОК-4';
export const CABLE_ORK_LABEL: CableType = 'ОК-4';

const LADDER: CableType[] = ['ОК-4', 'ОК-8', 'ОК-12', 'ОК-16'];

const SPLITTER_N: Record<SplitterRatio, number> = {
  '1:2': 2, '1:4': 4, '1:8': 8, '1:16': 16, '1:32': 32, '1:64': 64,
};

/** L1 в муфте у OLT — по фактическому числу ОРКСП на порту. */
export function inferL1SplitterForOrkCount(orkCount: number): SplitterRatio {
  const n = Math.max(1, Math.min(orkCount, SERGEK_MAX_ORKS_PER_MUFTA));
  if (n <= 2) return '1:2';
  if (n <= 4) return '1:4';
  if (n <= 8) return '1:8';
  return '1:16';
}

/** Кабель по числу волокон (без ×2 — для веток L1). */
export function pickCableForFiberCount(fibersNeeded: number): CableType {
  const n = Math.max(1, fibersNeeded);
  for (const t of LADDER) {
    if (CABLE_FIBERS[t] >= n) return t;
  }
  return 'ОК-16';
}

/** OLT → муфта: столько жил, сколько веток на ОРКСП (по одной на ОРК). */
export function pickOltToMuftaCableType(orkCountOnMufta: number): CableType {
  return pickCableForFiberCount(orkCountOnMufta);
}

/**
 * Жильность по камерам на стороне абонентов (раб+рез = ×2):
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
  orkCountByTbId?: Map<string, number>,
): CableType {
  const from = inferRole(fromId, roles);
  const to = inferRole(toId, roles);

  if (from === 'olt' && to === 'tb') {
    const orks = orkCountByTbId?.get(toId) ?? Math.max(1, Math.ceil(subsCount / SERGEK_MAX_CAMS_PER_ORK));
    return pickOltToMuftaCableType(orks);
  }
  if ((from === 'tb' && to === 'ork') || (from === 'ork' && to === 'tb')) {
    return CABLE_L1_BRANCH;
  }

  return pickCableForDownstreamCount(subsCount);
}

/** @deprecated */
export function pickSergekSharedCableType(subsCount: number): CableType {
  return pickCableForDownstreamCount(subsCount);
}

/** Участок ОРКСП→бокс: hopIndexFromOrk 0 = первый бокс от ОРК. */
export function pickOrkChainHopCableType(hopIndexFromOrk: number): CableType {
  return pickCableForDownstreamCount(hopIndexFromOrk + 1);
}

/** @deprecated */
export function pickOrkChainCableType(downstreamCameras: number): CableType {
  return pickCableForDownstreamCount(downstreamCameras);
}

export function pickOrkBoxType(subscriberCount: number): string {
  if (subscriberCount <= 8) return 'Бокс-8';
  if (subscriberCount <= 16) return 'Бокс-16';
  return 'ОРКСп-16';
}

/** @deprecated */
export const CABLE_OLT_FEEDER: CableType = 'ОК-16';
