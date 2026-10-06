import { describe, it, expect } from 'vitest';
import { localDay } from './localDay';

describe('сегодня по местному времени', () => {
  it('в половине первого ночи по Алматы — уже сегодня, а не вчера по UTC', () => {
    // 19:30 UTC 6 октября — это 00:30 7 октября в Алматы.
    const night = new Date('2026-10-06T19:30:00Z');
    expect(night.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(localDay(night)).toBe('2026-10-07');
  });

  it('днём совпадает с датой по UTC', () => {
    expect(localDay(new Date('2026-10-06T08:00:00Z'))).toBe('2026-10-06');
  });

  it('месяц и день — с ведущим нулём', () => {
    expect(localDay(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
});
