'use client';
import { District, Cable, ValidationIssue, CABLE_COLORS, CAMERA_KIND_LABEL, CAMERA_KIND_COLOR, CameraKind } from '@/types/network';

interface Props {
  districts: District[];
  cables: Cable[];
  issues: ValidationIssue[];
}

const splitterCap = (s: string) => (s === '1:4' ? 4 : s === '1:8' ? 8 : s === '1:16' ? 16 : s === '1:32' ? 32 : s === '1:64' ? 64 : s === '1:2' ? 2 : 8);

export default function StatsTab({ districts, cables, issues }: Props) {
  if (districts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">📊</div>
        <p className="text-sm text-[#94a3b8]">Постройте сеть для просмотра статистики</p>
      </div>
    );
  }

  const totalSubs = districts.reduce((s, d) => s + d.subscribers.length, 0);
  const totalCableM = cables.reduce((s, c) => s + c.lengthM, 0);

  const cableByType = cables.reduce((m, c) => {
    m[c.type] = (m[c.type] || 0) + c.lengthM;
    return m;
  }, {} as Record<string, number>);

  // Camera type breakdown (по камерам в ОРК)
  const camByKind: Record<string, number> = {};
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        for (const sub of ork.subscribers) {
          const k = sub.kind ?? 'unknown';
          camByKind[k] = (camByKind[k] || 0) + 1;
        }
      }
    }
  }

  // Per-district stats
  const dStats = districts.map((d) => {
    let orks = 0, tbs = 0, usedPorts = 0, capPorts = 0;
    for (const tb of d.olt.transitBoxes) {
      tbs++;
      for (const ork of tb.orks) {
        orks++;
        usedPorts += ork.subscribers.length;
        capPorts += splitterCap(ork.splitter);
      }
    }
    const allIds = [d.olt.id, ...d.olt.transitBoxes.map((t) => t.id),
      ...d.olt.transitBoxes.flatMap((t) => t.orks.map((o) => o.id)),
      ...d.subscribers.map((s) => s.id)];
    const cableM = cables.filter((c) => allIds.includes(c.fromId) || allIds.includes(c.toId)).reduce((s, c) => s + c.lengthM, 0);
    return { district: d, tbs, orks, cableM, usedPorts, capPorts };
  });

  // ORK load distribution + capacity
  const orkLoads: number[] = [];
  let totalUsedPorts = 0, totalCapPorts = 0, totalTbs = 0;
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      totalTbs++;
      for (const ork of tb.orks) {
        const max = splitterCap(ork.splitter);
        orkLoads.push(ork.subscribers.length / max);
        totalUsedPorts += ork.subscribers.length;
        totalCapPorts += max;
      }
    }
  }
  const avgLoad = orkLoads.length ? orkLoads.reduce((a, b) => a + b, 0) / orkLoads.length : 0;
  const overload = orkLoads.filter((l) => l > 1).length;
  const underload = orkLoads.filter((l) => l < 0.5).length;
  const utilization = totalCapPorts ? (totalUsedPorts / totalCapPorts) * 100 : 0;

  return (
    <div className="overflow-y-auto h-full p-3 space-y-4">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#38bdf8]/15 to-[#a78bfa]/10 border border-[#38bdf8]/30 rounded-xl p-4">
        <div className="text-[10px] text-[#94a3b8] uppercase tracking-wider">Всего камер</div>
        <div className="text-3xl font-mono font-bold text-[#38bdf8] leading-tight">{totalSubs}</div>
        <div className="grid grid-cols-4 gap-2 mt-3 text-center">
          <div><div className="text-sm font-mono font-bold text-[#34d399]">{districts.length}</div><div className="text-[9px] text-[#64748b]">район</div></div>
          <div><div className="text-sm font-mono font-bold text-[#a78bfa]">{totalTbs}</div><div className="text-[9px] text-[#64748b]">муфт</div></div>
          <div><div className="text-sm font-mono font-bold text-[#f59e0b]">{orkLoads.length}</div><div className="text-[9px] text-[#64748b]">ОРК</div></div>
          <div><div className="text-sm font-mono font-bold text-[#e2e8f0]">{(totalCableM / 1000).toFixed(1)}</div><div className="text-[9px] text-[#64748b]">км</div></div>
        </div>
      </div>

      {/* Port utilization */}
      <section>
        <div className="flex items-center justify-between text-[10px] mb-1">
          <h3 className="uppercase tracking-widest text-[#64748b]">Утилизация портов</h3>
          <span className="font-mono text-[#e2e8f0]">{totalUsedPorts} / {totalCapPorts} ({utilization.toFixed(0)}%)</span>
        </div>
        <div className="h-2.5 bg-[#1e3a5f] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, utilization)}%`, background: utilization > 90 ? '#f87171' : utilization > 70 ? '#fbbf24' : '#34d399' }} />
        </div>
      </section>

      {/* Camera breakdown */}
      {Object.keys(camByKind).length > 0 && (
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Типы камер</h3>
          <div className="space-y-1.5">
            {Object.entries(camByKind).sort((a, b) => b[1] - a[1]).map(([kind, n]) => {
              const pct = totalSubs ? (n / totalSubs) * 100 : 0;
              const label = CAMERA_KIND_LABEL[kind as CameraKind] ?? kind;
              const color = CAMERA_KIND_COLOR[kind as CameraKind] ?? '#64748b';
              return (
                <div key={kind}>
                  <div className="flex items-center justify-between text-[10px] mb-0.5">
                    <span className="text-[#94a3b8] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: color }} />{label}
                    </span>
                    <span className="font-mono text-[#e2e8f0]">{n} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 bg-[#1e3a5f] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Cable breakdown */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Структура кабеля</h3>
        <div className="space-y-1.5">
          {Object.entries(cableByType).sort((a, b) => b[1] - a[1]).map(([type, m]) => {
            const pct = totalCableM ? (m / totalCableM) * 100 : 0;
            const color = CABLE_COLORS[type as keyof typeof CABLE_COLORS] ?? '#64748b';
            return (
              <div key={type}>
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <span className="text-[#94a3b8]">{type}</span>
                  <span className="font-mono text-[#e2e8f0]">{(m / 1000).toFixed(2)} км ({pct.toFixed(0)}%)</span>
                </div>
                <div className="h-1.5 bg-[#1e3a5f] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Loading */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Загрузка ОРК</h3>
        <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="bg-[#0a0e1a] border border-[#34d399]/30 rounded p-1.5">
            <div className="font-mono text-[#34d399] font-bold">{(avgLoad * 100).toFixed(0)}%</div>
            <div className="text-[#64748b]">средняя</div>
          </div>
          <div className="bg-[#0a0e1a] border border-[#f87171]/30 rounded p-1.5">
            <div className="font-mono text-[#f87171] font-bold">{overload}</div>
            <div className="text-[#64748b]">перегруз</div>
          </div>
          <div className="bg-[#0a0e1a] border border-[#fbbf24]/30 rounded p-1.5">
            <div className="font-mono text-[#fbbf24] font-bold">{underload}</div>
            <div className="text-[#64748b]">недогр.</div>
          </div>
        </div>
      </section>

      {/* Per district */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">По районам</h3>
        <div className="space-y-2">
          {dStats.map(({ district, tbs, orks, cableM, usedPorts, capPorts }) => {
            const util = capPorts ? (usedPorts / capPorts) * 100 : 0;
            return (
              <div key={district.name} className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: district.color }} />
                  <span className="text-xs text-[#e2e8f0] font-medium flex-1 truncate">{district.name}</span>
                  <span className="text-[9px] font-mono text-[#64748b]">{util.toFixed(0)}%</span>
                </div>
                <div className="grid grid-cols-4 gap-1 text-[9px] font-mono mb-1.5">
                  <div><div className="text-[#38bdf8]">{district.subscribers.length}</div><div className="text-[#64748b]">кам</div></div>
                  <div><div className="text-[#a78bfa]">{tbs}</div><div className="text-[#64748b]">муфт</div></div>
                  <div><div className="text-[#f59e0b]">{orks}</div><div className="text-[#64748b]">ОРК</div></div>
                  <div><div className="text-[#34d399]">{(cableM / 1000).toFixed(1)}</div><div className="text-[#64748b]">км</div></div>
                </div>
                <div className="h-1 bg-[#1e3a5f] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, util)}%`, background: district.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Issues */}
      {issues.length > 0 && (
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">⚠️ Предупреждения ({issues.length})</h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {issues.map((iss, i) => (
              <div key={i} className="text-[10px] text-[#fbbf24] p-1.5 bg-[#fbbf24]/5 border border-[#fbbf24]/20 rounded">
                {iss.message}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
