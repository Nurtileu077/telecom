import { describe, it, expect } from 'vitest';
import { mergeCorridorSegments, segmentSharesCorridor } from './mergeCorridorSegments';
import { pickSegmentCableType } from './SergekTopology';

describe('mergeCorridorSegments', () => {
  it('merges parallel segment keys and unions subscribers', () => {
    const segments = new Map([
      ['a|b', {
        key: 'a|b',
        fromKey: 'a',
        toKey: 'b',
        coords: [[43.2, 68.25], [43.201, 68.251]] as [[number, number], [number, number]],
        subs: new Set(['s1']),
        lengthM: 100,
      }],
      ['c|d', {
        key: 'c|d',
        fromKey: 'c',
        toKey: 'd',
        coords: [[43.20001, 68.25002], [43.20101, 68.25102]] as [[number, number], [number, number]],
        subs: new Set(['s2']),
        lengthM: 105,
      }],
    ]);
    expect(
      segmentSharesCorridor(
        [43.2, 68.25],
        [43.201, 68.251],
        segments.get('c|d')!,
        15,
      ),
    ).toBe(true);
    const { segments: merged, keyRemap } = mergeCorridorSegments(segments, 15);
    expect(merged.size).toBe(1);
    expect([...merged.values()][0].subs.size).toBe(2);
    expect(keyRemap.get('c|d')).toBe(keyRemap.get('a|b'));
  });
});

describe('pickSegmentCableType hop ladder', () => {
  const roles = new Map<string, 'ork' | 'box' | 'olt' | 'tb'>([
    ['ORK-1', 'ork'],
    ['BOX-1', 'box'],
    ['BOX-2', 'box'],
  ]);

  it('uses hop index on box chain, not total subs on trunk', () => {
    expect(pickSegmentCableType(5, 'ORK-1', 'BOX-1', roles, undefined, 0)).toBe('ОК-4');
    expect(pickSegmentCableType(5, 'BOX-1', 'BOX-2', roles, undefined, 1)).toBe('ОК-4');
    expect(pickSegmentCableType(5, 'BOX-1', 'BOX-2', roles, undefined, 2)).toBe('ОК-8');
  });
});
