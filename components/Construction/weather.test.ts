import { describe, it, expect } from 'vitest';
import {
  weatherLabel, formatWeather, weatherHindered, weatherUrl, parseWeather,
} from './weather';

describe('weatherLabel', () => {
  it('говорит словами, которыми пишут в акте', () => {
    expect(weatherLabel(0)).toBe('ясно');
    expect(weatherLabel(3)).toBe('пасмурно');
    expect(weatherLabel(63)).toBe('дождь');
    expect(weatherLabel(73)).toBe('снег');
    expect(weatherLabel(95)).toBe('гроза');
  });

  it('кода нет — и писать нечего', () => {
    expect(weatherLabel(undefined)).toBe('');
  });
});

describe('formatWeather', () => {
  it('собирает строку для графы «погодные условия»', () => {
    expect(formatWeather({
      date: '2026-01-15', tMinC: -12, tMaxC: -4, precipMm: 3, code: 73, source: 'archive',
    })).toBe('−12…−4 °C, снег, осадки 3,0 мм');
  });

  it('сухой день без осадков не упоминает', () => {
    expect(formatWeather({
      date: '2026-07-25', tMinC: 14, tMaxC: 28, precipMm: 0, code: 0, source: 'archive',
    })).toBe('+14…+28 °C, ясно');
  });

  it('ноль градусов пишем без знака', () => {
    expect(formatWeather({ date: '2026-03-01', tMaxC: 0, code: 3, source: 'archive' }))
      .toBe('0 °C, пасмурно');
  });

  it('погоды нет — строки тоже', () => {
    expect(formatWeather(undefined)).toBe('');
  });
});

describe('weatherHindered', () => {
  it('ливень мешает', () => {
    expect(weatherHindered({ date: '', precipMm: 12, source: 'archive' })).toBe(true);
    expect(weatherHindered({ date: '', code: 82, source: 'archive' })).toBe(true);
  });

  it('мороз за двадцать мешает', () => {
    expect(weatherHindered({ date: '', tMaxC: -24, source: 'archive' })).toBe(true);
  });

  it('обычный день не мешает', () => {
    expect(weatherHindered({ date: '', tMaxC: 18, precipMm: 0.2, code: 1, source: 'archive' }))
      .toBe(false);
    expect(weatherHindered(undefined)).toBe(false);
  });
});

describe('weatherUrl', () => {
  it('спрашивает ровно один день и ровно те поля, что нужны', () => {
    const url = weatherUrl(53.0912, 69.1234, '2026-07-25');
    expect(url).toContain('latitude=53.0912');
    expect(url).toContain('longitude=69.1234');
    expect(url).toContain('start_date=2026-07-25');
    expect(url).toContain('end_date=2026-07-25');
    expect(url).toContain('precipitation_sum');
  });
});

describe('parseWeather', () => {
  const json = {
    daily: {
      time: ['2026-07-24', '2026-07-25'],
      temperature_2m_max: [26, 28],
      temperature_2m_min: [12, 14],
      precipitation_sum: [0, 3.4],
      weathercode: [1, 63],
    },
  };

  it('берёт тот день, о котором спрашивали', () => {
    const w = parseWeather(json, '2026-07-25');
    expect(w?.tMaxC).toBe(28);
    expect(w?.precipMm).toBe(3.4);
    expect(w?.code).toBe(63);
    expect(w?.source).toBe('archive');
  });

  it('пустой ответ — это не «ясно, ноль градусов»', () => {
    expect(parseWeather({ daily: { time: [] } }, '2026-07-25')).toBeNull();
    expect(parseWeather({}, '2026-07-25')).toBeNull();
    expect(parseWeather(null, '2026-07-25')).toBeNull();
  });

  it('пропуски в данных не превращаются в нули', () => {
    const w = parseWeather({
      daily: {
        time: ['2026-07-25'],
        temperature_2m_max: [null],
        temperature_2m_min: [null],
        precipitation_sum: [null],
        weathercode: [3],
      },
    }, '2026-07-25');
    expect(w?.tMaxC).toBeUndefined();
    expect(w?.code).toBe(3);
  });
});
