'use client';
import { Materials, District, Cable, CABLE_SIZES } from '@/types/network';
import { exportExcel } from '@/components/Export/ExportExcel';
import { exportKMZ } from '@/components/Export/ExportKMZ';

interface Props {
  materials: Materials | null;
  districts: District[];
  cables: Cable[];
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

export default function MaterialsTab({ materials, districts, cables }: Props) {
  if (!materials) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">📦</div>
        <p className="text-sm text-[#94a3b8]">Импортируйте данные и постройте сеть для расчёта материалов</p>
      </div>
    );
  }

  const handleExcelExport = async () => {
    const blob = await exportExcel(districts, cables, materials);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gpon-materials.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleKMZExport = async () => {
    const blob = await exportKMZ(districts, cables);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gpon-network.kmz';
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
        <button
          onClick={handleExcelExport}
          className="w-full py-2 px-3 bg-[#0d1b2a] hover:bg-[#1a2744] border border-[#1e3a5f] rounded-lg text-xs text-[#e2e8f0] transition-colors flex items-center gap-2"
        >
          📊 Экспорт в Excel
        </button>
        <button
          onClick={handleKMZExport}
          className="w-full py-2 px-3 bg-[#0d1b2a] hover:bg-[#1a2744] border border-[#1e3a5f] rounded-lg text-xs text-[#e2e8f0] transition-colors flex items-center gap-2"
        >
          🗺 Экспорт в KMZ
        </button>
      </div>
    </div>
  );
}
