import { describe, it, expect } from 'vitest';
import { cableNeed, drumsFor, slackSummary, DEFAULT_SLACK } from './cableSlack';

describe('cableNeed', () => {
  it('кабеля всегда больше, чем трассы', () => {
    const r = cableNeed({ routeM: 1000 });
    expect(r.totalM).toBeGreaterThan(1000);
    expect(r.slackM).toBe(20);
  });

  it('каждая муфта, заводка и прокол — свой кусок', () => {
    const r = cableNeed({ routeM: 1000, joints: 2, entries: 1, drills: 3 });
    expect(r.jointM).toBe(20);
    expect(r.entryM).toBe(15);
    expect(r.drillM).toBe(15);
    expect(r.totalM).toBe(1000 + 20 + 20 + 15 + 15);
  });

  it('слагаемые в сумме дают итог — спорить можно с каждым', () => {
    const r = cableNeed({ routeM: 4370, joints: 5, entries: 2, drills: 7 });
    expect(r.routeM + r.slackM + r.jointM + r.entryM + r.drillM).toBeCloseTo(r.totalM, 6);
  });

  it('свои нормы важнее умолчаний', () => {
    const r = cableNeed({ routeM: 1000, joints: 1 },
      { ...DEFAULT_SLACK, slackPct: 5, perJointM: 30 });
    expect(r.slackM).toBe(50);
    expect(r.jointM).toBe(30);
  });

  it('нулевая трасса — нулевой кабель, а не деление на ноль', () => {
    const r = cableNeed({ routeM: 0 });
    expect(r.totalM).toBe(0);
    expect(r.ratio).toBe(0);
  });

  it('отрицательные числа не превращаются в скидку', () => {
    const r = cableNeed({ routeM: -100, joints: -3 });
    expect(r.totalM).toBe(0);
  });
});

describe('drumsFor', () => {
  it('на 4 300 м при барабане 2 000 нужно три', () => {
    const p = drumsFor(4300, 2000);
    expect(p.drums).toBe(3);
    expect(p.leftoverM).toBe(1700);
    expect(p.usableLeftover).toBe(true);
  });

  it('ровно на барабан — без остатка', () => {
    const p = drumsFor(4000, 2000);
    expect(p.drums).toBe(2);
    expect(p.leftoverM).toBe(0);
    expect(p.usableLeftover).toBe(false);
  });

  it('короткий хвост честно называется бесполезным', () => {
    const p = drumsFor(1950, 2000);
    expect(p.leftoverM).toBe(50);
    expect(p.usableLeftover).toBe(false);
  });

  it('барабана нет — считать нечего', () => {
    expect(drumsFor(1000, 0).drums).toBe(0);
    expect(drumsFor(0, 2000).drums).toBe(0);
  });
});

describe('slackSummary', () => {
  it('говорит и откуда взялось', () => {
    const s = slackSummary(cableNeed({ routeM: 1240, joints: 2 }));
    // toLocaleString('ru') разделяет тысячи неразрывным пробелом.
    expect(s).toContain('1\u00a0240 м трассы');
    expect(s).toContain('кабеля');
    expect(s).toContain('муфты');
  });

  it('без запасов — без скобок', () => {
    expect(slackSummary(cableNeed({ routeM: 0 }))).toBe('0 м трассы → 0 м кабеля');
  });
});
