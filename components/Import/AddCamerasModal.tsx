'use client';
import { useState, useCallback, useRef } from 'react';
import { CameraType, CAMERA_MIN_SPEED_MBPS } from '@/types/network';
import { importExcel } from './ExcelImporter';

interface Props {
  onClose: () => void;
  // Sequentially attach each row: nearest existing ORKSP, OSRM-routed drop.
  onAdd: (rows: Array<{ lat: number; lon: number; desc: string; cameraType?: CameraType; district?: string }>) => Promise<void>;
}

// Brownfield: добавить новые камеры к существующей сети.  Excel → preview
// table → "Добавить N камер".  Тип камеры определяется автоматически из
// колонки «тип» или из описания; пользователь может вручную переопределить
// на каждой строке.
export default function AddCamerasModal({ onClose, onAdd }: Props) {
  type Row = { lat: number; lon: number; desc: string; cameraType?: CameraType; district?: string };
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setError(''); setFileName(file.name);
    try {
      const subs = await importExcel(file);
      if (subs.length === 0) throw new Error('Не нашёл строк с координатами');
      setRows(subs.map((s) => ({
        lat: s.lat, lon: s.lon, desc: s.desc,
        cameraType: s.cameraType,
        district: s.district,
      })));
    } catch (e: any) {
      setError(e?.message ?? 'parse error');
    } finally {
      setLoading(false);
    }
  }, []);

  const setRowType = (i: number, t: CameraType | undefined) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, cameraType: t } : r)));
  };

  const submit = useCallback(async () => {
    setBusy(true);
    setProgress({ done: 0, total: rows.length });
    try {
      // Передаём по одному, чтобы прогресс обновлялся.
      for (let i = 0; i < rows.length; i++) {
        await onAdd([rows[i]]);
        setProgress({ done: i + 1, total: rows.length });
      }
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'add error');
    } finally {
      setBusy(false);
    }
  }, [rows, onAdd, onClose]);

  // Per-type counts for preview.
  const counts = rows.reduce(
    (a, r) => {
      const k = r.cameraType ?? 'unknown';
      a[k] = (a[k] ?? 0) + 1;
      return a;
    },
    {} as Record<string, number>,
  );

  const TYPE_OPT: Array<{ v: CameraType | ''; label: string; color: string }> = [
    { v: '',                  label: '?',           color: '#94a3b8' },
    { v: 'apk-lu',            label: 'ЛУ',          color: '#fbbf24' },
    { v: 'apk-intersection',  label: 'Перекр',      color: '#f87171' },
    { v: 'ovn',               label: 'ОВН',         color: '#38bdf8' },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl w-[680px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-[#1e3a5f]">
          <h2 className="text-sm font-semibold text-[#e2e8f0]">📷 Добавить камеры из Excel</h2>
          <button onClick={onClose} className="text-[#64748b] hover:text-[#e2e8f0]">✕</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {rows.length === 0 ? (
            <>
              <div
                className="border-2 border-dashed border-[#1e3a5f] hover:border-[#38bdf8]/50 rounded-xl p-6 text-center cursor-pointer transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
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
                      Колонки: <b>lat / lon</b> (или одной ячейкой), <b>тип</b> (ЛУ/Перекр/ОВН), <b>адрес</b>, <b>район</b>
                    </p>
                  </>
                )}
              </div>
              <div className="text-[10px] text-[#64748b] bg-[#0a0e1a] border border-[#1e3a5f]/50 rounded p-2">
                💡 Каждая камера привязывается к ближайшему существующему ОРКСП.  OSRM-маршрутизирует
                drop-кабель ОК-4 от ОРКСП до камеры.  ОНТ-бокс создаётся на координатах камеры.
                <br/>Существующая сеть НЕ перестраивается.
              </div>
            </>
          ) : (
            <>
              <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded p-2 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[#e2e8f0]">📄 {fileName}</span>
                  <span className="text-[#64748b] ml-2">— {rows.length} камер</span>
                </div>
                <button onClick={() => setRows([])} className="text-[10px] text-[#64748b] hover:text-[#38bdf8]">Сменить</button>
              </div>

              <div className="grid grid-cols-4 gap-1 text-[10px] font-mono text-center">
                <div><span style={{ color: '#fbbf24' }}>●</span> {counts['apk-lu'] ?? 0} ЛУ</div>
                <div><span style={{ color: '#f87171' }}>●</span> {counts['apk-intersection'] ?? 0} Перекр</div>
                <div><span style={{ color: '#38bdf8' }}>●</span> {counts['ovn'] ?? 0} ОВН</div>
                <div><span style={{ color: '#94a3b8' }}>●</span> {counts['unknown'] ?? 0} без типа</div>
              </div>
              {(counts['unknown'] ?? 0) > 0 && (
                <div className="text-[10px] text-[#fbbf24]">
                  ⚠️ У {counts['unknown']} строк тип не распознан — выставь вручную ниже.
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
                        <td className="px-2 py-1 text-[#e2e8f0] truncate max-w-[200px]" title={r.desc}>{r.desc}</td>
                        <td className="px-2 py-1">
                          <select
                            value={r.cameraType ?? ''}
                            onChange={(e) => setRowType(i, e.target.value as CameraType | '' || undefined)}
                            className={`bg-[#0a0e1a] border rounded px-1 py-0.5 text-[10px] ${!r.cameraType ? 'border-[#fbbf24] text-[#fbbf24]' : 'border-[#1e3a5f]'}`}
                            style={{ color: r.cameraType ? (TYPE_OPT.find(o => o.v === r.cameraType)?.color) : undefined }}
                          >
                            {TYPE_OPT.map((o) => (
                              <option key={o.v} value={o.v}>{o.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-right text-[#94a3b8]">
                          {r.cameraType ? CAMERA_MIN_SPEED_MBPS[r.cameraType] : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {busy && (
                <div className="text-[11px] text-[#38bdf8]">
                  ⏳ Привязка к ОРКСП + OSRM: {progress.done} / {progress.total}
                </div>
              )}
            </>
          )}
          {error && <div className="text-xs text-[#f87171]">⚠️ {error}</div>}
        </div>

        <div className="p-3 border-t border-[#1e3a5f] flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-1.5 border border-[#1e3a5f] rounded text-xs text-[#94a3b8] disabled:opacity-40">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={rows.length === 0 || busy}
            className="flex-1 py-1.5 bg-[#38bdf8] hover:bg-[#7dd3fc] disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-semibold text-[#0a0e1a]"
          >
            {busy ? `⏳ ${progress.done}/${progress.total}` : `📍 Добавить ${rows.length} камер`}
          </button>
        </div>
      </div>
    </div>
  );
}
