// Camera classification for Sergek-cameras projects.
//   apk-lu          — ЛУ (линейный участок), baseline + скорость, ≥26 Мбит/с
//   apk-intersection — Перекрёсток (stop line + baseline + …), ≥78 Мбит/с
//   ovn             — ОВН (общественное видеонаблюдение, оффлайн), ≥5 Мбит/с
export type CameraType = 'apk-lu' | 'apk-intersection' | 'ovn';

export const CAMERA_MIN_SPEED_MBPS: Record<CameraType, number> = {
  'apk-lu': 26,
  'apk-intersection': 78,
  'ovn': 5,
};

export const CAMERA_TYPE_LABEL: Record<CameraType, string> = {
  'apk-lu': 'АПК · ЛУ',
  'apk-intersection': 'АПК · Перекрёсток',
  'ovn': 'ОВН',
};

// Pole-mounted box at every camera ("Бокс ОНТ" в терминологии вендора).
// Содержит ONT, входной ОК-4 и пробросы дальше по цепочке камер.
// Coords совпадают с координатами камеры — фактически бокс на том же столбе.
export interface OntBox {
  id: string;
  lat: number;
  lon: number;
  subscriberId: string;
  orkspId: string;
}

export interface Subscriber {
  id: string;
  lat: number;
  lon: number;
  desc: string;
  district: string;
  orkId?: string;
  fibers: { working: number; spare: number };
  // Sergek-domain: тип камеры и опциональная минимальная скорость.
  // Оставлены опциональными — старые сейвы без полей продолжают грузиться.
  cameraType?: CameraType;
  minSpeedMbps?: number;
}

export interface ORK {
  id: string;
  lat: number;
  lon: number;
  district: string;
  splitter: SplitterRatio;
  tbId: string;
  subscribers: Subscriber[];
  cableType: CableType;
  boxType: BoxType;
}

export type MuftaType = 'МТОК-96А' | 'МТОК-48А' | 'МТОК-32А' | 'FOSC-400' | 'ОМС-3В' | string;
export type SplitterRatio = '1:2' | '1:4' | '1:8' | '1:16' | '1:32' | '1:64';
export type OLTModel = 'Huawei MA5800-X7' | 'Huawei MA5800-X2' | 'ZTE C610' | 'ZTE C320' | 'Eltex LTP-8X' | string;
export type BoxType = 'Бокс-8' | 'Бокс-16' | 'ОРКСп-16' | 'ОРКСп-32' | 'WTC-BOX-16' | string;

export interface TransitBox {
  id: string;
  lat: number;
  lon: number;
  district: string;
  oltId: string;
  orks: ORK[];
  inCable: CableType;
  outCable: CableType;
  muftaType: MuftaType;
}

export interface OLT {
  id: string;
  lat: number;
  lon: number;
  district: string;
  model: OLTModel;
  capacity: number;
  transitBoxes: TransitBox[];
  l1Splitter: SplitterRatio;
}

export type CableType = 'ОК-4' | 'ОК-8' | 'ОК-12' | 'ОК-16' | 'ОК-24' | 'ОК-32' | 'ОК-48' | 'ОК-96';

