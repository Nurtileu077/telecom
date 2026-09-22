import { describe, it, expect } from 'vitest';
import { parseMeters, metersToField, metersHint } from './units';

describe('parseMeters', () => {
  it('голое число — это метры', () => {
    expect(parseMeters('480')).toEqual({ meters: 480, unit: 'м', ok: true });
  });

  it('километры не превращаются в метры молча', () => {
    expect(parseMeters('1,2 км').meters).toBe(1200);
    expect(parseMeters('1.2км').meters).toBe(1200);
    expect(parseMeters('1,2 км').unit).toBe('км');
  });

  it('разделитель тысяч — это одно число, а не два', () => {
    expect(parseMeters('1 200').meters).toBe(1200);
    expect(parseMeters('1 200 м').meters).toBe(1200);
    // Неразрывный пробел из toLocaleString тоже.
    expect(parseMeters('1 200').meters).toBe(1200);
  });

  it('понимает и «пог.м», и «метров»', () => {
    expect(parseMeters('480 метров').meters).toBe(480);
    expect(parseMeters('480 пог.м').meters).toBe(480);
  });

  it('чужая единица — не метры', () => {
    expect(parseMeters('12 шт').ok).toBe(false);
    expect(parseMeters('12 шт').meters).toBe(0);
  });

  it('мусор разбирать нечего', () => {
    expect(parseMeters('').ok).toBe(false);
    expect(parseMeters('много').ok).toBe(false);
    expect(parseMeters(undefined).ok).toBe(false);
  });

  it('число приходит и числом', () => {
    expect(parseMeters(480)).toEqual({ meters: 480, unit: 'м', ok: true });
    expect(parseMeters(NaN).ok).toBe(false);
  });
});

describe('metersToField', () => {
  it('целое пишем целым', () => {
    expect(metersToField(480)).toBe('480');
  });

  it('дробное — с запятой, как по-русски', () => {
    expect(metersToField(480.5)).toBe('480,5');
  });

  it('нечего показывать — пустое поле, а не ноль', () => {
    expect(metersToField(0)).toBe('');
    expect(metersToField(undefined)).toBe('');
  });
});

describe('metersHint', () => {
  it('километры подсказываем, когда они есть', () => {
    expect(metersHint(1240)).toBe('1,24 км');
  });

  it('под «480 м» писать «0,48 км» незачем', () => {
    expect(metersHint(480)).toBeNull();
    expect(metersHint(0)).toBeNull();
  });
});
