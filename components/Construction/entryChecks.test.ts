import { describe, it, expect } from 'vitest';
import {
  findDuplicate, typicalPerShift, checkEntry, hasBlocking, HARD_METERS_LIMIT,
} from './entryChecks';
import type { DailyWorkEntry } from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: patch.id ?? 'x', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'Зеренда — Серафимовка',
    kato: '1', byMethod: { 'бар': 400 }, materials: {},
    createdAt: '', updatedAt: '', contractor: 'Дозер', ...patch,
  } as DailyWorkEntry;
}

describe('findDuplicate', () => {
  const history = [e({ id: 'a' })];

  it('та же дата, участок и бригада — это дубль', () => {
    expect(findDuplicate(history, e({ id: 'new' }))?.id).toBe('a');
  });

  it('сам себе не дубль', () => {
    expect(findDuplicate(history, e({ id: 'a' }))).toBeNull();
  });

  it('другая колонна в тот же день — не дубль', () => {
    expect(findDuplicate(history, e({ id: 'new', column: 'Колонна-2' }))).toBeNull();
  });

  it('другой день — не дубль', () => {
    expect(findDuplicate(history, e({ id: 'new', date: '2026-07-26' }))).toBeNull();
  });

  it('разное написание участка всё равно дубль', () => {
    expect(findDuplicate(history, e({ id: 'new', uchastok: 'зеренда  —  серафимовка' }))?.id)
      .toBe('a');
  });
});

describe('typicalPerShift', () => {
  it('на пяти сменах уже можно судить', () => {
    const rows = [300, 400, 500, 600, 700].map((v, i) => e({ id: `r${i}`, byMethod: { 'бар': v } }));
    expect(typicalPerShift(rows, 'бар')).toBe(500);
  });

  it('одна огромная смена не поднимает планку', () => {
    const rows = [300, 400, 500, 600, 9000].map((v, i) => e({ id: `r${i}`, byMethod: { 'бар': v } }));
    expect(typicalPerShift(rows, 'бар')).toBe(500);
  });

  it('по трём сменам судить рано', () => {
    const rows = [300, 400, 500].map((v, i) => e({ id: `r${i}`, byMethod: { 'бар': v } }));
    expect(typicalPerShift(rows, 'бар')).toBeNull();
  });
});

describe('checkEntry', () => {
  const history = [300, 400, 500, 600, 700].map((v, i) => (
    e({ id: `r${i}`, date: `2026-07-0${i + 1}`, byMethod: { 'бар': v } })
  ));

  it('предупреждает про дубль и не даёт сохранить молча', () => {
    const warns = checkEntry(e({ id: 'new', date: '2026-07-01' }), history);
    expect(hasBlocking(warns)).toBe(true);
    expect(warns[0].text).toContain('уже есть запись');
  });

  it('лишний ноль виден сразу', () => {
    const warns = checkEntry(e({ id: 'new', date: '2026-08-01', byMethod: { 'бар': HARD_METERS_LIMIT + 1 } }), history);
    expect(hasBlocking(warns)).toBe(true);
    expect(warns.some((w) => w.hint?.includes('ноль'))).toBe(true);
  });

  it('вчетверо больше обычного — стоит посмотреть, но не запрет', () => {
    const warns = checkEntry(e({ id: 'new', date: '2026-08-01', byMethod: { 'бар': 4000 } }), history);
    expect(hasBlocking(warns)).toBe(false);
    expect(warns.some((w) => w.text.includes('вчетверо'))).toBe(true);
  });

  it('обычная смена проходит молча', () => {
    expect(checkEntry(e({ id: 'new', date: '2026-08-01', byMethod: { 'бар': 550 } }), history))
      .toEqual([]);
  });

  it('пустая смена без причины простоя — вопрос', () => {
    const warns = checkEntry(e({ id: 'new', date: '2026-08-01', byMethod: {} }), history);
    expect(warns.some((w) => w.text.includes('ни метров'))).toBe(true);
  });

  it('простой объясняет пустую смену', () => {
    const warns = checkEntry(
      e({ id: 'new', date: '2026-08-01', byMethod: {}, downtime: 'дождь' }), history,
    );
    expect(warns).toEqual([]);
  });

  it('прокол в полкилометра — редкость, о которой стоит спросить', () => {
    const warns = checkEntry(
      e({ id: 'new', date: '2026-08-01', byMethod: { 'бар': 500 }, drillM: 500, drillCount: 1 }),
      history,
    );
    expect(warns.some((w) => w.text.includes('300 м'))).toBe(true);
  });
});
