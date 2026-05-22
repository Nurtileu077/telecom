'use client';
import { useState, useEffect, useMemo } from 'react';
import { Copy, MapPin } from 'lucide-react';
import {
  District, OLT, TransitBox, ORK, Cable, InlineJoint,
  CABLE_SIZES, SplitterRatio, MuftaType, OLTModel, BoxType,
} from '@/types/network';
import { cablesForEntity } from '@/components/Network/SnapConnect';
import type { SubBudget } from '@/components/Network/PowerBudget';
import type { InteriorView } from '@/components/Network/entityInterior';
import { findEntityCoords, cableLinksForEntity } from '@/components/Network/entityInterior';
import { NetworkInteriorEmbed } from '@/components/Map/NetworkInterior';
import FieldChecklistPanel from '@/components/Field/FieldChecklistPanel';
import QrPassportLink from '@/components/Field/QrPassportLink';
import { ensureFieldChecklist, DEFAULT_ORK_CHECKLIST, DEFAULT_TB_CHECKLIST } from '@/lib/fieldChecklist';

export type EntitySelection =
  | { kind: 'olt'; id: string }
  | { kind: 'tb';  id: string }
  | { kind: 'ork'; id: string }
  | { kind: 'joint'; id: string };

interface Props {
  selection: EntitySelection | null;
  interiorView: InteriorView | null;
  districts: District[];
  cables?: Cable[];
  joints?: InlineJoint[];
  powerBudgets?: SubBudget[];
  onClose: () => void;
  onNavigateInterior: (kind: InteriorView['kind'], id: string) => void;
  onFlyToEntity: (kind: InteriorView['kind'], id: string) => void;
  onFlyToSubscriber: (subId: string) => void;
  onUpdateOLT: (id: string, patch: Partial<Omit<OLT, 'id' | 'lat' | 'lon' | 'transitBoxes'>>) => void;
  onUpdateTB:  (id: string, patch: Partial<Omit<TransitBox, 'id' | 'lat' | 'lon' | 'orks'>>) => void;
  onUpdateORK: (id: string, patch: Partial<Omit<ORK, 'id' | 'lat' | 'lon' | 'subscribers'>>) => void;
  onDeleteOLT: (id: string) => void;
  onDeleteTB:  (id: string) => void;
  onDeleteORK: (id: string) => void;
  onReassignORK: (orkId: string, newTbId: string) => void;
  onOpenSplicePlan: (tbId: string) => void;
  onShowBranch?: (kind: 'olt' | 'tb' | 'ork', id: string) => void;
  moveActive?: boolean;
  onStartMove?: () => void;
  onStopMove?: () => void;
}

const SPLITTERS: SplitterRatio[] = ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64'];
const MUFTA_TYPES: MuftaType[] = ['МТОК-96А', 'МТОК-48А', 'МТОК-32А', 'FOSC-400', 'ОМС-3В'];
const OLT_MODELS: OLTModel[] = [
  'Huawei MA5800-X7', 'Huawei MA5800-X2', 'ZTE C610', 'ZTE C320', 'Eltex LTP-8X',
];
const BOX_TYPES: BoxType[] = ['Бокс-8', 'Бокс-16', 'ОРКСп-16', 'ОРКСп-32', 'WTC-BOX-16'];

