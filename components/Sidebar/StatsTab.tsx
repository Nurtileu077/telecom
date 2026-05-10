'use client';
import { District, Cable, ValidationIssue } from '@/types/network';

interface Props {
  districts: District[];
  cables: Cable[];
  issues: ValidationIssue[];
}

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

  // Per-district stats
  const dStats = districts.map((d) => {
    let orks = 0, tbs = 0;
    for (const tb of d.olt.transitBoxes) {
      tbs++;
      orks += tb.orks.length;
    }
    const dCables = cables.filter((c) => {
      // Crude: check if any endpoint matches this district's IDs
      const allIds = [d.olt.id, ...d.olt.transitBoxes.map((t) => t.id),
                      ...d.olt.transitBoxes.flatMap((t) => t.orks.map((o) => o.id)),
                      ...d.subscribers.map((s) => s.id)];
      return allIds.includes(c.fromId) || allIds.includes(c.toId);
    });
    const cableM = dCables.reduce((s, c) => s + c.lengthM, 0);
    return { district: d, tbs, orks, cableM };
  });

  // ORK load distribution
  const orkLoads: number[] = [];
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        const max = ork.splitter === '1:4' ? 4 : ork.splitter === '1:8' ? 8 : 16;
        orkLoads.push(ork.subscribers.length / max);
      }
    }
  }
  const avgLoad = orkLoads.length ? orkLoads.reduce((a, b) => a + b, 0) / orkLoads.length : 0;
  const overload = orkLoads.filter((l) => l > 1).length;
  const underload = orkLoads.filter((l) => l < 0.5).length;

  return (
    <div className="overflow-y-auto h-full p-3 space-y-4">
      {/* Big stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 text-center">
          <div className="text-xl font-mono font-bold text-[#38bdf8]">{totalSubs}</div>
          <div className="text-[10px] text-[#64748b]">всего або.</div>
        </div>
        <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 text-center">
          <div className="text-xl font-mono font-bold text-[#34d399]">{districts.length}</div>
          <div className="text-[10px] text-[#64748b]">район(ов)</div>
        </div>
        <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 text-center">
          <div className="text-xl font-mono font-bold text-[#f59e0b]">{orkLoads.length}</div>
          <div className="text-[10px] text-[#64748b]">ОРК шкафов</div>
        </div>
        <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 text-center">
          <div className="text-xl font-mono font-bold text-[#a78bfa]">{(totalCableM / 1000).toFixed(1)}</div>
          <div className="text-[10px] text-[#64748b]">км кабеля</div>
        </div>
      </div>

      {/* Cable breakdown */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Структура кабеля</h3>
        <div className="space-y-1.5">
          {Object.entries(cableByType).map(([type, m]) => {
            const pct = totalCableM ? (m / totalCableM) * 100 : 0;
            const colors: Record<string, string> = {
              'ОКБ-10': '#00d4fc', 'ОКСНН-8': '#ec8a00', 'ОКСНН-4': '#3a92fb', 'ОКА-2': '#99d499',
            };
            return (
              <div key={type}>
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <span className="text-[#94a3b8]">{type}</span>
                  <span className="font-mono text-[#e2e8f0]">{(m / 1000).toFixed(2)} км ({pct.toFixed(0)}%)</span>
                </div>
                <div className="h-1.5 bg-[#1e3a5f] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[type] }} />
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
          {dStats.map(({ district, tbs, orks, cableM }) => (
            <div key={district.name} className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: district.color }} />
                <span className="text-xs text-[#e2e8f0] font-medium flex-1 truncate">{district.name}</span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[9px] font-mono">
                <div><div className="text-[#38bdf8]">{district.subscribers.length}</div><div className="text-[#64748b]">або</div></div>
                <div><div className="text-[#a78bfa]">{tbs}</div><div className="text-[#64748b]">TB</div></div>
                <div><div className="text-[#f59e0b]">{orks}</div><div className="text-[#64748b]">ОРК</div></div>
                <div><div className="text-[#34d399]">{(cableM / 1000).toFixed(1)}</div><div className="text-[#64748b]">км</div></div>
              </div>
            </div>
          ))}
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
