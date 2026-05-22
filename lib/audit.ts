import type { AuditEntry } from '@/types/network';

export const AUDIT_LOG_MAX = 200;

export function newAuditEntry(
  action: string,
  opts?: { detail?: string; entityId?: string; actor?: string },
): AuditEntry {
  return {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    action,
    detail: opts?.detail,
    entityId: opts?.entityId,
    actor: opts?.actor?.trim() || undefined,
  };
}

export function appendAudit(prev: AuditEntry[], entry: AuditEntry): AuditEntry[] {
  return [entry, ...prev].slice(0, AUDIT_LOG_MAX);
}
