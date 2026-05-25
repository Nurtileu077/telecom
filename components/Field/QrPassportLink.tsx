'use client';
import { useMemo } from 'react';
import { buildPassportUrl } from '@/lib/entitySearch';

interface Props {
  kind: string;
  id: string;
}

export default function QrPassportLink({ kind, id }: Props) {
  const url = useMemo(() => buildPassportUrl(kind, id), [kind, id]);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(url)}`;

  const copy = () => {
    navigator.clipboard?.writeText(url).catch(() => {});
  };

  return (
    <div className="flex items-center gap-3 pt-1">
      <img src={qrSrc} alt="" width={72} height={72} className="rounded bg-white p-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-[#64748b] mb-1">QR → паспорт на карте</div>
        <button type="button" onClick={copy} className="text-[10px] text-[#38bdf8] hover:underline truncate block w-full text-left">
          Скопировать ссылку
        </button>
      </div>
    </div>
  );
}
