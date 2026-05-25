import type {
  District, Cable, ValidationIssue, ProjectStatus, ProjectScenarios,
  Materials, PriceCatalog, ProjectSettings, AuditEntry,
} from '@/types/network';
import { checklistProgress } from '@/lib/fieldChecklist';
import { calculateCost } from '@/components/Network/CostCalc';
import { PROJECT_STATUS_LABELS } from '@/types/network';

export interface ProjectDashboardData {
  subscribers: number;
  cableKm: number;
  orkCount: number;
  tbCount: number;
  oltCount: number;
  errors: number;
  warnings: number;
  checklistPct: number;
  checklistDone: number;
  checklistTotal: number;
  grandTotal: number | null;
  currency: string;
  statusLabel: string;
  statusColor: string;
  scenarioA: string | null;
  scenarioB: string | null;
  auditCount: number;
  lastAudit: string | null;
}

export function computeProjectDashboard(
  districts: District[],
  cables: Cable[],
  issues: ValidationIssue[],
  materials: Materials | null,
  prices: PriceCatalog,
  projectStatus: ProjectStatus,
  scenarios: ProjectScenarios,
  auditLog: AuditEntry[],
): ProjectDashboardData {
  let orkCount = 0;
  let tbCount = 0;
  let checklistDone = 0;
  let checklistTotal = 0;

  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      tbCount++;
      if (tb.fieldChecklist) {
        const p = checklistProgress(tb.fieldChecklist);
        checklistDone += p.done;
        checklistTotal += p.total;
      }
      for (const ork of tb.orks) {
        orkCount++;
        if (ork.fieldChecklist) {
          const p = checklistProgress(ork.fieldChecklist);
          checklistDone += p.done;
          checklistTotal += p.total;
        }
      }
    }
  }

  const subscribers = districts.reduce((s, d) => s + d.subscribers.length, 0);
  const cableKm = Math.round(cables.reduce((s, c) => s + c.lengthM, 0) / 10) / 100;
  const st = PROJECT_STATUS_LABELS[projectStatus];
  const cost = materials ? calculateCost(materials, prices) : null;

  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

  return {
    subscribers,
    cableKm,
    orkCount,
    tbCount,
    oltCount: districts.length,
    errors: issues.filter((i) => i.type === 'error').length,
    warnings: issues.filter((i) => i.type === 'warning').length,
    checklistPct: checklistTotal ? Math.round((checklistDone / checklistTotal) * 100) : 0,
    checklistDone,
    checklistTotal,
    grandTotal: cost?.grandTotal ?? null,
    currency: cost?.currency ?? prices.currency,
    statusLabel: st.label,
    statusColor: st.color,
    scenarioA: fmt(scenarios.a?.takenAt),
    scenarioB: fmt(scenarios.b?.takenAt),
    auditCount: auditLog.length,
    lastAudit: auditLog[0]?.at ? fmt(auditLog[0].at) : null,
  };
}
