import { District, Cable, Materials } from '@/types/network';

export async function exportExcel(districts: District[], cables: Cable[], materials: Materials): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // Sheet 1: Materials
  const matRows = [
    ['Категория', 'Наименование', 'Марка/Тип', 'Кол-во', 'Ед.', 'Примечание'],
    ['Кабель ВОЛС', 'Магістральный кабель', 'ОКБ-10 G.652D', materials.cables['ОКБ-10'], 'м', 'с запасом 10%'],
    ['Кабель ВОЛС', 'Распределительный', 'ОКСНН-8 G.652D', materials.cables['ОКСНН-8'], 'м', ''],
    ['Кабель ВОЛС', 'Питающий', 'ОКСНН-4 G.652D', materials.cables['ОКСНН-4'], 'м', ''],
    ['Кабель ВОЛС', 'Абонентский дроп', 'ОКА-2 G.657A', materials.cables['ОКА-2'], 'м', '2 раб.+1 зап.'],
    ['Оборудование', 'OLT', 'Huawei MA5800-X7', materials.equipment.oltUnits, 'шт', ''],
    ['Оборудование', 'Сплиттер L1', 'PLC 1:4 SC/APC', materials.equipment.splitter_1x4_L1, 'шт', ''],
    ['Оборудование', 'Сплиттер L2 1:4', 'PLC 1:4 SC/APC', materials.equipment.splitter_1x4_L2, 'шт', ''],
    ['Оборудование', 'Сплиттер L2 1:8', 'PLC 1:8 SC/APC', materials.equipment.splitter_1x8_L2, 'шт', ''],
    ['Оборудование', 'Сплиттер L2 1:16', 'PLC 1:16 SC/APC', materials.equipment.splitter_1x16_L2, 'шт', ''],
    ['Оборудование', 'Муфта транзитная', 'МТОК-96А IP68', materials.equipment.muftaMTOK96A, 'шт', ''],
    ['Оборудование', 'ОРК шкаф', 'ОРК IP55', materials.equipment.orkBox, 'шт', ''],
    ['Оборудование', 'Бокс абонентский', 'ОРБ-32 (ОК4)', materials.equipment.boxORB32, 'шт', ''],
    ['Оборудование', 'ONT терминал', 'ZTE F601', materials.equipment.ontZTE_F601, 'шт', ''],
    ['Монтаж', 'Пигтейл', 'SC/APC 1м G.657A', materials.equipment.pigtailSCAPC, 'шт', ''],
    ['Монтаж', 'Патч-корд', 'SC/APC-SC/UPC 3м', materials.equipment.patchcord, 'шт', ''],
    ['Монтаж', 'Гильзы КДЗС', '40мм термоусадка', materials.equipment.kdzsGilzy, 'шт', ''],
    ['Монтаж', 'Зажим анкерный', 'СТС-10', materials.equipment.clamps, 'шт', ''],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(matRows);
  XLSX.utils.book_append_sheet(wb, ws1, 'Материалы');

  // Sheet 2: Subscribers
  const subRows: (string | number)[][] = [['№', 'Район', 'ОРК', 'Адрес', 'Широта', 'Долгота', 'Волокна', 'Кабель', 'ONT']];
  let n = 1;
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        for (const sub of ork.subscribers) {
          subRows.push([n++, d.name, ork.id, sub.desc, sub.lat, sub.lon, `${sub.fibers.working}+${sub.fibers.spare}`, 'ОКА-2', 'ZTE F601']);
        }
      }
    }
  }
  const ws2 = XLSX.utils.aoa_to_sheet(subRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Абоненты');

  // Sheet 3: ORKs
  const orkRows: (string | number)[][] = [['№', 'Район', 'ОРК ID', 'Широта', 'Долгота', 'Сплиттер', 'Або.', 'Тр.Муфта', 'Кабель']];
  let on = 1;
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        orkRows.push([on++, d.name, ork.id, ork.lat, ork.lon, ork.splitter, ork.subscribers.length, tb.id, 'ОКСНН-4']);
      }
    }
  }
  const ws3 = XLSX.utils.aoa_to_sheet(orkRows);
  XLSX.utils.book_append_sheet(wb, ws3, 'ОРК шкафы');

  // Sheet 4: Cables
  const cableRows: (string | number)[][] = [['№', 'Тип', 'От', 'До', 'Длина (м)', 'Длина+10%', 'Волокон', 'Маршрут']];
  cables.forEach((c, i) => {
    cableRows.push([i + 1, c.type, c.fromId, c.toId, Math.round(c.lengthM), Math.round(c.lengthM * 1.1), c.fibers, c.routedByOSRM ? 'по дорогам' : 'прямая']);
  });
  const ws4 = XLSX.utils.aoa_to_sheet(cableRows);
  XLSX.utils.book_append_sheet(wb, ws4, 'Кабели');

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
