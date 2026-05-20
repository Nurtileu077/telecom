import { describe, it, expect } from 'vitest';
import { buildNetwork } from './AutoBuild';
import { DEFAULT_SETTINGS } from '@/types/network';

describe('ORK chain cable sizing (subscriber → ORK)', () => {
  it('first hop ORK→box is ОК-4, last hop grows with chain length', () => {
    const subs = Array.from({ length: 8 }, (_, i) => ({
      id: `sub-${i}`,
      lat: 43.25 + i * 0.0005,
      lon: 68.2 + i * 0.0003,
      address: '',
      district: 'T',
      cameraType: 'outdoor' as const,
      speedMbps: 10,
    }));
    const settings = {
      ...DEFAULT_SETTINGS,
      subsPerOrksp: 8,
      orkspPerPort: 8,
      oltsCount: 1,
    };
    const { districts, cables } = buildNetwork(subs, settings, {});
    const ork = districts[0]?.olt.transitBoxes[0]?.orks[0];
    expect(ork).toBeDefined();
    expect(ork!.cableType).toBe('ОК-4');
    expect(ork!.boxType).toBe('Бокс-8');

    const orkCables = cables.filter((c) => c.fromId === ork!.id || c.toId === ork!.id);
    const orkToBox = orkCables.find((c) => c.fromId === ork!.id && c.toId.startsWith('BOX-'));
    expect(orkToBox?.type).toBe('ОК-4');

    const tbToOrk = cables.find((c) => c.fromId.startsWith('Муфта-') && c.toId === ork!.id);
    expect(tbToOrk?.type).toBe('ОК-4');

    const oltToTb = cables.find((c) => c.fromId.startsWith('OLT-') && c.toId.startsWith('Муфта-'));
    expect(oltToTb?.type).toBe('ОК-16');
  });
});
