import { describe, it, expect } from 'vitest';
import {
  parseQuickEntry, parseDate, quickEntryReady, parsedMethods,
} from './quickEntry';

const CTX = {
  contractors: ['Дозер', 'TERRA TECH', 'Модуль Строй'],
  uchastki: ['Зеренда — Серафимовка', 'Щучинск — Бурабай', 'Зеренда'],
  columns: ['1-колонна', 'Колонна-2'],
  today: new Date('2026-07-26T10:00:00Z'),
};

describe('parseDate', () => {
  const today = new Date('2026-07-26T10:00:00Z');

  it('короткая дата достраивается текущим годом', () => {
    expect(parseDate('25.07 Дозер', today)).toBe('2026-07-25');
  });

  it('с годом — берём его', () => {
    expect(parseDate('25.07.2025', today)).toBe('2025-07-25');
    expect(parseDate('25.07.25', today)).toBe('2025-07-25');
  });

  it('понимает «вчера» и «сегодня»', () => {
    expect(parseDate('вчера 480 м', today)).toBe('2026-07-25');
    expect(parseDate('сегодня', today)).toBe('2026-07-26');
    expect(parseDate('позавчера', today)).toBe('2026-07-24');
  });

  it('ISO тоже годится', () => {
    expect(parseDate('2026-07-25 Дозер', today)).toBe('2026-07-25');
  });

  it('невозможная дата — не дата', () => {
    expect(parseDate('45.19', today)).toBeUndefined();
    expect(parseDate('просто текст', today)).toBeUndefined();
  });
});

describe('parseQuickEntry', () => {
  it('разбирает строку из чата целиком', () => {
    const p = parseQuickEntry(
      '25.07 Дозер 480 м кабелеукладчик, Зеренда — Серафимовка, ГНБ 72', CTX,
    );
    expect(p.date).toBe('2026-07-25');
    expect(p.contractor).toBe('Дозер');
    expect(p.uchastok).toBe('Зеренда — Серафимовка');
    expect(p.byMethod['кабелеукладчик']).toBe(480);
    expect(p.drillM).toBe(72);
  });

  it('число после слова тоже понимает', () => {
    const p = parseQuickEntry('бар 1200, Щучинск — Бурабай', CTX);
    expect(p.byMethod['бар']).toBe(1200);
  });

  it('несколько способов в одной смене', () => {
    const p = parseQuickEntry('Зеренда 300 вручную и 900 баром', CTX);
    expect(parsedMethods(p)).toEqual(['бар', 'вручную']);
    expect(p.byMethod['вручную']).toBe(300);
    expect(p.byMethod['бар']).toBe(900);
  });

  it('длинное название участка важнее короткого', () => {
    const p = parseQuickEntry('Зеренда — Серафимовка 100 баром', CTX);
    expect(p.uchastok).toBe('Зеренда — Серафимовка');
  });

  it('СМУ и колонна разбираются отдельно', () => {
    const p = parseQuickEntry('СМУ-3 1-колонна Зеренда 200 баром', CTX);
    expect(p.smu).toBe('СМУ-3');
    expect(p.column).toBe('1-колонна');
  });

  it('задувку не путает с прокладкой', () => {
    const p = parseQuickEntry('Зеренда задувка 2400', CTX);
    expect(p.blowingM).toBe(2400);
    expect(parsedMethods(p)).toEqual([]);
  });

  it('говорит, чего не понял, а не угадывает молча', () => {
    const p = parseQuickEntry('вчера 480', CTX);
    expect(p.leftover).toContain('число есть, но неясно, каким способом');
    expect(p.leftover).toContain('участок');
  });

  it('простой уходит в примечание целиком', () => {
    const p = parseQuickEntry('Зеренда простой весь день, дождь', CTX);
    expect(p.note).toContain('дождь');
  });

  it('пустая строка — пустой разбор, а не падение', () => {
    const p = parseQuickEntry('', CTX);
    expect(p.byMethod).toEqual({});
    expect(p.matched).toEqual([]);
  });

  it('без справочников участок не выдумывает', () => {
    const p = parseQuickEntry('480 баром', {});
    expect(p.uchastok).toBeUndefined();
    expect(p.leftover).not.toContain('участок');
  });

  it('рассказывает, что именно понял', () => {
    const p = parseQuickEntry('25.07 Дозер 480 баром Зеренда', CTX);
    expect(p.matched.join(' ')).toContain('Дозер');
    expect(p.matched.join(' ')).toContain('480');
  });
});

describe('quickEntryReady', () => {
  it('без участка сохранять нечего', () => {
    expect(quickEntryReady(parseQuickEntry('480 баром', CTX))).toBe(false);
  });

  it('без метров тоже', () => {
    expect(quickEntryReady(parseQuickEntry('Зеренда — Серафимовка', CTX))).toBe(false);
  });

  it('участок и метры — уже смена', () => {
    expect(quickEntryReady(parseQuickEntry('Зеренда — Серафимовка 480 баром', CTX))).toBe(true);
  });

  it('один ГНБ без прокладки — тоже смена', () => {
    expect(quickEntryReady(parseQuickEntry('Зеренда — Серафимовка ГНБ 72', CTX))).toBe(true);
  });
});
