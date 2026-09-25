import { authGetSession } from '@/lib/authSession';

/**
 * Можно ли сейчас обращаться к облаку.
 *
 * Раньше это решала настройка сборки: без NEXT_PUBLIC_OPTIQ_REQUIRE_AUTH
 * приложение лезло на сервер и без входа. Пока политики доступа пускали
 * строки «без организации», это даже работало.
 *
 * Теперь не работает и работать не должно: строки в базе принадлежат
 * организации, а организация берётся из входа. Без сессии сервер ответит
 * отказом — и человек увидит ошибку Postgres вместо понятного «войдите».
 *
 * Поэтому решает не настройка, а положение дел: облако настроено —
 * значит, нужен вход.
 */

export class AuthRequiredError extends Error {
  constructor() {
    super('AUTH_REQUIRED');
    this.name = 'AuthRequiredError';
  }
}

/**
 * Настройка осталась, но значит теперь другое: «требовать вход даже там,
 * где облако не настроено». Пригодится, если доступ к приложению нужно
 * закрыть целиком, а не только к обмену.
 */
export function isAuthRequired(): boolean {
  return process.env.NEXT_PUBLIC_OPTIQ_REQUIRE_AUTH === '1';
}

export function isAuthRequiredError(e: unknown): e is AuthRequiredError {
  return e instanceof AuthRequiredError;
}

/**
 * Пускать ли к облаку.
 *
 * Отдельно от самой проверки, чтобы решение можно было проверить, не
 * поднимая ни браузера, ни сервера.
 */
export function mayUseCloud(hasSession: boolean): boolean {
  return hasSession;
}

/** Не пускает к облаку без входа: строки в базе принадлежат организации. */
export async function assertSupabaseAccess(): Promise<void> {
  const { user } = await authGetSession();
  if (!mayUseCloud(!!user)) throw new AuthRequiredError();
}
