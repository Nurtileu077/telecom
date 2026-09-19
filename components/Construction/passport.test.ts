import { describe, it, expect } from 'vitest';
import { muftaPassport, passports, passportSummary, fiberRows, missingFields } from './passport';
import type { SiteObject, SpliceRecord } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function mufta(over: Partial<SiteObject> = {}): SiteObject {
  return {
    id: 'm1', kind: 'mufta', name: 'Муфта №3', lat: 51.5, lon: 71.5,
    state: 'spliced', cable: 'ОК-24', fibers: 24,
    feedFrom: 'АТС Еленовка', feedTo: 'Школа', depthM: 1.2,
    createdAt: now, updatedAt: now, ...over,
  };
}

function splice(over: Partial<SpliceRecord> = {}): SpliceRecord {
  return {
    id: 's1', objectId: 'm1', date: '2026-09-17',
    fibers: [
      { fiber: 1, lossDb: 0.04, to: 'школа' },
      { fiber: 2, lossDb: 0.35 },
    ],
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('паспорт муфты', () => {
  it('волокна собираются из разметки муфты и протокола сварки', () => {
    const rows = fiberRows(mufta({ fiberUse: { 1: 'школа', 5: 'ФАП' } }), splice());
    expect(rows.map((r) => r.fiber)).toEqual([1, 2, 5]);
    // Протокол уточняет то, что было в разметке, а не затирает.
    expect(rows[0].to).toBe('школа');
    expect(rows[0].lossDb).toBe(0.04);
    expect(rows.find((r) => r.fiber === 5)!.to).toBe('ФАП');
  });

  it('затухание выше нормы помечено', () => {
    const p = muftaPassport(mufta(), [splice()]);
    expect(p.bad.map((f) => f.fiber)).toEqual([2]);
    expect(p.fibers.find((f) => f.fiber === 2)!.bad).toBe(true);
    expect(p.fibers.find((f) => f.fiber === 1)!.bad).toBe(false);
  });

  it('берётся последний протокол — муфту могут переваривать', () => {
    const p = muftaPassport(mufta(), [
      splice({ id: 'old', date: '2026-08-01', fibers: [{ fiber: 1, lossDb: 0.9 }] }),
      splice({ id: 'new', date: '2026-09-17' }),
    ]);
    expect(p.splice?.id).toBe('new');
    expect(p.splices).toHaveLength(2);
  });

  it('заваренная муфта без протокола — пропуск, о котором говорим вслух', () => {
    expect(missingFields(mufta(), undefined)).toContain('протокол сварки');
    expect(missingFields(mufta(), splice())).not.toContain('протокол сварки');
  });

  it('пустой паспорт перечисляет, чего не хватает', () => {
    const m = missingFields({
      id: 'x', kind: 'mufta', lat: 0, lon: 0, createdAt: now, updatedAt: now,
    }, undefined);
    expect(m).toContain('тип кабеля');
    expect(m).toContain('число волокон');
    expect(m).toContain('откуда и куда питается');
    expect(m).toContain('глубина заложения');
  });

  it('полный паспорт ни на что не жалуется', () => {
    expect(missingFields(mufta(), splice())).toEqual([]);
  });
});

describe('список паспортов', () => {
  it('сначала неполные: паспорт нужен полным, а не длинным', () => {
    const rows = passports([
      mufta({ id: 'ok', name: 'Полная' }),
      mufta({ id: 'bad', name: 'Пустая', cable: undefined, fibers: undefined, depthM: undefined }),
    ], [splice(), splice({ id: 's2', objectId: 'ok' }), splice({ id: 's3', objectId: 'bad' })]);
    expect(rows[0].object.id).toBe('bad');
  });

  it('столбы и ККС в паспорт не попадают — у них нет волокон', () => {
    const rows = passports([
      mufta(),
      { id: 'st', kind: 'stolb', lat: 0, lon: 0, createdAt: now, updatedAt: now },
      { id: 'ep', kind: 'endpoint', lat: 0, lon: 0, createdAt: now, updatedAt: now },
    ], []);
    expect(rows.map((r) => r.object.kind).sort()).toEqual(['endpoint', 'mufta']);
  });

  it('сводка считает заваренные, неполные и плохие стыки', () => {
    const rows = passports([
      mufta(),
      mufta({ id: 'm2', state: 'installed', cable: undefined }),
    ], [splice()]);
    const s = passportSummary(rows);
    expect(s.muftas).toBe(2);
    expect(s.spliced).toBe(1);
    expect(s.badSplices).toBe(1);
    // Неполная одна: у второй муфты не записан кабель.
    expect(s.incomplete).toBe(1);
  });
});
