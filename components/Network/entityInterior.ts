import type { Cable, District, InlineJoint, OLT, ORK, Subscriber, TransitBox } from '@/types/network';
import { haversineM } from '@/components/Network/KMeans';
import { CAMERA_KIND_LABEL, CABLE_FIBERS, type CameraKind } from '@/types/network';
import { TIA_598_COLORS } from '@/components/Network/FiberColors';
import { cablesForEntity } from '@/components/Network/SnapConnect';
import type { SubBudget } from '@/components/Network/PowerBudget';
import { SPLITTER_LOSS_DB, SAFE_LOSS_DB } from '@/components/Network/PowerBudget';

export type InteriorKind = 'olt' | 'tb' | 'ork' | 'joint';

export interface InteriorView {
  kind: InteriorKind;
  id: string;
}

export type PeerKind = 'olt' | 'tb' | 'ork' | 'sub' | 'joint' | 'unknown';

export interface CableLink {
  cable: Cable;
  direction: 'in' | 'out';
  peerId: string;
  peerKind: PeerKind;
  peerLabel: string;
}

export interface FiberSplice {
  inCableId: string;
  inFiber: number;
  outCableId: string;
  outFiber: number;
  targetId: string;
  targetKind: PeerKind;
  targetLabel: string;
  role: 'working' | 'spare';
}

export interface OrkPort {
  index: number;
  subscriber: Subscriber | null;
  budget: SubBudget | null;
  fiberWorking: number;
  fiberSpare: number;
}

export interface ComplexityBadge {
  score: number;
  level: 1 | 2 | 3 | 4 | 5;
  title: string;
  subtitle: string;
  color: string;
  stars: number;
  hints: string[];
}

export interface OltPonPort {
  port: number;
  tbId: string | null;
  label: string;
  orkCount: number;
  subCount: number;
  status: 'free' | 'used';
}

export interface OltInteriorData {
  kind: 'olt';
  olt: OLT;
  district: string;
  links: CableLink[];
  tbCount: number;
  orkCount: number;
  subCount: number;
  ponPorts: OltPonPort[];
  complexity: ComplexityBadge;
}

export interface TbInteriorData {
  kind: 'tb';
  tb: TransitBox;
  links: CableLink[];
  splices: FiberSplice[];
  freeFibers: number;
  complexity: ComplexityBadge;
}

export interface OrkInteriorData {
  kind: 'ork';
  ork: ORK;
  tb: TransitBox | null;
  uplink: Cable | null;
  ports: OrkPort[];
  maxPorts: number;
  complexity: ComplexityBadge;
}

export interface JointInteriorData {
  kind: 'joint';
  joint: InlineJoint;
  links: CableLink[];
  splices: FiberSplice[];
  freeFibers: number;
  nearestTbId: string | null;
  complexity: ComplexityBadge;
}

export type EntityInteriorData = OltInteriorData | TbInteriorData | OrkInteriorData | JointInteriorData;

export interface EntityCoords {
  lat: number;
  lon: number;
  label: string;
}

export function findEntityCoords(
  kind: InteriorKind,
  id: string,
  districts: District[],
  joints: InlineJoint[],
): EntityCoords | null {
  if (kind === 'joint') {
    const j = joints.find((x) => x.id === id);
    return j ? { lat: j.lat, lon: j.lon, label: j.id } : null;
  }
  if (kind === 'olt') {
    for (const d of districts) {
      if (d.olt.id === id) return { lat: d.olt.lat, lon: d.olt.lon, label: d.olt.id };
    }
    return null;
  }
  if (kind === 'tb') {
    for (const d of districts) {
      const tb = d.olt.transitBoxes.find((t) => t.id === id);
      if (tb) return { lat: tb.lat, lon: tb.lon, label: tb.id };
    }
    const j = joints.find((x) => x.id === id);
    if (j) return { lat: j.lat, lon: j.lon, label: j.id };
    return null;
  }
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      const ork = tb.orks.find((o) => o.id === id);
      if (ork) return { lat: ork.lat, lon: ork.lon, label: ork.id };
    }
  }
  return null;
}

export function findSubscriber(
  subId: string,
  districts: District[],
): Subscriber | null {
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        const sub = ork.subscribers.find((s) => s.id === subId);
        if (sub) return sub;
      }
    }
  }
  return null;
}

export function nearestTbToJoint(
  joint: InlineJoint,
  districts: District[],
  maxM = 25,
): TransitBox | null {
  let best: TransitBox | null = null;
  let bestD = maxM;
  for (const d of districts) {
    for (const tb of d.olt.transitBoxes) {
      const dist = haversineM(joint.lat, joint.lon, tb.lat, tb.lon);
      if (dist < bestD) {
        bestD = dist;
        best = tb;
      }
    }
  }
  return best;
}

