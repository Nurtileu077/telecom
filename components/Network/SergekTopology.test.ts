import { describe, it, expect } from 'vitest';
import {
  pickSergekSharedCableType,
  pickOrkChainCableType,
  pickOrkChainHopCableType,
  pickCableForDownstreamCount,
  CABLE_OLT_FEEDER,
  CABLE_L1_BRANCH,
  CABLE_ORK_LABEL,
} from './SergekTopology';

describe('SergekTopology cable sizing', () => {
  it('ladder by downstream cameras (subscriber → OLT)', () => {
    expect(pickCableForDownstreamCount(1)).toBe('ОК-4');
    expect(pickCableForDownstreamCount(2)).toBe('ОК-4');
    expect(pickCableForDownstreamCount(3)).toBe('ОК-8');
    expect(pickCableForDownstreamCount(4)).toBe('ОК-8');
    expect(pickCableForDownstreamCount(5)).toBe('ОК-12');
    expect(pickCableForDownstreamCount(6)).toBe('ОК-12');
    expect(pickCableForDownstreamCount(7)).toBe('ОК-16');
    expect(pickCableForDownstreamCount(8)).toBe('ОК-16');
    expect(pickCableForDownstreamCount(64)).toBe('ОК-16');
  });

  it('never exceeds ОК-16 (no ОК-48)', () => {
    expect(pickSergekSharedCableType(64)).toBe('ОК-16');
    expect(pickSergekSharedCableType(8)).toBe('ОК-16');
    expect(pickSergekSharedCableType(1)).toBe('ОК-4');
  });

  it('defines fixed segment types', () => {
    expect(CABLE_OLT_FEEDER).toBe('ОК-16');
    expect(CABLE_L1_BRANCH).toBe('ОК-4');
    expect(CABLE_ORK_LABEL).toBe('ОК-4');
  });

  it('chain hop grows from subscriber toward ORK (not full ORK count on first hop)', () => {
    expect(pickOrkChainHopCableType(0)).toBe('ОК-4');
    expect(pickOrkChainHopCableType(1)).toBe('ОК-4');
    expect(pickOrkChainHopCableType(2)).toBe('ОК-8');
    expect(pickOrkChainHopCableType(7)).toBe('ОК-16');
    expect(pickOrkChainCableType(8)).toBe('ОК-16');
  });
});
