'use client';
import { TransitBox, Cable, District } from '@/types/network';
import { TIA_598_COLORS } from '@/components/Network/FiberColors';
import { cablesForEntity } from '@/components/Network/SnapConnect';

interface Props {
  tbId: string | null;
  districts: District[];
  cables: Cable[];
  onClose: () => void;
}

export default function MuftaInterior({ tbId, districts, cables, onClose }: Props) {
  if (!tbId) return null;

  let tb: TransitBox | null = null;
  for (const d of districts) {
    const x = d.olt.transitBoxes.find((t) => t.id === tbId);
    if (x) { tb = x; break; }
  }
  if (!tb) return null;

  const incoming = cables.filter((c) => c.toId === tb.id);
  const outgoing = cables.filter((c) => c.fromId === tb.id);
  const inFibers = incoming.reduce((s, c) => s + c.fibers, 0);
  const outFibers = outgoing.reduce((s, c) => s + c.fibers, 0);
  const used = Math.min(inFibers, outFibers * 2);
  const fillPct = inFibers > 0 ? Math.round((used / inFibers) * 100) : 0;

  return (
    <div className="absolute inset-0 z-[650] flex items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in p-4">
      <div
        className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border-2 border-[#38bdf8]/40 shadow-2xl"
        style={{
          background: 'linear-gradient(180deg, #0f172a 0%, #0a0e1a 100%)',
          boxShadow: '0 0 40px rgba(56,189,248,0.15), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-[#1e3a5f] bg-[#0d1b2a]/95">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#38bdf8]">Внутри муфты</div>
            <div className="text-sm font-bold text-[#e2e8f0] font-mono">{tb.id}</div>
            <div className="text-[10px] text-[#64748b]">{tb.muftaType} · {tb.district}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-[#1e3a5f] text-[#94a3b8] hover:text-white hover:border-[#38bdf8]/50"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="relative h-24 rounded-xl border border-[#1e3a5f] bg-[#050810] overflow-hidden">
            <div
              className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#38bdf8]/30 to-transparent transition-all"
              style={{ height: `${Math.min(100, fillPct)}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center gap-6 text-center">
              <div>
                <div className="text-2xl font-bold text-[#38bdf8]">{incoming.length}</div>
                <div className="text-[9px] text-[#64748b] uppercase">Вход</div>
                <div className="text-[10px] text-[#94a3b8]">{inFibers} вол.</div>
              </div>
              <div className="text-3xl opacity-40">⊕</div>
              <div>
                <div className="text-2xl font-bold text-[#34d399]">{outgoing.length}</div>
                <div className="text-[9px] text-[#64748b] uppercase">Выход</div>
                <div className="text-[10px] text-[#94a3b8]">{outFibers} вол.</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Section title="Входящие" color="#38bdf8" items={incoming} direction="in" />
            <Section title="Исходящие" color="#34d399" items={outgoing} direction="out" />
          </div>

          {cablesForEntity(cables, tb.id).length === 0 && (
            <p className="text-[11px] text-amber-400/90 text-center py-2">
              Пустая муфта — поставьте на кабель или протяните связь вручную
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title, color, items, direction,
}: {
  title: string;
  color: string;
  items: Cable[];
  direction: 'in' | 'out';
}) {
  return (
    <div className="rounded-lg border border-[#1e3a5f] bg-[#0a0e1a]/80 p-2">
      <div className="text-[10px] font-semibold mb-2" style={{ color }}>{title}</div>
      {items.length === 0 ? (
        <div className="text-[10px] text-[#64748b] italic py-4 text-center">— пусто —</div>
      ) : (
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {items.map((c) => (
            <div key={c.id} className="rounded border border-[#1e3a5f]/60 p-1.5">
              <div className="text-[9px] font-mono text-[#94a3b8] truncate mb-1">
                {direction === 'in' ? `${c.fromId} →` : `→ ${c.toId}`}
                <span className="text-[#e2e8f0] ml-1">{c.type}</span>
              </div>
              <div className="grid grid-cols-12 gap-px">
                {Array.from({ length: Math.min(c.fibers, 24) }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-[1px]"
                    style={{ background: TIA_598_COLORS[i % 12].hex }}
                    title={`#${i + 1}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
