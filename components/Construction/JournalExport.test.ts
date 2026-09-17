import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseJournalBuffer } from './JournalImport';
import { buildJournalWorkbook, formatDrillCoords, GROUND_HEADERS } from './JournalExport';
import type { DailyWorkEntry, DrillLogEntry, AerialWorkEntry, SettlementOrder } from '@/types/construction';

const now = '2026-09-17T00:00:00.000Z';

function sample(): {
  orders: SettlementOrder[]; ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[]; drills: DrillLogEntry[];
} {
  return {
    orders: [{
      kato: '191234567', oblast: 'Акмолинская область', rayon: 'Аршалынский',
      okrug: 'Еленовский', snp: 'Еленовка', year: 2026,
      planStart: '2026-05-12', planEnd: '2026-09-30', guCount: 4, tech: 'МКТ',
      planVolsM: 12500, planMktM: 11200,
    }],
    ground: [{
      kind: 'ground', id: 'g1', date: '2026-06-01', smu: 'СМУ-2',
      oblast: 'Акмолинская область', rayon: 'Аршалынский',
      uchastok: 'сущ. ОМ - Еленовка', kato: '191234567', tech: 'МКТ',
      byMethod: { 'кабелеукладчик': 1234, 'экскаватор': 500, 'вручную': 50 },
      drillM: 72, drillCount: 2, openCrossings: 1, blowingM: 0,
      materials: { 'МКТ': 1800, 'Лента': 400, 'Муфта': 3, 'ФИТИНГ': 12 },
      createdAt: now, updatedAt: now, sync: 'local',
    }],
    aerial: [{
      kind: 'aerial', id: 'a1', date: '2026-06-02', smu: 'СМУ-3',
      oblast: 'Костанайская область', rayon: 'Алтынсаринский',
      uchastok: 'Убаган - Щербаково', kato: '391112233',
      totalM: 2400, byCable: { 'ОК8': 2400 },
      materials: { 'Опоры': 60, 'Зажим анкерный': 120 },
      createdAt: now, updatedAt: now, sync: 'local',
    }],
    drills: [{
      kind: 'drill', id: 'd1', date: '2026-06-03', smu: '',
      oblast: 'Мангистауская область', uchastok: 'Шетпе - Тиген', kato: '471234567',
      drillKind: 'ГНБ', meters: 72, count: 1,
      points: [{ lat: 44.480565, lon: 52.091435, meters: 72 }],
      note: 'Переход ГНБ через а/дорогу',
      createdAt: now, updatedAt: now, sync: 'local',
    }],
  };
}

async function roundTrip(data: ReturnType<typeof sample>) {
  const blob = await buildJournalWorkbook(data);
  const buf = await blob.arrayBuffer();
  return parseJournalBuffer(buf);
}