function buildJointSplices(links: CableLink[]): { splices: FiberSplice[]; freeFibers: number } {
  const incoming = links.filter((l) => l.direction === 'in');
  const outgoing = links.filter((l) => l.direction === 'out');
  const splices: FiberSplice[] = [];
  let inCursor = 0;
  let inCableIdx = 0;
  let inCableFiberCap = incoming[0]?.cable.fibers ?? 0;
  const advanceIn = () => {
    inCursor++;
    if (inCursor >= inCableFiberCap && inCableIdx < incoming.length - 1) {
      inCableIdx++;
      inCursor = 0;
      inCableFiberCap = incoming[inCableIdx].cable.fibers;
    }
  };
  for (const out of outgoing) {
    const targetLabel = out.peerLabel;
    for (let f = 0; f < out.cable.fibers; f++) {
      const inLink = incoming[inCableIdx];
      if (!inLink) break;
      splices.push({
        inCableId: inLink.cable.id,
        inFiber: inCursor,
        outCableId: out.cable.id,
        outFiber: f,
        targetId: out.peerId,
        targetKind: out.peerKind,
        targetLabel,
        role: f % 2 === 0 ? 'working' : 'spare',
      });
      advanceIn();
    }
  }
  const totalIn = incoming.reduce((s, l) => s + l.cable.fibers, 0);
  return { splices, freeFibers: Math.max(0, totalIn - splices.length) };
}

function peerKindForId(districts: District[], id: string, joints: InlineJoint[] = []): PeerKind {
  if (joints.some((j) => j.id === id)) return 'joint';
  for (const d of districts) {
    if (d.olt.id === id) return 'olt';
    for (const tb of d.olt.transitBoxes) {
      if (tb.id === id) return 'tb';
      for (const ork of tb.orks) {
        if (ork.id === id) return 'ork';
        for (const sub of ork.subscribers) {
          if (sub.id === id) return 'sub';
        }
      }
    }
  }
  return 'unknown';
}

function peerLabel(kind: PeerKind, id: string): string {
  if (kind === 'olt') return 'OLT';
  if (kind === 'tb') return 'Муфта';
  if (kind === 'ork') return 'ОРК';
  if (kind === 'sub') return 'Камера';
  if (kind === 'joint') return 'Транзит';
  return id.slice(0, 12);
}

export function cableLinksForEntity(
  entityId: string,
  cables: Cable[],
  districts: District[],
  joints: InlineJoint[] = [],
): CableLink[] {
  return cablesForEntity(cables, entityId).map((c) => {
    const out = c.fromId === entityId;
    const peerId = out ? c.toId : c.fromId;
    const pk = peerKindForId(districts, peerId, joints);
    return {
      cable: c,
      direction: out ? 'out' : 'in',
      peerId,
      peerKind: pk,
      peerLabel: peerLabel(pk, peerId),
    };
  });
}

// Человекочитаемая метка конца кабеля по его id: тип объекта + короткий id.
// Используется и в попапе кабеля на карте, и в редакторе кабеля.
export function endpointLabel(
  districts: District[],
  id: string,
  joints: InlineJoint[] = [],
): { kind: PeerKind; label: string; shortId: string } {
  const kind = peerKindForId(districts, id, joints);
  return {
    kind,
    label: peerLabel(kind, id),
    shortId: id.length > 16 ? `${id.slice(0, 14)}…` : id,
  };
}

function splitterPortCount(ratio: string): number {
  const n = parseInt(ratio.split(':')[1] ?? '8', 10);
  return Number.isFinite(n) ? n : 8;
}

export function buildTbSplices(tb: TransitBox, links: CableLink[]): { splices: FiberSplice[]; freeFibers: number } {
  const incoming = links.filter((l) => l.direction === 'in');
  const outgoing = links.filter((l) => l.direction === 'out');
  const splices: FiberSplice[] = [];
  let inCursor = 0;
  let inCableIdx = 0;
  let inCableFiberCap = incoming[0]?.cable.fibers ?? 0;

  const advanceIn = () => {
    inCursor++;
    if (inCursor >= inCableFiberCap && inCableIdx < incoming.length - 1) {
      inCableIdx++;
      inCursor = 0;
      inCableFiberCap = incoming[inCableIdx].cable.fibers;
    }
  };

  for (const out of outgoing) {
    const targetLabel = out.peerKind === 'ork' ? out.peerId : out.peerLabel;
    for (let f = 0; f < out.cable.fibers; f++) {
      const inLink = incoming[inCableIdx];
      if (!inLink) break;
      splices.push({
        inCableId: inLink.cable.id,
        inFiber: inCursor,
        outCableId: out.cable.id,
        outFiber: f,
        targetId: out.peerId,
        targetKind: out.peerKind,
        targetLabel,
        role: f % 2 === 0 ? 'working' : 'spare',
      });
      advanceIn();
    }
  }

  const totalIn = incoming.reduce((s, l) => s + l.cable.fibers, 0);
  return { splices, freeFibers: Math.max(0, totalIn - splices.length) };
}

