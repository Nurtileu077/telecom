import { describe, it, expect } from 'vitest';
import {
  parseLatLon, formatLatLon, formatOne, COORD_STYLES, COORD_STYLE_LABEL,
} from './coordFormat';

describe('parseLatLon', () => {
  it('десятичные через запятую и пробел', () => {
    expect(parseLatLon('52.091435, 69.123456')).toEqual({ lat: 52.091435, lon: 69.123456 });
  });

  it('десятичные с запятой вместо точки — как в русском Excel', () => {
    const p = parseLatLon('52,091435 69,123456');
    expect(p!.lat).toBeCloseTo(52.091435, 6);
    expect(p!.lon).toBeCloseTo(69.123456, 6);
  });

  it('перевёрнутую пару ставит на место по границам Казахстана', () => {
    // 69 широтой быть не может — это север Норвегии, а не Акмолинская.
    const p = parseLatLon('69.123456, 52.091435');
    expect(p!.lat).toBeCloseTo(52.091435, 6);
    expect(p!.lon).toBeCloseTo(69.123456, 6);
  });

  it('градусы, минуты, секунды с латинскими буквами', () => {
    const p = parseLatLon('N 52°34\'12" E 69°12\'05"');
    expect(p!.lat).toBeCloseTo(52 + 34 / 60 + 12 / 3600, 6);
    expect(p!.lon).toBeCloseTo(69 + 12 / 60 + 5 / 3600, 6);
  });

  it('градусы с кириллицей — «с.ш.» и «в.д.»', () => {
    const p = parseLatLon('52°05′29″ с.ш. 69°07′24″ в.д.');
    expect(p!.lat).toBeCloseTo(52 + 5 / 60 + 29 / 3600, 5);
    expect(p!.lon).toBeCloseTo(69 + 7 / 60 + 24 / 3600, 5);
  });

  it('буква после числа не перескакивает через запятую', () => {
    const p = parseLatLon('52.09 N, 69.12 E');
    expect(p!.lat).toBeCloseTo(52.09, 4);
    expect(p!.lon).toBeCloseTo(69.12, 4);
  });

  it('полушарие важнее порядка', () => {
    const p = parseLatLon('E 69°12\'05" N 52°34\'12"');
    expect(p!.lat).toBeCloseTo(52 + 34 / 60 + 12 / 3600, 6);
  });

  it('южное и западное полушарие — со знаком минус', () => {
    const p = parseLatLon('S 33°55\'00" W 18°25\'00"');
    expect(p!.lat).toBeCloseTo(-33.9166, 3);
    expect(p!.lon).toBeCloseTo(-18.4166, 3);
  });

  it('градусы и минуты без секунд', () => {
    const p = parseLatLon('52°34.5\' 69°12.3\'');
    expect(p!.lat).toBeCloseTo(52 + 34.5 / 60, 6);
  });

  it('одно число — это не координаты', () => {
    expect(parseLatLon('52.091435')).toBeNull();
    expect(parseLatLon('')).toBeNull();
    expect(parseLatLon('  ')).toBeNull();
  });

  it('заведомо невозможные числа не принимаем', () => {
    expect(parseLatLon('952, 1800')).toBeNull();
  });

  it('подсказка по области снимает неоднозначность', () => {
    // 52 и 51 годятся и широтой, и долготой — решает центр области.
    const west = parseLatLon('51.2, 51.4', { lat: 51.2, lon: 51.4 });
    expect(west!.lat).toBeCloseTo(51.2, 3);
  });
});

