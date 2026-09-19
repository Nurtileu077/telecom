import { describe, it, expect } from 'vitest';
import { photoMeta, photosOf, pendingPhotos, fmtBytes, GEO_SOURCE_LABEL } from './photoStore';
import type { FieldPhoto } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function photo(over: Partial<FieldPhoto> = {}): FieldPhoto {
  return {
    id: 'p1', kind: 'entry', refId: 'g1', geoSource: 'none',
    takenAt: now, createdAt: now, updatedAt: now, ...over,
  };
}

describe('откуда у фото координаты', () => {
  it('без EXIF и без телефона — честно «без координат»', async () => {
    const meta = await photoMeta(new Blob([new Uint8Array([1, 2, 3])]), null);
    expect(meta.geoSource).toBe('none');
    expect(meta.lat).toBeUndefined();
    expect(meta.takenAt).toBeTruthy();
  });

  it('без EXIF берёт телефон, но помечает это', async () => {
    const meta = await photoMeta(new Blob([new Uint8Array([1, 2, 3])]), { lat: 51.5, lon: 71.2 });
    expect(meta.geoSource).toBe('device');
    expect(meta.lat).toBe(51.5);
    // Разница существенная: снимок могли приложить вечером в вагончике.
    expect(GEO_SOURCE_LABEL.device).toContain('телефона');
  });

  it('кривые координаты телефона не берутся', async () => {
    const meta = await photoMeta(new Blob([new Uint8Array([1])]), { lat: NaN, lon: 71 });
    expect(meta.geoSource).toBe('none');
  });
});

describe('карточки фото', () => {
  it('отбираются по записи и идут по времени съёмки', () => {
    const list = [
      photo({ id: 'b', takenAt: '2026-09-18T10:00:00.000Z' }),
      photo({ id: 'a', takenAt: '2026-09-18T08:00:00.000Z' }),
      photo({ id: 'c', refId: 'другая' }),
    ];
    expect(photosOf(list, 'entry', 'g1').map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('считает, сколько ещё не ушло в облако', () => {
    const p = pendingPhotos([
      photo({ id: '1', pending: true, bytes: 2_000_000 }),
      photo({ id: '2', pending: true, bytes: 1_000_000 }),
      photo({ id: '3', url: 'https://…' }),
    ]);
    expect(p.count).toBe(2);
    expect(p.bytes).toBe(3_000_000);
  });

  it('размер пишется по-человечески', () => {
    expect(fmtBytes(512)).toBe('512 Б');
    expect(fmtBytes(2048)).toBe('2 КБ');
    expect(fmtBytes(3_145_728)).toBe('3.0 МБ');
  });
});

describe('отправка фото в облако', () => {
  it('без локального файла карточка не теряется и «отправлено» не врёт', async () => {
    const { uploadPending } = await import('./photoStore');
    const res = await uploadPending(
      [photo({ id: 'нет-файла', pending: true })],
      async () => ({ url: 'u', storagePath: 's' }),
    );
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.photos).toHaveLength(1);
    expect(res.photos[0].pending).toBe(false);
  });

  it('уже отправленные не трогаются', async () => {
    const { uploadPending } = await import('./photoStore');
    const sentPhoto = photo({ id: 'p9', url: 'https://…', pending: false });
    const res = await uploadPending([sentPhoto], async () => {
      throw new Error('не должно вызываться');
    });
    expect(res.photos[0]).toBe(sentPhoto);
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(0);
  });
});
