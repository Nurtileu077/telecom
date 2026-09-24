import { describe, it, expect } from 'vitest';
import {
  shrinkPlan, savedText, shrinkPhoto, MAX_SIDE, SKIP_BELOW_BYTES, QUALITY,
} from './photoShrink';

const BIG = 5_000_000;

describe('shrinkPlan', () => {
  it('снимок с телефона ужимается до стороны для акта', () => {
    const p = shrinkPlan(4032, 3024, BIG);
    expect(p.shrink).toBe(true);
    expect(Math.max(p.width, p.height)).toBe(MAX_SIDE);
  });

  it('пропорции сохраняются — иначе на снимке всё вытянется', () => {
    const p = shrinkPlan(4032, 3024, BIG);
    expect(p.width / p.height).toBeCloseTo(4032 / 3024, 2);
  });

  it('вертикальный снимок ужимается по своей длинной стороне', () => {
    const p = shrinkPlan(3024, 4032, BIG);
    expect(p.height).toBe(MAX_SIDE);
    expect(p.width).toBeLessThan(p.height);
  });

  it('некрупный снимок не трогаем', () => {
    const p = shrinkPlan(1200, 900, BIG);
    expect(p.shrink).toBe(false);
    expect(p.why).toContain('некрупный');
  });

  it('лёгкий снимок не трогаем, даже если он большой', () => {
    // Скриншот схемы: сторона крупная, весит мало, пережатие только портит.
    const p = shrinkPlan(3000, 2000, SKIP_BELOW_BYTES - 1);
    expect(p.shrink).toBe(false);
    expect(p.why).toContain('небольшой');
  });

  it('панорама не схлопывается в ноль', () => {
    const p = shrinkPlan(12000, 900, BIG);
    expect(p.width).toBe(MAX_SIDE);
    expect(p.height).toBeGreaterThanOrEqual(1);
  });

  it('неизвестный размер — не трогаем и говорим почему', () => {
    for (const [w, h] of [[0, 100], [NaN, 100], [100, -5]]) {
      const p = shrinkPlan(w, h, BIG);
      expect(p.shrink).toBe(false);
      expect(p.why).toContain('неизвестен');
    }
  });

  it('сторону можно задать: для схемы она другая', () => {
    expect(Math.max(...Object.values(shrinkPlan(4000, 3000, BIG, 800))
      .filter((v): v is number => typeof v === 'number'))).toBe(800);
  });

  it('качество выбрано так, чтобы разницы не было видно', () => {
    expect(QUALITY).toBeGreaterThan(0.75);
    expect(QUALITY).toBeLessThan(0.95);
  });
});

describe('savedText', () => {
  it('говорит, сколько выиграли', () => {
    expect(savedText(5_000_000, 500_000)).toBe('90% меньше');
  });

  it('когда не выиграли — так и говорит', () => {
    expect(savedText(1000, 1000)).toBe('без изменений');
    expect(savedText(1000, 2000)).toBe('без изменений');
    expect(savedText(0, 500)).toBe('без изменений');
  });
});

describe('shrinkPhoto вне браузера', () => {
  it('возвращает оригинал, а не ошибку: снимок важнее мегабайтов', async () => {
    const file = new Blob([new Uint8Array(BIG)], { type: 'image/jpeg' });
    const r = await shrinkPhoto(file);
    expect(r.blob).toBe(file);
    expect(r.shrunk).toBe(false);
    expect(r.before).toBe(r.after);
    expect(r.why).toContain('браузере');
  });
});
