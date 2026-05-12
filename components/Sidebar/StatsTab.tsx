'use client';
import { District, Cable, ValidationIssue, OBJECT_TYPE_LABELS, ObjectType, ProjectSettings } from '@/types/network';

interface Props {
  districts: District[];
  cables: Cable[];
  issues: ValidationIssue[];
  settings: ProjectSettings;
}

export default function StatsTab({ districts, cables, issues, settings }: Props) {
  if (districts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-4xl mb-3">📊</div>
        <p className="text-sm text-[#94a3b8]">Постройте сеть для просмотра статистики</p>
      </div>
    );
  }

  const isP2P = settings.networkType === 'p2p';

  const allSubs = districts.flatMap((d) => d.subscribers);
  const totalSubs = allSubs.length;
  const totalCableM = cables.reduce((s, c) => s + c.lengthM, 0);

  const byObjType = allSubs.reduce((m, s) => {
    const t = s.objectType ?? 'абонент';
    m[t] = (m[t] || 0) + 1;
    return m;
  }, {} as Record<ObjectType, number>);

  const gponCount = allSubs.filter((s) => s.connectionType !== 'p2p' && !isP2P).length;
  const p2pCount  = isP2P ? totalSubs : allSubs.filter((s) => s.connectionType === 'p2p').length;

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
    const allIds = new Set([
      d.olt.id,
      ...d.olt.transitBoxes.map((t) => t.id),
      ...d.olt.transitBoxes.flatMap((t) => t.orks.map((o) => o.id)),
      ...d.subscribers.map((s) => s.id),
    ]);
    const cableM = cables.filter((c) => allIds.has(c.fromId) || allIds.has(c.toId))
      .reduce((s, c) => s + c.lengthM, 0);
    return { district: d, tbs, orks, cableM };
  });

  // Box load distribution
  const boxLoads: number[] = [];
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        const max = ork.splitter === '1:4' ? 4 : ork.splitter === '1:8' ? 8 : 16;
        boxLoads.push(ork.subscribers.length / max);
      }
    }
  }
  const avgLoad = boxLoads.length ? boxLoads.reduce((a, b) => a + b, 0) / boxLoads.length : 0;
  const overload = boxLoads.filter((l) => l > 1).length;
  const underload = boxLoads.filter((l) => l < 0.5).length;

  const nodeLabel = isP2P ? 'УС' : 'OLT';
  const boxLabel  = isP2P ? 'Бокс' : 'ОРК';
  const tbLabel   = isP2P ? 'Муфта' : 'TB';
  const objLabel  = isP2P ? 'объ.' : 'або.';

  return (
    <div className="overflow-y-auto h-full p-3 space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 text-center">
          <div className="text-xl font-mono font-bold text-[#38bdf8]">{totalSubs}</div>
          <div className="text-[10px] text-[#64748b]">всего {objLabel}</div>
        </div>
        <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 text-center">
          <div className="text-xl font-mono font-bold text-[#34d399]">{districts.length}</div>
          <div className="text-[10px] text-[#64748b]">район(ов)</div>
        </div>
        <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 text-center">
          <div className="text-xl font-mono font-bold text-[#f59e0b]">{boxLoads.length}</div>
          <div className="text-[10px] text-[#64748b]">{boxLabel}</div>
        </div>
        <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg p-2 text-center">
          <div className="text-xl font-mono font-bold text-[#a78bfa]">{(totalCableM / 1000).toFixed(1)}</div>
          <div className="text-[10px] text-[#64748b]">км кабеля</div>
        </div>
      </div>

      {/* Connection type (only show in mixed or GPON mode) */}
      {(!isP2P || p2pCount > 0 || gponCount > 0) && (
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Тип подключения</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#0a0e1a] border border-[#34d399]/30 rounded-lg p-2 text-center">
              <div className="text-lg font-mono font-bold text-[#34d399]">{gponCount}</div>
              <div className="text-[10px] text-[#64748b]">GPON</div>
            </div>
            <div className="bg-[#0a0e1a] border border-[#38bdf8]/30 rounded-lg p-2 text-center">
              <div className="text-lg font-mono font-bold text-[#38bdf8]">{p2pCount}</div>
              <div className="text-[10px] text-[#64748b]">P2P (прямое)</div>
            </div>
          </div>
        </section>
      )}

      {/* Object type breakdown */}
      {Object.keys(byObjType).length > 0 && (
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">По типу объекта</h3>
          <div className="space-y-1">
            {(Object.entries(byObjType) as [ObjectType, number][]).map(([type, count]) => {
              const colors: Record<ObjectType, string> = {
                абонент: '#38bdf8', камера: '#22d3ee', база: '#f97316', офис: '#a78bfa',
              };
              const icons: Record<ObjectType, string> = {
                абонент: '🏠', камера: '📷', база: '📡', офис: '🏢',
              };
              const pct = totalSubs ? (count / totalSubs) * 100 : 0;
              return (
                <div key={type} className="flex items-center gap-2">
                  <span className="text-xs w-4">{icons[type]}</span>
                  <span className="text-[10px] text-[#94a3b8] flex-1">{OBJECT_TYPE_LABELS[type]}</span>
                  <span className="text-[10px] font-mono text-[#e2e8f0]">{count}</span>
                  <div className="w-16 h-1.5 bg-[#1e3a5f] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[type] }} />
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
          {Object.entries(cableByType).map(([type, m]) => {
            const pct = totalCableM ? (m / totalCableM) * 100 : 0;
            const colors: Record<string, string> = {
              'ОК-4': '#99d499', 'ОК-8': '#4ade80', 'ОК-12': '#3a92fb', 'ОК-16': '#60a5fa',
              'ОК-24': '#f59e0b', 'ОК-32': '#fbbf24', 'ОК-48': '#ec8a00', 'ОК-96': '#f87171',
            };
            return (
              <div key={type}>
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <span className="text-[#94a3b8]">{type}</span>
                  <span className="font-mono text-[#e2e8f0]">{(m / 1000).toFixed(2)} км ({pct.toFixed(0)}%)</span>
                </div>
                <div className="h-1.5 bg-[#1e3a5f] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[type] || '#888' }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Box / ORK load */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-2">Загрузка {boxLabel}ов</h3>
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
                <div><div className="text-[#38bdf8]">{district.subscribers.length}</div><div className="text-[#64748b]">{objLabel}</div></div>
                <div><div className="text-[#a78bfa]">{tbs}</div><div className="text-[#64748b]">{tbLabel}</div></div>
                <div><div className="text-[#f59e0b]">{orks}</div><div className="text-[#64748b]">{boxLabel}</div></div>
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
