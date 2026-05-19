import { describe, it, expect } from 'vitest';
import { buildNetwork } from './AutoBuild';
import { validateNetwork } from './MaterialCalc';
import { DEFAULT_SETTINGS } from '@/types/network';
import { clusterForOrkGroups } from './KMeans';

describe('ORK max 8 subscribers', () => {
  it('clusterForOrkGroups never exceeds maxPerOrk', () => {
    const pts = Array.from({ length: 45 }, (_, i) => ({
      lat: 43.3 + (i % 9) * 0.002,
      lon: 68.3 + Math.floor(i / 9) * 0.003,
      id: `s-${i}`,
    }));
    const groups = clusterForOrkGroups(pts, 8, 8);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.length).toBeLessThanOrEqual(8);
    }
  });

  it('buildNetwork has no ORK overload warnings for Turkestan-scale mock', () => {
    const subs = Array.from({ length: 120 }, (_, i) => ({
      id: `sub-${i}`,
      lat: 43.25 + (i % 12) * 0.008,
      lon: 68.2 + Math.floor(i / 12) * 0.01,
      address: '',
      district: 'Sheet1',
      cameraType: 'outdoor' as const,
      speedMbps: 10,
    }));
    const { districts, cables } = buildNetwork(subs, DEFAULT_SETTINGS, {});
    const issues = validateNetwork(districts, cables);
    const overload = issues.filter((x) => x.message.includes('загрузка') && x.message.includes('>100%'));
    expect(overload).toHaveLength(0);
  });
});
