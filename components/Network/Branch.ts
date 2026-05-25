// «Показать ветку»: по клику на OLT/муфту/ОРКСП/камеру подсветить только её
// кабели. Ветка считается на графе ИТОГОВЫХ кабелей (fromId/toId — id сущностей
// или муфт-стыков J-n), поэтому общая магистраль, обслуживающая выбранный узел,
// тоже подсвечивается — это и есть его трасса до OLT.

import type { Cable, District } from '@/types/network';

type Adj = Map<string, { cableId: string; other: string }[]>;

function buildAdj(cables: Cable[]): Adj {
  const adj: Adj = new Map();
  const add = (a: string, cableId: string, other: string) => {
    let arr = adj.get(a);
    if (!arr) { arr = []; adj.set(a, arr); }
    arr.push({ cableId, other });
  };
  for (const c of cables) {
    add(c.fromId, c.id, c.toId);
    add(c.toId, c.id, c.fromId);
  }
  return adj;
}

// Все кабели в связной компоненте узла (весь субтри одного OLT).
function componentCables(adj: Adj, start: string): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of adj.get(n) ?? []) {
      out.add(e.cableId);
      if (!seen.has(e.other)) { seen.add(e.other); queue.push(e.other); }
    }
  }
  return out;
}

// Кабели кратчайшего пути src → dst (BFS).
function pathCables(adj: Adj, src: string, dst: string): string[] {
  if (src === dst) return [];
  const prev = new Map<string, { node: string; cableId: string }>();
  const seen = new Set<string>([src]);
  const queue = [src];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === dst) break;
    for (const e of adj.get(n) ?? []) {
      if (seen.has(e.other)) continue;
      seen.add(e.other);
      prev.set(e.other, { node: n, cableId: e.cableId });
      queue.push(e.other);
    }
  }
  if (!prev.has(dst)) return [];
  const out: string[] = [];
  let cur = dst;
  while (cur !== src) {
    const p = prev.get(cur);
    if (!p) break;
    out.push(p.cableId);
    cur = p.node;
  }
  return out;
}

export function computeBranchCables(
  cables: Cable[],
  districts: District[],
  kind: 'olt' | 'tb' | 'ork' | 'sub',
  id: string,
): Set<string> {
  const adj = buildAdj(cables);

  for (const d of districts) {
    const olt = d.olt;
    const inThis =
      olt.id === id ||
      olt.transitBoxes.some(
        (tb) => tb.id === id || tb.orks.some((o) => o.id === id || o.subscribers.some((s) => s.id === id)),
      );
    if (!inThis) continue;

    if (kind === 'olt') return componentCables(adj, olt.id);

    // Листья (камеры) субтри выбранного узла → путь каждой до OLT.
    const targets: string[] = [];
    if (kind === 'tb') {
      const tb = olt.transitBoxes.find((t) => t.id === id);
      for (const o of tb?.orks ?? []) for (const s of o.subscribers) targets.push(s.id);
      if (targets.length === 0 && tb) targets.push(tb.id);
    } else if (kind === 'ork') {
      const o = olt.transitBoxes.flatMap((t) => t.orks).find((x) => x.id === id);
      for (const s of o?.subscribers ?? []) targets.push(s.id);
      if (targets.length === 0 && o) targets.push(o.id);
    } else {
      targets.push(id); // камера
    }

    const result = new Set<string>();
    for (const t of targets) {
      for (const cid of pathCables(adj, t, olt.id)) result.add(cid);
    }
    return result;
  }
  return new Set();
}