describe('выгрузка журнала в Excel', () => {
  it('создаёт книгу с теми же листами, что в оригинале', async () => {
    const blob = await buildJournalWorkbook(sample());
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Все СНП заказа', 'DATA', 'ГНБ Журнал', 'DATA ПОДВЕС']);
  });

  it('пишет колонки листа DATA с привычными названиями', async () => {
    const blob = await buildJournalWorkbook(sample());
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['DATA'], { header: 1 }) as unknown[][];
    expect(rows[0]).toEqual([...GROUND_HEADERS]);
  });

  it('переживает полный оборот: импорт → выгрузка → импорт', async () => {
    const r = await roundTrip(sample());
    expect(r.stats.groundRows).toBe(1);
    expect(r.stats.aerialRows).toBe(1);
    expect(r.stats.drillRows).toBe(1);
    expect(r.stats.orderRows).toBe(1);
  });

  it('не теряет метры при обороте через километры', async () => {
    const r = await roundTrip(sample());
    const g = r.ground[0];
    expect(g.byMethod['кабелеукладчик']).toBe(1234);
    expect(g.byMethod['экскаватор']).toBe(500);
    expect(g.byMethod['вручную']).toBe(50);
    expect(g.drillM).toBe(72);
    expect(g.materials['МКТ']).toBe(1800);
    expect(g.materials['Лента']).toBe(400);
  });

  it('сохраняет штучные материалы штуками', async () => {
    const r = await roundTrip(sample());
    expect(r.ground[0].materials['Муфта']).toBe(3);
    expect(r.ground[0].materials['ФИТИНГ']).toBe(12);
    expect(r.ground[0].drillCount).toBe(2);
    expect(r.ground[0].openCrossings).toBe(1);
  });

  it('сохраняет привязку: дату, СМУ, участок, КАТО', async () => {
    const r = await roundTrip(sample());
    const g = r.ground[0];
    expect(g.date).toBe('2026-06-01');
    expect(g.smu).toBe('СМУ-2');
    expect(g.uchastok).toBe('сущ. ОМ - Еленовка');
    expect(g.kato).toBe('191234567');
    expect(g.tech).toBe('МКТ');
  });

  it('выгружает координаты ГНБ уже в выверенном порядке', async () => {
    const r = await roundTrip(sample());
    const d = r.drills[0];
    expect(d.points).toHaveLength(1);
    expect(d.points[0].lat).toBeCloseTo(44.480565, 6);
    expect(d.points[0].lon).toBeCloseTo(52.091435, 6);
    expect(d.points[0].meters).toBe(72);
    // После оборота порядок уже однозначен — переразбор не считает пару спорной.
    expect(r.stats.drillAmbiguous).toBe(0);
  });

  it('форматирует точки построчно и с длиной прокола', () => {
    const d = sample().drills[0];
    expect(formatDrillCoords(d)).toBe('1. 44.480565, 52.091435 (72м)');
  });

  it('когда точек нет — отдаёт исходный текст, ничего не теряя', () => {
    const d: DrillLogEntry = {
      ...sample().drills[0], points: [], rawCoords: 'ГНП через асфальт улицу-18м',
    };
    expect(formatDrillCoords(d)).toBe('ГНП через асфальт улицу-18м');
  });

  it('переживает оборот подвеса по типам кабеля', async () => {
    const r = await roundTrip(sample());
    const a = r.aerial[0];
    expect(a.totalM).toBe(2400);
    expect(a.byCable['ОК8']).toBe(2400);
    expect(a.materials['Опоры']).toBe(60);
    expect(a.materials['Зажим анкерный']).toBe(120);
  });

  it('переживает оборот планового реестра', async () => {
    const r = await roundTrip(sample());
    const o = r.orders[0];
    expect(o.snp).toBe('Еленовка');
    expect(o.planVolsM).toBe(12500);
    expect(o.planStart).toBe('2026-05-12');
    expect(o.guCount).toBe(4);
  });

  it('пустой журнал даёт корректную книгу без строк', async () => {
    const r = await roundTrip({ orders: [], ground: [], aerial: [], drills: [] });
    expect(r.stats.groundRows).toBe(0);
    expect(r.warnings).toHaveLength(0);
  });
});

describe('подробный отчёт инженера', () => {
  const detailed = (): ReturnType<typeof sample> => {
    const s = sample();
    s.ground[0] = {
      ...s.ground[0],
      operations: {
        proporka: 3850,
        lay_mkt_heavy: 3850,
        trench_excavator: 250,
        lay_mkt: 4100,
        lay_tape: 4100,
        obvalovka_tractor: 4100,
        install_kod: 2,
      },
      equipment: { 'Кабелеукладчик': 1, 'Манипулятор': 1, 'Экскаватор 3/1': 1, 'Пропорщик': 1 },
      ductMarks: [{ coil: '2590', meters: 0 }, { coil: '4000', meters: 2490 }],
      totalMktM: 4100,
      totalUchastokM: 12658,
      downtime: 'Ждали согласование',
      tomorrow: 'Продолжение протяжки МКТ в сторону п. Кызылегис',
    };
    return s;
  };

  it('добавляет лист «Детали работ», когда есть что писать', async () => {
    const blob = await buildJournalWorkbook(detailed());
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    expect(wb.SheetNames).toContain('Детали работ');
  });

  it('не плодит лишний лист, когда подробностей нет', async () => {
    const blob = await buildJournalWorkbook(sample());
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    expect(wb.SheetNames).not.toContain('Детали работ');
  });

  it('операции переживают оборот и не суммируются в прогресс', async () => {
    const r = await roundTrip(detailed());
    const ops = r.ground[0].operations!;
    expect(ops.lay_mkt).toBe(4100);
    expect(ops.lay_tape).toBe(4100);
    expect(ops.install_kod).toBe(2);
    // Прогресс по способам прокладки остался прежним — операции в него не влились.
    expect(r.ground[0].byMethod['кабелеукладчик']).toBe(1234);
    expect(r.ground[0].totalMktM).toBe(4100);
  });

  it('состав техники переживает оборот', async () => {
    const r = await roundTrip(detailed());
    expect(r.ground[0].equipment).toEqual({
      'Кабелеукладчик': 1, 'Манипулятор': 1, 'Экскаватор 3/1': 1, 'Пропорщик': 1,
    });
  });

  it('метки трубы переживают оборот, включая нулевой метраж', async () => {
    const r = await roundTrip(detailed());
    expect(r.ground[0].ductMarks).toEqual([
      { coil: '2590', meters: 0 }, { coil: '4000', meters: 2490 },
    ]);
  });

  it('тоталы, простои и план на завтра переживают оборот', async () => {
    const r = await roundTrip(detailed());
    const g = r.ground[0];
    expect(g.totalUchastokM).toBe(12658);
    expect(g.downtime).toBe('Ждали согласование');
    expect(g.tomorrow).toContain('Кызылегис');
  });
});
