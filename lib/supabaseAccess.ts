import { authGetSession } from '@/lib/authSession';

export class AuthRequiredError extends Error {
  constructor() {
    super('AUTH_REQUIRED');
    this.name = 'AuthRequiredError';
  }
}

export function isAuthRequired(): boolean {
  return process.env.NEXT_PUBLIC_OPTIQ_REQUIRE_AUTH === '1';
}

export function isAuthRequiredError(e: unknown): e is AuthRequiredError {
  return e instanceof AuthRequiredError;
}

/** Блокирует облачные операции без сессии, если включён NEXT_PUBLIC_OPTIQ_REQUIRE_AUTH=1. */
export async function assertSupabaseAccess(): Promise<void> {
  if (!isAuthRequired()) return;
  const { user } = await authGetSession();
  if (!user) throw new AuthRequiredError();
}
