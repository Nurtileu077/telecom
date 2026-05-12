'use client';
import { Materials, District, Cable, CABLE_SIZES, ProjectSettings } from '@/types/network';
import { exportExcel } from '@/components/Export/ExportExcel';
import { exportKMZ } from '@/components/Export/ExportKMZ';

interface Props {
  materials: Materials | null;
  districts: District[];
  cables: Cable[];
  settings: ProjectSettings;
}

interface Row {
  name: string;
  spec: string;
  qty: number;
  unit: string;
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  const visible = rows.filter((r) => r.qty > 0);
  if (visible.length === 0) return null;
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2 pt-3">{title}</h3>
      <div className="space-y-1">
        {visible.map((row, i) => (
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

export default function MaterialsTab({ materials, districts, cables, settings }: Props) {
  if (!materials) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">📦</div>
        <p className="text-sm text-[#94a3b8]">Импортируйте данные и постройте сеть для расчёта материалов</p>
      </div>
    );
  }

  const isP2P = settings.networkType === 'p2p';
  const eq = materials.equipment;

  const handleExcelExport = async () => {
    const blob = await exportExcel(districts, cables, materials);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isP2P ? 'p2p-materials.xlsx' : 'gpon-materials.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleKMZExport = async () => {
    const blob = await exportKMZ(districts, cables);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'network.kmz';
    a.click();
    URL.revokeObjectURL(url);
  };

  const cableRows: Row[] = CABLE_SIZES
    .filter((t) => (materials.cables[t] || 0) > 0)
    .map((t) => ({ name: t, spec: `${t} G.652D одномод.`, qty: materials.cables[t] || 0, unit: 'м' }));

  // Equipment differs between P2P and GPON
  const equipRows: Row[] = isP2P ? [
    { name: 'Узел связи (УС)', spec: 'Шкаф ОРМ / кросс оптический', qty: eq.usCount, unit: 'шт' },
    { name: 'Муфта транзитная', spec: 'МТОК-96А IP68', qty: eq.muftaMTOK96A, unit: 'шт' },
    { name: 'Бокс распределительный', spec: 'БОКС-24 IP55', qty: eq.boksCount, unit: 'шт' },
    { name: 'ONT / медиаконвертер', spec: 'для камер/АПК (SFP + порт)', qty: eq.ontZTE_F601, unit: 'шт' },
    { name: 'CPE / роутер', spec: 'для абонентов (ONT роутер)', qty: eq.cpeCount, unit: 'шт' },
  ] : [
    { name: 'OLT', spec: 'Huawei MA5800-X7', qty: eq.oltUnits, unit: 'шт' },
    { name: 'Сплиттер L1', spec: 'PLC 1:4 SC/APC', qty: eq.splitter_1x4_L1, unit: 'шт' },
    { name: 'Сплиттер L2 1:4', spec: 'PLC 1:4 SC/APC', qty: eq.splitter_1x4_L2, unit: 'шт' },
    { name: 'Сплиттер L2 1:8', spec: 'PLC 1:8 SC/APC', qty: eq.splitter_1x8_L2, unit: 'шт' },
    { name: 'Сплиттер L2 1:16', spec: 'PLC 1:16 SC/APC', qty: eq.splitter_1x16_L2, unit: 'шт' },
    { name: 'Муфта транзитная', spec: 'МТОК-96А IP68', qty: eq.muftaMTOK96A, unit: 'шт' },
    { name: 'Бокс / ОРК', spec: 'IP55', qty: eq.boksCount, unit: 'шт' },
    { name: 'ONT терминал', spec: 'ZTE F601', qty: eq.ontZTE_F601, unit: 'шт' },
  ];

  const mountRows: Row[] = [
    { name: 'Пигтейл', spec: 'SC/APC 1м G.657A', qty: eq.pigtailSCAPC, unit: 'шт' },
    { name: 'Патч-корд', spec: 'SC/APC–SC/UPC 3м', qty: eq.patchcord, unit: 'шт' },
    { name: 'Гильзы КДЗС', spec: '40мм термоусадка', qty: eq.kdzsGilzy, unit: 'шт' },
    { name: 'Зажим анкерный', spec: 'СТС-10 (воздушный кабель)', qty: eq.clamps, unit: 'шт' },
  ];

  const totalObjects = isP2P ? (eq.ontZTE_F601 + eq.cpeCount) : eq.ontZTE_F601;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3">
        {/* Mode badge */}
        <div className={`text-center text-[10px] font-semibold py-1 px-2 rounded mb-2 ${
          isP2P
            ? 'bg-[#38bdf8]/10 border border-[#38bdf8]/30 text-[#38bdf8]'
            : 'bg-[#34d399]/10 border border-[#34d399]/30 text-[#34d399]'
        }`}>
          {isP2P ? '⚡ Режим P2P — прямое волокно' : '🌿 Режим GPON — пассивная сеть'}
        </div>

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
              {totalObjects}
            </div>
            <div className="text-[10px] text-[#64748b]">{isP2P ? 'объектов' : 'абонентов'}</div>
          </div>
        </div>

        {/* Object type breakdown */}
        {isP2P && (
          <div className="grid grid-cols-2 gap-1.5 mb-2">
            {(Object.entries(materials.byObjectType) as [string, number][])
              .filter(([, n]) => n > 0)
              .map(([type, count]) => {
                const icons: Record<string, string> = { абонент: '🏠', камера: '📷', база: '📡', офис: '🏢' };
                return (
                  <div key={type} className="bg-[#0d1b2a] border border-[#1e3a5f] rounded p-1.5 flex items-center gap-1.5">
                    <span className="text-xs">{icons[type] || '📍'}</span>
                    <div>
                      <div className="text-[10px] font-mono font-bold text-[#e2e8f0]">{count}</div>
                      <div className="text-[9px] text-[#64748b]">{type}</div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        <Section title="Кабели ВОЛС" rows={cableRows} />
        <Section title="Оборудование" rows={equipRows} />
        <Section title="Монтаж" rows={mountRows} />

        <p className="text-[10px] text-[#64748b] mt-3 italic">* Длины кабеля с запасом +{Math.round((settings.cableReserve - 1) * 100)}% от маршрута</p>
      </div>

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
