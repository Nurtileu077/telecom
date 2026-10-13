import { describe, it, expect } from 'vitest';
import {
  fixQuality, formatAccuracy, zoomForAccuracy, fixLabel, fixStyle,
  MAX_ZOOM, MIN_ZOOM, UNKNOWN_ZOOM,
} from './gpsFix';

/** Метры в пикселе — та же формула, что у линейки. */
const mpp = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

describe('fixQuality', () => {
  it('спутники под открытым небом — хорошая точка', () => {
    expect(fixQuality(6)).toBe('good');
    expect(fixQuality(15)).toBe('good');
  });

  it('±800 м по вышке — плохая, а не «хорошая без круга»', () => {
    expect(fixQuality(800)).toBe('poor');
    expect(fixQuality(250)).toBe('poor');
  });

  it('ноль погрешности не принимает за идеальную точку', () => {
    expect(fixQuality(0)).toBe('unknown');
    expect(fixQuality(undefined)).toBe('unknown');
    expect(fixQuality(NaN)).toBe('unknown');
  });
});

describe('zoomForAccuracy', () => {
  it('при ±800 м не летит на 18-й зум', () => {
    expect(zoomForAccuracy(800, 51.2, 400)).toBeLessThan(15);
  });

  it('круг ±800 м целиком помещается в экран', () => {
    const z = zoomForAccuracy(800, 51.2, 400);
    const diameterPx = 1600 / mpp(51.2, z);
    expect(diameterPx).toBeLessThanOrEqual(400);
  });

  it('точную точку приближает до 18-го, но не дальше', () => {
    expect(zoomForAccuracy(4, 43.2, 800)).toBe(MAX_ZOOM);
  });

  it('чем хуже сигнал, тем мельче карта', () => {
    const z = [10, 60, 300, 1500].map((a) => zoomForAccuracy(a, 50, 600));
    for (let i = 1; i < z.length; i++) expect(z[i]).toBeLessThanOrEqual(z[i - 1]);
  });

  it('погрешность в сотни километров не уводит карту за пределы страны', () => {
    expect(zoomForAccuracy(900_000, 48, 600)).toBe(MIN_ZOOM);
  });

  it('без погрешности не делает вид, что точка точная', () => {
    expect(zoomForAccuracy(undefined, 48, 600)).toBe(UNKNOWN_ZOOM);
    expect(UNKNOWN_ZOOM).toBeLessThan(MAX_ZOOM);
  });
});

describe('fixLabel', () => {
  it('при хорошем сигнале — коротко и с погрешностью', () => {
    expect(fixLabel(7)).toEqual({ short: 'Вы здесь · ±7 м', note: '' });
  });

  it('при ±800 м говорит, что середина круга — не ваше место', () => {
    const l = fixLabel(800);
    expect(l.short).toBe('Вы где-то в круге ±800 м');
    expect(l.note).toContain('не ваше место');
  });

  it('погрешность больше километра пишет в километрах с запятой', () => {
    expect(formatAccuracy(1530)).toBe('±1,5 км');
    expect(formatAccuracy(2000)).toBe('±2 км');
  });

  it('неизвестную точность так и называет', () => {
    expect(fixLabel(undefined).short).toContain('точность неизвестна');
  });
});

describe('fixStyle', () => {
  it('плохой точке не рисует уверенную сплошную точку', () => {
    expect(fixStyle('poor').solidDot).toBe(false);
    expect(fixStyle('good').solidDot).toBe(true);
  });
});
