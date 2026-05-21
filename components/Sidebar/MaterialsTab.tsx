'use client';
import { useState } from 'react';
import { Materials, District, Cable, CABLE_SIZES, InlineJoint } from '@/types/network';
import { exportExcel } from '@/components/Export/ExportExcel';
import { exportKMZ, ALL_LAYERS, LAYER_LABEL, type KmzLayer } from '@/components/Export/ExportKMZ';
import { filterByBBox, type BBox } from '@/components/Network/Selection';
import { calculateMaterials } from '@/components/Network/MaterialCalc';

interface Props {
  materials: Materials | null;
  districts: District[];
  cables: Cable[];
  joints?: InlineJoint[];
  selectionBBox?: BBox | null;
  // Settings is needed to recalculate materials for the filtered subset.
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

export default function MaterialsTab({ materials, districts, cables, joints, selectionBBox, cableReserve = 1.10 }: Props) {
  const [kmzLayers, setKmzLayers] = useState<KmzLayer[]>([...ALL_LAYERS]);
  const [kmzSeparate, setKmzSeparate] = useState(false);
  const toggleKmzLayer = (l: KmzLayer) =>
    setKmzLayers((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));

  if (!materials) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">📦</div>
        <p className="text-sm text-[#94a3b8]">Импортируйте данные и постройте сеть для расчёта материалов</p>
      </div>
    );
  }

  // When a bbox is active, exports send only the subset that falls inside.
  // Materials are recomputed for that subset — using the project's saved
  // cableReserve so reserve-padded totals stay consistent with the sidebar.
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

  const handleExcelExport = async () => {
    const { districts: d, cables: c, materials: m } = exportSet();
    const blob = await exportExcel(d, c, m);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectionBBox ? 'optiq-materials-выделение.xlsx' : 'optiq-materials.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleKMZExport = async () => {
    if (kmzLayers.length === 0) return;
    const { districts: d, cables: c } = exportSet();
    const blob = await exportKMZ(d, c, { layers: kmzLayers, separate: kmzSeparate });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = selectionBBox ? '-выделение' : '';
    a.download = kmzSeparate ? `optiq-network-слои${suffix}.zip` : `optiq-network${suffix}.kmz`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        {/* Summary */}
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

      {/* Export buttons */}
      <div className="p-3 border-t border-[#1e3a5f] space-y-2">
        {selectionBBox && (() => {
          const f = filterByBBox(districts, cables, joints ?? [], selectionBBox);
          return (
            <div className="p-2 bg-[#fbbf24]/10 border border-[#fbbf24]/40 rounded text-[10px] text-[#fbbf24]">
              🔲 Выделено: <b>{f.counts.olt}</b> OLT · <b>{f.counts.tb}</b> Муфт · <b>{f.counts.ork}</b> ОРК · <b>{f.counts.sub}</b> Аб. · <b>{f.counts.cable}</b> кабелей
              <div className="text-[#94a3b8] mt-0.5">Экспорт пойдёт только по этой области.</div>
            </div>
          );
        })()}
        <button
          onClick={handleExcelExport}
          className="w-full py-2 px-3 bg-[#0d1b2a] hover:bg-[#1a2744] border border-[#1e3a5f] rounded-lg text-xs text-[#e2e8f0] transition-colors flex items-center gap-2"
        >
          📊 {selectionBBox ? 'Excel (выделение)' : 'Экспорт в Excel'}
        </button>
        <div className="p-2 bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-[#64748b]">Слои KMZ</div>
          <div className="grid grid-cols-2 gap-1">
            {ALL_LAYERS.map((l) => (
              <label key={l} className="flex items-center gap-1.5 text-[11px] text-[#e2e8f0] cursor-pointer">
                <input
                  type="checkbox"
                  checked={kmzLayers.includes(l)}
                  onChange={() => toggleKmzLayer(l)}
                  className="accent-[#38bdf8]"
                />
                {LAYER_LABEL[l]}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-[#94a3b8] cursor-pointer pt-1 border-t border-[#1e3a5f]">
            <input
              type="checkbox"
              checked={kmzSeparate}
              onChange={(e) => setKmzSeparate(e.target.checked)}
              className="accent-[#38bdf8]"
            />
            Отдельными файлами по слоям (.zip)
          </label>
        </div>
        <button
          onClick={handleKMZExport}
          disabled={kmzLayers.length === 0}
          className="w-full py-2 px-3 bg-[#0d1b2a] hover:bg-[#1a2744] border border-[#1e3a5f] rounded-lg text-xs text-[#e2e8f0] transition-colors flex items-center gap-2 disabled:opacity-40"
        >
          🗺 {kmzSeparate ? 'Экспорт KMZ по слоям' : selectionBBox ? 'KMZ (выделение)' : 'Экспорт в KMZ'}
        </button>
      </div>
    </div>
  );
}
