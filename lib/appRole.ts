import type { AppViewMode, UserRole } from '@/types/network';

const ROLE_KEY = 'optiq-user-role';
const ACTOR_KEY = 'optiq-actor-name';

export function getStoredRole(): UserRole {
  if (typeof window === 'undefined') return 'engineer';
  const r = localStorage.getItem(ROLE_KEY);
  if (r === 'field' || r === 'viewer' || r === 'engineer') return r;
  return 'engineer';
}

export function setStoredRole(role: UserRole): void {
  try { localStorage.setItem(ROLE_KEY, role); } catch { /* ignore */ }
}

export function getActorName(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(ACTOR_KEY) ?? '';
}

export function setActorName(name: string): void {
  try { localStorage.setItem(ACTOR_KEY, name.trim()); } catch { /* ignore */ }
}

export function parseUserRole(search: string): UserRole | null {
  const r = new URLSearchParams(search).get('role')?.toLowerCase();
  if (r === 'engineer' || r === 'field' || r === 'viewer') return r;
  return null;
}

/** URL mode + роль → фактический режим UI. */
export function resolveEffectiveMode(urlMode: AppViewMode, role: UserRole): AppViewMode {
  if (role === 'viewer') return 'view';
  if (role === 'field') return urlMode === 'view' ? 'view' : 'field';
  return urlMode;
}

export function roleAllowsStatusChange(role: UserRole): boolean {
  return role === 'engineer';
}
