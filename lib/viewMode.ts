import type { AppViewMode } from '@/types/network';

export function parseAppViewMode(search: string): AppViewMode {
  const m = new URLSearchParams(search).get('mode')?.toLowerCase();
  if (m === 'view' || m === 'readonly') return 'view';
  if (m === 'field') return 'field';
  return 'edit';
}

export function buildShareViewUrl(projectId: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const u = new URL(path, base);
  u.searchParams.set('mode', 'view');
  u.searchParams.set('project', projectId);
  return u.toString();
}

export function isMutationAllowed(mode: AppViewMode): boolean {
  return mode === 'edit';
}

export function isFieldToolsAllowed(mode: AppViewMode): boolean {
  return mode === 'edit' || mode === 'field';
}

export function buildShareFieldUrl(projectId: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const u = new URL(path, base);
  u.searchParams.set('mode', 'field');
  u.searchParams.set('role', 'field');
  u.searchParams.set('project', projectId);
  return u.toString();
}
