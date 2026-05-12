export interface Subscriber {
  id: string;
  lat: number;
  lon: number;
  desc: string;
  district: string;
  orkId?: string;
  fibers: { working: number; spare: number };
}

export interface ORK {
  id: string;
  lat: number;
  lon: number;
  district: string;
  splitter: '1:4' | '1:8' | '1:16';
  tbId: string;
  subscribers: Subscriber[];
  cableType: CableType;
  boxType: string;
}

export interface TransitBox {
  id: string;
  lat: number;
  lon: number;
  district: string;
  oltId: string;
  orks: ORK[];
  inCable: CableType;
  outCable: CableType;
  muftaType: 'МТОК-96А';
}

export interface OLT {
  id: string;
  lat: number;
  lon: number;
  district: string;
  model: string;
  capacity: number;
  transitBoxes: TransitBox[];
  l1Splitter: '1:4';
}

export type CableType = 'ОК-4' | 'ОК-8' | 'ОК-12' | 'ОК-16' | 'ОК-24' | 'ОК-32' | 'ОК-48' | 'ОК-96';

export const CABLE_SIZES: CableType[] = ['ОК-4', 'ОК-8', 'ОК-12', 'ОК-16', 'ОК-24', 'ОК-32', 'ОК-48', 'ОК-96'];
export const CABLE_FIBERS: Record<CableType, number> = {
  'ОК-4': 4, 'ОК-8': 8, 'ОК-12': 12, 'ОК-16': 16,
  'ОК-24': 24, 'ОК-32': 32, 'ОК-48': 48, 'ОК-96': 96,
};
export function selectCableType(subs: number, sparePerSub = 1): CableType {
  const needed = subs * (1 + sparePerSub);
  return CABLE_SIZES.find((t) => CABLE_FIBERS[t] >= needed) ?? 'ОК-96';
}

export interface Cable {
  id: string;
  type: CableType;
  fibers: number;
  fromId: string;
  toId: string;
  coords: [number, number][];
  lengthM: number;
  routedByOSRM: boolean;
}

export interface District {
  name: string;
  color: string;
  olt: OLT;
  subscribers: Subscriber[];
}

export interface InlineJoint {
  id: string;
  lat: number;
  lon: number;
  parentId: string;
  branchCount: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  districts: District[];
  cables: Cable[];
  joints?: InlineJoint[];
  annotations: MapAnnotation[];
  importHistory: ImportRecord[];
  settings: ProjectSettings;
}

export interface ImportRecord {
  id: string;
  source: string;
  districts: string[];
  count: number;
  importedAt: string;
}

export type AnnotationType = 'village' | 'note' | 'problem' | 'area' | 'photo' | 'cable-route';
export type AnnotationShape = 'point' | 'polygon' | 'line' | 'circle';

export interface MapAnnotation {
  id: string;
  type: AnnotationType;
  shape: AnnotationShape;
  coords: [number, number][];
  name: string;
  description: string;
  color: string;
  radius?: number;
  createdAt: string;
  updatedAt: string;
}

export const ANNOTATION_PRESETS: Record<AnnotationType, { icon: string; color: string; label: string }> = {
  village:     { icon: '🏘',  color: '#34d399', label: 'Село / нас.пункт' },
  note:        { icon: '📝',  color: '#38bdf8', label: 'Заметка' },
  problem:     { icon: '⚠️',  color: '#f87171', label: 'Проблема' },
  area:        { icon: '⬜',  color: '#a78bfa', label: 'Зона' },
  photo:       { icon: '📷',  color: '#fbbf24', label: 'Фото-точка' },
  'cable-route':{ icon: '〰',  color: '#f59e0b', label: 'Маршрут кабеля' },
};


export interface ProjectSettings {
  maxPerORK: number;
  maxORKperTB: number;
  spareFiresPerSub: number;
  cableReserve: number;
  useOSRM: boolean;
  osrmDelay: number;
}

export interface Materials {
  cables: {
    'ОК-4': number;
    'ОК-8': number;
    'ОК-12': number;
    'ОК-16': number;
    'ОК-24': number;
    'ОК-32': number;
    'ОК-48': number;
    'ОК-96': number;
    total: number;
  };
  equipment: {
    oltUnits: number;
    splitter_1x4_L1: number;
    splitter_1x4_L2: number;
    splitter_1x8_L2: number;
    splitter_1x16_L2: number;
    muftaMTOK96A: number;
    boksCount: number;
    ontZTE_F601: number;
    pigtailSCAPC: number;
    patchcord: number;
    kdzsGilzy: number;
    clamps: number;
    cable_reserve_m: number;
  };
}

export interface ValidationIssue {
  type: 'warning' | 'error';
  message: string;
  entityId?: string;
  entityType?: 'ork' | 'cable' | 'olt' | 'subscriber';
}

export interface LayerVisibility {
  olt: boolean;
  tb: boolean;
  ork: boolean;
  subscribers: boolean;
  cables: boolean;
  cableOK4: boolean;
  cableOK8: boolean;
  cableOK12: boolean;
  cableOK16: boolean;
  cableOK24: boolean;
  cableOK32: boolean;
  cableOK48: boolean;
  cableOK96: boolean;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  maxPerORK: 8,
  maxORKperTB: 4,
  spareFiresPerSub: 1,
  cableReserve: 1.10,
  useOSRM: true,
  osrmDelay: 100,
};

export interface PriceCatalog {
  currency: string;
  cables: {
    'ОК-4': number; 'ОК-8': number; 'ОК-12': number; 'ОК-16': number;
    'ОК-24': number; 'ОК-32': number; 'ОК-48': number; 'ОК-96': number;
  };
  olt: number;
  splitter_1x4: number;
  splitter_1x8: number;
  splitter_1x16: number;
  mufta: number;
  boks: number;
  ontBox: number;
  ont: number;
  pigtail: number;
  patchcord: number;
  kdzs: number;
  clamp: number;
  installLabor: number;
}

export const DEFAULT_PRICES: PriceCatalog = {
  currency: '₸',
  cables: {
    'ОК-4': 95, 'ОК-8': 140, 'ОК-12': 180, 'ОК-16': 220,
    'ОК-24': 290, 'ОК-32': 360, 'ОК-48': 490, 'ОК-96': 760,
  },
  olt: 2500000,
  splitter_1x4: 8500,
  splitter_1x8: 11000,
  splitter_1x16: 18000,
  mufta: 25000,
  boks: 12000,
  ontBox: 1800,
  ont: 9500,
  pigtail: 350,
  patchcord: 850,
  kdzs: 35,
  clamp: 420,
  installLabor: 0,
};

export interface OpticalBudgetInputs {
  txPowerDbm: number;
  distanceKm: number;
  splitter1: '1:4' | '1:8' | '1:16' | 'none';
  splitter2: '1:4' | '1:8' | '1:16' | 'none';
  connectors: number;
  splices: number;
  reserveDb: number;
}

export interface OpticalBudgetResult {
  rxPowerDbm: number;
  totalLossDb: number;
  breakdown: { name: string; lossDb: number }[];
  status: 'ok' | 'warning' | 'fail';
  margin: number;
}

export const DISTRICT_COLORS = [
  '#38bdf8',
  '#34d399',
  '#f59e0b',
  '#a78bfa',
  '#f472b6',
  '#fb923c',
  '#fbbf24',
  '#f87171',
  '#22d3ee',
  '#4ade80',
  '#facc15',
  '#c084fc',
];
