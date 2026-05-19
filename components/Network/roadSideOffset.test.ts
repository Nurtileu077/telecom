import { describe, it, expect } from 'vitest';
import {
  offsetPolylineToSide,
  pickSnapOnRoadSide,
  shouldReverseForRoadOffset,
  harmonizeCableIntersections,
  offsetCablePath,
} from './roadSideOffset';
import { Cable } from '@/types/network';

describe('roadSideOffset', () => {
  it('offsets polyline perpendicular to direction', () => {
    const line: [number, number][] = [
      [43.2, 68.25],
      [43.201, 68.25],
    ];
    const left = offsetPolylineToSide(line, 'left', 5);
    const right = offsetPolylineToSide(line, 'right', 5);
    expect(left[0][1]).not.toBeCloseTo(right[0][1], 5);
    expect(left).not.toEqual(line);
  });

  it('center leaves coords unchanged', () => {
    const line: [number, number][] = [[43.2, 68.25], [43.21, 68.26]];
    expect(offsetPolylineToSide(line, 'center', 5)).toEqual(line);
  });

  it('reverses OLT→sub cables for consistent right side', () => {
    expect(shouldReverseForRoadOffset('OLT-1', 'Муфта-1')).toBe(true);
    expect(shouldReverseForRoadOffset('BOX-1', 'ОРКСП-1')).toBe(false);
  });

  it('harmonizes nearby vertices from different cables', () => {
    const cables: Cable[] = [
      {
        id: 'a',
        type: 'ОК-8',
        fibers: 8,
        fromId: 'OLT-1',
        toId: 'Муфта-1',
        coords: [[43.2, 68.25], [43.201, 68.251]],
        lengthM: 100,
        routedByOSRM: true,
      },
      {
        id: 'b',
        type: 'ОК-8',
        fibers: 8,
        fromId: 'Муфта-1',
        toId: 'ОРКСП-1',
        coords: [[43.20001, 68.25001], [43.205, 68.255]],
        lengthM: 100,
        routedByOSRM: true,
      },
    ];
    const out = harmonizeCableIntersections(cables, 15);
    expect(out[0].coords[0][0]).toBeCloseTo(out[1].coords[0][0], 5);
    expect(out[0].coords[0][1]).toBeCloseTo(out[1].coords[0][1], 5);
  });

  it('offsetCablePath uses toward-OLT direction', () => {
    const line: [number, number][] = [
      [43.2, 68.25],
      [43.201, 68.25],
    ];
    const a = offsetCablePath(line, 'OLT-1', 'Муфта-1', 'right', 5);
    const b = offsetCablePath([...line].reverse(), 'Муфта-1', 'OLT-1', 'right', 5);
    expect(a[0][1]).toBeCloseTo(b[0][1], 4);
  });
});