export const CABLE_SIZES: CableType[] = ['ОК-4', 'ОК-8', 'ОК-12', 'ОК-16', 'ОК-24', 'ОК-32', 'ОК-48', 'ОК-96'];
export const CABLE_COLORS: Record<CableType, string> = {
  'ОК-4': '#99d499', 'ОК-8': '#4ade80', 'ОК-12': '#3a92fb', 'ОК-16': '#60a5fa',
  'ОК-24': '#f59e0b', 'ОК-32': '#fbbf24', 'ОК-48': '#ec8a00', 'ОК-96': '#f87171',
};
export const CABLE_FIBERS: Record<CableType, number> = {
  'ОК-4': 4, 'ОК-8': 8, 'ОК-12': 12, 'ОК-16': 16,
  'ОК-24': 24, 'ОК-32': 32, 'ОК-48': 48, 'ОК-96': 96,
};
// Project requirement: do NOT use ОК-96. Trunks above 48 fibers fall back to ОК-48.
export const MAX_CABLE_TYPE: CableType = 'ОК-48';
export function selectCableType(subs: number, sparePerSub = 1): CableType {
  const needed = subs * (1 + sparePerSub);
  const allowed = CABLE_SIZES.filter((t) => t !== 'ОК-96');
  return allowed.find((t) => CABLE_FIBERS[t] >= needed) ?? MAX_CABLE_TYPE;
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

export type ProjectStatus = 'draft' | 'review' | 'approved' | 'construction' | 'operating';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, { label: string; color: string; icon: string }> = {
  draft:         { label: 'Дизайн',          color: '#94a3b8', icon: '📝' },
  review:        { label: 'На согласовании', color: '#fbbf24', icon: '👁' },
  approved:      { label: 'Утверждён',       color: '#34d399', icon: '✅' },
  construction:  { label: 'Строительство',   color: '#f59e0b', icon: '🔨' },
  operating:     { label: 'В эксплуатации',  color: '#38bdf8', icon: '📡' },
};

export interface ProjectSnapshot {
  id: string;
  name: string;
  takenAt: string;
  snapshot: {
    districts: District[];
    cables: Cable[];
    joints?: InlineJoint[];
    annotations: MapAnnotation[];
  };
}

export interface Project {
  id: string;
  name: string;
  status?: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  districts: District[];
  cables: Cable[];
  joints?: InlineJoint[];
  // Боксы (ОНТ) у каждой камеры — отдельный слой, не сущность в дереве OLT.
  // Координаты совпадают с камерой; ссылка на abrendid + ОРКСП наверху.
  ontBoxes?: OntBox[];
  annotations: MapAnnotation[];
  importHistory: ImportRecord[];
  settings: ProjectSettings;
  snapshots?: ProjectSnapshot[];
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
  // ── Sergek-domain settings ─────────────────────────────────────────
  // L1-сплиттер по умолчанию на муфте: 1:4 (→ 4 ОРКСП с L2 1:16 = 64
  // камер) или 1:8 (→ 8 ОРКСП с L2 1:8 = 64).  Произведение L1×L2 всегда
  // 64 — это жёсткий лимит на порт OLT.
  l1SplitterDefault?: '1:4' | '1:8';
  // Коридор слияния параллельных кабелей на одной дороге, метры.
  // По умолчанию 12 м: достаточно чтобы соседние OSRM-нити слились,
  // но не сольёт две параллельные улицы (как было при 40 м).
  mergeCorridorM?: number;
  /** Протяжка OSRM: center = ось дороги; left/right = одна сторона проезжей части. */
  roadSide?: 'center' | 'left' | 'right';
  /** Смещение от оси дороги при left/right, метры (обычно 3–6). */
  roadSideOffsetM?: number;
  // Жёсткий лимит камер на один порт OLT.  При превышении группа
  // разбивается на дополнительные порты / OLT.
  maxSubsPerOltPort?: number;
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

export type Currency = 'KZT' | 'USD' | 'RUB' | 'EUR' | 'CNY';

export interface CatalogItem {
  id: string;
  category: 'cable' | 'mufta' | 'box' | 'splitter' | 'olt' | 'ont' | 'patchcord' | 'pigtail' | 'pole' | 'other';
  article: string;
  name: string;
  unit: 'м' | 'км' | 'шт' | 'компл';
  price: number;
  currency: Currency;
  vendor: string;
  link?: string;
  notes?: string;
}

export const CATEGORY_LABELS: Record<CatalogItem['category'], string> = {
  cable: 'Кабель',
  mufta: 'Муфта',
  box: 'Бокс / ОРК',
  splitter: 'Сплиттер',
  olt: 'OLT',
  ont: 'ONT / ONU',
  patchcord: 'Патчкорд',
  pigtail: 'Пигтейл',
  pole: 'Опора / Кронштейн',
  other: 'Прочее',
};

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  KZT: '₸', USD: '$', RUB: '₽', EUR: '€', CNY: '¥',
};

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
  l1SplitterDefault: '1:8',
  mergeCorridorM: 12,
  maxSubsPerOltPort: 64,
  roadSide: 'left',
  roadSideOffsetM: 4,
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
