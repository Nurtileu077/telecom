'use client';
import { useState, useEffect } from 'react';
import {
  District, OLT, TransitBox, ORK,
  CABLE_SIZES, SplitterRatio, MuftaType, OLTModel, BoxType,
} from '@/types/network';

export type EntitySelection =
  | { kind: 'olt'; id: string }
  | { kind: 'tb';  id: string }
  | { kind: 'ork'; id: string };

interface Props {
  selection: EntitySelection | null;
  districts: District[];
  onClose: () => void;
  onUpdateOLT: (id: string, patch: Partial<Omit<OLT, 'id' | 'lat' | 'lon' | 'transitBoxes'>>) => void;
  onUpdateTB:  (id: string, patch: Partial<Omit<TransitBox, 'id' | 'lat' | 'lon' | 'orks'>>) => void;
  onUpdateORK: (id: string, patch: Partial<Omit<ORK, 'id' | 'lat' | 'lon' | 'subscribers'>>) => void;
  onDeleteOLT: (id: string) => void;
  onDeleteTB:  (id: string) => void;
  onDeleteORK: (id: string) => void;
  onReassignORK: (orkId: string, newTbId: string) => void;
  onOpenSplicePlan: (tbId: string) => void;
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

function Inp({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]"
    />
  );
}

// ── OLT editor ────────────────────────────────────────────────────────────────
function OLTEditor({ olt, onSave }: { olt: OLT; onSave: (patch: Partial<Omit<OLT, 'id' | 'lat' | 'lon' | 'transitBoxes'>>) => void }) {
  const [model, setModel] = useState(olt.model);
  const [capacity, setCapacity] = useState(String(olt.capacity));
  const [splitter, setSplitter] = useState(olt.l1Splitter);

  useEffect(() => { setModel(olt.model); setCapacity(String(olt.capacity)); setSplitter(olt.l1Splitter); }, [olt]);

  return (
    <div className="space-y-2.5">
      <Row label="Модель OLT">
        <Sel value={model} options={[...OLT_MODELS, model].filter((v, i, a) => a.indexOf(v) === i)} onChange={setModel} />
      </Row>
      <Row label="Ёмкость портов">
        <input
          type="number" min={1} max={512} value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          className="w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#38bdf8]"
        />
      </Row>
      <Row label="L1 сплиттер">
        <Sel value={splitter} options={SPLITTERS} onChange={(v) => setSplitter(v as SplitterRatio)} />
      </Row>
      <button
        onClick={() => onSave({ model: model as OLTModel, capacity: Number(capacity) || olt.capacity, l1Splitter: splitter })}
        className="w-full py-1.5 bg-[#f59e0b]/15 hover:bg-[#f59e0b]/25 text-[#f59e0b] text-xs rounded transition-colors"
      >
        Сохранить
      </button>
    </div>
  );
}

// ── TB editor ─────────────────────────────────────────────────────────────────
function TBEditor({ tb, onSave }: { tb: TransitBox; onSave: (patch: Partial<Omit<TransitBox, 'id' | 'lat' | 'lon' | 'orks'>>) => void }) {
  const [mufta, setMufta] = useState(tb.muftaType);
  const [inCable, setInCable] = useState(tb.inCable);
  const [outCable, setOutCable] = useState(tb.outCable);

  useEffect(() => { setMufta(tb.muftaType); setInCable(tb.inCable); setOutCable(tb.outCable); }, [tb]);

  return (
    <div className="space-y-2.5">
      <Row label="Тип муфты">
        <Sel
          value={mufta}
          options={[...MUFTA_TYPES, mufta].filter((v, i, a) => a.indexOf(v) === i)}
          onChange={setMufta}
        />
      </Row>
      <Row label="Вход (OLT→TB)">
        <Sel value={inCable} options={CABLE_SIZES} onChange={(v) => setInCable(v as typeof inCable)} />
      </Row>
      <Row label="Выход (TB→ОРК)">
        <Sel value={outCable} options={CABLE_SIZES} onChange={(v) => setOutCable(v as typeof outCable)} />
      </Row>
      <div className="text-[10px] text-[#475569]">ОРК в этой муфте: {tb.orks.length}</div>
      <button
        onClick={() => onSave({ muftaType: mufta as MuftaType, inCable, outCable })}
        className="w-full py-1.5 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 text-[#38bdf8] text-xs rounded transition-colors"
      >
        Сохранить
      </button>
    </div>
  );
}

