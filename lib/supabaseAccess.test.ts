import { describe, it, expect } from 'vitest';
import { mayUseCloud, isAuthRequiredError, AuthRequiredError } from './supabaseAccess';

/**
 * Строки в базе принадлежат организации, а организация берётся из входа.
 * Без сессии сервер отвечает отказом — и без этой проверки человек видел
 * бы ошибку Postgres вместо понятного «войдите».
 */
describe('кого пускать к облаку', () => {
  it('вошедшего — пускаем', () => {
    expect(mayUseCloud(true)).toBe(true);
  });

  it('невошедшего — нет, и настройка сборки тут ничего не меняет', () => {
    expect(mayUseCloud(false)).toBe(false);
  });
});

describe('отказ по входу узнаётся отдельно от прочих', () => {
  it('свою ошибку узнаёт', () => {
    expect(isAuthRequiredError(new AuthRequiredError())).toBe(true);
  });

  it('чужую — нет: «нет связи» и «войдите» лечатся по-разному', () => {
    expect(isAuthRequiredError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAuthRequiredError('AUTH_REQUIRED')).toBe(false);
    expect(isAuthRequiredError(null)).toBe(false);
  });
});
