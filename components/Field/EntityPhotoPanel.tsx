'use client';
import { useRef, useState } from 'react';
import { Camera, Trash2, Loader2 } from 'lucide-react';
import type { EntityFieldPhoto } from '@/types/network';
import { addFieldPhoto, removeFieldPhoto } from '@/lib/fieldPhotos';
import { supabase } from '@/lib/supabase';

interface Props {
  projectId: string;
  entityKind: 'ork' | 'tb';
  entityId: string;
  photos: EntityFieldPhoto[];
  onPhotosChange: (photos: EntityFieldPhoto[]) => void;
  allowUpload?: boolean;
}

export default function EntityPhotoPanel({
  projectId, entityKind, entityId, photos, onPhotosChange, allowUpload = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !allowUpload) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await addFieldPhoto(projectId, entityKind, entityId, file, photos);
      onPhotosChange(next);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Ошибка загрузки');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (photo: EntityFieldPhoto) => {
    if (!allowUpload || !confirm('Удалить фото?')) return;
    setBusy(true);
    try {
      onPhotosChange(await removeFieldPhoto(photo, photos));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#1e3a5f] bg-[#0a0e1a]/80 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[#64748b]">Фото объекта</span>
        {!supabase && (
          <span className="text-[9px] text-[#fbbf24]">офлайн в проекте</span>
        )}
      </div>
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {photos.map((p) => (
            <div key={p.id} className="relative aspect-square rounded overflow-hidden border border-[#1e3a5f]">
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                <img src={p.url} alt="" className="w-full h-full object-cover" />
              </a>
              {allowUpload && (
                <button
                  type="button"
                  onClick={() => onRemove(p)}
                  className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-[#f87171]"
                  aria-label="Удалить"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {allowUpload && (
        <>
          <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="w-full py-1.5 text-[11px] border border-[#fbbf24]/40 text-[#fbbf24] rounded flex items-center justify-center gap-1"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            {busy ? 'Загрузка…' : 'Сделать / выбрать фото'}
          </button>
        </>
      )}
      {err && <p className="text-[10px] text-[#f87171]">{err}</p>}
    </div>
  );
}
