import { describe, it, expect } from 'vitest';
import type { FieldPhoto } from '@/types/construction';
import { photoGeoNote, photoTimeNote, photoGeoSummary, fmtGap } from './photoGeo';
import { photoCaption, photoReportHtml } from './fieldDocs';

/** Снимок на трассе у Еленовки: 09:12 по Алматы. */
const SHOT = '2026-07-25T04:12:00.000Z';

function photo(over: Partial<FieldPhoto> = {}): FieldPhoto {
  return {
    id: 'p1', kind: 'entry', refId: 'e1',
    lat: 52.1, lon: 71.2, geoSource: 'exif',
    takenAt: SHOT, exifAt: SHOT,
    createdAt: '2026-07-25T04:13:00.000Z', updatedAt: '2026-07-25T04:13:00.000Z',
    ...over,
  };
}

describe('fmtGap', () => {
  it('промежуток говорит словами, а не миллисекундами', () => {
    expect(fmtGap(40 * 60_000)).toBe('40 мин');
    expect(fmtGap((10 * 60 + 28) * 60_000)).toBe('10 ч 28 мин');
    expect(fmtGap(3 * 3_600_000)).toBe('3 ч');
    expect(fmtGap(3 * 24 * 3_600_000)).toBe('3 сут.');
  });
});

describe('photoGeoNote', () => {
  it('точку из снимка называет точкой из снимка и пишет погрешность', () => {
    const g = photoGeoNote(photo({ geoAccuracyM: 8 }));
    expect(g.source).toBe('координаты из снимка, ±8 м');
    expect(g.warning).toBe('');
    expect(g.atShot).toBe(true);
  });

  it('без погрешности в снимке не пишет «±0 м»', () => {
    expect(photoGeoNote(photo({ geoAccuracyM: 0 })).source).toBe('координаты из снимка');
  });

  it('точку с телефона вечером в вагончике не выдаёт за место работ', () => {
    const g = photoGeoNote(photo({
      geoSource: 'device', geoAt: '2026-07-25T14:40:00.000Z', geoAccuracyM: 25,
    }));
    expect(g.source).toContain('с телефона при добавлении');
    expect(g.warning).toContain('через 10 ч 28 мин после съёмки');
    expect(g.warning).toContain('а не где снимали');
    expect(g.atShot).toBe(false);
    expect(g.short).toContain('не место съёмки');
  });

  it('сфотографировали и сразу приложили — точке с телефона верит', () => {
    const g = photoGeoNote(photo({ geoSource: 'device', geoAt: '2026-07-25T04:12:40.000Z' }));
    expect(g.warning).toBe('');
    expect(g.atShot).toBe(true);
    expect(g.source).toContain('сразу после съёмки');
  });

  it('старую карточку без времени точки сверяет по времени добавления', () => {
    const g = photoGeoNote(photo({ geoSource: 'device', createdAt: '2026-07-25T13:00:00.000Z' }));
    expect(g.warning).toContain('после съёмки');
    expect(g.atShot).toBe(false);
  });

  it('снимок из мессенджера без времени съёмки — место неизвестно', () => {
    const g = photoGeoNote(photo({ geoSource: 'device', exifAt: undefined }));
    expect(g.warning).toContain('где снимали, неизвестно');
    expect(g.atShot).toBe(false);
  });

  it('точку в снимке, оставшуюся с прошлого места, называет вслух', () => {
    const g = photoGeoNote(photo({ geoAt: '2026-07-25T03:30:00.000Z' }));
    expect(g.warning).toContain('определена за 42 мин до кадра');
    expect(g.atShot).toBe(false);
  });

  it('разницу ровно в час не принимает за старую точку — это похоже на пояс', () => {
    const g = photoGeoNote(photo({ geoAt: '2026-07-25T03:12:30.000Z' }));
    expect(g.warning).toContain('часовой пояс');
    expect(g.atShot).toBe(true);
  });

  it('точка ±800 м — место примерное, даже из снимка', () => {
    const g = photoGeoNote(photo({ geoAccuracyM: 800 }));
    expect(g.warning).toContain('±800 м — место примерное');
    expect(g.short).toBe('из снимка ±800 м · примерно');
  });

  it('без координат так и пишет', () => {
    expect(photoGeoNote(photo({ lat: undefined, lon: undefined })).source).toBe('без координат');
  });
});

describe('photoTimeNote', () => {
  it('время из снимка называет временем съёмки', () => {
    expect(photoTimeNote(photo())).toMatch(/^снято 25\.07\.2026, 09:12:00$/);
  });

  it('время добавления не выдаёт за время съёмки', () => {
    expect(photoTimeNote(photo({ exifAt: undefined, takenAt: '2026-07-25T14:40:00.000Z' })))
      .toBe('приложено 25.07.2026, 19:40:00 (время съёмки в снимке не записано)');
  });
});

describe('подпись в фотоотчёте', () => {
  it('рядом с координатами стоит, откуда они', () => {
    expect(photoCaption(photo({ geoAccuracyM: 8 })))
      .toContain('52.10000, 71.20000 (координаты из снимка, ±8 м)');
  });

  it('координаты с телефона через полдня помечены как не место съёмки', () => {
    const cap = photoCaption(photo({ geoSource: 'device', geoAt: '2026-07-25T14:40:00.000Z' }));
    expect(cap).toContain('(координаты с телефона при добавлении, не из снимка): взяты через 10 ч 28 мин');
  });
});

describe('photoGeoSummary', () => {
  it('считает, сколько точек из снимков и сколько не подтверждают место', () => {
    const s = photoGeoSummary([
      photo(),
      photo({ id: 'p2', geoSource: 'device', geoAt: '2026-07-25T14:40:00.000Z' }),
      photo({ id: 'p3', lat: undefined, lon: undefined, geoSource: 'none' }),
    ]);
    expect(s).toBe('Координаты: из снимка — 1, с телефона при добавлении — 1, без координат — 1. '
      + 'Не подтверждают место съёмки: 1 — причина указана под снимком.');
  });

  it('когда всё из снимков, лишнего не пишет', () => {
    expect(photoGeoSummary([photo(), photo({ id: 'p2' })])).toBe('Координаты: из снимка — 2.');
  });

  it('сводка стоит в начале фотоотчёта', () => {
    const html = photoReportHtml({ title: 'ФОТООТЧЁТ', items: [{ photo: photo() }] });
    expect(html).toContain('Координаты: из снимка — 1.');
  });
});
