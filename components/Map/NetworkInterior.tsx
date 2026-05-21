'use client';
import { useEffect, useMemo, useState } from 'react';
import type { District, Cable } from '@/types/network';
import type { SubBudget } from '@/components/Network/PowerBudget';
import {
  type InteriorView,
  resolveInterior,
  cameraLabel,
  fiberSwatch,
  budgetStatusLabel,
  budgetStatusColor,
  type OrkPort,
  type CableLink,
  type FiberSplice,
} from '@/components/Network/entityInterior';
import { TIA_598_COLORS } from '@/components/Network/FiberColors';
import { SAFE_LOSS_DB } from '@/components/Network/PowerBudget';

interface Props {
  view: InteriorView | null;
  districts: District[];
  cables: Cable[];
  powerBudgets: SubBudget[];
  onClose: () => void;
  onOpenEntity?: (kind: InteriorView['kind'], id: string) => void;
}

const KIND_THEME: Record<InteriorView['kind'], { accent: string; label: string }> = {
  olt: { accent: '#f59e0b', label: 'Внутри OLT' },
  tb: { accent: '#38bdf8', label: 'Внутри муфты' },
  ork: { accent: '#a78bfa', label: 'Внутри ОРК' },
};

export default function NetworkInterior({
  view, districts, cables, powerBudgets, onClose, onOpenEntity,
}: Props) {
  const data = useMemo(
    () => (view ? resolveInterior(view, districts, cables, powerBudgets) : null),
    [view, districts, cables, powerBudgets],
  );
  const [selectedPort, setSelectedPort] = useState<number | null>(null);

  useEffect(() => {
    setSelectedPort(null);
  }, [view?.kind, view?.id]);

  if (!view || !data) return null;

  const theme = KIND_THEME[data.kind];

  return (
    <div className="absolute inset-0 z-[650] flex items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in p-3 md:p-4">
      <div
        className="w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-2xl border-2 shadow-2xl"
        style={{
          borderColor: `${theme.accent}66`,
          background: 'linear-gradient(180deg, #0f172a 0%, #0a0e1a 100%)',
          boxShadow: `0 0 40px ${theme.accent}22`,
        }}
      >
        <Header
          theme={theme}
          title={data.kind === 'olt' ? data.olt.id : data.kind === 'tb' ? data.tb.id : data.ork.id}
          subtitle={
            data.kind === 'olt'
              ? `${data.district} · ${data.olt.model}`
              : data.kind === 'tb'
                ? `${data.tb.muftaType} · ${data.tb.district}`
                : `${data.ork.boxType} · сплиттер ${data.ork.splitter}`
          }
          onClose={onClose}
        />

        <ComplexityCard badge={data.complexity} />

        <div className="p-4 space-y-4">
          {data.kind === 'olt' && (
            <OltBody data={data} onOpenEntity={onOpenEntity} />
          )}
          {data.kind === 'tb' && (
            <TbBody data={data} onOpenEntity={onOpenEntity} />
          )}
          {data.kind === 'ork' && (
            <OrkBody
              data={data}
              selectedPort={selectedPort}
              onSelectPort={setSelectedPort}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Header({
  theme, title, subtitle, onClose,
}: {
  theme: { accent: string; label: string };
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div
      className="sticky top-0 flex items-center justify-between px-4 py-3 border-b bg-[#0d1b2a]/95"
      style={{ borderColor: '#1e3a5f' }}
    >
      <div>
        <div className="text-[10px] uppercase tracking-widest" style={{ color: theme.accent }}>
          {theme.label}
        </div>
        <div className="text-sm font-bold text-[#e2e8f0] font-mono">{title}</div>
        <div className="text-[10px] text-[#64748b]">{subtitle}</div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-8 h-8 rounded-lg border border-[#1e3a5f] text-[#94a3b8] hover:text-white"
      >
        ×
      </button>
    </div>
  );
}

function ComplexityCard({ badge }: { badge: import('@/components/Network/entityInterior').ComplexityBadge }) {
  return (
    <div className="mx-4 mt-3 rounded-xl border border-[#1e3a5f] bg-[#050810]/90 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-xs font-bold" style={{ color: badge.color }}>{badge.title}</div>
          <div className="text-[10px] text-[#64748b]">{badge.subtitle}</div>
        </div>
        <div className="text-[10px] text-[#94a3b8] font-mono">{badge.score}/100</div>
      </div>
      <div className="h-2 rounded-full bg-[#1e293b] overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${badge.score}%`, background: badge.color }}
        />
      </div>
      <div className="flex gap-0.5 mb-2" aria-label={`Сложность ${badge.stars} из 5`}>
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="text-sm" style={{ opacity: i < badge.stars ? 1 : 0.2 }}>★</span>
        ))}
      </div>
      <ul className="text-[10px] text-[#94a3b8] space-y-0.5 list-disc list-inside">
        {badge.hints.map((h) => <li key={h}>{h}</li>)}
      </ul>
    </div>
  );
}

function OltBody({
  data,
  onOpenEntity,
}: {
  data: import('@/components/Network/entityInterior').OltInteriorData;
  onOpenEntity?: (kind: InteriorView['kind'], id: string) => void;
}) {
  const { olt, links } = data;
  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Муфты" value={data.tbCount} color="#38bdf8" />
        <MiniStat label="ОРК" value={data.orkCount} color="#a78bfa" />
        <MiniStat label="Камеры" value={data.subCount} color="#34d399" />
      </div>
      <div className="rounded-lg border border-[#1e3a5f] p-2 text-[10px] text-[#94a3b8]">
        L1 сплиттер <span className="text-[#f59e0b] font-mono">{olt.l1Splitter}</span>
        {' · '}портов {olt.capacity}
      </div>
      <LinkList title="Кабели OLT" links={links} onOpenEntity={onOpenEntity} />
      <div>
        <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-2">Ветки сети</div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {olt.transitBoxes.length === 0 ? (
            <EmptyHint text="Нет муфт — добавьте муфту от OLT" />
          ) : (
            olt.transitBoxes.map((tb) => (
              <div key={tb.id} className="rounded-lg border border-[#1e3a5f]/80 bg-[#0a0e1a]/80 p-2">
                <button
                  type="button"
                  className="text-[11px] font-mono text-[#38bdf8] hover:underline w-full text-left"
                  onClick={() => onOpenEntity?.('tb', tb.id)}
                >
                  🔷 {tb.id} → {tb.orks.length} ОРК
                </button>
                <div className="mt-1 pl-2 border-l border-[#1e3a5f]/50 space-y-0.5">
                  {tb.orks.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="block text-[10px] font-mono text-[#a78bfa] hover:underline"
                      onClick={() => onOpenEntity?.('ork', o.id)}
                    >
                      📦 {o.id} · {o.subscribers.length} кам.
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function TbBody({
  data,
  onOpenEntity,
}: {
  data: import('@/components/Network/entityInterior').TbInteriorData;
  onOpenEntity?: (kind: InteriorView['kind'], id: string) => void;
}) {
  const inLinks = data.links.filter((l) => l.direction === 'in');
  const outLinks = data.links.filter((l) => l.direction === 'out');
  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Вход" value={inLinks.length} sub={`${inLinks.reduce((s, l) => s + l.cable.fibers, 0)} вол.`} color="#38bdf8" />
        <MiniStat label="Выход" value={outLinks.length} sub={`${outLinks.reduce((s, l) => s + l.cable.fibers, 0)} вол.`} color="#34d399" />
        <MiniStat label="Сварки" value={data.splices.length} sub={`${data.freeFibers} своб.`} color="#a78bfa" />
      </div>
      {data.links.length === 0 && (
        <EmptyHint text="Пустая муфта — поставьте на кабель или соедините вручную" />
      )}
      <LinkList title="Все подключения" links={data.links} onOpenEntity={onOpenEntity} />
      <div>
        <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-2">Куда идёт каждая волокна</div>
        {data.splices.length === 0 ? (
          <EmptyHint text="Нет исходящих кабелей — сварки не построены" />
        ) : (
          <div className="rounded-lg border border-[#1e3a5f] bg-[#0a0e1a]/80 max-h-52 overflow-y-auto">
            <SpliceTable splices={data.splices} onOpenTarget={onOpenEntity} />
          </div>
        )}
      </div>
      <div>
        <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-1">ОРК в муфте</div>
        {data.tb.orks.length === 0 ? (
          <EmptyHint text="Нет ОРК" />
        ) : (
          <div className="flex flex-wrap gap-1">
            {data.tb.orks.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onOpenEntity?.('ork', o.id)}
                className="text-[10px] font-mono px-2 py-1 rounded border border-[#a78bfa]/40 text-[#a78bfa] hover:bg-[#a78bfa]/10"
              >
                {o.id}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function OrkBody({
  data,
  selectedPort,
  onSelectPort,
}: {
  data: import('@/components/Network/entityInterior').OrkInteriorData;
  selectedPort: number | null;
  onSelectPort: (n: number | null) => void;
}) {
  const active = selectedPort != null
    ? data.ports.find((p) => p.index === selectedPort)
    : null;

  return (
    <>
      {data.uplink && (
        <div className="text-[10px] text-[#94a3b8] border border-[#1e3a5f] rounded px-2 py-1.5 font-mono">
          ↑ от муфты {data.tb?.id ?? '—'}: {data.uplink.type} · {Math.round(data.uplink.lengthM)} м
        </div>
      )}
      {!data.uplink && <EmptyHint text="Нет входящего кабеля от муфты" />}
      <div>
        <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-2">
          Посты сплиттера ({data.ork.splitter})
        </div>
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.min(4, data.maxPorts)}, minmax(0, 1fr))` }}
        >
          {data.ports.map((port) => (
            <PortTile
              key={port.index}
              port={port}
              selected={selectedPort === port.index}
              onClick={() => onSelectPort(selectedPort === port.index ? null : port.index)}
            />
          ))}
        </div>
        <p className="text-[9px] text-[#475569] mt-2 text-center">
          Нажмите на пост — увидите камеру и затухание
        </p>
      </div>
      {active && <PortDetail port={active} />}
    </>
  );
}

function PortTile({
  port, selected, onClick,
}: {
  port: OrkPort;
  selected: boolean;
  onClick: () => void;
}) {
  const hasSub = !!port.subscriber;
  const status = port.budget?.status;
  const border = selected
    ? '#a78bfa'
    : status === 'fail'
      ? '#f87171'
      : status === 'warn'
        ? '#fbbf24'
        : hasSub
          ? '#34d399'
          : '#1e3a5f';
  const sw = fiberSwatch(port.fiberWorking);

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border-2 p-2 text-left transition-all min-h-[72px]"
      style={{
        borderColor: border,
        background: selected ? 'rgba(167,139,250,0.12)' : '#0a0e1a',
      }}
    >
      <div className="text-[9px] text-[#64748b] font-mono">Пост {port.index}</div>
      <div className="w-4 h-4 rounded-sm mt-1 mb-1" style={{ background: sw.hex }} title={sw.name} />
      {hasSub && port.subscriber ? (
        <>
          <div className="text-[10px] text-[#e2e8f0] font-medium truncate leading-tight">
            {port.subscriber.desc?.slice(0, 18) || port.subscriber.id.slice(0, 10)}
          </div>
          {port.budget && (
            <div className="text-[9px] font-mono mt-0.5" style={{ color: budgetStatusColor(port.budget.status) }}>
              {port.budget.totalLossDB.toFixed(1)} dB
            </div>
          )}
        </>
      ) : (
        <div className="text-[10px] text-[#475569] italic">свободен</div>
      )}
    </button>
  );
}

function PortDetail({ port }: { port: OrkPort }) {
  if (!port.subscriber) return null;
  const sub = port.subscriber;
  const b = port.budget;
  return (
    <div className="rounded-xl border border-[#a78bfa]/50 bg-[#0a0e1a] p-3 space-y-2 animate-fade-in">
      <div className="text-[10px] uppercase tracking-wider text-[#a78bfa]">Камера на посту {port.index}</div>
      <div className="text-sm font-semibold text-[#e2e8f0]">{cameraLabel(sub)}</div>
      <div className="text-[10px] font-mono text-[#64748b]">{sub.id}</div>
      {b ? (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded border border-[#1e3a5f] p-2">
            <div className="text-[#64748b]">Затухание</div>
            <div className="font-mono text-lg font-bold" style={{ color: budgetStatusColor(b.status) }}>
              {b.totalLossDB.toFixed(1)} dB
            </div>
            <div style={{ color: budgetStatusColor(b.status) }}>{budgetStatusLabel(b.status)}</div>
          </div>
          <div className="rounded border border-[#1e3a5f] p-2">
            <div className="text-[#64748b]">На камере</div>
            <div className="font-mono text-lg font-bold text-[#38bdf8]">{b.rxPowerDBm.toFixed(1)} dBm</div>
            <div className="text-[#64748b]">лимит ~{SAFE_LOSS_DB} dB</div>
          </div>
          <div className="col-span-2 text-[9px] text-[#64748b] font-mono">
            кабель {b.breakdown.cableKm.toFixed(2)} км · L1 {b.breakdown.l1Splitter.toFixed(1)} dB · L2 {b.breakdown.l2Splitter.toFixed(1)} dB
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-[#64748b]">Бюджет не рассчитан — пересоберите сеть</p>
      )}
      <div className="flex gap-1 items-center text-[9px]">
        <span className="w-3 h-3 rounded-sm" style={{ background: fiberSwatch(port.fiberWorking).hex }} />
        <span className="text-[#94a3b8]">рабочая #{port.fiberWorking + 1}</span>
        <span className="w-3 h-3 rounded-sm ml-2" style={{ background: fiberSwatch(port.fiberSpare).hex }} />
        <span className="text-[#94a3b8]">резерв #{port.fiberSpare + 1}</span>
      </div>
    </div>
  );
}

function LinkList({
  title, links, onOpenEntity,
}: {
  title: string;
  links: CableLink[];
  onOpenEntity?: (kind: InteriorView['kind'], id: string) => void;
}) {
  if (links.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] text-[#64748b] uppercase tracking-wider mb-1">{title}</div>
      <ul className="space-y-1 max-h-32 overflow-y-auto">
        {links.map((l) => (
          <li
            key={l.cable.id}
            className="text-[10px] font-mono border border-[#1e3a5f]/60 rounded px-2 py-1 flex items-center justify-between gap-2"
          >
            <span className="text-[#94a3b8] truncate">
              {l.direction === 'in' ? '←' : '→'} {l.cable.type} · {l.cable.fibers} вол.
            </span>
            <button
              type="button"
              className="text-[#38bdf8] hover:underline shrink-0"
              onClick={() => {
                const k = l.peerKind === 'olt' ? 'olt' : l.peerKind === 'tb' ? 'tb' : l.peerKind === 'ork' ? 'ork' : null;
                if (k && onOpenEntity) onOpenEntity(k, l.peerId);
              }}
              disabled={l.peerKind === 'sub' || l.peerKind === 'unknown'}
            >
              {l.peerLabel} {l.peerId.slice(0, 8)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpliceTable({
  splices,
  onOpenTarget,
}: {
  splices: FiberSplice[];
  onOpenTarget?: (kind: InteriorView['kind'], id: string) => void;
}) {
  return (
    <table className="w-full text-[9px] font-mono">
      <thead className="text-[#64748b] sticky top-0 bg-[#0a0e1a]">
        <tr>
          <th className="p-1 text-left">Вх.#</th>
          <th className="p-1">→</th>
          <th className="p-1 text-left">Исх.#</th>
          <th className="p-1 text-left">Куда</th>
        </tr>
      </thead>
      <tbody>
        {splices.map((s, i) => {
          const cin = TIA_598_COLORS[s.inFiber % 12];
          const cout = TIA_598_COLORS[s.outFiber % 12];
          return (
            <tr key={i} className="border-t border-[#1e3a5f]/30">
              <td className="p-1 text-[#94a3b8]">
                <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: cin.hex }} />
                {s.inFiber + 1}
              </td>
              <td className="p-1 text-center">{s.role === 'working' ? '◇' : '○'}</td>
              <td className="p-1 text-[#94a3b8]">
                <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: cout.hex }} />
                {s.outFiber + 1}
              </td>
              <td className="p-1">
                <button
                  type="button"
                  className="text-[#a78bfa] hover:underline truncate max-w-[100px]"
                  onClick={() => {
                    if (s.targetKind === 'ork' || s.targetKind === 'tb' || s.targetKind === 'olt') {
                      onOpenTarget?.(s.targetKind, s.targetId);
                    }
                  }}
                  disabled={s.targetKind === 'sub' || s.targetKind === 'unknown'}
                >
                  {s.targetLabel}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MiniStat({
  label, value, sub, color,
}: {
  label: string;
  value: number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-[#1e3a5f] bg-[#0a0e1a]/80 p-2" style={{ borderLeftColor: color, borderLeftWidth: 2 }}>
      <div className="text-lg font-bold font-mono" style={{ color }}>{value}</div>
      <div className="text-[9px] text-[#64748b]">{label}</div>
      {sub && <div className="text-[9px] text-[#64748b]">{sub}</div>}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-[11px] text-amber-400/90 text-center py-2">{text}</p>;
}
