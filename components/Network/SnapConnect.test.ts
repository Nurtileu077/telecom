import { describe, it, expect } from 'vitest';
import type { Cable } from '@/types/network';
import { splitCableAt, findCablesNearPoint } from './SnapConnect';

describe('SnapConnect', () => {
  const cable: Cable = {
    id: 'c1',
    type: 'ОК-12',
    fibers: 12,
    fromId: 'OLT-1',
    toId: 'ORK-1',
    coords: [[40, 68], [40.01, 68], [40.02, 68.01]],
    lengthM: 1000,
    routedByOSRM: false,
  };

  it('finds cable near polyline', () => {
    const hits = findCablesNearPoint(40.005, 68, [cable], 50);
    expect(hits.length).toBe(1);
    expect(hits[0].cableId).toBe('c1');
  });

  it('splits cable through TB id', () => {
    const hit = findCablesNearPoint(40.005, 68, [cable], 50)[0];
    const { removedId, added } = splitCableAt(cable, hit, 'TB-NEW');
    expect(removedId).toBe('c1');
    expect(added.length).toBe(2);
    expect(added[0].toId).toBe('TB-NEW');
    expect(added[1].fromId).toBe('TB-NEW');
    expect(added[0].coords.length).toBeGreaterThan(1);
    expect(added[1].coords.length).toBeGreaterThan(1);
  });
});
