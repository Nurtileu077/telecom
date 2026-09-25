import { describe, it, expect } from 'vitest';
import { loginLine, loginSummary, type LoginEntry } from './loginLog';

const e = (over: Partial<LoginEntry> = {}): LoginEntry => ({
  email: 'nurtuleu2001@gmail.com',
  event: 'вход',
  at: '2026-09-25T06:30:00.000Z',
  ip: '203.0.113.7',
  ...over,
});

describe('строка о входе', () => {
  it('несёт время, человека, событие и откуда', () => {
    const line = loginLine(e());
    expect(line).toContain('nurtuleu2001@gmail.com');
    expect(line).toContain('вход');
    expect(line).toContain('203.0.113.7');
  });

  it('без адреса лишнего разделителя не ставит', () => {
    expect(loginLine(e({ ip: '—' }))).not.toContain('· —');
    expect(loginLine(e({ ip: '' }))).not.toMatch(/·\s*$/);
  });

  it('битое время показывает как есть, а не «Invalid Date»', () => {
    expect(loginLine(e({ at: 'когда-то' }))).toContain('когда-то');
  });
});

describe('сводка по входам', () => {
  it('считает разных людей, а не записи', () => {
    const list = [e(), e(), e({ email: 'afik3405@gmail.com' })];
    expect(loginSummary(list).people).toBe(2);
  });

  it('регистр почты людей не удваивает', () => {
    const list = [e({ email: 'A@b.kz' }), e({ email: 'a@B.kz' })];
    expect(loginSummary(list).people).toBe(1);
  });

  it('находит последний вход, а не первый в списке', () => {
    const list = [
      e({ at: '2026-09-20T10:00:00.000Z' }),
      e({ at: '2026-09-25T06:30:00.000Z' }),
      e({ at: '2026-09-22T08:00:00.000Z' }),
    ];
    expect(loginSummary(list).last).toBe('2026-09-25T06:30:00.000Z');
  });

  it('пустой список — нормальный ответ, а не поломка', () => {
    expect(loginSummary([])).toEqual({ people: 0, last: undefined });
  });
});
