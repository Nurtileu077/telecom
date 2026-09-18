import { Materials, PriceCatalog, CABLE_SIZES } from '@/types/network';

export interface CostLine {
  /** стабильный id строки (для ручных правок количества) */
  id: string;
  /** путь к цене в PriceCatalog (для инлайн-редактирования цены) */
  priceKey: string;
  name: string;
  qty: number;
  /** авто-количество из расчёта (до ручной правки) */
  autoQty: number;
  unit: string;
  unitPrice: number;
  total: number;
}

export interface CostBreakdown {
  cables: CostLine[];
  equipment: CostLine[];
  labor: CostLine;
  subtotalCables: number;
  subtotalEquipment: number;
  subtotalLabor: number;
  grandTotal: number;
  currency: string;
}

export function calculateCost(materials: Materials, prices: PriceCatalog): CostBreakdown {
  const ov = prices.qtyOverrides ?? {};
  const qty = (id: string, auto: number) => (ov[id] != null ? ov[id] : auto);

  const cables: CostLine[] = CABLE_SIZES.map((t) => {
    const id = `cable:${t}`;
    const autoQty = materials.cables[t] || 0;
    const q = qty(id, autoQty);
    const unitPrice = prices.cables[t] || 0;
    return { id, priceKey: `cables.${t}`, name: t, qty: q, autoQty, unit: 'м', unitPrice, total: q * unitPrice };
  }).filter((r) => r.qty > 0 || r.autoQty > 0);

  const eqDefs: { id: string; priceKey: keyof PriceCatalog; name: string; auto: number; unitPrice: number }[] = [
    { id: 'olt', priceKey: 'olt', name: 'OLT Huawei MA5800-X7', auto: materials.equipment.oltUnits, unitPrice: prices.olt },
    { id: 'splitter_1x4', priceKey: 'splitter_1x4', name: 'Сплиттер 1:4', auto: materials.equipment.splitter_1x4_L1 + materials.equipment.splitter_1x4_L2, unitPrice: prices.splitter_1x4 },
    { id: 'splitter_1x8', priceKey: 'splitter_1x8', name: 'Сплиттер 1:8', auto: materials.equipment.splitter_1x8_L1 + materials.equipment.splitter_1x8_L2, unitPrice: prices.splitter_1x8 },
    { id: 'splitter_1x16', priceKey: 'splitter_1x16', name: 'Сплиттер 1:16', auto: materials.equipment.splitter_1x16_L2, unitPrice: prices.splitter_1x16 },
    { id: 'mufta', priceKey: 'mufta', name: 'Муфта МТОК-96А', auto: materials.equipment.muftaMTOK96A, unitPrice: prices.mufta },
    { id: 'boks', priceKey: 'boks', name: 'Бокс распределительный', auto: materials.equipment.boksCount, unitPrice: prices.boks },
    { id: 'ont', priceKey: 'ont', name: 'ONT ZTE F601', auto: materials.equipment.ontZTE_F601, unitPrice: prices.ont },
    { id: 'pigtail', priceKey: 'pigtail', name: 'Пигтейл SC/APC', auto: materials.equipment.pigtailSCAPC, unitPrice: prices.pigtail },
    { id: 'patchcord', priceKey: 'patchcord', name: 'Патч-корд', auto: materials.equipment.patchcord, unitPrice: prices.patchcord },
    { id: 'kdzs', priceKey: 'kdzs', name: 'Гильза КДЗС', auto: materials.equipment.kdzsGilzy, unitPrice: prices.kdzs },
    { id: 'clamp', priceKey: 'clamp', name: 'Анкерный зажим', auto: materials.equipment.clamps, unitPrice: prices.clamp },
  ];
  const equipment: CostLine[] = eqDefs.map((d) => {
    const q = qty(d.id, d.auto);
    return { id: d.id, priceKey: d.priceKey, name: d.name, qty: q, autoQty: d.auto, unit: 'шт', unitPrice: d.unitPrice, total: q * d.unitPrice };
  });

  const subtotalCables = cables.reduce((s, c) => s + c.total, 0);
  const subtotalEquipment = equipment.reduce((s, e) => s + e.total, 0);
  const autoMeters = cables.reduce((s, c) => s + c.qty, 0);
  const laborQty = qty('labor', Math.round(autoMeters));
  const labor: CostLine = {
    id: 'labor', priceKey: 'installLabor', name: 'Прокладка кабеля', qty: laborQty, autoQty: Math.round(autoMeters),
    unit: 'м', unitPrice: prices.installLabor, total: laborQty * prices.installLabor,
  };
  const subtotalLabor = labor.total;
  const grandTotal = subtotalCables + subtotalEquipment + subtotalLabor;

  return { cables, equipment, labor, subtotalCables, subtotalEquipment, subtotalLabor, grandTotal, currency: prices.currency };
}

export function formatMoney(n: number, currency = '₸'): string {
  return `${Math.round(n).toLocaleString('ru')} ${currency}`;
}