function findOLT(districts: District[], id: string): OLT | null {
  return districts.find((d) => d.olt.id === id)?.olt ?? null;
}
function findTB(districts: District[], id: string): TransitBox | null {
  for (const d of districts)
    for (const tb of d.olt.transitBoxes)
      if (tb.id === id) return tb;
  return null;
}
function findORK(districts: District[], id: string): ORK | null {
  for (const d of districts)
    for (const tb of d.olt.transitBoxes)
      for (const ork of tb.orks)
        if (ork.id === id) return ork;
  return null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-[#64748b] shrink-0 w-28">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Sel({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]"
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function OLTEditor({ olt, onSave }: { olt: OLT; onSave: (patch: Partial<Omit<OLT, 'id' | 'lat' | 'lon' | 'transitBoxes'>>) => void }) {
  const [model, setModel] = useState(olt.model);
  const [capacity, setCapacity] = useState(String(olt.capacity));
  const [splitter, setSplitter] = useState(olt.l1Splitter);
  useEffect(() => { setModel(olt.model); setCapacity(String(olt.capacity)); setSplitter(olt.l1Splitter); }, [olt]);
  return (
    <div className="space-y-2">
      <Row label="Модель OLT"><Sel value={model} options={[...OLT_MODELS, model].filter((v, i, a) => a.indexOf(v) === i)} onChange={setModel} /></Row>
      <Row label="Ёмкость">
        <input type="number" min={1} max={512} value={capacity} onChange={(e) => setCapacity(e.target.value)}
          className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0]" />
      </Row>
      <Row label="L1 сплиттер"><Sel value={splitter} options={SPLITTERS} onChange={(v) => setSplitter(v as SplitterRatio)} /></Row>
      <button onClick={() => onSave({ model: model as OLTModel, capacity: Number(capacity) || olt.capacity, l1Splitter: splitter })}
        className="w-full py-1.5 bg-[#f59e0b]/15 text-[#f59e0b] text-xs rounded">Сохранить</button>
    </div>
  );
}

function TBEditor({ tb, onSave }: { tb: TransitBox; onSave: (patch: Partial<Omit<TransitBox, 'id' | 'lat' | 'lon' | 'orks'>>) => void }) {
  const [mufta, setMufta] = useState(tb.muftaType);
  const [inCable, setInCable] = useState(tb.inCable);
  const [outCable, setOutCable] = useState(tb.outCable);
  useEffect(() => { setMufta(tb.muftaType); setInCable(tb.inCable); setOutCable(tb.outCable); }, [tb]);
  return (
    <div className="space-y-2">
      <Row label="Тип муфты"><Sel value={mufta} options={[...MUFTA_TYPES, mufta].filter((v, i, a) => a.indexOf(v) === i)} onChange={setMufta} /></Row>
      <Row label="Вход"><Sel value={inCable} options={CABLE_SIZES} onChange={(v) => setInCable(v as typeof inCable)} /></Row>
      <Row label="Выход"><Sel value={outCable} options={CABLE_SIZES} onChange={(v) => setOutCable(v as typeof outCable)} /></Row>
      <button onClick={() => onSave({ muftaType: mufta as MuftaType, inCable, outCable })}
        className="w-full py-1.5 bg-[#38bdf8]/15 text-[#38bdf8] text-xs rounded">Сохранить</button>
    </div>
  );
}

function ORKEditor({ ork, districts, onSave, onReassign }: {
  ork: ORK; districts: District[];
  onSave: (patch: Partial<Omit<ORK, 'id' | 'lat' | 'lon' | 'subscribers'>>) => void;
  onReassign: (newTbId: string) => void;
}) {
  const [splitter, setSplitter] = useState(ork.splitter);
  const [boxType, setBoxType] = useState(ork.boxType);
  const [cableType, setCableType] = useState(ork.cableType);
  const [reassignOpen, setReassignOpen] = useState(false);
  useEffect(() => { setSplitter(ork.splitter); setBoxType(ork.boxType); setCableType(ork.cableType); }, [ork]);
  const districtTBs = districts.find((d) => d.name === ork.district)?.olt.transitBoxes ?? [];
  return (
    <div className="space-y-2">
      <Row label="Сплиттер"><Sel value={splitter} options={SPLITTERS} onChange={(v) => setSplitter(v as SplitterRatio)} /></Row>
      <Row label="Тип бокса"><Sel value={boxType} options={[...BOX_TYPES, boxType].filter((v, i, a) => a.indexOf(v) === i)} onChange={setBoxType} /></Row>
      <Row label="Кабель"><Sel value={cableType} options={CABLE_SIZES} onChange={(v) => setCableType(v as typeof cableType)} /></Row>
      <button onClick={() => onSave({ splitter, boxType: boxType as BoxType, cableType })}
        className="w-full py-1.5 bg-[#f59e0b]/15 text-[#f59e0b] text-xs rounded">Сохранить</button>
      {districtTBs.length > 1 && (
        <>
          <button type="button" onClick={() => setReassignOpen((v) => !v)} className="w-full py-1 text-[11px] text-[#a78bfa] border border-[#a78bfa]/30 rounded">↔ Другая муфта</button>
          {reassignOpen && (
            <select defaultValue="" onChange={(e) => { if (e.target.value) onReassign(e.target.value); }}
              className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs">
              <option value="" disabled>— муфта —</option>
              {districtTBs.filter((tb) => tb.id !== ork.tbId).map((tb) => (
                <option key={tb.id} value={tb.id}>{tb.id}</option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}

function ConnectedCables({
  entityId, cables, districts, joints, onLinkClick,
}: {
  entityId: string;
  cables: Cable[];
  districts: District[];
  joints: InlineJoint[];
  onLinkClick?: (kind: InteriorView['kind'], id: string) => void;
}) {
  const links = cableLinksForEntity(entityId, cables, districts, joints);
  if (links.length === 0) {
    return <p className="text-[10px] text-[#64748b]">Нет кабелей</p>;
  }
  return (
    <ul className="text-[10px] space-y-1">
      {links.map((l) => {
        const k = l.peerKind === 'olt' || l.peerKind === 'tb' || l.peerKind === 'ork' || l.peerKind === 'joint'
          ? l.peerKind : null;
        return (
          <li key={l.cable.id} className="font-mono text-[#94a3b8]">
            {l.direction === 'in' ? '←' : '→'} {l.cable.type} ·{' '}
            {k && onLinkClick ? (
              <button type="button" className="text-[#38bdf8] hover:underline" onClick={() => onLinkClick(k, l.peerId)}>
                {l.peerLabel} {l.peerId.slice(0, 12)}
              </button>
            ) : (
              <span>{l.peerId.slice(0, 14)}</span>
            )}
            <span className="text-[#64748b]"> ({Math.round(l.cable.lengthM)} м)</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function EntityEditor({
  selection, interiorView, districts, cables = [], joints = [], powerBudgets = [],
  onClose, onNavigateInterior, onFlyToEntity, onFlyToSubscriber,
  onShowBranch, moveActive, onStartMove, onStopMove,
  onUpdateOLT, onUpdateTB, onUpdateORK,
  onDeleteOLT, onDeleteTB, onDeleteORK,
  onReassignORK, onOpenSplicePlan,
}: Props) {
  const sel = useMemo((): EntitySelection | null => {
    if (!selection) return null;
    if (selection.kind === 'tb' && !findTB(districts, selection.id)) {
      if (joints.some((j) => j.id === selection.id)) return { kind: 'joint', id: selection.id };
    }
    return selection;
  }, [selection, districts, joints]);

  const view = interiorView ?? (sel ? { kind: sel.kind, id: sel.id } as InteriorView : null);

  const coords = useMemo(() => {
    if (!view) return null;
    return findEntityCoords(view.kind, view.id, districts, joints);
  }, [view, districts, joints]);

  if (!sel && !view) return null;

  const kindLabel: Record<string, string> = {
    olt: 'OLT', tb: 'Муфта', ork: 'ОРК', joint: 'Транзитная муфта',
  };
  const kindColor: Record<string, string> = {
    olt: '#f59e0b', tb: '#38bdf8', ork: '#a78bfa', joint: '#38bdf8',
  };

  if (!sel) return null;

  let title = sel.id;
  let propsPanel: React.ReactNode = null;
  let onDelete: (() => void) | null = null;
  let deleteWarn = '';
  const kind = sel.kind;

  if (kind === 'olt') {
    const olt = findOLT(districts, sel.id);
    if (!olt) return null;
    title = olt.id;
    propsPanel = <OLTEditor olt={olt} onSave={(patch) => { onUpdateOLT(olt.id, patch); }} />;
    deleteWarn = `Удалит район`;
    onDelete = () => { onDeleteOLT(olt.id); onClose(); };
  } else if (kind === 'tb') {
    const tb = findTB(districts, sel.id);
    if (!tb) {
      if (view?.kind === 'joint') {
        title = view.id;
      } else return null;
    } else {
      title = tb.id;
      const tbCheck = ensureFieldChecklist(tb.fieldChecklist, DEFAULT_TB_CHECKLIST);
      propsPanel = (
        <>
          <TBEditor tb={tb} onSave={(patch) => onUpdateTB(tb.id, patch)} />
          <FieldChecklistPanel
            checklist={tbCheck}
            onChange={(next) => onUpdateTB(tb.id, { fieldChecklist: next })}
          />
          <QrPassportLink kind="tb" id={tb.id} />
          <button type="button" onClick={() => onOpenSplicePlan(tb.id)}
            className="w-full py-1.5 mt-2 border border-[#38bdf8]/30 text-[#38bdf8] text-[11px] rounded">
            🔗 Сплайс-план
          </button>
        </>
      );
      onDelete = () => { onDeleteTB(tb.id); onClose(); };
      deleteWarn = `Удалит ОРК в муфте`;
    }
  } else if (kind === 'ork') {
    const ork = findORK(districts, sel.id);
    if (!ork) return null;
    title = ork.id;
    const orkCheck = ensureFieldChecklist(ork.fieldChecklist, DEFAULT_ORK_CHECKLIST);
    propsPanel = (
      <>
        <ORKEditor ork={ork} districts={districts}
          onSave={(patch) => onUpdateORK(ork.id, patch)}
          onReassign={(newTbId) => onReassignORK(ork.id, newTbId)}
        />
        <FieldChecklistPanel
          checklist={orkCheck}
          onChange={(next) => onUpdateORK(ork.id, { fieldChecklist: next })}
        />
        <QrPassportLink kind="ork" id={ork.id} />
      </>
    );
    onDelete = () => { onDeleteORK(ork.id); onClose(); };
    deleteWarn = `Удалит ${ork.subscribers.length} камер`;
  } else {
    title = sel.id;
    propsPanel = <p className="text-[10px] text-[#64748b]">Транзит на развилке — свойства в центре</p>;
  }

  const copyCoords = () => {
    if (!coords) return;
    const t = `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`;
    navigator.clipboard?.writeText(t).catch(() => {});
  };

  return (
    <aside className="object-passport animate-fade-in">
      <div className="object-passport__header">
        <div className="min-w-0">
          <span className="object-passport__badge" style={{ color: kindColor[kind], background: `${kindColor[kind]}22` }}>
            {kindLabel[kind]}
          </span>
          <div className="object-passport__title truncate">{title}</div>
        </div>
        <button type="button" onClick={onClose} className="object-passport__close" aria-label="Закрыть">×</button>
      </div>

      {coords && (
        <div className="object-passport__coords">
          <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
            <MapPin size={12} /> Координаты
          </div>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-xs font-mono text-[var(--text)] flex-1">
              {coords.lat.toFixed(6)}, {coords.lon.toFixed(6)}
            </code>
            <button type="button" onClick={copyCoords} className="btn btn-ghost btn-icon p-1" title="Копировать">
              <Copy size={14} />
            </button>
            <button type="button" onClick={() => onFlyToEntity(view!.kind, view!.id)}
              className="btn btn-ghost text-[10px] py-1 px-2" title="На карте">
              📍
            </button>
          </div>
        </div>
      )}

      <div className="object-passport__center">
        <NetworkInteriorEmbed
          view={view}
          districts={districts}
          cables={cables}
          joints={joints}
          powerBudgets={powerBudgets}
          onNavigate={onNavigateInterior}
          onFlyToEntity={onFlyToEntity}
          onFlyToSubscriber={onFlyToSubscriber}
        />
      </div>

      <div className="object-passport__footer">
        <details className="object-passport__details" open={kind !== 'joint'}>
          <summary className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider cursor-pointer py-1">
            Свойства и соединения
          </summary>
          <div className="pt-2 space-y-2">
            {propsPanel}
            <div>
              <div className="text-[10px] text-[#64748b] mb-1">Соединения</div>
              <ConnectedCables
                entityId={sel.id}
                cables={cables}
                districts={districts}
                joints={joints}
                onLinkClick={(k, id) => { onNavigateInterior(k, id); onFlyToEntity(k, id); }}
              />
            </div>
          </div>
        </details>

        {onShowBranch && kind !== 'joint' && (
          <button type="button" onClick={() => onShowBranch(kind as 'olt' | 'tb' | 'ork', sel.id)}
            className="w-full py-1.5 text-[11px] text-[#38bdf8] border border-[#38bdf8]/30 rounded">
            🌿 Показать ветку
          </button>
        )}
        {onStartMove && kind !== 'joint' && (
          <button type="button" onClick={() => (moveActive ? onStopMove?.() : onStartMove())}
            className={`w-full py-1.5 text-[11px] rounded border ${moveActive ? 'border-[#a78bfa]/50 text-[#a78bfa]' : 'border-[#a78bfa]/30'}`}>
            {moveActive ? '↔ Перетащите на карте' : '↔ Переместить'}
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={() => { if (confirm(deleteWarn + '?')) onDelete(); }}
            className="w-full py-1.5 text-[11px] text-[#f87171] border border-[#f87171]/30 rounded">
            🗑 Удалить
          </button>
        )}
      </div>
    </aside>
  );
}
