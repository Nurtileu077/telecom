'use client';
import type { ProjectScenarios } from '@/types/network';
import { compareScenarioMetrics, metricsFromSlot, type ScenarioCompareRow } from '@/lib/scenarioCompare';
import { useMemo } from 'react';

interface Props {
  scenarios: ProjectScenarios;
  onSaveA: () => void;
  onSaveB: () => void;
  onRestoreA: () => void;
  onRestoreB: () => void;
  readOnly?: boolean;
}

export default function ScenarioPanel({
  scenarios, onSaveA, onSaveB, onRestoreA, onRestoreB, readOnly,
}: Props) {
  const rows: ScenarioCompareRow[] = useMemo(() => {
    if (!scenarios.a || !scenarios.b) return [];
    return compareScenarioMetrics(
      metricsFromSlot(scenarios.a),
      metricsFromSlot(scenarios.b),
    );
  }, [scenarios]);

  const fmtDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <section className="space-y-2">
      <h3 className="section-title">Сценарии A / B</h3>
      <p className="text-[9px] text-[#64748b]">
        Сохраните два варианта сети и сравните метрики без 2GIS.
      </p>
      {!readOnly && (
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={onSaveA} className="btn btn-secondary text-[10px] py-1.5">
            💾 Сценарий A
          </button>
          <button type="button" onClick={onSaveB} className="btn btn-secondary text-[10px] py-1.5">
            💾 Сценарий B
          </button>
          <button type="button" onClick={onRestoreA} disabled={!scenarios.a} className="btn btn-ghost text-[10px] py-1 disabled:opacity-40">
            ↩ A
          </button>
          <button type="button" onClick={onRestoreB} disabled={!scenarios.b} className="btn btn-ghost text-[10px] py-1 disabled:opacity-40">
            ↩ B
          </button>
        </div>
      )}
      <div className="text-[10px] text-[#64748b] font-mono space-y-0.5">
        <div>A: {fmtDate(scenarios.a?.takenAt)}</div>
        <div>B: {fmtDate(scenarios.b?.takenAt)}</div>
      </div>
      {rows.length > 0 && (
        <table className="w-full text-[10px] border border-[#1e3a5f] rounded overflow-hidden">
          <thead>
            <tr className="bg-[#0a0e1a] text-[#64748b]">
              <th className="p-1 text-left">Показатель</th>
              <th className="p-1 text-right">A</th>
              <th className="p-1 text-right">B</th>
              <th className="p-1 text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-[#1e3a5f]/50">
                <td className="p-1 text-[#94a3b8]">{r.label}</td>
                <td className="p-1 text-right font-mono">{r.a}</td>
                <td className="p-1 text-right font-mono">{r.b}</td>
                <td className="p-1 text-right font-mono text-[#38bdf8]">{r.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {scenarios.a && !scenarios.b && (
        <p className="text-[9px] text-[#64748b]">Сохраните сценарий B для сравнения.</p>
      )}
    </section>
  );
}
