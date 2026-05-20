import { describe, it, expect } from 'vitest';
import {
  pickSergekSharedCableType,
  pickOrkChainCableType,
  pickOrkChainHopCableType,
  pickCableForDownstreamCount,
  pickOltToMuftaCableType,
  inferL1SplitterForOrkCount,
  CABLE_L1_BRANCH,
  CABLE_ORK_LABEL,
  SERGEK_L2_ORK_SPIDER,
} from './SergekTopology';

describe('SergekTopology cable sizing', () => {
  it('ladder by cameras on subscriber side', () => {
    expect(pickCableForDownstreamCount(1)).toBe('ОК-4');
    expect(pickCableForDownstreamCount(2)).toBe('ОК-4');
    expect(pickCableForDownstreamCount(3)).toBe('ОК-8');
    expect(pickCableForDownstreamCount(8)).toBe('ОК-16');
  });

  it('OLT→муфта by ORK branch count (1 fiber per ORK)', () => {
    expect(pickOltToMuftaCableType(1)).toBe('ОК-4');
    expect(pickOltToMuftaCableType(4)).toBe('ОК-4');
    expect(pickOltToMuftaCableType(5)).toBe('ОК-8');
    expect(pickOltToMuftaCableType(8)).toBe('ОК-8');
  });

  it('infers L1 splitter from ORK count', () => {
    expect(inferL1SplitterForOrkCount(3)).toBe('1:4');
    expect(inferL1SplitterForOrkCount(8)).toBe('1:8');
    expect(inferL1SplitterForOrkCount(12)).toBe('1:16');
  });

  it('fixed segment types', () => {
    expect(CABLE_L1_BRANCH).toBe('ОК-4');
    expect(CABLE_ORK_LABEL).toBe('ОК-4');
    expect(SERGEK_L2_ORK_SPIDER).toBe('1:16');
  });

  it('chain hop grows from subscriber toward ORK', () => {
    expect(pickOrkChainHopCableType(0)).toBe('ОК-4');
    expect(pickOrkChainHopCableType(7)).toBe('ОК-16');
    expect(pickOrkChainCableType(8)).toBe('ОК-16');
  });
});
