'use client';
import { useMemo } from 'react';
import type {
  District, Cable, ValidationIssue, Materials, PriceCatalog,
  ProjectStatus, ProjectScenarios, AuditEntry,
} from '@/types/network';
import { computeProjectDashboard } from '@/lib/projectDashboard';
import { formatMoney } from '@/components/Network/CostCalc';
import AuditLogPanel from '@/components/Sidebar/AuditLogPanel';

interface Props {
  districts: District[];
  cables: Cable[];
  issues: ValidationIssue[];
  materials: Materials | null;
  prices: PriceCatalog;
  projectStatus: ProjectStatus;
  scenarios: ProjectScenarios;
  auditLog: AuditEntry[];
  lastSavedAt: string | null;
}

export default function DashboardTab({
  districts, cables, issues, materials, prices, projectStatus, scenarios, auditLog, lastSavedAt,
}: Props) {
  const d = useMemo(
    () => computeProjectDashboard(districts, cables, issues, materials, prices, projectStatus, scenarios, auditLog),
    [districts, cables, issues, materials, prices, projectStatus, scenarios, auditLog],
  );

  if (districts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">📋</div>
        <p className="text-sm text-[#94a3b8]">Постройте сеть для сводки проекта</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full p-3 space-y-4">
      <div
        className="rounded-xl border p-3 text-center"
        style={{ borderColor: `${d.statusColor}44`, background: `${d.statusColor}12` }}
      >
        <div className="text-[10px] text-[#64748b] uppercase tracking-wider">Статус</div>
        <div className="text-lg font-semibold" style={{ color: d.statusColor }}>{d.statusLabel}</div>
        {lastSavedAt && (
          <div className="text-[10px] text-[#64748b] mt-1">
            Сохранено {new Date(lastSavedAt).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard icon="📷" label="Камеры" value={String(d.subscribers)} color="#38bdf8" />
        <StatCard icon="🧵" label="Км кабеля" value={String(d.cableKm)} color="#a78bfa" />
        <StatCard icon="📦" label="ОРК" value={String(d.orkCount)} color="#f59e0b" />
        <StatCard icon="🖥️" label="OLT" value={String(d.oltCount)} color="#34d399" />
      </div>

      {d.grandTotal != null && (
        <div className="rounded-lg border border-[#34d399]/40 bg-[#34d399]/10 p-3 text-center">
          <div className="text-[10px] text-[#64748b]">Оценка сметы</div>
          <div className="text-xl font-mono font-bold text-[#34d399]">
            {formatMoney(d.grandTotal, d.currency)}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[#1e3a5f] p-2">
        <div className="flex justify-between text-[10px] text-[#64748b] mb-1">
          <span>Чеклисты монтажа</span>
          <span className="font-mono text-[#34d399]">{d.checklistPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-[#1e293b] overflow-hidden">
          <div className="h-full bg-[#34d399]" style={{ width: `${d.checklistPct}%` }} />
        </div>
        <div className="text-[9px] text-[#64748b] mt-1">{d.checklistDone} / {d.checklistTotal} пунктов</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
        <div className="rounded border border-[#f87171]/30 p-2">
          <div className="font-mono text-[#f87171] text-lg">{d.errors}</div>
          <div className="text-[#64748b]">ошибок</div>
        </div>
        <div className="rounded border border-[#fbbf24]/30 p-2">
          <div className="font-mono text-[#fbbf24] text-lg">{d.warnings}</div>
          <div className="text-[#64748b]">предупр.</div>
        </div>
      </div>

      {(d.scenarioA || d.scenarioB) && (
        <div className="text-[10px] text-[#64748b] font-mono space-y-0.5">
          <div>Сценарий A: {d.scenarioA ?? '—'}</div>
          <div>Сценарий B: {d.scenarioB ?? '—'}</div>
        </div>
      )}

      <AuditLogPanel entries={auditLog} />
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon?: string; label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 text-center">
      <div className="text-lg font-mono font-bold flex items-center justify-center gap-1" style={{ color }}>
        {icon && <span className="text-sm">{icon}</span>}{value}
      </div>
      <div className="text-[10px] text-[#64748b]">{label}</div>
    </div>
  );
}
