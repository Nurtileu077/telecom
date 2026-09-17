import { describe, it, expect } from 'vitest';
import { formatDuctMarks, parseDuctMarks } from './ductMarks';

// Формат меток взят из ежедневных отчётов: «4003 - 0000», «4000 — 2490 м».
describe('метки трубы', () => {
  it('разбирает запись с длинным тире', () => {
    expect(parseDuctMarks('2590 — 0000 м')).toEqual([{ coil: '2590', meters: 0 }]);
  });

  it('разбирает запись с дефисом', () => {
    expect(parseDuctMarks('4003 - 1000')).toEqual([{ coil: '4003', meters: 1000 }]);
  });

  it('разбирает несколько меток из одной ячейки', () => {
    expect(parseDuctMarks('4003 - 0000\n4002 - 0000\n4003 - 1000')).toEqual([
      { coil: '4003', meters: 0 },
      { coil: '4002', meters: 0 },
      { coil: '4003', meters: 1000 },
    ]);
  });

  it('переживает разделитель точкой с запятой', () => {
    expect(parseDuctMarks('2590 — 0000; 4000 — 2490')).toEqual([
      { coil: '2590', meters: 0 },
      { coil: '4000', meters: 2490 },
    ]);
  });

  it('пустая строка не даёт меток', () => {
    expect(parseDuctMarks('')).toEqual([]);
    expect(parseDuctMarks(undefined as unknown as string)).toEqual([]);
  });

  it('собирает строку обратно', () => {
    expect(formatDuctMarks([{ coil: '4000', meters: 2490 }])).toBe('4000 — 2490');
    expect(formatDuctMarks([])).toBe('');
    expect(formatDuctMarks(undefined)).toBe('');
  });

  it('переживает оборот строка → список → строка', () => {
    // Ведущие нули «0000» — форма записи в отчёте, значение это ноль метров,
    // поэтому обратно строка собирается уже без них.
    expect(formatDuctMarks(parseDuctMarks('2590 — 0000; 4000 — 2490')))
      .toBe('2590 — 0; 4000 — 2490');
    const clean = '2590 — 120; 4000 — 2490';
    expect(formatDuctMarks(parseDuctMarks(clean))).toBe(clean);
  });
});
