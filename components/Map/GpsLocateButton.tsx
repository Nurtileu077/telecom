'use client';
import { useState, useCallback, useEffect } from 'react';
import { Navigation } from 'lucide-react';
import { fixLabel, fixQuality, fixStyle } from './gpsFix';

interface Props {
  onLocated: (lat: number, lon: number, accuracyM?: number) => void;
  className?: string;
}

/** Сколько держать подпись с точностью у кнопки. */
const NOTE_MS = 12_000;

export default function GpsLocateButton({ onLocated, className }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  // Точность пишем и у кнопки: подсказку у точки закрывают одним касанием,
  // а «±800 м» должно попасться на глаза, даже если её не открывали.
  const [note, setNote] = useState<{ text: string; color: string } | null>(null);

  useEffect(() => {
    if (!note) return undefined;
    const t = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(t);
  }, [note]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('error');
      setErr('GPS недоступен');
      return;
    }
    setStatus('loading');
    setErr(null);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus('idle');
        const acc = pos.coords.accuracy;
        setNote({ text: fixLabel(acc).short, color: fixStyle(fixQuality(acc)).color });
        onLocated(pos.coords.latitude, pos.coords.longitude, acc);
      },
      (e) => {
        setStatus('error');
        setErr(e.message || 'Не удалось определить позицию');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }, [onLocated]);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={locate}
        disabled={status === 'loading'}
        className="map-gps-btn"
        title="Где я (GPS)"
        aria-label="Показать моё местоположение на карте"
      >
        <Navigation size={18} className={status === 'loading' ? 'animate-pulse' : ''} />
      </button>
      {err && <span className="map-gps-err">{err}</span>}
      {!err && note && (
        <span className="map-gps-note" style={{ color: note.color }} role="status">
          {note.text}
        </span>
      )}
    </div>
  );
}
