'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, X, MapPin, CloudOff } from 'lucide-react';
import { FieldPhoto } from '@/types/construction';
import {
  photoMeta, putPhotoBlob, getPhotoBlob, deletePhotoBlob,
  GEO_SOURCE_LABEL, fmtBytes,
} from './photoStore';
import { shrinkPhoto } from './photoShrink';

/**
 * Фотографии к записи.
 *
 * Снимок нужен не «для галереи»: им подтверждают глубину, восстановление
 * покрытия, установленную муфту. Поэтому у него всегда есть место и время
 * и всегда написано, откуда они взялись — из самого файла или с телефона
 * в момент, когда фото прикладывали. Это разные вещи, и на приёмке
 * разница видна.
 *
 * Работает без сети: файл ложится в локальное хранилище и открывается
 * оттуда, пока не уйдёт в облако. В поле ждать интернета, чтобы приложить
 * снимок, никто не станет.
 */

interface Props {
  photos: FieldPhoto[];
  kind: FieldPhoto['kind'];
  refId: string;
  author: string;
  /** Контекст записи — чтобы фото знало, где оно снято по документам. */
  place?: { oblast?: string; rayon?: string; uchastok?: string; kato?: string };
  onAdd: (p: FieldPhoto) => void;
  onRemove: (id: string) => void;
  onFlash?: (text: string) => void;
}

/** Положение устройства — спрашиваем только когда в файле координат нет. */
function devicePosition(): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (v: { lat: number; lon: number } | null) => resolve(v);
    navigator.geolocation.getCurrentPosition(
      (pos) => done({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => done(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 },
    );
  });
}

export default function PhotoAttach({
  photos, kind, refId, author, place, onAdd, onRemove,
  onFlash,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      // Положение спрашиваем один раз на всю пачку: диалог разрешения на
      // каждый файл — верный способ получить отказ.
      let pos: { lat: number; lon: number } | null | undefined;
      let savedBytes = 0;
      for (const file of Array.from(files)) {
        const id = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        // Координаты читаем из оригинала: пережатие стирает EXIF, а
        // вместе с ним и место, где снято.
        const meta = await photoMeta(file, pos === undefined ? (pos = await devicePosition()) : pos);
        /**
         * Телефон снимает в четыре-шесть мегабайт, а снимков за день
         * сорок. Двести мегабайт в память браузера не влезают: она
         * кончается, и вместе с ней перестаёт сохраняться журнал.
         */
        const small = await shrinkPhoto(file);
        savedBytes += small.before - small.after;
        const stored = await putPhotoBlob(id, small.blob);
        if (!stored) {
          setError('Файл не сохранился: браузер не дал места. Освободите память устройства.');
          continue;
        }
        const now = new Date().toISOString();
        onAdd({
          id, kind, refId,
          lat: meta.lat, lon: meta.lon,
          geoSource: meta.geoSource,
          takenAt: meta.takenAt,
          exifAt: meta.exifAt,
          oblast: place?.oblast, rayon: place?.rayon,
          uchastok: place?.uchastok, kato: place?.kato,
          author,
          pending: true,
          bytes: small.after,
          createdAt: now, updatedAt: now, sync: 'local',
        });
      }
      if (savedBytes > 0) {
        onFlash?.(`Снимки ужаты: ${fmtBytes(savedBytes)} осталось свободно`);
      }
    } catch {
      setError('Не удалось приложить фото. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = (p: FieldPhoto) => {
    if (!confirm('Убрать фотографию?')) return;
    void deletePhotoBlob(p.id);
    onRemove(p.id);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10.5px] text-[var(--text-muted)] leading-snug">
        Место и время берутся из самого снимка. Если их там нет — с телефона,
        и это будет написано: фото могли приложить не на месте работ.
      </p>

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <Thumb key={p.id} photo={p} onRemove={() => remove(p)} />
          ))}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple
             className="hidden" onChange={(e) => void pick(e.target.files)} />
      <button type="button" disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="self-start btn text-[11px]">
        <Camera size={14} />{busy ? 'Добавляю…' : 'Фото'}
      </button>

      {error && <p className="text-[11px] text-[var(--danger)]">{error}</p>}
    </div>
  );
}

function Thumb({ photo, onRemove }: { photo: FieldPhoto; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(photo.url ?? null);

  useEffect(() => {
    if (photo.url) { setSrc(photo.url); return; }
    let url: string | null = null;
    let alive = true;
    void getPhotoBlob(photo.id).then((blob) => {
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      alive = false;
      // Ссылку на объект освобождаем: иначе вкладка с сотней снимков
      // съедает память и её закрывают вместе с несохранённым отчётом.
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo.id, photo.url]);

  const when = new Date(photo.takenAt);
  const geo = photo.lat !== undefined && photo.lon !== undefined;

  return (
    <div className="w-[104px] rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] overflow-hidden relative">
      <button type="button" onClick={onRemove} title="Убрать"
              className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center">
        <X size={12} />
      </button>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-full h-[78px] object-cover" />
      ) : (
        <div className="w-full h-[78px] flex items-center justify-center text-[var(--text-muted)]">
          <Camera size={16} />
        </div>
      )}
      <div className="px-1.5 py-1 flex flex-col gap-0.5">
        <span className="text-[9.5px] text-[var(--text-muted)] font-mono">
          {Number.isNaN(when.getTime())
            ? '—'
            : when.toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="text-[9px] leading-tight flex items-center gap-0.5"
              style={{ color: photo.geoSource === 'exif' ? 'var(--accent)' : 'var(--text-muted)' }}
              title={GEO_SOURCE_LABEL[photo.geoSource]}>
          <MapPin size={9} className="shrink-0" />
          {geo ? GEO_SOURCE_LABEL[photo.geoSource] : 'без координат'}
        </span>
        {photo.pending && (
          <span className="text-[9px] text-[var(--text-muted)] flex items-center gap-0.5"
                title="Файл лежит на устройстве и уйдёт в облако при обмене">
            <CloudOff size={9} className="shrink-0" />
            {photo.bytes ? fmtBytes(photo.bytes) : 'локально'}
          </span>
        )}
      </div>
    </div>
  );
}