export function buildOrkPorts(
  ork: ORK,
  budgets: SubBudget[],
): { ports: OrkPort[]; maxPorts: number } {
  const maxPorts = splitterPortCount(ork.splitter);
  const budgetBySub = new Map(budgets.filter((b) => b.orkId === ork.id).map((b) => [b.subId, b]));
  const ports: OrkPort[] = [];
  for (let i = 0; i < maxPorts; i++) {
    const subscriber = ork.subscribers[i] ?? null;
    ports.push({
      index: i + 1,
      subscriber,
      budget: subscriber ? budgetBySub.get(subscriber.id) ?? null : null,
      fiberWorking: i * 2,
      fiberSpare: i * 2 + 1,
    });
  }
  return { ports, maxPorts };
}

function computeComplexity(opts: {
  links: number;
  subs: number;
  orks: number;
  tbs: number;
  failBudget: number;
  warnBudget: number;
  emptyLinks: boolean;
  splitterLoss?: number;
}): ComplexityBadge {
  let score = 0;
  score += Math.min(25, opts.links * 4);
  score += Math.min(25, opts.subs * 2);
  score += Math.min(15, opts.orks * 3);
  score += Math.min(10, opts.tbs * 2);
  score += opts.failBudget * 12;
  score += opts.warnBudget * 5;
  if (opts.emptyLinks) score += 15;
  if (opts.splitterLoss && opts.splitterLoss > 15) score += 8;
  score = Math.min(100, Math.round(score));

  const level: ComplexityBadge['level'] =
    score <= 20 ? 1 : score <= 40 ? 2 : score <= 60 ? 3 : score <= 80 ? 4 : 5;
  const titles = ['🌱 Новичок', '🔧 Монтажник', '⚡ Инженер', '🎯 Проектировщик', '🏆 Магистр'];
  const subtitles = [
    'Простая точка — мало связей',
    'Обычный узел, всё под контролем',
    'Несколько веток — внимательно со сварками',
    'Плотный узел — проверь бюджет',
    'Критический хаб — каждая волокна на счету',
  ];
  const colors = ['#34d399', '#38bdf8', '#fbbf24', '#fb923c', '#f87171'];
  const stars = 6 - level;
  const hints: string[] = [];
  if (opts.emptyLinks) hints.push('Нет кабелей — протяните связь или поставьте узел на трассу');
  if (opts.failBudget > 0) hints.push(`${opts.failBudget} камер с перегрузом по затуханию`);
  if (opts.warnBudget > 0) hints.push(`${opts.warnBudget} камер в жёлтой зоне бюджета`);
  if (opts.subs > 8) hints.push('Много камер на одном сплиттере — проверь ёмкость');
  if (hints.length === 0) hints.push('Схема сбалансирована — можно масштабировать дальше');

  return {
    score,
    level,
    title: titles[level - 1],
    subtitle: subtitles[level - 1],
    color: colors[level - 1],
    stars,
    hints,
  };
}

