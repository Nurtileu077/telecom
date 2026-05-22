import type { Cable, District } from '@/types/network';

function entityLabel(id: string, districts: District[]): string {
  for (const d of districts) {
    if (d.olt.id === id) return d.olt.id;
    for (const tb of d.olt.transitBoxes) {
      if (tb.id === id) return tb.id;
      for (const ork of tb.orks) {
        if (ork.id === id) return ork.id;
        const sub = ork.subscribers.find((s) => s.id === id);
        if (sub) return sub.desc?.slice(0, 24) || sub.id;
      }
    }
    const sub = d.subscribers.find((s) => s.id === id);
    if (sub) return sub.desc?.slice(0, 24) || sub.id;
  }
  if (id.startsWith('pt-')) return 'точка';
  return id.slice(0, 16);
}

export function suggestCableDisplayName(cable: Cable, districts: District[]): string {
  const a = entityLabel(cable.fromId, districts);
  const b = entityLabel(cable.toId, districts);
  return `${a} → ${b}`;
}

export function defaultPoleCount(lengthM: number): number {
  return Math.max(2, Math.ceil(lengthM / 40));
}