// ── ORK editor ────────────────────────────────────────────────────────────────
function ORKEditor({
  ork, districts, onSave, onReassign,
}: {
  ork: ORK;
  districts: District[];
  onSave: (patch: Partial<Omit<ORK, 'id' | 'lat' | 'lon' | 'subscribers'>>) => void;
  onReassign: (newTbId: string) => void;
}) {
  const [splitter, setSplitter] = useState(ork.splitter);
  const [boxType, setBoxType] = useState(ork.boxType);
  const [cableType, setCableType] = useState(ork.cableType);
  const [reassignOpen, setReassignOpen] = useState(false);

  useEffect(() => { setSplitter(ork.splitter); setBoxType(ork.boxType); setCableType(ork.cableType); }, [ork]);

  // List of all TBs in the same district (so we don't break district topology)
  const districtTBs = districts.find((d) => d.name === ork.district)?.olt.transitBoxes ?? [];

  return (
    <div className="space-y-2.5">
      <Row label="Сплиттер">
        <Sel value={splitter} options={SPLITTERS} onChange={(v) => setSplitter(v as SplitterRatio)} />
      </Row>
      <Row label="Тип бокса">
        <Sel
          value={boxType}
          options={[...BOX_TYPES, boxType].filter((v, i, a) => a.indexOf(v) === i)}
          onChange={setBoxType}
        />
      </Row>
      <Row label="Кабель TB→ОРК">
        <Sel value={cableType} options={CABLE_SIZES} onChange={(v) => setCableType(v as typeof cableType)} />
      </Row>
      <div className="text-[10px] text-[#475569]">Родительская Муфта: <span className="text-[#94a3b8]">{ork.tbId}</span> · Абонентов: {ork.subscribers.length}</div>
      <button
        onClick={() => onSave({ splitter, boxType: boxType as BoxType, cableType })}
        className="w-full py-1.5 bg-[#f59e0b]/15 hover:bg-[#f59e0b]/25 text-[#f59e0b] text-xs rounded transition-colors"
      >
        Сохранить
      </button>

      {districtTBs.length > 1 && (
        <div className="border-t border-[#1e3a5f] pt-2">
          <button
            onClick={() => setReassignOpen((v) => !v)}
            className="w-full py-1.5 text-[11px] text-[#a78bfa] border border-[#a78bfa]/30 hover:bg-[#a78bfa]/10 rounded transition-colors"
          >
            ↔ Перенести в другую Муфту
          </button>
          {reassignOpen && (
            <select
              autoFocus
              defaultValue=""
              onChange={(e) => { if (e.target.value) onReassign(e.target.value); }}
              className="mt-1.5 w-full bg-[#0a0e1a] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#a78bfa]"
            >
              <option value="" disabled>— выбери Муфту —</option>
              {districtTBs.filter((tb) => tb.id !== ork.tbId).map((tb) => (
                <option key={tb.id} value={tb.id}>{tb.id} · ОРК: {tb.orks.length}</option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function EntityEditor({
  selection, districts, onClose,
  onUpdateOLT, onUpdateTB, onUpdateORK,
  onDeleteOLT, onDeleteTB, onDeleteORK,
  onReassignORK, onOpenSplicePlan,
}: Props) {
  if (!selection) return null;

  const kindLabel: Record<string, string> = { olt: 'OLT', tb: 'Муфта (TB)', ork: 'ОРК' };
  const kindColor: Record<string, string> = { olt: '#f59e0b', tb: '#38bdf8', ork: '#f59e0b' };

  let title = '';
  let content: React.ReactNode = null;
  let onDelete: (() => void) | null = null;
  let deleteWarn = '';

  if (selection.kind === 'olt') {
    const olt = findOLT(districts, selection.id);
    if (!olt) return null;
    title = olt.id;
    content = <OLTEditor olt={olt} onSave={(patch) => { onUpdateOLT(olt.id, patch); onClose(); }} />;
    const tbCount = olt.transitBoxes.length;
    const orkCount = olt.transitBoxes.reduce((s, tb) => s + tb.orks.length, 0);
    const subCount = olt.transitBoxes.reduce((s, tb) => s + tb.orks.reduce((ss, o) => ss + o.subscribers.length, 0), 0);
    deleteWarn = `Удалит весь район: ${tbCount} муфт, ${orkCount} ОРК, ${subCount} абонентов`;
    onDelete = () => { onDeleteOLT(olt.id); onClose(); };
  } else if (selection.kind === 'tb') {
    const tb = findTB(districts, selection.id);
    if (!tb) return null;
    title = tb.id;
    content = (
      <div className="space-y-2">
        <TBEditor tb={tb} onSave={(patch) => { onUpdateTB(tb.id, patch); onClose(); }} />
        <button
          onClick={() => onOpenSplicePlan(tb.id)}
          className="w-full py-1.5 border border-[#38bdf8]/30 text-[#38bdf8] hover:bg-[#38bdf8]/10 text-[11px] rounded transition-colors"
        >
          🔗 Открыть сплайс-план
        </button>
      </div>
    );
    const orkCount = tb.orks.length;
    const subCount = tb.orks.reduce((s, o) => s + o.subscribers.length, 0);
    deleteWarn = `Удалит ${orkCount} ОРК и ${subCount} абонентов`;
    onDelete = () => { onDeleteTB(tb.id); onClose(); };
  } else {
    const ork = findORK(districts, selection.id);
    if (!ork) return null;
    title = ork.id;
    content = <ORKEditor
      ork={ork}
      districts={districts}
      onSave={(patch) => { onUpdateORK(ork.id, patch); onClose(); }}
      onReassign={(newTbId) => { onReassignORK(ork.id, newTbId); onClose(); }}
    />;
    deleteWarn = `Удалит ОРК и ${ork.subscribers.length} абонентов`;
    onDelete = () => { onDeleteORK(ork.id); onClose(); };
  }

  return (
    <div className="absolute top-3 right-3 z-[500] w-64 bg-[#0d1b2a]/97 border border-[#1e3a5f] rounded-xl shadow-2xl backdrop-blur-sm animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1e3a5f]">
        <div>
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: `${kindColor[selection.kind]}20`, color: kindColor[selection.kind] }}
          >
            {kindLabel[selection.kind]}
          </span>
          <div className="text-xs font-semibold text-[#e2e8f0] mt-0.5 truncate max-w-[160px]">{title}</div>
        </div>
        <button onClick={onClose} className="text-[#64748b] hover:text-white transition-colors text-base leading-none px-1">×</button>
      </div>

      {/* Body */}
      <div className="p-3">
        {content}
      </div>

      {/* Delete footer */}
      {onDelete && (
        <div className="px-3 pb-3 pt-1 border-t border-[#1e3a5f] mt-1">
          <button
            onClick={() => { if (confirm(`${deleteWarn}. Продолжить?`)) onDelete!(); }}
            className="w-full py-1.5 text-[11px] text-[#f87171] hover:bg-[#f87171]/10 border border-[#f87171]/30 rounded transition-colors"
          >
            🗑 Удалить
          </button>
        </div>
      )}
    </div>
  );
}
