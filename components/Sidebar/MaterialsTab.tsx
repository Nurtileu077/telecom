'use client';
import { useState, useMemo } from 'react';
import { Materials, District, Cable, CABLE_SIZES, CableType, InlineJoint } from '@/types/network';
import { exportExcel } from '@/components/Export/ExportExcel';
import {
  exportKMZ,
  exportKMZPackage,
  downloadKMZSplitByType,
  DEFAULT_KMZ_LAYERS,
  type KmzExportLayers,
  type KmzPackageMode,
} from '@/components/Export/ExportKMZ';
import { filterByBBox, type BBox } from '@/components/Network/Selection';
import { calculateMaterials } from '@/components/Network/MaterialCalc';

interface Props {
  materials: Materials | null;
  districts: District[];
  cables: Cable[];
  joints?: InlineJoint[];
  selectionBBox?: BBox | null;
  cableReserve?: number;
}

interface Row {
  category: string;
  name: string;
  spec: string;
  qty: number;
  unit: string;
  note?: string;
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2 pt-3">{title}</h3>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between py-0.5">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[#e2e8f0] truncate">{row.name}</div>
              <div className="text-[10px] text-[#64748b] font-mono truncate">{row.spec}</div>
            </div>
            <div className="text-right ml-2 flex-shrink-0">
              <span className="text-sm font-mono font-semibold text-[#38bdf8]">
                {row.qty.toLocaleString('ru')}
              </span>
              <span className="text-[10px] text-[#64748b] ml-1">{row.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LayerCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 py-0.5 cursor-pointer text-xs text-[#cbd5e1] hover:text-[#e2e8f0]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-[#1e3a5f] bg-[#0d1b2a] text-[#38bdf8] focus:ring-[#38bdf8]/40"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

export default function MaterialsTab({ materials, districts, cables, joints, selectionBBox, cableReserve = 1.10 }: Props) {
  const [kmzLayers, setKmzLayers] = useState<KmzExportLayers>(() => ({ ...DEFAULT_KMZ_LAYERS, cables: { ...DEFAULT_KMZ_LAYERS.cables } }));
  const [showKmzPanel, setShowKmzPanel] = useState(false);
  const [kmzBusy, setKmzBusy] = useState<string | null>(null);

  if (!materials) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">📦</div>
        <p className="text-sm text-[#94a3b8]">Импортируйте данные и постройте сеть для расчёта материалов</p>
      </div>
    );
  }

  const exportSet = (): { districts: District[]; cables: Cable[]; materials: Materials } => {
    if (!selectionBBox) return { districts, cables, materials: materials! };
    const f = filterByBBox(districts, cables, joints ?? [], selectionBBox);
    const m = calculateMaterials(
      f.districts, f.cables,
      { maxPerORK: 8, maxORKperTB: 4, spareFiresPerSub: 1, cableReserve, useOSRM: true, osrmDelay: 100 },
      f.joints.length,
    );
    return { districts: f.districts, cables: f.cables, materials: m };
  };

  const filePrefix = selectionBBox ? 'gpon-выделение' : 'gpon-network';

  const activeCableTypes = useMemo(() => {
    const { cables: c } = exportSet();
    return CABLE_SIZES.filter((t) => c.some((x) => x.type === t));
  }, [districts, cables, selectionBBox, materials]);

  const setEntityLayer = (key: keyof Pick<KmzExportLayers, 'olt' | 'mufta' | 'ork' | 'subscribers' | 'summary'>, v: boolean) => {
    setKmzLayers((prev) => ({ ...prev, [key]: v }));
  };

  const setCableLayer = (type: CableType, v: boolean) => {
    setKmzLayers((prev) => ({
      ...prev,
      cables: { ...prev.cables, [type]: v },
    }));
  };

  const selectAllLayers = () => {
    setKmzLayers({
      olt: true, mufta: true, ork: true, subscribers: true, summary: true,
      cables: Object.fromEntries(CABLE_SIZES.map((t) => [t, true])) as Record<CableType, boolean>,
    });
  };

  const handleExcelExport = async () => {
    const { districts: d, cables: c, materials: m } = exportSet();
    const blob = await exportExcel(d, c, m);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectionBBox ? 'gpon-materials-выделение.xlsx' : 'gpon-materials.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runKmz = async (label: string, fn: () => Promise<void>) => {
    setKmzBusy(label);
    try {
      await fn();
    } finally {
      setKmzBusy(null);
    }
  };

  const handleKMZFull = () => runKmz('full', async () => {
    const { districts: d, cables: c } = exportSet();
    const blob = await exportKMZ(d, c, { layers: kmzLayers, flatCableFolders: true });
    downloadBlob(blob, `${filePrefix}.kmz`);
  });

  const handleKMZZip = (mode: KmzPackageMode) => runKmz('zip', async () => {
    const { districts: d, cables: c } = exportSet();
    const blob = await exportKMZPackage(d, c, kmzLayers, mode);
    const name = mode === 'split-by-type' ? `${filePrefix}-по-типам-ок.zip` : `${filePrefix}-полный+по-типам.zip`;
    downloadBlob(blob, name);
  });

  const handleKMZSplitFiles = () => runKmz('split', async () => {
    const { districts: d, cables: c } = exportSet();
    await downloadKMZSplitByType(d, c, kmzLayers, filePrefix);
  });

  const cableRows: Row[] = CABLE_SIZES
    .filter((t) => (materials.cables[t] || 0) > 0)
    .map((t) => ({ category: '', name: t, spec: `${t} G.652D`, qty: materials.cables[t] || 0, unit: 'м' }));

  const equipRows: Row[] = [
    { category: '', name: 'OLT', spec: 'Huawei MA5800-X7', qty: materials.equipment.oltUnits, unit: 'шт' },
    { category: '', name: 'Сплиттер L1', spec: 'PLC 1:4 SC/APC', qty: materials.equipment.splitter_1x4_L1, unit: 'шт' },
    { category: '', name: 'Сплиттер L2 1:4', spec: 'PLC 1:4 SC/APC', qty: materials.equipment.splitter_1x4_L2, unit: 'шт' },
    { category: '', name: 'Сплиттер L2 1:8', spec: 'PLC 1:8 SC/APC', qty: materials.equipment.splitter_1x8_L2, unit: 'шт' },
    { category: '', name: 'Муфта транзитная', spec: 'МТОК-96А IP68', qty: materials.equipment.muftaMTOK96A, unit: 'шт' },
    { category: '', name: 'Бокс распределительный', spec: 'IP55', qty: materials.equipment.boksCount, unit: 'шт' },
    { category: '', name: 'ONT терминал', spec: 'ZTE F601', qty: materials.equipment.ontZTE_F601, unit: 'шт' },
  ];

  const mountRows: Row[] = [
    { category: '', name: 'Пигтейл', spec: 'SC/APC 1м G.657A', qty: materials.equipment.pigtailSCAPC, unit: 'шт' },
    { category: '', name: 'Патч-корд', spec: 'SC/APC-SC/UPC 3м', qty: materials.equipment.patchcord, unit: 'шт' },
    { category: '', name: 'Гильзы КДЗС', spec: '40мм термоусадка', qty: materials.equipment.kdzsGilzy, unit: 'шт' },
    { category: '', name: 'Зажим анкерный', spec: 'СТС-10', qty: materials.equipment.clamps, unit: 'шт' },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg p-2 text-center">
            <div className="text-lg font-mono font-bold text-[#38bdf8]">
              {(materials.cables.total / 1000).toFixed(1)}
            </div>
            <div className="text-[10px] text-[#64748b]">км ВОЛС (с запасом)</div>
          </div>
          <div className="bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg p-2 text-center">
            <div className="text-lg font-mono font-bold text-[#34d399]">
              {materials.equipment.ontZTE_F601}
            </div>
            <div className="text-[10px] text-[#64748b]">абонентов</div>
          </div>
        </div>

        <Section title="Кабели ВОЛС" rows={cableRows} />
        <Section title="Оборудование" rows={equipRows} />
        <Section title="Монтаж" rows={mountRows} />

        <p className="text-[10px] text-[#64748b] mt-3 italic">* Длины с запасом +10% от маршрута</p>
      </div>

      <div className="p-3 border-t border-[#1e3a5f] space-y-2">
        {selectionBBox && (() => {
          const f = filterByBBox(districts, cables, joints ?? [], selectionBBox);
          return (
            <div className="p-2 bg-[#fbbf24]/10 border border-[#fbbf24]/40 rounded text-[10px] text-[#fbbf24]">
              🔲 Выделено: <b>{f.counts.olt}</b> OLT · <b>{f.counts.tb}</b> Муфт · <b>{f.counts.ork}</b> ОРК · <b>{f.counts.sub}</b> Аб. · <b>{f.counts.cable}</b> кабелей
            </div>
          );
        })()}

        <button
          type="button"
          onClick={handleExcelExport}
          className="w-full py-2 px-3 bg-[#0d1b2a] hover:bg-[#1a2744] border border-[#1e3a5f] rounded-lg text-xs text-[#e2e8f0] transition-colors flex items-center gap-2"
        >
          📊 {selectionBBox ? 'Excel (выделение)' : 'Экспорт в Excel'}
        </button>

        <button
          type="button"
          onClick={() => setShowKmzPanel((v) => !v)}
          className="w-full py-2 px-3 bg-[#0d1b2a] hover:bg-[#1a2744] border border-[#38bdf8]/40 rounded-lg text-xs text-[#e2e8f0] transition-colors flex items-center justify-between"
        >
          <span>🗺 Экспорт KMZ — слои и файлы</span>
          <span className="text-[#64748b]">{showKmzPanel ? '▲' : '▼'}</span>
        </button>

        {showKmzPanel && (
          <div className="p-2.5 bg-[#0a1020] border border-[#1e3a5f] rounded-lg space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-[#64748b]">Слои в файле</span>
              <button type="button" onClick={selectAllLayers} className="text-[10px] text-[#38bdf8] hover:underline">
                Все
              </button>
            </div>

            <div>
              <div className="text-[10px] text-[#64748b] mb-1">Объекты</div>
              <LayerCheckbox checked={kmzLayers.olt} onChange={(v) => setEntityLayer('olt', v)} label="📡 OLT" />
              <LayerCheckbox checked={kmzLayers.mufta} onChange={(v) => setEntityLayer('mufta', v)} label="🔷 Муфты МТОК — общий" />
              <LayerCheckbox checked={kmzLayers.ork} onChange={(v) => setEntityLayer('ork', v)} label="📦 ОРК / боксы — общий" />
              <LayerCheckbox checked={kmzLayers.subscribers} onChange={(v) => setEntityLayer('subscribers', v)} label="🏠 Абоненты — общий" />
              <LayerCheckbox checked={kmzLayers.summary} onChange={(v) => setEntityLayer('summary', v)} label="📋 Сводка (ОК-4 общий, ОК-8 общий…)" />
            </div>

            <div>
              <div className="text-[10px] text-[#64748b] mb-1">Кабели (каждый тип — один общий слой)</div>
              {CABLE_SIZES.map((t) => {
                const has = activeCableTypes.includes(t);
                return (
                  <LayerCheckbox
                    key={t}
                    checked={kmzLayers.cables[t] && has}
                    onChange={(v) => setCableLayer(t, v)}
                    label={`〰 ${t}${has ? '' : ' (нет в сети)'}`}
                  />
                );
              })}
            </div>

            <p className="text-[10px] text-[#64748b] leading-relaxed">
              В KMZ: один слой <b>ОК-4 — общий</b>, один <b>ОК-8 — общий</b> и т.д. Подписи: Муфта 1, ОРК 2, адрес абонента.
            </p>

            <div className="space-y-1.5 pt-1 border-t border-[#1e3a5f]">
              <button
                type="button"
                disabled={!!kmzBusy}
                onClick={handleKMZFull}
                className="w-full py-2 px-2 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 border border-[#38bdf8]/50 rounded-lg text-[#7dd3fc] font-medium disabled:opacity-50"
              >
                {kmzBusy === 'full' ? '…' : '📥 Один общий KMZ'}
              </button>
              <button
                type="button"
                disabled={!!kmzBusy}
                onClick={() => handleKMZZip('full-and-split')}
                className="w-full py-2 px-2 bg-[#0d1b2a] hover:bg-[#1a2744] border border-[#1e3a5f] rounded-lg text-[#e2e8f0] disabled:opacity-50"
              >
                {kmzBusy === 'zip' ? '…' : '📦 ZIP: общий + ОК-4.kmz, ОК-8.kmz…'}
              </button>
              <button
                type="button"
                disabled={!!kmzBusy}
                onClick={handleKMZSplitFiles}
                className="w-full py-2 px-2 bg-[#0d1b2a] hover:bg-[#1a2744] border border-[#1e3a5f] rounded-lg text-[#e2e8f0] disabled:opacity-50"
              >
                {kmzBusy === 'split' ? '…' : '📂 Отдельные KMZ: ОК-4.kmz, ОК-8.kmz…'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
