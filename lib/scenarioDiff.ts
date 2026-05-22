import type { Cable, ScenarioSlotData } from '@/types/network';

export type ScenarioCableDiffKind = 'added' | 'removed' | 'modified';

export interface ScenarioCableDiff {
  kind: ScenarioCableDiffKind;
  cable: Cable;
  /** Для modified — кабель из другого слота. */
  other?: Cable;
  deltaLengthM?: number;
}

export interface ScenarioMapDiff {
  added: ScenarioCableDiff[];
  removed: ScenarioCableDiff[];
  modified: ScenarioCableDiff[];
  /** id кабелей текущей сети для подсветки, если id совпадает со сценарием */
  highlightIds: Set<string>;
}

function linkKey(fromId: string, toId: string): string {
  return fromId < toId ? `${fromId}↔${toId}` : `${toId}↔${fromId}`;
}

function indexByLink(cables: Cable[]): Map<string, Cable> {
  const m = new Map<string, Cable>();
  for (const c of cables) {
    const k = linkKey(c.fromId, c.toId);
    if (!m.has(k)) m.set(k, c);
  }
  return m;
}

/** Сравнение двух сохранённых сценариев A и B. */
export function diffScenarioCables(a: ScenarioSlotData, b: ScenarioSlotData): ScenarioMapDiff {
  const mapA = indexByLink(a.cables);
  const mapB = indexByLink(b.cables);
  const added: ScenarioCableDiff[] = [];
  const removed: ScenarioCableDiff[] = [];
  const modified: ScenarioCableDiff[] = [];
  const highlightIds = new Set<string>();

  for (const [k, ca] of mapA) {
    const cb = mapB.get(k);
    if (!cb) {
      removed.push({ kind: 'removed', cable: ca });
      highlightIds.add(ca.id);
      continue;
    }
    const lenDiff = Math.abs(ca.lengthM - cb.lengthM);
    if (ca.type !== cb.type || lenDiff > Math.max(20, ca.lengthM * 0.05)) {
      modified.push({
        kind: 'modified',
        cable: cb,
        other: ca,
        deltaLengthM: Math.round(cb.lengthM - ca.lengthM),
      });
      highlightIds.add(cb.id);
      highlightIds.add(ca.id);
    }
  }

  for (const [k, cb] of mapB) {
    if (!mapA.has(k)) {
      added.push({ kind: 'added', cable: cb });
      highlightIds.add(cb.id);
    }
  }

  return { added, removed, modified, highlightIds };
}

export function diffSummary(d: ScenarioMapDiff): { added: number; removed: number; modified: number } {
  return { added: d.added.length, removed: d.removed.length, modified: d.modified.length };
}

/** Подсветка кабелей текущей сети, совпадающих по связке с diff A↔B. */
export function highlightCurrentCableIds(current: Cable[], diff: ScenarioMapDiff): Set<string> {
  const keys = new Set<string>();
  for (const list of [diff.added, diff.removed, diff.modified]) {
    for (const d of list) keys.add(linkKey(d.cable.fromId, d.cable.toId));
  }
  const ids = new Set<string>();
  for (const c of current) {
    if (keys.has(linkKey(c.fromId, c.toId))) ids.add(c.id);
  }
  return ids;
}

export { linkKey };
