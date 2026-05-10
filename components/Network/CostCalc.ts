import { Materials, PriceCatalog } from '@/types/network';

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
  const cables = [
    { type: 'ОКБ-10', qty: materials.cables['ОКБ-10'], unit: 'м', unitPrice: prices.cables['ОКБ-10'], total: materials.cables['ОКБ-10'] * prices.cables['ОКБ-10'] },
    { type: 'ОКСНН-8', qty: materials.cables['ОКСНН-8'], unit: 'м', unitPrice: prices.cables['ОКСНН-8'], total: materials.cables['ОКСНН-8'] * prices.cables['ОКСНН-8'] },
    { type: 'ОКСНН-4', qty: materials.cables['ОКСНН-4'], unit: 'м', unitPrice: prices.cables['ОКСНН-4'], total: materials.cables['ОКСНН-4'] * prices.cables['ОКСНН-4'] },
    { type: 'ОКА-2', qty: materials.cables['ОКА-2'], unit: 'м', unitPrice: prices.cables['ОКА-2'], total: materials.cables['ОКА-2'] * prices.cables['ОКА-2'] },
  ];

  const equipment = [
    { name: 'OLT Huawei MA5800-X7', qty: materials.equipment.oltUnits, unit: 'шт', unitPrice: prices.olt, total: materials.equipment.oltUnits * prices.olt },
    { name: 'Сплиттер 1:4', qty: materials.equipment.splitter_1x4_L1 + materials.equipment.splitter_1x4_L2, unit: 'шт', unitPrice: prices.splitter_1x4, total: (materials.equipment.splitter_1x4_L1 + materials.equipment.splitter_1x4_L2) * prices.splitter_1x4 },
    { name: 'Сплиттер 1:8', qty: materials.equipment.splitter_1x8_L2, unit: 'шт', unitPrice: prices.splitter_1x8, total: materials.equipment.splitter_1x8_L2 * prices.splitter_1x8 },
    { name: 'Сплиттер 1:16', qty: materials.equipment.splitter_1x16_L2, unit: 'шт', unitPrice: prices.splitter_1x16, total: materials.equipment.splitter_1x16_L2 * prices.splitter_1x16 },
    { name: 'Муфта МТОК-96А', qty: materials.equipment.muftaMTOK96A, unit: 'шт', unitPrice: prices.mufta, total: materials.equipment.muftaMTOK96A * prices.mufta },
    { name: 'ОРК шкаф', qty: materials.equipment.orkBox, unit: 'шт', unitPrice: prices.orkBox, total: materials.equipment.orkBox * prices.orkBox },
    { name: 'Бокс ОРБ-32', qty: materials.equipment.boxORB32, unit: 'шт', unitPrice: prices.ontBox, total: materials.equipment.boxORB32 * prices.ontBox },
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
