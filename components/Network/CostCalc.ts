import { Materials, PriceCatalog, CABLE_SIZES } from '@/types/network';

export interface CostBreakdown {
  cables: { type: string; qty: number; unit: string; unitPrice: number; total: number }[];
  equipment: { name: string; qty: number; unit: string; unitPrice: number; total: number }[];
  subtotalCables: number;
  subtotalEquipment: number;
  subtotalLabor: number;
  grandTotal: number;
  currency: string;
}

export function calculateCost(materials: Materials, prices: PriceCatalog): CostBreakdown {
  const cables = CABLE_SIZES.map((t) => ({
    type: t,
    qty: materials.cables[t] || 0,
    unit: 'м',
    unitPrice: prices.cables[t] || 0,
    total: (materials.cables[t] || 0) * (prices.cables[t] || 0),
  })).filter((r) => r.qty > 0);

  const equipment = [
    { name: 'OLT Huawei MA5800-X7', qty: materials.equipment.oltUnits, unit: 'шт', unitPrice: prices.olt, total: materials.equipment.oltUnits * prices.olt },
    { name: 'Сплиттер 1:4', qty: materials.equipment.splitter_1x4_L1 + materials.equipment.splitter_1x4_L2, unit: 'шт', unitPrice: prices.splitter_1x4, total: (materials.equipment.splitter_1x4_L1 + materials.equipment.splitter_1x4_L2) * prices.splitter_1x4 },
    { name: 'Сплиттер 1:8', qty: materials.equipment.splitter_1x8_L2, unit: 'шт', unitPrice: prices.splitter_1x8, total: materials.equipment.splitter_1x8_L2 * prices.splitter_1x8 },
    { name: 'Сплиттер 1:16', qty: materials.equipment.splitter_1x16_L2, unit: 'шт', unitPrice: prices.splitter_1x16, total: materials.equipment.splitter_1x16_L2 * prices.splitter_1x16 },
    { name: 'Муфта МТОК-96А', qty: materials.equipment.muftaMTOK96A, unit: 'шт', unitPrice: prices.mufta, total: materials.equipment.muftaMTOK96A * prices.mufta },
    { name: 'Бокс распределительный', qty: materials.equipment.boksCount, unit: 'шт', unitPrice: prices.boks, total: materials.equipment.boksCount * prices.boks },
    { name: 'ONT ZTE F601', qty: materials.equipment.ontZTE_F601, unit: 'шт', unitPrice: prices.ont, total: materials.equipment.ontZTE_F601 * prices.ont },
    { name: 'Пигтейл SC/APC', qty: materials.equipment.pigtailSCAPC, unit: 'шт', unitPrice: prices.pigtail, total: materials.equipment.pigtailSCAPC * prices.pigtail },
    { name: 'Патч-корд', qty: materials.equipment.patchcord, unit: 'шт', unitPrice: prices.patchcord, total: materials.equipment.patchcord * prices.patchcord },
    { name: 'Гильза КДЗС', qty: materials.equipment.kdzsGilzy, unit: 'шт', unitPrice: prices.kdzs, total: materials.equipment.kdzsGilzy * prices.kdzs },
    { name: 'Анкерный зажим', qty: materials.equipment.clamps, unit: 'шт', unitPrice: prices.clamp, total: materials.equipment.clamps * prices.clamp },
  ];

  const subtotalCables = cables.reduce((s, c) => s + c.total, 0);
  const subtotalEquipment = equipment.reduce((s, e) => s + e.total, 0);
  const totalMeters = cables.reduce((s, c) => s + c.qty, 0);
  const subtotalLabor = totalMeters * prices.installLabor;
  const grandTotal = subtotalCables + subtotalEquipment + subtotalLabor;

  return { cables, equipment, subtotalCables, subtotalEquipment, subtotalLabor, grandTotal, currency: prices.currency };
}

export function formatMoney(n: number, currency = '₸'): string {
  return `${Math.round(n).toLocaleString('ru')} ${currency}`;
}
