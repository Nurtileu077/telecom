import {
  Cable, CABLE_FIBERS, District, OntBox,
} from '@/types/network';
import {
  CABLE_L1_BRANCH,
  CABLE_OLT_FEEDER,
  CABLE_ORK_DISTRIBUTION,
  pickOrkChainCableType,
} from './SergekTopology';
import { haversineM } from './KMeans';

function pathLen(coords: [number, number][]): number {
  let l = 0;
  for (let i = 1; i < coords.length; i++) {
    l += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return l;
}

let seq = 0;
function nextId() { return `cable-r-${++seq}`; }

/** Восстановить логические кабели дерева (OLT→муфта→ОРКСП→BOX*) из districts + ontBoxes. */
export function rebuildCablesFromDistricts(
  districts: District[],
  ontBoxes: OntBox[],
  existingCoords?: Map<string, [number, number][]>,
): Cable[] {
  seq = 0;
  const out: Cable[] = [];

  const pickCoords = (fromId: string, toId: string, fallback: [number, number][]) => {
    const k = `${fromId}::${toId}`;
    const rev = `${toId}::${fromId}`;
    return existingCoords?.get(k) ?? existingCoords?.get(rev) ?? fallback;
  };

  for (const d of districts) {
    const olt = d.olt;
    for (const tb of olt.transitBoxes) {
      const c1 = pickCoords(olt.id, tb.id, [[olt.lat, olt.lon], [tb.lat, tb.lon]]);
      out.push({
        id: nextId(),
        type: tb.inCable || CABLE_OLT_FEEDER,
        fibers: CABLE_FIBERS[tb.inCable || CABLE_OLT_FEEDER],
        fromId: olt.id,
        toId: tb.id,
        coords: c1,
        lengthM: pathLen(c1),
        routedByOSRM: existingCoords?.has(`${olt.id}::${tb.id}`) ?? false,
      });

      for (const ork of tb.orks) {
        const c2 = pickCoords(tb.id, ork.id, [[tb.lat, tb.lon], [ork.lat, ork.lon]]);
        out.push({
          id: nextId(),
          type: CABLE_L1_BRANCH,
          fibers: CABLE_FIBERS[CABLE_L1_BRANCH],
          fromId: tb.id,
          toId: ork.id,
          coords: c2,
          lengthM: pathLen(c2),
          routedByOSRM: existingCoords?.has(`${tb.id}::${ork.id}`) ?? false,
        });

        const orderedBoxes: OntBox[] = [];
        for (const sub of ork.subscribers) {
          const box = ontBoxes.find(
            (b) => b.subscriberId === sub.id && b.orkspId === ork.id,
          );
          if (box) orderedBoxes.push(box);
        }

        for (let i = 0; i < orderedBoxes.length; i++) {
          const box = orderedBoxes[i];
          const sub = ork.subscribers[i];
          const remaining = orderedBoxes.length - i;
          const hopType = pickOrkChainCableType(remaining);

          if (i === 0) {
            const c3 = pickCoords(ork.id, box.id, [[ork.lat, ork.lon], [box.lat, box.lon]]);
            out.push({
              id: nextId(),
              type: CABLE_ORK_DISTRIBUTION,
              fibers: CABLE_FIBERS[CABLE_ORK_DISTRIBUTION],
              fromId: ork.id,
              toId: box.id,
              coords: c3,
              lengthM: pathLen(c3),
              routedByOSRM: existingCoords?.has(`${ork.id}::${box.id}`) ?? false,
            });
          } else {
            const prev = orderedBoxes[i - 1];
            const c4 = pickCoords(prev.id, box.id, [[prev.lat, prev.lon], [box.lat, box.lon]]);
            out.push({
              id: nextId(),
              type: hopType,
              fibers: CABLE_FIBERS[hopType],
              fromId: prev.id,
              toId: box.id,
              coords: c4,
              lengthM: pathLen(c4),
              routedByOSRM: existingCoords?.has(`${prev.id}::${box.id}`) ?? false,
            });
          }
          void sub;
        }
      }
    }
  }

  return out;
}
