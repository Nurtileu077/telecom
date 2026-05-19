import { describe, it, expect } from 'vitest';
import { offsetPolylineToSide, pickSnapOnRoadSide } from './roadSideOffset';

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

  it('pickSnapOnRoadSide prefers candidate on chosen side', () => {
    const origin = { lat: 43.2, lon: 68.25 };
    const toward = { lat: 43.21, lon: 68.25 };
    const leftCand: [number, number] = [43.2001, 68.2499];
    const rightCand: [number, number] = [43.2001, 68.2501];
    const picked = pickSnapOnRoadSide(
      origin,
      [rightCand, leftCand],
      toward,
      'left',
    );
    expect(picked).toEqual(leftCand);
  });
});
