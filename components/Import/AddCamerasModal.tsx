'use client';
import { useState, useCallback, useRef } from 'react';
import { CameraKind, CAMERA_KIND_LABEL, CAMERA_KIND_COLOR, CAMERA_MIN_BANDWIDTH_MBPS } from '@/types/network';
import { importCameraExcel, type ParsedCameraRow } from './CamerasExcelImporter';

interface Props {
  onClose: () => void;
  // Called for each parsed row.  Returns when all rows attached + cables routed.
  onAdd: (rows: ParsedCameraRow[]) => Promise<void>;
}

// Brownfield "Add cameras to existing network" flow.  Read an Excel with
// new camera coordinates + types, preview classification, let the user fix
// any "unknown" rows, then ask the host to attach them.
export default function AddCamerasModal({ onClose, onAdd }: Props) {
  const [rows, setRows] = useState<ParsedCameraRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setError(''); setFileName(file.name);
    try {
      const parsed = await importCameraExcel(file);
      if (parsed.length === 0) throw new Error('Не нашёл валидных строк с координатами');
      setRows(parsed);
    } catch (e: any) {
      setError(e?.message ?? 'parse error');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateKind = (i: number, k: CameraKind) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, kind: k } : r)));
  };

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      await onAdd(rows);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'add error');
    } finally {
      setBusy(false);
    }
  }, [rows, onAdd, onClose]);

  const counts = rows.reduce(
    (a, r) => {
      a[r.kind] = (a[r.kind] ?? 0) + 1;
      return a;
    },
    {} as Record<CameraKind, number>,
  );

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-[#1e3a5f]">
          <h2 className="text-sm font-semibold text-[#e2e8f0]">📷 Добавить камеры из Excel</h2>
          <button onClick={onClose} className="text-[#64748b] hover:text-[#e2e8f0]">✕</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {rows.length === 0 && (
            <>
              <div
                className="border-2 border-dashed border-[#1e3a5f] hover:border-[#38bdf8]/50 rounded-xl p-6 text-center cursor-pointer transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFile(f);
                }}
              >
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                {loading ? (
                  <div className="text-xs text-[#94a3b8]">Чтение…</div>
                ) : (
                  <>
                    <div className="text-3xl mb-2">📷</div>
                    <p className="text-sm text-[#e2e8f0]">Перетащи Excel или нажми</p>
                    <p className="text-[10px] text-[#64748b] mt-1">
                      Колонки: <b>lat</b>, <b>lon</b> (или одной ячейкой), <b>тип</b> (ЛУ/Перекр/ОВН), <b>адрес</b>
                    </p>
                  </>
                )}
              </div>
              <div className="text-[10px] text-[#64748b] bg-[#0a0e1a] border border-[#1e3a5f]/50 rounded p-2">
                💡 Каждая камера будет привязана к ближайшему существующему ОРКСП с свободным портом и кабель ОК-4 проложится через OSRM.
                Существующая сеть не трогается.
              </div>
            </>
          )}

          {rows.length > 0 && (
            <>
              <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded p-2 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[#e2e8f0]">📄 {fileName}</span>
                  <span className="text-[#64748b] ml-2">— {rows.length} камер</span>
                </div>
                <button onClick={() => setRows([])} className="text-[10px] text-[#64748b] hover:text-[#38bdf8]">
                  Сменить
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
                <div className="text-center"><span style={{ color: CAMERA_KIND_COLOR.lu }}>●</span> {counts.lu ?? 0} ЛУ</div>
                <div className="text-center"><span style={{ color: CAMERA_KIND_COLOR.intersection }}>●</span> {counts.intersection ?? 0} Перекр</div>
                <div className="text-center"><span style={{ color: CAMERA_KIND_COLOR.ovn }}>●</span> {counts.ovn ?? 0} ОВН</div>
              </div>
              {counts.unknown > 0 && (
                <div className="text-[10px] text-[#fbbf24]">
                  ⚠️ {counts.unknown} строк не удалось определить — выбери тип вручную ниже.
                </div>
              )}

              <div className="max-h-[40vh] overflow-y-auto border border-[#1e3a5f] rounded">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-[#0a0e1a] text-[#64748b]">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">Координаты</th>
                      <th className="px-2 py-1 text-left">Адрес / описание</th>
                      <th className="px-2 py-1 text-left">Тип</th>
                      <th className="px-2 py-1 text-right">Мбит/с</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-[#1e3a5f]/40">
                        <td className="px-2 py-1 text-[#64748b]">{i + 1}</td>
                        <td className="px-2 py-1 text-[#94a3b8]">{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</td>
                        <td className="px-2 py-1 text-[#e2e8f0] truncate max-w-[180px]" title={r.desc}>{r.desc}</td>
                        <td className="px-2 py-1">
                          <select
                            value={r.kind}
                            onChange={(e) => updateKind(i, e.target.value as CameraKind)}
                            className={`bg-[#0a0e1a] border rounded px-1 py-0.5 text-[10px] ${r.kind === 'unknown' ? 'border-[#fbbf24] text-[#fbbf24]' : 'border-[#1e3a5f] text-[#e2e8f0]'}`}
                            style={{ color: r.kind !== 'unknown' ? CAMERA_KIND_COLOR[r.kind] : undefined }}
                          >
                            <option value="lu">ЛУ</option>
                            <option value="intersection">Перекр</option>
                            <option value="ovn">ОВН</option>
                            <option value="unknown">?</option>
                          </select>
                        </td>
                        <td className="px-2 py-1 text-right text-[#94a3b8]">{CAMERA_MIN_BANDWIDTH_MBPS[r.kind]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {error && <div className="text-xs text-[#f87171]">⚠️ {error}</div>}
        </div>

        <div className="p-3 border-t border-[#1e3a5f] flex gap-2">
          <button onClick={onClose} className="flex-1 py-1.5 border border-[#1e3a5f] rounded text-xs text-[#94a3b8]">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={rows.length === 0 || busy}
            className="flex-1 py-1.5 bg-[#38bdf8] hover:bg-[#7dd3fc] disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-semibold text-[#0a0e1a]"
          >
            {busy ? '⏳ Привязка + OSRM…' : `📍 Добавить ${rows.length} камер`}
          </button>
        </div>
      </div>
    </div>
  );
}
