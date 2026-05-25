import type { EntityFieldPhoto } from '@/types/network';
import { storageUploadFieldPhoto, storageDeleteFieldPhoto, supabase } from '@/lib/supabase';
import { resizeImageFile, blobToDataUrl } from '@/lib/photoResize';

const MAX_PHOTOS_PER_ENTITY = 12;
const MAX_LOCAL_DATA_URL_BYTES = 400_000;

export async function addFieldPhoto(
  projectId: string,
  entityKind: 'ork' | 'tb',
  entityId: string,
  file: File,
  existing: EntityFieldPhoto[],
): Promise<EntityFieldPhoto[]> {
  if (existing.length >= MAX_PHOTOS_PER_ENTITY) {
    throw new Error(`Не более ${MAX_PHOTOS_PER_ENTITY} фото на объект`);
  }
  const blob = await resizeImageFile(file);
  const id = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const takenAt = new Date().toISOString();

  if (supabase) {
    const { url, storagePath } = await storageUploadFieldPhoto(projectId, entityKind, entityId, blob);
    return [...existing, { id, url, storagePath, takenAt }];
  }

  const url = await blobToDataUrl(blob);
  if (url.length > MAX_LOCAL_DATA_URL_BYTES) {
    throw new Error('Фото слишком большое для офлайн-сохранения. Подключите Supabase Storage.');
  }
  return [...existing, { id, url, takenAt }];
}

export async function removeFieldPhoto(photo: EntityFieldPhoto, existing: EntityFieldPhoto[]): Promise<EntityFieldPhoto[]> {
  if (photo.storagePath) {
    try {
      await storageDeleteFieldPhoto(photo.storagePath);
    } catch (e) {
      console.warn('[photos] storage delete', e);
    }
  }
  return existing.filter((p) => p.id !== photo.id);
}
