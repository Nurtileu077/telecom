import { District, Cable, Materials, CABLE_SIZES } from '@/types/network';

export async function exportExcel(districts: District[], cables: Cable[], materials: Materials): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // Sheet 1: Materials — cables
  const matRows: (string | number)[][] = [
    ['Категория', 'Наименование', 'Марка/Тип', 'Кол-во', 'Ед.', 'Примечание'],
  ];
  for (const t of CABLE_SIZES) {
    const qty = materials.cables[t] || 0;
    if (qty === 0) continue;
    const fibers = parseInt(t.replace('ОК-', ''));
    matRows.push(['Кабель ВОЛС', `Кабель ${t}`, `${t} G.652D (${fibers} вол.)`, qty, 'м', 'с запасом']);
  }
  matRows.push(
    ['Оборудование', 'OLT', 'Huawei MA5800-X7 / ZTE C300', materials.equipment.oltUnits, 'шт', ''],
    ['Оборудование', 'Сплиттер L1 1:4', 'PLC 1:4 SC/APC', materials.equipment.splitter_1x4_L1, 'шт', ''],
    ['Оборудование', 'Сплиттер L2 1:4', 'PLC 1:4 SC/APC', materials.equipment.splitter_1x4_L2, 'шт', ''],
    ['Оборудование', 'Сплиттер L2 1:8', 'PLC 1:8 SC/APC', materials.equipment.splitter_1x8_L2, 'шт', ''],
    ['Оборудование', 'Сплиттер L2 1:16', 'PLC 1:16 SC/APC', materials.equipment.splitter_1x16_L2, 'шт', ''],
    ['Оборудование', 'Муфта транзитная', 'МТОК-96А IP68', materials.equipment.muftaMTOK96A, 'шт', ''],
    ['Оборудование', 'Бокс распределительный', 'Бокс IP55', materials.equipment.boksCount, 'шт', ''],
    ['Оборудование', 'ONT терминал', 'ZTE F601 / Huawei HG8310M', materials.equipment.ontZTE_F601, 'шт', ''],
    ['Монтаж', 'Пигтейл SC/APC', 'SC/APC 1м G.657A', materials.equipment.pigtailSCAPC, 'шт', ''],
    ['Монтаж', 'Патч-корд', 'SC/APC-SC/UPC 3м', materials.equipment.patchcord, 'шт', ''],
    ['Монтаж', 'Гильзы КДЗС', '40мм термоусадка', materials.equipment.kdzsGilzy, 'шт', ''],
    ['Монтаж', 'Зажим анкерный', 'СТС-10', materials.equipment.clamps, 'шт', ''],
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matRows), 'Материалы');

  // Sheet 2: Subscribers
  const subRows: (string | number)[][] = [['№', 'Район', 'Бокс', 'Адрес', 'Широта', 'Долгота', 'Волокна раб.', 'Волокна зап.', 'ONT']];
  let n = 1;
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        for (const sub of ork.subscribers) {
          subRows.push([n++, d.name, ork.id, sub.desc, sub.lat, sub.lon, sub.fibers.working, sub.fibers.spare, 'ZTE F601']);
        }
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(subRows), 'Абоненты');

  // Sheet 3: Boxes (ORKs)
  const orkRows: (string | number)[][] = [['№', 'Район', 'Бокс ID', 'Широта', 'Долгота', 'Сплиттер', 'Або.', 'Муфта', 'Тип бокса']];
  let on = 1;
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        orkRows.push([on++, d.name, ork.id, ork.lat, ork.lon, ork.splitter, ork.subscribers.length, tb.id, ork.boxType || 'Бокс']);
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(orkRows), 'Боксы');

  // Sheet 4: Cables
  const cableRows: (string | number)[][] = [['№', 'Тип', 'Волокон', 'От', 'До', 'Длина (м)', 'Длина+10% (м)', 'Маршрут']];
  cables.forEach((c, i) => {
    cableRows.push([i + 1, c.type, c.fibers, c.fromId, c.toId, Math.round(c.lengthM), Math.round(c.lengthM * 1.1), c.routedByOSRM ? 'по дорогам' : 'прямая']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cableRows), 'Кабели');

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