export function resolveInterior(
  view: InteriorView,
  districts: District[],
  cables: Cable[],
  budgets: SubBudget[],
  joints: InlineJoint[] = [],
): EntityInteriorData | null {
  if (view.kind === 'joint') {
    const joint = joints.find((j) => j.id === view.id);
    if (!joint) return null;
    const links = cableLinksForEntity(joint.id, cables, districts, joints);
    const { splices, freeFibers } = buildJointSplices(links);
    const nearTb = nearestTbToJoint(joint, districts);
    const complexity = computeComplexity({
      links: links.length,
      subs: 0,
      orks: 0,
      tbs: 0,
      failBudget: 0,
      warnBudget: 0,
      emptyLinks: links.length === 0,
    });
    return {
      kind: 'joint',
      joint,
      links,
      splices,
      freeFibers,
      nearestTbId: nearTb?.id ?? null,
      complexity,
    };
  }
  if (view.kind === 'olt') {
    const district = districts.find((d) => d.olt.id === view.id);
    if (!district) return null;
    const olt = district.olt;
    const links = cableLinksForEntity(olt.id, cables, districts, joints);
    const orkCount = olt.transitBoxes.reduce((s, tb) => s + tb.orks.length, 0);
    const subCount = olt.transitBoxes.reduce(
      (s, tb) => s + tb.orks.reduce((ss, o) => ss + o.subscribers.length, 0),
      0,
    );
    const relatedBudgets = budgets.filter((b) => b.oltId === olt.id);
    const complexity = computeComplexity({
      links: links.length,
      subs: subCount,
      orks: orkCount,
      tbs: olt.transitBoxes.length,
      failBudget: relatedBudgets.filter((b) => b.status === 'fail').length,
      warnBudget: relatedBudgets.filter((b) => b.status === 'warn').length,
      emptyLinks: links.length === 0,
      splitterLoss: SPLITTER_LOSS_DB[olt.l1Splitter],
    });
    const portCount = Math.min(olt.capacity, 16);
    const ponPorts: OltPonPort[] = Array.from({ length: portCount }, (_, i) => {
      const port = i + 1;
      const tb = olt.transitBoxes[i] ?? null;
      const orkCount = tb ? tb.orks.length : 0;
      const subCount = tb ? tb.orks.reduce((s, o) => s + o.subscribers.length, 0) : 0;
      return {
        port,
        tbId: tb?.id ?? null,
        label: tb ? tb.id : '—',
        orkCount,
        subCount,
        status: tb ? 'used' : 'free',
      };
    });
    return {
      kind: 'olt',
      olt,
      district: district.name,
      links,
      tbCount: olt.transitBoxes.length,
      orkCount,
      subCount,
      ponPorts,
      complexity,
    };
  }

  if (view.kind === 'tb') {
    let tb: TransitBox | null = null;
    for (const d of districts) {
      const x = d.olt.transitBoxes.find((t) => t.id === view.id);
      if (x) { tb = x; break; }
    }
    if (!tb) {
      const joint = joints.find((j) => j.id === view.id);
      if (joint) return resolveInterior({ kind: 'joint', id: joint.id }, districts, cables, budgets, joints);
      return null;
    }
    const links = cableLinksForEntity(tb.id, cables, districts, joints);
    const { splices, freeFibers } = buildTbSplices(tb, links);
    const subCount = tb.orks.reduce((s, o) => s + o.subscribers.length, 0);
    const relatedBudgets = budgets.filter((b) => b.tbId === tb.id);
    const complexity = computeComplexity({
      links: links.length,
      subs: subCount,
      orks: tb.orks.length,
      tbs: 1,
      failBudget: relatedBudgets.filter((b) => b.status === 'fail').length,
      warnBudget: relatedBudgets.filter((b) => b.status === 'warn').length,
      emptyLinks: links.length === 0,
    });
    return { kind: 'tb', tb, links, splices, freeFibers, complexity };
  }

  let ork: ORK | null = null;
  let tb: TransitBox | null = null;
  for (const d of districts) {
    for (const t of d.olt.transitBoxes) {
      const o = t.orks.find((x) => x.id === view.id);
      if (o) { ork = o; tb = t; break; }
    }
    if (ork) break;
  }
  if (!ork) return null;
  const links = cableLinksForEntity(ork.id, cables, districts, joints);
  const uplink = links.find((l) => l.direction === 'in')?.cable ?? null;
  const { ports, maxPorts } = buildOrkPorts(ork, budgets);
  const relatedBudgets = budgets.filter((b) => b.orkId === ork.id);
  const complexity = computeComplexity({
    links: links.length,
    subs: ork.subscribers.length,
    orks: 1,
    tbs: 0,
    failBudget: relatedBudgets.filter((b) => b.status === 'fail').length,
    warnBudget: relatedBudgets.filter((b) => b.status === 'warn').length,
    emptyLinks: links.length === 0,
    splitterLoss: SPLITTER_LOSS_DB[ork.splitter],
  });
  return { kind: 'ork', ork, tb, uplink, ports, maxPorts, complexity };
}

export function budgetStatusLabel(status: SubBudget['status']): string {
  if (status === 'ok') return 'В норме';
  if (status === 'warn') return 'Жёлтая зона';
  return 'Перегруз';
}

export function budgetStatusColor(status: SubBudget['status']): string {
  if (status === 'ok') return '#34d399';
  if (status === 'warn') return '#fbbf24';
  return '#f87171';
}

export function cameraLabel(sub: Subscriber): string {
  const kind = (sub.kind ?? 'unknown') as CameraKind;
  const kindLbl = CAMERA_KIND_LABEL[kind];
  const name = sub.desc?.trim() || sub.id;
  return `${kindLbl}: ${name}`;
}

export function fiberSwatch(index: number): { hex: string; name: string } {
  const c = TIA_598_COLORS[index % 12];
  return { hex: c.hex, name: c.name };
}

export function cableFiberCount(type: Cable['type']): number {
  return CABLE_FIBERS[type] ?? 12;
}

export { SAFE_LOSS_DB };