describe('formatLatLon', () => {
  const P = { lat: 52.091435, lon: 69.123456 };

  it('десятичные — шесть знаков', () => {
    expect(formatLatLon(P, 'decimal')).toBe('52.091435, 69.123456');
  });

  it('для навигатора — без пробела, чтобы вставлялось целиком', () => {
    expect(formatLatLon(P, 'nav')).toBe('52.091435,69.123456');
  });

  it('градусы, минуты, секунды — как в акте', () => {
    expect(formatLatLon(P, 'dms')).toBe('52°05′29,2″ с.ш. 069°07′24,4″ в.д.');
  });

  it('градусы и минуты — как в приёмнике', () => {
    expect(formatLatLon(P, 'dm')).toBe('52°05,486′ с.ш. 069°07,407′ в.д.');
  });

  it('южная широта подписана «ю.ш.»', () => {
    expect(formatOne(-33.9166, 'lat', 'dms')).toContain('ю.ш.');
  });

  it('что написали — то и прочитали обратно', () => {
    for (const style of COORD_STYLES) {
      const back = parseLatLon(formatLatLon(P, style));
      expect(back, COORD_STYLE_LABEL[style]).not.toBeNull();
      expect(back!.lat, COORD_STYLE_LABEL[style]).toBeCloseTo(P.lat, 4);
      expect(back!.lon, COORD_STYLE_LABEL[style]).toBeCloseTo(P.lon, 4);
    }
  });
});

/**
 * Координаты присылают не голыми: «Муфта 3: 52.12, 71.65». Брать просто
 * первые два числа значит взять номер муфты за широту и уехать в
 * Гвинейский залив.
 */
describe('число перед координатами', () => {
  it('номер объекта не принимается за широту', () => {
    expect(parseLatLon('Муфта 3: 52.091435, 69.123456'))
      .toEqual({ lat: 52.091435, lon: 69.123456 });
  });

  it('и номер, и единицы измерения вокруг координат', () => {
    expect(parseLatLon('ККС 339, отм. 1240 м — 52.09 69.12'))
      .toEqual({ lat: 52.09, lon: 69.12 });
  });

  it('дата перед координатами не сбивает разбор', () => {
    expect(parseLatLon('25.07 муфта у 52.5 71.3')).toEqual({ lat: 52.5, lon: 71.3 });
  });

  it('буква полушария по-прежнему решает всё', () => {
    expect(parseLatLon('точка 7: 69.12 E, 52.09 N'))
      .toEqual({ lat: 52.09, lon: 69.12 });
  });

  it('координаты за пределами Казахстана всё равно принимаются', () => {
    expect(parseLatLon('-33.92, 18.42')).toEqual({ lat: -33.92, lon: 18.42 });
  });

  it('когда годных пар нет вовсе, отвечает «нет»', () => {
    expect(parseLatLon('смена 2, бар 400 м')).toBeNull();
  });
});

/**
 * Округлять разряды порознь нельзя: при 52,99999° секунды дают «60,0», и
 * в акт уходит «52°00′60,0″» — запись, которой не бывает.
 */
describe('перенос разряда при округлении', () => {
  it('секунды не доходят до шестидесяти', () => {
    expect(formatOne(52.99999999, 'lat', 'dms')).toBe('53°00′00,0″ с.ш.');
    expect(formatOne(52.0166664, 'lat', 'dms')).toBe('52°01′00,0″ с.ш.');
  });

  it('минуты не доходят до шестидесяти', () => {
    expect(formatOne(52.99999999, 'lat', 'dm')).toBe('53°00,000′ с.ш.');
  });

  it('обычные значения не портит', () => {
    expect(formatOne(52.5, 'lat', 'dms')).toBe('52°30′00,0″ с.ш.');
    expect(formatOne(69.25, 'lon', 'dm')).toBe('069°15,000′ в.д.');
  });

  it('в любой записи секунд и минут меньше шестидесяти', () => {
    for (let i = 0; i < 400; i += 1) {
      const v = 40 + Math.random() * 15;
      const dms = formatOne(v, 'lat', 'dms');
      const [, min, sec] = dms.match(/^(\d+)°(\d+)′([\d,]+)″/)!.slice(0);
      expect(Number(min)).toBeLessThan(60);
      expect(Number(sec.replace(',', '.'))).toBeLessThan(60);
      const dm = formatOne(v, 'lat', 'dm');
      expect(Number(dm.match(/°([\d,]+)′/)![1].replace(',', '.'))).toBeLessThan(60);
    }
  });
});
