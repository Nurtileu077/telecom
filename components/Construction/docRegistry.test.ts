import { describe, it, expect } from 'vitest';
import {
  formatActNumber, parseActNumber, nextActNumber, duplicateNumbers, actRegistry,
} from './docRegistry';
import type { SectionActManual } from './sectionAct';

const FIELDS: Record<string, SectionActManual> = {
  'Зеренда — Серафимовка': {
    actNumber: 'АСР-2026-0012', actDate: '2026-07-25', city: 'Кокшетау',
    objectName: 'ВОЛС до с. Серафимовка',
  },
  'Щучинск — Бурабай': { actNumber: 'АСР-2026-0007', actDate: '2026-07-20' },
  'Аккол — Урюпинка': { actNumber: 'ОСР-2026-0003' },
  'Без номера': {},
};

describe('formatActNumber', () => {
  it('вид, год и порядок с ведущими нулями', () => {
    expect(formatActNumber('ASR', 2026, 12)).toBe('АСР-2026-0012');
    expect(formatActNumber('OSR', 2026, 3)).toBe('ОСР-2026-0003');
  });
});

describe('parseActNumber', () => {
  it('читает то, что сам написал', () => {
    expect(parseActNumber('АСР-2026-0012')).toEqual({ kind: 'ASR', year: 2026, seq: 12 });
  });

  it('вписанное руками не трогаем', () => {
    expect(parseActNumber('14')).toBeNull();
    expect(parseActNumber('14/2026')).toBeNull();
    expect(parseActNumber('б/н')).toBeNull();
    expect(parseActNumber(undefined)).toBeNull();
  });
});

describe('nextActNumber', () => {
  it('продолжает нумерацию этого года', () => {
    expect(nextActNumber(FIELDS, 'ASR', 2026)).toBe('АСР-2026-0013');
  });

  it('у каждого вида своя нумерация', () => {
    expect(nextActNumber(FIELDS, 'OSR', 2026)).toBe('ОСР-2026-0004');
  });

  it('новый год начинается с единицы', () => {
    expect(nextActNumber(FIELDS, 'ASR', 2027)).toBe('АСР-2027-0001');
  });

  it('дырки не заполняем: пропущенный номер — это отменённый акт', () => {
    const withHole = { a: { actNumber: 'АСР-2026-0001' }, b: { actNumber: 'АСР-2026-0005' } };
    expect(nextActNumber(withHole, 'ASR', 2026)).toBe('АСР-2026-0006');
  });

  it('пустой журнал — первый номер', () => {
    expect(nextActNumber({}, 'ASR', 2026)).toBe('АСР-2026-0001');
  });
});

describe('duplicateNumbers', () => {
  it('находит два акта с одним номером', () => {
    expect(duplicateNumbers({
      a: { actNumber: 'АСР-14' }, b: { actNumber: 'АСР-14' }, c: { actNumber: 'АСР-15' },
    })).toEqual(['АСР-14']);
  });

  it('пустые номера дублями не считаются', () => {
    expect(duplicateNumbers({ a: {}, b: {} })).toEqual([]);
  });
});

describe('actRegistry', () => {
  it('показывает, чего не хватает для подписи', () => {
    const rows = actRegistry(FIELDS);
    const full = rows.find((r) => r.uchastok === 'Зеренда — Серафимовка');
    expect(full?.missing).toEqual([]);
    const partial = rows.find((r) => r.uchastok === 'Щучинск — Бурабай');
    expect(partial?.missing).toContain('город');
  });

  it('свежие акты сверху', () => {
    const rows = actRegistry(FIELDS);
    expect(rows[0].uchastok).toBe('Зеренда — Серафимовка');
  });

  it('помечает задвоенные номера', () => {
    const rows = actRegistry({
      a: { actNumber: 'АСР-14' }, b: { actNumber: 'АСР-14' },
    });
    expect(rows.every((r) => r.duplicate)).toBe(true);
  });

  it('пустой реестр — пустой список', () => {
    expect(actRegistry({})).toEqual([]);
  });
});
