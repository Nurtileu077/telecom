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
  cableType: 'ОКСНН-4';
  box: 'ОРБ-32';
}

export interface TransitBox {
  id: string;
  lat: number;
  lon: number;
  district: string;
  oltId: string;
  orks: ORK[];
  inCable: 'ОКСНН-8';
  outCable: 'ОКСНН-4';
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

export type CableType = 'ОКБ-10' | 'ОКСНН-8' | 'ОКСНН-4' | 'ОКА-2';

export interface Cable {
  id: string;
  type: CableType;
  fibers: 8 | 4 | 2;
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

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  districts: District[];
  cables: Cable[];
  settings: ProjectSettings;
}

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
    'ОКБ-10': number;
    'ОКСНН-8': number;
    'ОКСНН-4': number;
    'ОКА-2': number;
    total: number;
  };
  equipment: {
    oltUnits: number;
    splitter_1x4_L1: number;
    splitter_1x4_L2: number;
    splitter_1x8_L2: number;
    splitter_1x16_L2: number;
    muftaMTOK96A: number;
    orkBox: number;
    boxORB32: number;
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
  cableOKB10: boolean;
  cableOKSNN8: boolean;
  cableOKSNN4: boolean;
  cableOKA2: boolean;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  maxPerORK: 8,
  maxORKperTB: 4,
  spareFiresPerSub: 1,
  cableReserve: 1.10,
  useOSRM: true,
  osrmDelay: 100,
};

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
