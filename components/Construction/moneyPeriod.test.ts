import { describe, it, expect } from 'vitest';
import {
  startDayOf, addMonths, monthRange, monthOf, periodRange, defaultPeriod,
  monthName, fmtDay, rangeText, periodTitle, checkRange, monthChoices, startDayLabel,
  upToToday,
} from './moneyPeriod';

describe('отчётный месяц', () => {
  it('календарный месяц — с первого по последнее число', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('месяц с 26-го — с 26-го прошлого по 25-е этого', () => {
    expect(monthRange('2026-09', 26)).toEqual({ from: '2026-08-26', to: '2026-09-25' });
  });

  it('январь с 26-го начинается в декабре прошлого года', () => {
    expect(monthRange('2027-01', 26)).toEqual({ from: '2026-12-26', to: '2027-01-25' });
  });

  it('31 декабря в Алма-Ате остаётся в декабре, а не съезжает на сутки', () => {
    expect(monthRange('2026-12').to).toBe('2026-12-31');
    expect(monthOf('2026-12-31')).toBe('2026-12');
    expect(monthOf('2027-01-01')).toBe('2027-01');
  });

  it('смена 27 августа при периоде с 26-го — уже сентябрьская', () => {
    expect(monthOf('2026-08-27', 26)).toBe('2026-09');
    expect(monthOf('2026-08-25', 26)).toBe('2026-08');
    expect(monthOf('2026-12-26', 26)).toBe('2027-01');
  });

  it('день, попавший в месяц, лежит в его датах', () => {
    for (const start of [1, 21, 26, 28]) {
      for (const day of ['2026-01-01', '2026-02-28', '2026-03-27', '2026-12-31', '2026-06-21']) {
        const r = monthRange(monthOf(day, start), start);
        expect(day >= r.from && day <= r.to).toBe(true);
      }
    }
  });

  it('смена без даты не ложится ни в какой месяц', () => {
    expect(monthOf('')).toBe('');
    expect(monthOf('25.09.2026')).toBe('');
    expect(monthOf('2026-02-30')).toBe('');
  });

  it('начало позже 28-го и мусор считаются календарным месяцем', () => {
    expect(startDayOf(26)).toBe(26);
    expect(startDayOf('26')).toBe(26);
    expect(startDayOf(30)).toBe(1);
    expect(startDayOf(0)).toBe(1);
    expect(startDayOf(2.5)).toBe(1);
    expect(startDayOf(undefined)).toBe(1);
  });

  it('месяцы листаются через год', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-09', -12)).toBe('2025-09');
  });
});

describe('выбранный период', () => {
  it('месяц, свои даты и всё время дают свои границы', () => {
    expect(periodRange({ kind: 'month', month: '2026-09' }))
      .toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange({ kind: 'range', from: '2026-09-05', to: '2026-09-12' }))
      .toEqual({ from: '2026-09-05', to: '2026-09-12' });
    expect(periodRange({ kind: 'all' })).toEqual({ from: '', to: '' });
  });

  it('по умолчанию открывается месяц последней смены, а не 30 дней до неё', () => {
    expect(defaultPeriod('2026-09-30', '2026-10-13')).toEqual({ kind: 'month', month: '2026-09' });
    expect(periodRange(defaultPeriod('2026-09-30', '2026-10-13')))
      .toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('пустой журнал открывается текущим месяцем', () => {
    expect(defaultPeriod('', '2026-10-13')).toEqual({ kind: 'month', month: '2026-10' });
  });

  it('название говорит и месяц, и даты', () => {
    expect(monthName('2026-09')).toBe('сентябрь 2026');
    expect(periodTitle({ kind: 'month', month: '2026-09' }, 26))
      .toBe('сентябрь 2026 (26.08.2026 — 25.09.2026)');
    expect(periodTitle({ kind: 'all' })).toBe('всё время');
    expect(fmtDay('2026-09-01')).toBe('01.09.2026');
    expect(rangeText({ from: '', to: '2026-09-30' })).toBe('с начала работ — 30.09.2026');
  });

  it('перевёрнутые даты не переставляет молча, а говорит', () => {
    expect(checkRange('2026-09-30', '2026-09-01')).toBe('Начало позже конца — проверьте даты');
    expect(checkRange('', '2026-09-01')).toBe('Выберите обе даты в календаре');
    expect(checkRange('2026-09-01', '2026-09-01')).toBeNull();
  });

  it('месяцы для выбора — от первой смены до сегодня, свежие сверху', () => {
    expect(monthChoices('2026-07-15', '2026-10-13')).toEqual(['2026-10', '2026-09', '2026-08', '2026-07']);
    expect(monthChoices('', '2026-10-13')).toEqual(['2026-10']);
    expect(monthChoices('2020-01-01', '2026-10-13', 1, 3)).toHaveLength(3);
  });

  it('идущий месяц кончается сегодняшним днём, а не 31-м', () => {
    const oct = monthRange('2026-10');
    expect(upToToday(oct, '2026-10-13')).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    expect(upToToday(monthRange('2026-09'), '2026-10-13')).toEqual(monthRange('2026-09'));
  });

  it('смену, записанную вперёд, граница не прячет', () => {
    expect(upToToday(monthRange('2026-10'), '2026-10-13', '2026-10-15').to).toBe('2026-10-15');
  });

  it('всё время остаётся без границ', () => {
    expect(upToToday({ from: '', to: '' }, '2026-10-13')).toEqual({ from: '', to: '' });
  });

  it('подпись настройки говорит, с какого по какое', () => {
    expect(startDayLabel(1)).toBe('календарный месяц');
    expect(startDayLabel(26)).toBe('с 26-го по 25-е');
  });
});
