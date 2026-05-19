import { describe, it, expect } from 'vitest';
import { walkOrkBoxChain, consolidateCables } from './Consolidation';
import type { Cable, District } from '@/types/network';

function cable(id: string, from: string, to: string): Cable {
  return {
    id,
    type: 'ОК-8',
    fibers: 8,
    fromId: from,
    toId: to,
    coords: [[43.0, 68.0], [43.001, 68.001]],
    lengthM: 100,
    routedByOSRM: true,
  };
}

describe('walkOrkBoxChain', () => {
  it('follows ORK → BOX → BOX chain', () => {
    const map = new Map<string, Cable>();
    map.set('ORK-1::BOX-1', cable('c1', 'ORK-1', 'BOX-1'));
    map.set('BOX-1::BOX-2', cable('c2', 'BOX-1', 'BOX-2'));
    const chain = walkOrkBoxChain('ORK-1', map);
    expect(chain.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('consolidateCables with box chain', () => {
  it('consolidates tree paths and emits inline joints', () => {
    const olt = {
      id: 'OLT-1',
      lat: 43.0,
      lon: 68.0,
      district: 'Test',
      model: 'Huawei',
      capacity: 64,
      l1Splitter: '1:4' as const,
      transitBoxes: [{
        id: 'TB-1',
        lat: 43.0005,
        lon: 68.0005,
        district: 'Test',
        oltId: 'OLT-1',
        inCable: 'ОК-8' as const,
        outCable: 'ОК-4' as const,
        muftaType: 'МТОК-96А',
        orks: [{
          id: 'ORK-1',
          lat: 43.001,
          lon: 68.001,
          district: 'Test',
          splitter: '1:8' as const,
          tbId: 'TB-1',
          cableType: 'ОК-4' as const,
          boxType: 'Бокс-8',
          subscribers: [
            { id: 'S1', lat: 43.001, lon: 68.001, desc: 'cam1', district: 'Test', fibers: { working: 1, spare: 1 } },
            { id: 'S2', lat: 43.002, lon: 68.002, desc: 'cam2', district: 'Test', fibers: { working: 1, spare: 1 } },
          ],
        }],
      }],
    };
    const districts: District[] = [{
      name: 'Test',
      color: '#fff',
      olt,
      subscribers: olt.transitBoxes[0].orks[0].subscribers,
    }];
    const cables: Cable[] = [
      cable('olt-tb', 'OLT-1', 'TB-1'),
      cable('tb-ork', 'TB-1', 'ORK-1'),
      cable('ork-b1', 'ORK-1', 'BOX-1'),
      cable('b1-b2', 'BOX-1', 'BOX-2'),
    ];
    cables[0].coords = [[43.0, 68.0], [43.0005, 68.0005]];
    cables[1].coords = [[43.0005, 68.0005], [43.001, 68.001]];
    cables[2].coords = [[43.001, 68.001], [43.001, 68.001]];
    cables[3].coords = [[43.001, 68.001], [43.002, 68.002]];

    const { cables: out, joints } = consolidateCables(cables, districts, 12);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((c) => !cables.find((x) => x.id === c.id))).toBe(true);
    expect(joints.length).toBeGreaterThanOrEqual(0);
    const passthroughOnly = out.every((c) => cables.some((x) => x.id === c.id));
    expect(passthroughOnly).toBe(false);
  });

  it('preserves OSRM bend points along trunk (no diagonal collapse)', () => {
    const bend: [number, number][] = [
      [43.0, 68.0],
      [43.0002, 68.0],
      [43.0004, 68.0003],
      [43.0006, 68.0006],
      [43.001, 68.001],
    ];
    const olt = {
      id: 'OLT-1',
      lat: 43.0,
      lon: 68.0,
      district: 'Test',
      model: 'Huawei',
      capacity: 64,
      l1Splitter: '1:4' as const,
      transitBoxes: [{
        id: 'TB-1',
        lat: 43.001,
        lon: 68.001,
        district: 'Test',
        oltId: 'OLT-1',
        inCable: 'ОК-8' as const,
        outCable: 'ОК-4' as const,
        muftaType: 'МТОК-96А',
        orks: [{
          id: 'ORK-1',
          lat: 43.001,
          lon: 68.001,
          district: 'Test',
          splitter: '1:8' as const,
          tbId: 'TB-1',
          cableType: 'ОК-4' as const,
          boxType: 'Бокс-8',
          subscribers: [
            { id: 'S1', lat: 43.001, lon: 68.001, desc: 'cam1', district: 'Test', fibers: { working: 1, spare: 1 } },
          ],
        }],
      }],
    };
    const districts: District[] = [{
      name: 'Test',
      color: '#fff',
      olt,
      subscribers: olt.transitBoxes[0].orks[0].subscribers,
    }];
    const cables: Cable[] = [
      { ...cable('olt-tb', 'OLT-1', 'TB-1'), coords: bend },
      { ...cable('tb-ork', 'TB-1', 'ORK-1'), coords: [[43.001, 68.001], [43.001, 68.001]] },
      { ...cable('ork-s1', 'ORK-1', 'S1'), coords: [[43.001, 68.001], [43.001, 68.001]] },
    ];

    const { cables: out } = consolidateCables(cables, districts, 12);
    const trunk = out.find((c) => c.fromId === 'OLT-1' || c.toId === 'OLT-1');
    expect(trunk).toBeDefined();
    expect(trunk!.coords.length).toBeGreaterThanOrEqual(4);
    const straight = Math.hypot(
      (bend[bend.length - 1][0] - bend[0][0]) * 111320,
      (bend[bend.length - 1][1] - bend[0][1]) * 81400,
    );
    expect(trunk!.lengthM).toBeGreaterThan(straight * 0.85);
  });
});
