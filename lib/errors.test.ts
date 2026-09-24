import { describe, it, expect } from 'vitest';
import { plainError, errorLine } from './errors';

/**
 * Всё, что здесь проверяется, — настоящие сообщения, которые видел
 * прораб. По ним нельзя понять ни что случилось, ни что теперь делать.
 */
describe('plainError', () => {
  it('кончилось место — говорит, что освободить', () => {
    const err = new Error('The quota has been exceeded.');
    err.name = 'QuotaExceededError';
    const p = plainError(err);
    expect(p.what).toBe('В браузере кончилось место');
    expect(p.how).toContain('копию журнала');
    expect(p.retry).toBeFalsy();
  });

  it('место узнаёт и по тексту, если имени ошибки нет', () => {
    expect(plainError('DOMException: exceeded the quota').what)
      .toBe('В браузере кончилось место');
  });

  it('нет связи — успокаивает, а не пугает', () => {
    const p = plainError(new TypeError('NetworkError when attempting to fetch resource.'));
    expect(p.what).toBe('Нет связи с сервером');
    expect(p.how).toContain('уйдут сами');
    expect(p.retry).toBe(true);
  });

  it('и «Failed to fetch» — это то же самое', () => {
    expect(plainError(new TypeError('Failed to fetch')).what).toBe('Нет связи с сервером');
  });

  it('битый файл — подсказывает, какой нужен', () => {
    const p = plainError(new SyntaxError('Unexpected token < in JSON at position 0'));
    expect(p.what).toContain('не похож');
    expect(p.how).toContain('.kmz');
  });

  it('нет доступа — говорит, к кому идти', () => {
    expect(plainError(new Error('403 Forbidden')).how).toContain('в конторе');
  });

  it('отмена — это не ошибка и советов не требует', () => {
    const p = plainError(new DOMException('The operation was aborted.', 'AbortError'));
    expect(p.what).toBe('Отменено');
    expect(p.how).toBeUndefined();
  });

  it('незнакомая ошибка не оставляет человека без ответа', () => {
    const p = plainError(new Error('ы'));
    expect(p.what).toBeTruthy();
    expect(p.how).toContain('копию журнала');
    expect(p.retry).toBe(true);
  });

  it('называет дело, которое не получилось, если его назвали', () => {
    expect(plainError(new Error('ы'), 'собрать документ').what)
      .toBe('Не получилось: собрать документ');
  });

  it('исходный текст сохраняет — он нужен при разборе', () => {
    expect(plainError(new Error('boom')).raw).toContain('boom');
  });

  it('не роняется ни на чём', () => {
    for (const bad of [undefined, null, 0, '', {}, [], Symbol('x')]) {
      expect(() => plainError(bad)).not.toThrow();
      expect(plainError(bad).what).toBeTruthy();
    }
  });

  it('ни в одном ответе нет технических слов', () => {
    const cases: unknown[] = [
      new Error('QuotaExceededError'),
      new TypeError('Failed to fetch'),
      new SyntaxError('Unexpected token <'),
      new Error('403'),
      new Error('что-то своё'),
    ];
    for (const c of cases) {
      const p = plainError(c);
      // Расширения файлов человек видит у себя в папке: «.json», «.kmz» —
      // это не термин, а то, что написано на файле.
      const shown = `${p.what} ${p.how ?? ''}`.replace(/\.\w+\b/g, '');
      expect(shown).not.toMatch(/error|fetch|json|quota|token|null|undefined/i);
    }
  });
});

describe('errorLine', () => {
  it('складывает обе части в одну строку', () => {
    const line = errorLine(new TypeError('Failed to fetch'));
    expect(line).toContain('Нет связи с сервером');
    expect(line).toContain('уйдут сами');
  });

  it('когда совета нет, точку не ставит впустую', () => {
    expect(errorLine(new DOMException('aborted', 'AbortError'))).toBe('Отменено');
  });
});
