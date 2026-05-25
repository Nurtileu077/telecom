'use client';
import { useState, useCallback } from 'react';
import { Navigation } from 'lucide-react';

interface Props {
  onLocated: (lat: number, lon: number, accuracyM?: number) => void;
  className?: string;
}

export default function GpsLocateButton({ onLocated, className }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('error');
      setErr('GPS недоступен');
      return;
    }
    setStatus('loading');
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus('idle');
        onLocated(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
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
    </div>
  );
}
