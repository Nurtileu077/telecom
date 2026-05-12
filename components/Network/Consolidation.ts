import { Cable, CABLE_FIBERS, CABLE_SIZES, CableType } from '@/types/network';
import { haversineM } from './KMeans';

// Synthetic in-line joint (point where a trunk splits into branches).
// Rendered on the map as a small ⊕ marker; counted as муфта в смете.
export interface InlineJoint {
  id: string;
  lat: number;
  lon: number;
  parentId: string;       // node from which the trunk originates
  branchCount: number;    // how many cables continue after this point
}

const GRID_M = 12;        // координатный шаг агрегации сегментов (≈12 м)

function quantize(lat: number, lon: number): string {
  // ~111320 m per deg lat. At ~43° lon-deg ≈ 81400 m. Use 12m grid.
  const fLat = 1 / (GRID_M / 111320);
  const fLon = 1 / (GRID_M / 81400);
  return `${Math.round(lat * fLat)}_${Math.round(lon * fLon)}`;
}

function pathLength(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}

function pickCableType(fibers: number): CableType {
  for (const t of CABLE_SIZES) {
    if (CABLE_FIBERS[t] >= fibers) return t;
  }
  return 'ОК-96';
}

// Build a tree of shared paths by longest-common-prefix on quantized coords.
// Each input cable is a leaf labeled with its terminal fiber requirement.
type Node = {
  // Coordinate of this node on the shared path
  coord: [number, number];
  // Direct children (next divergent step)
  children: Map<string, Node>;
  // If this node is a leaf, holds the cable info
  leaf?: { cable: Cable; fibersNeeded: number };
  // Sum of fibers passing through this node (computed in pass 2)
  fibersBelow: number;
};

function newNode(coord: [number, number]): Node {
  return { coord, children: new Map(), fibersBelow: 0 };
}

// Insert one cable's path into the trie. The first coord is shared with parent.
function insertPath(root: Node, cable: Cable, fibersNeeded: number) {
  let node = root;
  for (let i = 1; i < cable.coords.length; i++) {
    const c = cable.coords[i];
    const key = quantize(c[0], c[1]);
    let next = node.children.get(key);
    if (!next) {
      next = newNode(c);
      node.children.set(key, next);
    }
    node = next;
  }
  // Leaf: this is the cable's destination
  node.leaf = { cable, fibersNeeded };
}

// Recursively compute fibers passing through each subtree.
function computeFibers(node: Node): number {
  let total = node.leaf ? node.leaf.fibersNeeded : 0;
  for (const child of node.children.values()) {
    total += computeFibers(child);
  }
  node.fibersBelow = total;
  return total;
}

