import { describe, it, expect } from 'vitest';
import {
  pickSergekSharedCableType,
  pickOrkChainCableType,
  CABLE_OLT_FEEDER,
  CABLE_L1_BRANCH,
  CABLE_ORK_DISTRIBUTION,
} from './SergekTopology';

describe('SergekTopology cable sizing', () => {
  it('uses ОК-16 for port feeder and ORK groups, not ОК-48', () => {
    expect(pickSergekSharedCableType(64)).toBe('ОК-16');
    expect(pickSergekSharedCableType(8)).toBe('ОК-16');
    expect(pickSergekSharedCableType(1)).toBe('ОК-4');
  });

  it('defines fixed segment types', () => {
    expect(CABLE_OLT_FEEDER).toBe('ОК-16');
    expect(CABLE_L1_BRANCH).toBe('ОК-4');
    expect(CABLE_ORK_DISTRIBUTION).toBe('ОК-16');
  });

  it('chain hop drops to ОК-4 on last camera', () => {
    expect(pickOrkChainCableType(3)).toBe('ОК-16');
    expect(pickOrkChainCableType(1)).toBe('ОК-4');
  });
});
