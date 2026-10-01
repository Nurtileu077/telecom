import { describe, it, expect } from 'vitest';
import {
  parseQuickEntry, parseDate, quickEntryReady, parsedMethods, downtimeOf,
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

/**
 * «25.07» — это дата, а «1.5» в «1.5 км баром» — длина. Раньше вторую
 * читали датой, а первую — метрами: смена уходила на 1 мая и в 25 метров.
 */
describe('дата против длины', () => {
  const today = new Date('2026-07-28T00:00:00.000Z');

  it('число с единицей измерения датой не считается', () => {
    expect(parseDate('бар 1.5 км', today)).toBeUndefined();
    expect(parseDate('прошли 2.5 м вручную', today)).toBeUndefined();
  });

  it('с годом это всё-таки дата', () => {
    expect(parseDate('1.5.2026 бар 400', today)).toBe('2026-05-01');
  });

  it('обычная дата по-прежнему разбирается', () => {
    expect(parseDate('25.07 бар 400', today)).toBe('2026-07-25');
    expect(parseDate('25.07.2025 бар 400', today)).toBe('2025-07-25');
  });

  it('дня, которого не было, не принимает', () => {
    expect(parseDate('31.04 бар 400', today)).toBeUndefined();
    expect(parseDate('30.02.2026 бар 400', today)).toBeUndefined();
    expect(parseDate('32.01 бар 400', today)).toBeUndefined();
  });

  it('дату не принимает за метры', () => {
    const r = parseQuickEntry('25.07 бар 480', { today });
    expect(r.date).toBe('2026-07-25');
    expect(r.byMethod?.['бар']).toBe(480);
  });

  it('и когда дата стоит прямо перед видом работ', () => {
    const r = parseQuickEntry('25.07 кабелеукладчик 1200 м', { today });
    expect(r.byMethod?.['кабелеукладчик']).toBe(1200);
  });
});

/**
 * «25.07 Дозер, Зеренда — Серафимовка, дождь» — смена простоя одной
 * строкой. Раньше её было не записать: без метров строка «не готова», а
 * причина уходила только в примечание.
 */
describe('простой одной строкой', () => {
  it('участок и причина — уже смена', () => {
    const p = parseQuickEntry('25.07 Дозер, Зеренда — Серафимовка, дождь', CTX);
    expect(p.downtime).toBe('дождь');
    expect(quickEntryReady(p)).toBe(true);
  });

  it('без участка не записывает и простой', () => {
    expect(quickEntryReady(parseQuickEntry('дождь, простой', CTX))).toBe(false);
  });

  it('называет понятое: простой с причиной', () => {
    const p = parseQuickEntry('Зеренда — Серафимовка, ждём разрешения', CTX);
    expect(p.matched).toContain('простой: ждём разрешения');
  });

  it('дату в строке простоя не считает непонятным числом', () => {
    const p = parseQuickEntry('25.07 Зеренда — Серафимовка дождь', CTX);
    expect(p.leftover).not.toContain('число есть, но неясно, каким способом');
  });

  it('строка целиком остаётся в примечании', () => {
    const p = parseQuickEntry('Зеренда — Серафимовка, стояли, нет кабеля', CTX);
    expect(p.note).toBe('Зеренда — Серафимовка, стояли, нет кабеля');
    expect(p.downtime).toBe('нет кабеля');
  });
});

describe('downtimeOf', () => {
  const known = ['Зеренда — Серафимовка', 'Дозер', '1-колонна'];

  it('причина — без даты, бригады и участка', () => {
    expect(downtimeOf('25.07 Дозер Зеренда — Серафимовка дождь', known)).toBe('дождь');
    expect(downtimeOf('вчера 1-колонна, Зеренда — Серафимовка, ждали разрешения', known))
      .toBe('ждали разрешения');
  });

  it('название участка с другим пробелом и регистром тоже вынимает', () => {
    expect(downtimeOf('зеренда  —  СЕРАФИМОВКА дождь', known)).toBe('дождь');
  });

  it('«простой —» перед причиной не повторяет', () => {
    expect(downtimeOf('Зеренда — Серафимовка, простой — дождь', known)).toBe('дождь');
  });

  it('голое «простой» — так и пишем, а не выдумываем причину', () => {
    expect(downtimeOf('Зеренда — Серафимовка, простой', known)).toBe('простой');
    expect(downtimeOf('Зеренда — Серафимовка, стояли весь день', known)).toBe('простой');
  });

  it('метры с видом работ в причину не идут', () => {
    expect(downtimeOf('Зеренда — Серафимовка 480 м баром дождь после обеда', known))
      .toBe('дождь после обеда');
  });

  it('склонения узнаёт: «после дождя», «сломался»', () => {
    expect(downtimeOf('после дождя грунт поплыл', [])).toBe('после дождя грунт поплыл');
    expect(downtimeOf('сломался экскаватор', [])).toBe('сломался экскаватор');
  });

  it('«снег» внутри названия села простоем не считает', () => {
    expect(downtimeOf('Снегирёвка 480 баром', [])).toBeUndefined();
  });

  it('обычная смена без слов о простое — без причины', () => {
    expect(downtimeOf('25.07 Дозер 480 м кабелеукладчик, Зеренда — Серафимовка, ГНБ 72', known))
      .toBeUndefined();
  });

  it('регистр причины сохраняет, как написали', () => {
    expect(downtimeOf('Ждали разрешения Акимата', [])).toBe('Ждали разрешения Акимата');
  });
});