// Walk the tree, emitting one cable per contiguous run where fibersBelow is
// constant (i.e. no branch happens). At branch points, push an InlineJoint and
// recurse into each branch.
function emit(
  parentId: string,
  parentCoord: [number, number],
  startNode: Node,
  startFromId: string,
  emitCable: (c: Cable) => void,
  emitJoint: (j: InlineJoint) => void,
  nextJointId: () => string,
  nextCableId: () => string,
) {
  // Walk down while the node has exactly one child and is not a leaf.
  // Collect coordinates into one cable run.
  let node = startNode;
  let run: [number, number][] = [parentCoord, node.coord];
  let runFibers = node.fibersBelow;

  while (true) {
    // Stop conditions: leaf OR branch (>1 child) OR child fibers differ
    if (node.leaf) {
      // Emit cable from startFromId to leaf's destination
      const type = pickCableType(Math.max(2, runFibers));
      emitCable({
        id: nextCableId(),
        type,
        fibers: CABLE_FIBERS[type],
        fromId: startFromId,
        toId: node.leaf.cable.toId,
        coords: run,
        lengthM: pathLength(run),
        routedByOSRM: node.leaf.cable.routedByOSRM,
      });
      // Continue traversal? A node can be both leaf AND have children (rare with
      // trie-by-leaf), but defensively check children too.
      if (node.children.size === 0) return;
      // Treat as a joint at the leaf coordinate as well — its destination ID
      // serves as the joint.
      const jointId = node.leaf.cable.toId;
      // No new joint marker; reuse the destination as the branch origin.
      for (const child of node.children.values()) {
        emit(parentId, node.coord, child, jointId, emitCable, emitJoint, nextJointId, nextCableId);
      }
      return;
    }
    if (node.children.size === 0) return;
    if (node.children.size === 1) {
      const only = node.children.values().next().value as Node;
      if (only.fibersBelow !== runFibers) {
        // Fiber count drops (some leaves above this point, then continues).
        // This shouldn't normally happen since leaves are at terminal nodes,
        // but handle defensively: emit current run, then continue with new size.
        const type = pickCableType(Math.max(2, runFibers));
        const jointId = nextJointId();
        emitCable({
          id: nextCableId(),
          type,
          fibers: CABLE_FIBERS[type],
          fromId: startFromId,
          toId: jointId,
          coords: run,
          lengthM: pathLength(run),
          routedByOSRM: true,
        });
        emitJoint({ id: jointId, lat: node.coord[0], lon: node.coord[1], parentId, branchCount: 1 });
        run = [node.coord, only.coord];
        runFibers = only.fibersBelow;
        startFromId = jointId;
        node = only;
        continue;
      }
      run.push(only.coord);
      node = only;
      continue;
    }
    // Branch: emit current run, create a joint, then recurse into each child.
    const type = pickCableType(Math.max(2, runFibers));
    const jointId = nextJointId();
    emitCable({
      id: nextCableId(),
      type,
      fibers: CABLE_FIBERS[type],
      fromId: startFromId,
      toId: jointId,
      coords: run,
      lengthM: pathLength(run),
      routedByOSRM: true,
    });
    emitJoint({
      id: jointId,
      lat: node.coord[0], lon: node.coord[1],
      parentId,
      branchCount: node.children.size,
    });
    for (const child of node.children.values()) {
      emit(parentId, node.coord, child, jointId, emitCable, emitJoint, nextJointId, nextCableId);
    }
    return;
  }
}

/**
 * Объединяет параллельные кабели, идущие из одной родительской точки по общему
 * маршруту, в единую магистраль большей жильности. В точках расхождения
 * автоматически создаются in-line муфты.
 *
 * Дроп-кабели ОРК→абонент не консолидируются (они идут к разным домам по
 * коротким индивидуальным трассам, объединять их физически нельзя).
 */
export function consolidateCables(cables: Cable[]): { cables: Cable[]; joints: InlineJoint[] } {
  // Дроп-кабели идут отдельно — их не трогаем.
  const isDrop = (c: Cable) =>
    c.type === 'ОК-4' && /^Бокс-/.test(c.fromId);
  const drops = cables.filter(isDrop);
  const trunks = cables.filter((c) => !isDrop(c));

  // Группируем по родительской точке (fromId).
  const byParent = new Map<string, Cable[]>();
  for (const c of trunks) {
    if (!byParent.has(c.fromId)) byParent.set(c.fromId, []);
    byParent.get(c.fromId)!.push(c);
  }

  const out: Cable[] = [];
  const joints: InlineJoint[] = [];
  let jointCounter = 0;
  let cableCounter = 0;
  const nextJointId = () => `J-${++jointCounter}`;
  const nextCableId = () => `cable-c-${++cableCounter}`;

  for (const [parentId, group] of byParent.entries()) {
    if (group.length === 0) continue;

    if (group.length === 1) {
      // Один кабель — оставляем как есть.
      out.push(group[0]);
      continue;
    }

    // Все кабели в группе начинаются в parentId с одной координаты.
    const parentCoord = group[0].coords[0];
    const root: Node = newNode(parentCoord);
    for (const c of group) {
      // Fiber demand at the terminal: достаточно 2 волокон (1 рабочее + резерв)
      // для одного логического линка; для уже жирных кабелей берём фактическую
      // жильность, потому что они могут нести несколько каналов.
      const fibersNeeded = Math.max(2, Math.min(c.fibers, 4));
      insertPath(root, c, fibersNeeded);
    }
    computeFibers(root);

    // Walk root's children — root coord == parent location, no cable yet.
    for (const child of root.children.values()) {
      emit(parentId, parentCoord, child, parentId, (cc) => out.push(cc), (jj) => joints.push(jj), nextJointId, nextCableId);
    }
  }

  // Append drops untouched.
  out.push(...drops);
  return { cables: out, joints };
}
