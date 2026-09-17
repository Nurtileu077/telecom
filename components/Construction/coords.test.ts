import { describe, it, expect } from 'vitest';
import { parseCoordBlob, orderPair, hintForOblast } from './coords';

// Строки ниже — фактические значения из колонки «Координаты» листа «ГНБ Журнал».
describe('parseCoordBlob — реальные строки журнала', () => {
  it('переворачивает пару, где долгота записана первой', () => {
    // 44.48 не может быть долготой в Казахстане (граница 46°), значит пара перевёрнута.
    const r = parseCoordBlob('Координаты:\n1. 52.091435,44.480565 (72м);');
    expect(r.points).toHaveLength(1);
    expect(r.points[0].lat).toBeCloseTo(44.480565, 6);
    expect(r.points[0].lon).toBeCloseTo(52.091435, 6);
    expect(r.ambiguousCount).toBe(0);
  });

  it('снимает длину прокола из пометки «(72м)»', () => {
    const r = parseCoordBlob('Координаты:\n1. 52.091435,44.480565 (72м);');
    expect(r.points[0].meters).toBe(72);
  });

  it('оставляет как есть пару, записанную правильно', () => {
    const r = parseCoordBlob('Координаты:\n44.366046, 52.090369');
    expect(r.points[0].lat).toBeCloseTo(44.366046, 6);
    expect(r.points[0].lon).toBeCloseTo(52.090369, 6);
  });

  it('разбирает несколько нумерованных точек в одной ячейке', () => {
    const r = parseCoordBlob(
      '1) Координаты 42.906297, 79.457406\n2) Координаты 42.907251, 79.458120',
    );
    expect(r.points).toHaveLength(2);
    expect(r.points[0].lat).toBeCloseTo(42.906297, 6);
    expect(r.points[0].lon).toBeCloseTo(79.457406, 6);
    expect(r.points[1].lat).toBeCloseTo(42.907251, 6);
  });

  it('переживает мусор и переносы строк в начале', () => {
    const r = parseCoordBlob('\n44.363869, 52.089745');
    expect(r.points).toHaveLength(1);
    expect(r.points[0].lat).toBeCloseTo(44.363869, 6);
  });

  it('не принимает длины из текста за координаты', () => {
    // «41 м» и «105 м» — это длины переходов, а не координаты.
    const r = parseCoordBlob('Переход ГНБ через дорогу и ТТС, трасса Шетпе - Тиген - 41 м');
    expect(r.points).toHaveLength(0);
  });

  it('пустая строка не ломает разбор', () => {
    expect(parseCoordBlob('').points).toHaveLength(0);
    expect(parseCoordBlob(undefined as unknown as string).points).toHaveLength(0);
  });

  it('понимает запятую как десятичный разделитель', () => {
    const r = parseCoordBlob('44,366046 52,090369');
    expect(r.points).toHaveLength(1);
    expect(r.points[0].lat).toBeCloseTo(44.366046, 6);
    expect(r.points[0].lon).toBeCloseTo(52.090369, 6);
  });
});

describe('orderPair — разрешение порядка', () => {
  it('однозначно, когда обратный порядок выходит за границы страны', () => {
    const r = orderPair(42.906297, 79.457406)!;
    expect(r.ambiguous).toBe(false);
    expect(r.point.lat).toBeCloseTo(42.906297, 6);
  });

  it('помечает пару неоднозначной, когда оба порядка допустимы', () => {
    // Запад страны: 47.1 и 51.9 — оба числа годятся и как широта, и как долгота.
    const r = orderPair(47.1, 51.9)!;
    expect(r.ambiguous).toBe(true);
  });

  it('снимает неоднозначность по центру области', () => {
    const atyrau = hintForOblast('Атырауская область')!;
    const r = orderPair(51.9, 47.1, atyrau)!;
    // Подсказка (47.1, 51.9) ближе к варианту lat=47.1, lon=51.9.
    expect(r.point.lat).toBeCloseTo(47.1, 3);
    expect(r.point.lon).toBeCloseTo(51.9, 3);
    expect(r.ambiguous).toBe(true);
  });

  it('отбрасывает пару, не попадающую в границы ни в одном порядке', () => {
    expect(orderPair(10.123456, 200.123456)).toBeNull();
  });

  it('считает неразобранные пары', () => {
    const r = parseCoordBlob('10.123456, 200.123456');
    expect(r.invalidCount).toBe(1);
    expect(r.points).toHaveLength(0);
  });
});

describe('hintForOblast', () => {
  it('находит область по точному имени', () => {
    expect(hintForOblast('Мангистауская область')).toBeDefined();
  });
  it('не падает на неизвестной области', () => {
    expect(hintForOblast('Нет такой')).toBeUndefined();
    expect(hintForOblast(undefined)).toBeUndefined();
  });
});
