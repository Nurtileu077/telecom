'use client';
import { TransitBox, Cable, District } from '@/types/network';
import { TIA_598_COLORS } from '@/components/Network/FiberColors';

interface Props {
  tbId: string | null;
  districts: District[];
  cables: Cable[];
  onClose: () => void;
}

export default function SplicePlan({ tbId, districts, cables, onClose }: Props) {
  if (!tbId) return null;

  // Find the TB
  let tb: TransitBox | null = null;
  for (const d of districts)
    for (const x of d.olt.transitBoxes)
      if (x.id === tbId) tb = x;
  if (!tb) return null;

  // Input cable: OLT → TB (or from another TB if chained)
  const incoming = cables.filter((c) => c.toId === tb!.id);
  // Outgoing: TB → ORK
  const outgoing = cables.filter((c) => c.fromId === tb!.id);

  // Assign fiber-level splice mapping: greedily allocate input fibers to outputs
  // 1 fiber per ORK (working) + 1 spare. So each ORK consumes 2 fibers from input.
  const splices: { in: number; out: number; orkId: string; cableId: string }[] = [];
  let cursor = 0;
  for (const o of outgoing) {
    for (let i = 0; i < 2 && i < o.fibers; i++) {
      splices.push({ in: cursor, out: i, orkId: o.toId, cableId: o.id });
      cursor++;
    }
  }
  const totalInputFibers = incoming.reduce((s, c) => s + c.fibers, 0);

  return (
    <div className="absolute top-2 md:top-3 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[600] md:w-[480px] max-h-[min(75dvh,80vh)] overflow-y-auto bg-[#0d1b2a]/98 border border-[#1e3a5f] rounded-xl shadow-2xl backdrop-blur-sm animate-fade-in">
      <div className="sticky top-0 bg-[#0d1b2a]/98 backdrop-blur flex items-center justify-between px-3 py-2.5 border-b border-[#1e3a5f]">
        <div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#38bdf8]/20 text-[#38bdf8]">Сплайс-план</span>
          <div className="text-xs font-semibold text-[#e2e8f0] mt-0.5">{tb.id} · {tb.muftaType}</div>
        </div>
        <button onClick={onClose} className="text-[#64748b] hover:text-white px-1 text-base">×</button>
      </div>

      <div className="p-3 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <Stat label="Вход" value={incoming.length} sub={`${totalInputFibers} вол.`} color="#38bdf8" />
          <Stat label="Выход" value={outgoing.length} sub={`${outgoing.reduce((s, c) => s + c.fibers, 0)} вол.`} color="#34d399" />
          <Stat label="Сварки" value={splices.length} sub="(работ. + резерв)" color="#a78bfa" />
        </div>

        {/* Incoming cables */}
        <div>
          <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-1">Входящие</div>
          {incoming.length === 0
            ? <div className="text-[10px] text-[#64748b] italic">Нет входящих кабелей</div>
            : incoming.map((c) => (
              <div key={c.id} className="bg-[#0a0e1a] rounded p-2 mb-1.5">
                <div className="flex items-center justify-between text-[10px] text-[#94a3b8] mb-1">
                  <span>{c.fromId} → <b className="text-[#e2e8f0]">{c.toId}</b></span>
                  <span className="font-mono text-[#34d399]">{c.type}</span>
                </div>
                <div className="grid grid-cols-12 gap-0.5">
                  {Array.from({ length: c.fibers }).map((_, i) => {
                    const tia = TIA_598_COLORS[i % 12];
                    return (
                      <div
                        key={i}
                        className="aspect-square rounded-sm border border-[#1e3a5f]/40"
                        title={`#${i + 1} ${tia.name}`}
                        style={{ background: tia.hex }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
        </div>

        {/* Splice map */}
        <div>
          <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-1">Карта сварок</div>
          {splices.length === 0
            ? <div className="text-[10px] text-[#64748b] italic">Нет выходящих волокон</div>
            : (
              <div className="bg-[#0a0e1a] rounded p-2 space-y-0.5 max-h-48 overflow-y-auto">
                <div className="grid grid-cols-[60px_1fr_auto_1fr_auto] gap-1 text-[10px] text-[#64748b] font-mono px-1 pb-1 border-b border-[#1e3a5f]/40">
                  <span>Вход</span>
                  <span>Цвет</span>
                  <span>→</span>
                  <span>Цвет</span>
                  <span>ОРК</span>
                </div>
                {splices.map((s, idx) => {
                  const cIn = TIA_598_COLORS[s.in % 12];
                  const cOut = TIA_598_COLORS[s.out % 12];
                  const isWorking = idx % 2 === 0;
                  return (
                    <div key={idx} className="grid grid-cols-[60px_1fr_auto_1fr_auto] gap-1 text-[10px] items-center px-1">
                      <span className="font-mono text-[#94a3b8]">#{s.in + 1}</span>
                      <div className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm" style={{ background: cIn.hex }} />
                        <span className="text-[#64748b]">{cIn.name}</span>
                      </div>
                      <span className={isWorking ? 'text-[#34d399]' : 'text-[#f59e0b]'}>{isWorking ? '◇' : '◇'}</span>
                      <div className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm" style={{ background: cOut.hex }} />
                        <span className="text-[#64748b]">{cOut.name}</span>
                      </div>
                      <span className="font-mono text-[#e2e8f0] truncate" title={s.orkId}>{s.orkId}</span>
                    </div>
                  );
                })}
              </div>
            )}
          <div className="text-[9px] text-[#475569] mt-1.5">
            ◇ зелёный = рабочее волокно · ◇ оранжевый = резерв · {totalInputFibers - splices.length} вол. свободно
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  return (
    <div className="bg-[#0a0e1a] rounded p-1.5 text-center" style={{ borderLeft: `2px solid ${color}` }}>
      <div className="font-mono text-sm font-bold" style={{ color }}>{value}</div>
      <div className="text-[9px] text-[#64748b]">{label}</div>
      <div className="text-[9px] text-[#64748b]">{sub}</div>
    </div>
  );
}
