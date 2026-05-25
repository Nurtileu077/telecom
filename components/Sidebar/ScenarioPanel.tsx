'use client';
import type { ProjectScenarios, PriceCatalog, ProjectSettings } from '@/types/network';
import { compareScenarioDistrictCosts, formatCostDelta } from '@/lib/scenarioDistrictCost';
import { compareScenarioMetrics, metricsFromSlot, type ScenarioCompareRow } from '@/lib/scenarioCompare';
import { diffScenarioCables, diffSummary } from '@/lib/scenarioDiff';
import { useMemo } from 'react';

interface Props {
  scenarios: ProjectScenarios;
  onSaveA: () => void;
  onSaveB: () => void;
  onRestoreA: () => void;
  onRestoreB: () => void;
  readOnly?: boolean;
  scenarioDiffOn?: boolean;
  onToggleScenarioDiff?: () => void;
  settings?: ProjectSettings;
  prices?: PriceCatalog;
}

export default function ScenarioPanel({
  scenarios, onSaveA, onSaveB, onRestoreA, onRestoreB, readOnly,
  scenarioDiffOn, onToggleScenarioDiff, settings, prices,
}: Props) {
  const rows: ScenarioCompareRow[] = useMemo(() => {
    if (!scenarios.a || !scenarios.b) return [];
    return compareScenarioMetrics(
      metricsFromSlot(scenarios.a),
      metricsFromSlot(scenarios.b),
    );
  }, [scenarios]);

  const cableDiff = useMemo(() => {
    if (!scenarios.a || !scenarios.b) return null;
    return diffSummary(diffScenarioCables(scenarios.a, scenarios.b));
  }, [scenarios]);

  const districtCostDiff = useMemo(() => {
    if (!scenarios.a || !scenarios.b || !settings || !prices) return [];
    return compareScenarioDistrictCosts(scenarios.a, scenarios.b, settings, prices);
  }, [scenarios, settings, prices]);

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
      {districtCostDiff.length > 0 && prices && (
        <div>
          <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-1">Δ смета по районам</div>
          <table className="w-full text-[9px] border border-[#1e3a5f] rounded overflow-hidden">
            <thead>
              <tr className="bg-[#0a0e1a] text-[#64748b]">
                <th className="p-1 text-left">Район</th>
                <th className="p-1 text-right">A</th>
                <th className="p-1 text-right">B</th>
                <th className="p-1 text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {districtCostDiff.map((r) => (
                <tr key={r.name} className="border-t border-[#1e3a5f]/50">
                  <td className="p-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: r.color }} />
                    {r.name}
                  </td>
                  <td className="p-1 text-right font-mono text-[#94a3b8]">{Math.round(r.totalA / 1000)}k</td>
                  <td className="p-1 text-right font-mono text-[#94a3b8]">{Math.round(r.totalB / 1000)}k</td>
                  <td className={`p-1 text-right font-mono ${r.delta >= 0 ? 'text-[#f87171]' : 'text-[#34d399]'}`}>
                    {formatCostDelta(r.delta, prices.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cableDiff && (
        <div className="text-[10px] space-y-1 rounded border border-[#1e3a5f] p-2 bg-[#0a0e1a]/80">
          <div className="text-[#64748b] uppercase tracking-wider text-[9px]">Кабели A↔B</div>
          <div className="flex gap-3 font-mono">
            <span className="text-[#34d399]">+{cableDiff.added}</span>
            <span className="text-[#f87171]">−{cableDiff.removed}</span>
            <span className="text-[#fbbf24]">Δ{cableDiff.modified}</span>
          </div>
          {onToggleScenarioDiff && (
            <button
              type="button"
              onClick={onToggleScenarioDiff}
              className={`w-full py-1.5 mt-1 rounded text-[10px] border ${
                scenarioDiffOn
                  ? 'border-[#fbbf24]/50 bg-[#fbbf24]/15 text-[#fbbf24]'
                  : 'border-[#1e3a5f] text-[#94a3b8] hover:text-[#e2e8f0]'
              }`}
            >
              {scenarioDiffOn ? '✓ Diff на карте (выкл)' : '🗺 Показать diff на карте'}
            </button>
          )}
          {scenarioDiffOn && (
            <p className="text-[9px] text-[#64748b]">
              Красный пунктир — только в A, зелёный — в B, жёлтый — изменённая длина/тип.
            </p>
          )}
        </div>
      )}
      {scenarios.a && !scenarios.b && (
        <p className="text-[9px] text-[#64748b]">Сохраните сценарий B для сравнения.</p>
      )}
    </section>
  );
}
