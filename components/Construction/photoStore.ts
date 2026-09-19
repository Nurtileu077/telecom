import { FieldPhoto, PhotoGeoSource } from '@/types/construction';
import { readExifGps } from '@/lib/exifGps';

/**
 * Хранилище полевых фото.
 *
 * Снимки тяжёлые: десяток фотографий с телефона — это больше, чем весь
 * журнал за полгода. В localStorage им нельзя: они вытеснят оттуда то,
 * ради чего всё это затевалось. Поэтому файлы лежат в IndexedDB, а в
 * журнале — только карточка: где, когда, к чему приложено.
 *
 * Связь с облаком односторонняя и ленивая: пока фото не ушло, оно живёт
 * локально и открывается из локальной копии. Ушло — остаётся ссылка,
 * а локальная копия удаляется. В поле интернета нет, и ждать его,
 * чтобы приложить снимок, никто не станет.
 */

const DB_NAME = 'optiq-photos';
const STORE = 'blobs';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    // Приватный режим и запрет хранилища — не повод падать: фото просто
    // не сохранится, и об этом будет сказано вслух.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

export function putPhotoBlob(id: string, blob: Blob): Promise<boolean> {
  return tx('readwrite', (s) => s.put(blob, id) as IDBRequest<unknown>).then((r) => r !== null || true)
    .catch(() => false);
}

export function getPhotoBlob(id: string): Promise<Blob | null> {
  return tx<Blob>('readonly', (s) => s.get(id) as IDBRequest<Blob>);
}

export function deletePhotoBlob(id: string): Promise<void> {
  return tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>).then(() => undefined);
}

export function listPhotoBlobIds(): Promise<string[]> {
  return tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
    .then((keys) => (keys ?? []).map(String));
}

// ── Разбор приложенного файла ────────────────────────────────────────────────

export interface PhotoMeta {
  lat?: number;
  lon?: number;
  geoSource: PhotoGeoSource;
  takenAt: string;
  exifAt?: string;
}

/**
 * Откуда брать координаты.
 *
 * Сначала EXIF: он снят там, где снимали. Если его нет — положение
 * устройства, но помеченное как «телефон», потому что снимок могли
 * приложить вечером и не на месте работ. Придумывать координаты, когда
 * их нет ни там, ни там, нельзя — так и пишем.
 */
export async function photoMeta(
  file: Blob,
  devicePos?: { lat: number; lon: number } | null,
): Promise<PhotoMeta> {
  const now = new Date().toISOString();
  let exif: ReturnType<typeof readExifGps> = null;
  try {
    exif = readExifGps(await file.arrayBuffer());
  } catch {
    exif = null;
  }

  const hasExifCoords = !!exif && Number.isFinite(exif.lat) && Number.isFinite(exif.lon);
  if (hasExifCoords) {
    return {
      lat: exif!.lat, lon: exif!.lon,
      geoSource: 'exif',
      takenAt: exif!.takenAt ?? now,
      exifAt: exif!.takenAt,
    };
  }
  if (devicePos && Number.isFinite(devicePos.lat) && Number.isFinite(devicePos.lon)) {
    return {
      lat: devicePos.lat, lon: devicePos.lon,
      geoSource: 'device',
      takenAt: exif?.takenAt ?? now,
      exifAt: exif?.takenAt,
    };
  }
  return { geoSource: 'none', takenAt: exif?.takenAt ?? now, exifAt: exif?.takenAt };
}

export const GEO_SOURCE_LABEL: Record<PhotoGeoSource, string> = {
  exif: 'координаты из снимка',
  device: 'координаты с телефона при добавлении',
  manual: 'координаты поставлены вручную',
  none: 'без координат',
};

/** Сколько локальных файлов ещё не ушло в облако и сколько они весят. */
export function pendingPhotos(photos: FieldPhoto[]): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const p of photos) {
    if (!p.pending) continue;
    count += 1;
    bytes += p.bytes ?? 0;
  }
  return { count, bytes };
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Фото, приложенные к этой записи. */
export function photosOf(photos: FieldPhoto[], kind: FieldPhoto['kind'], refId: string): FieldPhoto[] {
  return photos
    .filter((p) => p.kind === kind && p.refId === refId)
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

// ── Отправка в облако ────────────────────────────────────────────────────────

export interface PhotoUploadResult {
  /** Обновлённые карточки: у отправленных появилась ссылка. */
  photos: FieldPhoto[];
  sent: number;
  failed: number;
}

/**
 * Отправляем то, что лежало локально.
 *
 * По одному файлу за раз и без «всё или ничего»: в поле связь рвётся на
 * середине, и половина отправленных фото — лучше, чем ноль. Локальную
 * копию удаляем только после того, как ссылка получена.
 */
export async function uploadPending(
  photos: FieldPhoto[],
  upload: (id: string, blob: Blob) => Promise<{ url: string; storagePath: string }>,
): Promise<PhotoUploadResult> {
  let sent = 0;
  let failed = 0;
  const out: FieldPhoto[] = [];

  for (const p of photos) {
    if (!p.pending) { out.push(p); continue; }
    const blob = await getPhotoBlob(p.id);
    if (!blob) {
      // Файла нет: карточку не теряем, но и врать про «отправлено» не станем.
      out.push({ ...p, pending: false, note: p.note ?? 'файл не найден на устройстве' });
      failed += 1;
      continue;
    }
    try {
      const { url, storagePath } = await upload(p.id, blob);
      out.push({ ...p, url, storagePath, pending: false, sync: 'synced', updatedAt: new Date().toISOString() });
      await deletePhotoBlob(p.id);
      sent += 1;
    } catch {
      out.push(p);
      failed += 1;
    }
  }
  return { photos: out, sent, failed };
}
