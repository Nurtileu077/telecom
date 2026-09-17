import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseJournalBuffer } from './JournalImport';

/**
 * Тест собирает книгу той же формы, что рабочий журнал СНП,
 * и проверяет разбор: км→метры, порядок координат, даты, материалы.
 */

function buildWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  // «Все СНП заказа» — шапка не в первой строке, как в оригинале
  const orders = [
    [], [], [],
    ['КАТО', 'Область', 'Район', 'Сельский округ', 'СНП', 'Год',
     'Начала СМР', 'Завершение СМР', 'Кол-во ГУ', 'Технология', 'ПЛАН ВОЛС (км)', 'МКТ, км'],
    ['191234567', 'Акмолинская область', 'Аршалынский', 'Еленовский', 'Еленовка', 2026,
     new Date(Date.UTC(2026, 4, 12)), new Date(Date.UTC(2026, 8, 30)), 4, 'МКТ', 12.5, 11.2],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(orders), 'Все СНП заказа');

  // «DATA» — дневная выработка подземки
  const data = [
    ['Дата', 'СМУ', 'Область', 'Участок', 'КАТО', 'Тип технологии',
     'Кабелеукладчиком, км', 'Мех. способом (экскаватор), км', 'Ручным способом, км',
     'ГНБ/ГНП, км', 'ГНБ/ГНП, шт', 'Задувка ОК, км',
     'МКТ, км', 'Лента, км', 'Муфта, шт', 'ФИТИНГ, шт'],
    [new Date(Date.UTC(2026, 5, 1)), 'СМУ-2', 'Акмолинская область', 'сущ. ОМ - Еленовка', '191234567', 'МКТ',
     1.234, 0.5, 0.05, 0.072, 2, 0, 1.8, 0.4, 3, 12],
    // пустая строка — не должна попасть в результат
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'DATA');

  // «DATA ПОДВЕС»
  const aerial = [
    ['Дата', 'СМУ', 'Область', 'Район', 'Участок', 'КАТО',
     'Подвес кабеля (км)', 'Подвес кабеля ОК8, км', 'ОПОРЫ, шт', 'Зажим анкерный РА, шт'],
    [new Date(Date.UTC(2026, 5, 2)), 'СМУ-3', 'Костанайская область', 'Алтынсаринский', 'Убаган - Щербаково', '391112233',
     2.4, 2.4, 60, 120],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aerial), 'DATA ПОДВЕС');

  // «ГНБ Журнал» — шапка в третьей строке, координаты текстом
  const drills = [
    [], [],
    ['Дата', 'КАТО', 'Участок', 'Протяженность, км', 'Координаты', 'Примечание', 'Технология', 'Количество', 'область'],
    [new Date(Date.UTC(2026, 5, 3)), '471234567', 'Шетпе - Тиген', 0.072,
     'Координаты:\n1. 52.091435,44.480565 (72м);', 'Переход ГНБ через а/дорогу', 'ГНБ', 1, 'Мангистауская область'],
    [new Date(Date.UTC(2026, 5, 4)), '471234567', 'Шетпе - Тиген', 0.018,
     'ГНП через асфальт улицу-18м', 'ГНП через асфальт', 'ГНП', 1, 'Мангистауская область'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drills), 'ГНБ Журнал');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

describe('импорт рабочего журнала СНП', () => {
  it('читает все четыре рабочих листа', async () => {
    const r = await parseJournalBuffer(buildWorkbook());
    expect(r.stats.orderRows).toBe(1);
    expect(r.stats.groundRows).toBe(1);
    expect(r.stats.aerialRows).toBe(1);
    expect(r.stats.drillRows).toBe(2);
    expect(r.warnings).toHaveLength(0);
  });

  it('находит шапку, даже когда она не в первой строке', async () => {
    const r = await parseJournalBuffer(buildWorkbook());
    expect(r.orders[0].snp).toBe('Еленовка');
    expect(r.orders[0].kato).toBe('191234567');
    expect(r.drills[0].uchastok).toBe('Шетпе - Тиген');
  });

  it('переводит километры в целые метры', async () => {
    const r = await parseJournalBuffer(buildWorkbook());
    const g = r.ground[0];
    expect(g.byMethod['кабелеукладчик']).toBe(1234);
    expect(g.byMethod['экскаватор']).toBe(500);
    expect(g.byMethod['вручную']).toBe(50);
    expect(g.drillM).toBe(72);
    expect(r.orders[0].planVolsM).toBe(12500);
  });

  it('различает материалы в метрах и в штуках', async () => {
    const r = await parseJournalBuffer(buildWorkbook());
    const m = r.ground[0].materials;
    expect(m['МКТ']).toBe(1800);    // 1.8 км → метры
    expect(m['Лента']).toBe(400);   // 0.4 км → метры
    expect(m['Муфта']).toBe(3);     // штуки как есть
    expect(m['ФИТИНГ']).toBe(12);
  });

  it('приводит даты к YYYY-MM-DD', async () => {
    const r = await parseJournalBuffer(buildWorkbook());
    expect(r.ground[0].date).toBe('2026-06-01');
    expect(r.aerial[0].date).toBe('2026-06-02');
    expect(r.orders[0].planStart).toBe('2026-05-12');
  });

  it('восстанавливает порядок координат и длину прокола', async () => {
    const r = await parseJournalBuffer(buildWorkbook());
    const d = r.drills[0];
    expect(d.points).toHaveLength(1);
    expect(d.points[0].lat).toBeCloseTo(44.480565, 6);
    expect(d.points[0].lon).toBeCloseTo(52.091435, 6);
    expect(d.points[0].meters).toBe(72);
    expect(d.drillKind).toBe('ГНБ');
  });

  it('сохраняет исходный текст координат и не теряет запись без них', async () => {
    const r = await parseJournalBuffer(buildWorkbook());
    const gnp = r.drills[1];
    expect(gnp.drillKind).toBe('ГНП');
    expect(gnp.points).toHaveLength(0);
    expect(gnp.rawCoords).toContain('ГНП через асфальт');
    expect(r.stats.drillUnparsed).toBe(1);
  });

  it('пропускает пустые строки', async () => {
    const r = await parseJournalBuffer(buildWorkbook());
    expect(r.ground).toHaveLength(1);
  });

  it('разбирает подвес по типам кабеля и материалам', async () => {
    const r = await parseJournalBuffer(buildWorkbook());
    const a = r.aerial[0];
    expect(a.totalM).toBe(2400);
    expect(a.byCable['ОК8']).toBe(2400);
    expect(a.materials['Опоры']).toBe(60);
    expect(a.materials['Зажим анкерный']).toBe(120);
  });

  it('предупреждает об отсутствующем листе, но не падает', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Дата']]), 'DATA');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const r = await parseJournalBuffer(buf);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.stats.groundRows).toBe(0);
  });
});
