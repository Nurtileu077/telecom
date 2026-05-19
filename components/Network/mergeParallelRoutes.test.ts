import { describe, it, expect } from 'vitest';
import { Cable } from '@/types/network';
import { mergeParallelCableGeometry, polylinesShareCorridor } from './mergeParallelRoutes';

describe('mergeParallelRoutes', () => {
  it('detects parallel OSRM offsets on same street', () => {
    const a: [number, number][] = [
      [43.2, 68.25],
      [43.201, 68.251],
      [43.202, 68.252],
    ];
    const b: [number, number][] = [
      [43.20001, 68.25002],
      [43.20101, 68.25102],
      [43.20201, 68.25202],
    ];
    expect(polylinesShareCorridor(a, b, 15)).toBe(true);
  });

  it('aligns parallel cables to one geometry', () => {
    const ref: [number, number][] = [
      [43.2, 68.25],
      [43.205, 68.255],
    ];
    const cables: Cable[] = [
      {
        id: 'c1',
        type: 'ОК-4',
        fibers: 4,
        fromId: 'a',
        toId: 'b',
        coords: ref,
        lengthM: 500,
        routedByOSRM: true,
      },
      {
        id: 'c2',
        type: 'ОК-4',
        fibers: 4,
        fromId: 'c',
        toId: 'd',
        coords: ref.map(([lat, lon]) => [lat + 0.00003, lon + 0.00003] as [number, number]),
        lengthM: 400,
        routedByOSRM: true,
      },
    ];
    const out = mergeParallelCableGeometry(cables, 15);
    expect(out).toHaveLength(2);
    expect(out[0].coords).toEqual(out[1].coords);
  });
});
