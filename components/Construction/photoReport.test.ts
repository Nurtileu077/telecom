import { describe, it, expect } from 'vitest';
import {
  photoStage, photoSection, photoDay, photosInRange, groupPhotos, splitPhotoReport,
  photoReportFileName, PHOTO_STAGE_LABEL, type PhotoContext,
} from './photoReport';
import type { DailyWorkEntry, FieldPhoto, SiteObject } from '@/types/construction';

function g(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: 'g1', kind: 'ground', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '1',
    byMethod: { 'бар': 400 }, materials: {}, createdAt: '', updatedAt: '', ...over,
  } as DailyWorkEntry;
}

function ph(over: Partial<FieldPhoto> = {}): FieldPhoto {
  return {
    id: `p${Math.random()}`, kind: 'entry', refId: 'g1', geoSource: 'none',
    takenAt: '2026-09-10T05:00:00.000Z', createdAt: '', updatedAt: '', ...over,
  };
}

const ctx: PhotoContext = {
  ground: [
    g(),
    g({ id: 'g2', byMethod: {}, drillM: 60, drillCount: 1 }),
    g({ id: 'g3', byMethod: {}, blowingM: 2000 }),
    g({ id: 'g4', uchastok: 'Обалы' }),
  ],
  objects: [
    { id: 'm1', kind: 'mufta', name: 'Муфта №1', lat: 0, lon: 0, uchastok: 'Еленовка' } as SiteObject,
    { id: 'k1', kind: 'kks', name: 'ККС 3', lat: 0, lon: 0, uchastok: 'Еленовка' } as SiteObject,
  ],
};

describe('этап снимка', () => {
  it('следует из того, к чему снимок приложен', () => {
    expect(photoStage(ph(), ctx)).toBe('mkt');
    expect(photoStage(ph({ refId: 'g2' }), ctx)).toBe('gnb');
    expect(photoStage(ph({ refId: 'g3' }), ctx)).toBe('zaduvka');
    expect(photoStage(ph({ kind: 'object', refId: 'm1' }), ctx)).toBe('svarka');
    expect(photoStage(ph({ kind: 'object', refId: 'k1' }), ctx)).toBe('objects');
    expect(photoStage(ph({ kind: 'drill', refId: 'x' }), ctx)).toBe('gnb');
  });

  it('не нашли, к чему приложен, — «без этапа», а не догадка', () => {
    expect(photoStage(ph({ refId: 'нет такой' }), ctx)).toBe('other');
    expect(PHOTO_STAGE_LABEL.other).toBe('Без этапа');
  });

  it('участок берётся из карточки, а если его нет — из смены', () => {
    expect(photoSection(ph({ uchastok: 'Обалы' }), ctx)).toBe('Обалы');
    expect(photoSection(ph({ refId: 'g4' }), ctx)).toBe('Обалы');
    expect(photoSection(ph({ kind: 'object', refId: 'm1' }), ctx)).toBe('Еленовка');
  });
});

describe('день снимка', () => {
  it('ночной снимок по Алматы не уезжает во вчерашний день', () => {
    // 20:30 UTC 24-го — это 01:30 25-го в Казахстане.
    expect(photoDay(ph({ takenAt: '2026-07-24T20:30:00.000Z' }))).toBe('2026-07-25');
  });

  it('время из снимка без пояса читается как местное', () => {
    expect(photoDay(ph({ exifAt: '2026-07-25T00:10:00' }))).toBe('2026-07-25');
  });

  it('в отчёт за день попадает ночной снимок этого дня', () => {
    const night = ph({ takenAt: '2026-07-24T20:30:00.000Z' });
    expect(photosInRange([night], '2026-07-25', '2026-07-25')).toEqual([night]);
  });
});

describe('раскладка фотоотчёта', () => {
  const photos = [
    ph({ refId: 'g2', takenAt: '2026-09-10T08:00:00.000Z' }),
    ph({ refId: 'g1', takenAt: '2026-09-10T09:00:00.000Z' }),
    ph({ refId: 'g1', takenAt: '2026-09-10T07:00:00.000Z' }),
    ph({ refId: 'g4' }),
    ph({ refId: 'нет такой' }),
  ];

  it('по участкам, внутри — этапы в порядке стройки и снимки по времени', () => {
    const groups = groupPhotos(photos, ctx);
    expect(groups.map((x) => `${x.uchastok}|${x.stage}`)).toEqual([
      'Еленовка|mkt', 'Еленовка|gnb', 'Обалы|mkt', '|other',
    ]);
    expect(groups[0].photos.map((p) => p.takenAt)).toEqual([
      '2026-09-10T07:00:00.000Z', '2026-09-10T09:00:00.000Z',
    ]);
  });

  it('по участку — только его снимки', () => {
    const groups = groupPhotos(photos, ctx, 'с. Обалы');
    expect(groups).toHaveLength(1);
    expect(groups[0].uchastok).toBe('Обалы');
  });

  it('сверх шестидесяти снимки не отбрасываются, а уходят в следующую часть', () => {
    const many = Array.from({ length: 150 }, (_, i) => ph({
      takenAt: `2026-09-10T0${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}:00.000Z`,
    }));
    const parts = splitPhotoReport(groupPhotos(many, ctx), 60);
    expect(parts.map((p) => p.groups.reduce((s, x) => s + x.photos.length, 0))).toEqual([60, 60, 30]);
    expect(parts.every((p) => p.of === 3 && p.total === 150)).toBe(true);
  });

  it('группа, перешедшая в следующую часть, подписана продолжением', () => {
    const many = Array.from({ length: 70 }, () => ph());
    const parts = splitPhotoReport(groupPhotos(many, ctx), 60);
    expect(parts[0].groups[0].title).toBe('Еленовка — Прокладка МКТ');
    expect(parts[1].groups[0].title).toBe('Еленовка — Прокладка МКТ (продолжение)');
  });

  it('в отчёте по одному участку заголовок группы — только этап', () => {
    const parts = splitPhotoReport(groupPhotos(photos, ctx, 'Еленовка'), 60, false);
    expect(parts[0].groups.map((x) => x.title)).toEqual(['Прокладка МКТ', 'ГНБ / переходы']);
  });

  it('пустой отчёт — ни одной части, а не пустой файл', () => {
    expect(splitPhotoReport([], 60)).toEqual([]);
  });
});

describe('имя файла фотоотчёта', () => {
  it('называет участок, период и часть', () => {
    expect(photoReportFileName({
      uchastok: 'Еленовка', from: '2026-09-01', to: '2026-09-30', part: { index: 2, of: 3 },
    })).toBe('Фотоотчёт Еленовка 2026-09-01—2026-09-30 часть 2 из 3.doc');
    expect(photoReportFileName({ from: '2026-09-01', to: '2026-09-30' }))
      .toBe('Фотоотчёт 2026-09-01—2026-09-30.doc');
  });
});
