import { describe, it, expect } from 'vitest';
import {
  findDuplicate, typicalPerShift, checkEntry, hasBlocking, HARD_METERS_LIMIT, saveBlocker,
  journalMarksIssues,
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

/**
 * Дождь — смену с нулём метров было не сохранить, и день простоя
 * пропадал из отчёта за период, хотя проверка сама просила указать
 * причину простоя.
 */
describe('saveBlocker', () => {
  it('смена простоя с причиной сохраняется', () => {
    expect(saveBlocker(e({ byMethod: {}, downtime: 'дождь' }))).toBeNull();
  });

  it('пустую смену без причины не сохраняет и говорит, что вписать', () => {
    const why = saveBlocker(e({ byMethod: {} }));
    expect(why).toContain('причину простоя');
  });

  it('пробелы вместо причины — не причина', () => {
    expect(saveBlocker(e({ byMethod: {}, downtime: '  ' }))).not.toBeNull();
  });

  it('задувка без метров укладки — работа, сохраняется', () => {
    expect(saveBlocker(e({ byMethod: {}, blowingM: 2400 }))).toBeNull();
  });

  it('без участка не сохраняет даже с метрами', () => {
    expect(saveBlocker(e({ uchastok: '  ' }))).toBe('Укажите участок.');
  });

  it('исправление без причины исправления не уходит', () => {
    expect(saveBlocker(e({}), { correcting: true, reason: '' }))
      .toBe('Укажите причину исправления.');
    expect(saveBlocker(e({}), { correcting: true, reason: 'ошиблись в метраже' })).toBeNull();
  });

  it('проверка и сохранение говорят одно: с причиной вопроса нет', () => {
    const idle = e({ id: 'new', date: '2026-08-01', byMethod: {}, downtime: 'ждём разрешения' });
    expect(checkEntry(idle, [])).toEqual([]);
    expect(saveBlocker(idle)).toBeNull();
  });
});

describe('метки трубы у сохранённых смен', () => {
  it('сохранённая смена с метками не по метрам попадает в список, сошедшаяся — нет', () => {
    const off = e({ id: 'off', date: '2026-07-20', column: '1-колонна', byMethod: { 'бар': 1200 },
      ductMarks: [{ coil: '4000', meters: 2490 }] });
    const ok = e({ id: 'ok', date: '2026-07-21', byMethod: { 'бар': 1500 },
      ductMarks: [{ coil: '4000', meters: 2490 }] });
    const noMarks = e({ id: 'none', date: '2026-07-22' });
    const issues = journalMarksIssues([off, ok, noMarks]);
    expect(issues.map((i) => i.entryId)).toEqual(['off']);
    expect(issues[0].crew).toBe('1-колонна (Дозер)');
    // Та же фраза, что в форме до сохранения.
    expect(issues[0].text).toBe(checkEntry(off, []).find((w) => w.text.startsWith('По меткам'))?.text);
  });

  it('номер бухты вместо метки — по меткам не считаем и не ругаемся', () => {
    const coil = e({ id: 'coil', byMethod: { 'бар': 300 }, ductMarks: [{ coil: 'Б-12', meters: 2490 }] });
    expect(journalMarksIssues([coil])).toEqual([]);
  });
});
