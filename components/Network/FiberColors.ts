// TIA-598-C fiber color code for telecom buffer/loose-tube cables.
// Index = fiber position (1-based) in a 12-fiber buffer tube.
export const TIA_598_COLORS = [
  { name: 'Blue',     hex: '#1d4ed8' },
  { name: 'Orange',   hex: '#ea580c' },
  { name: 'Green',    hex: '#16a34a' },
  { name: 'Brown',    hex: '#92400e' },
  { name: 'Slate',    hex: '#64748b' },
  { name: 'White',    hex: '#f8fafc' },
  { name: 'Red',      hex: '#dc2626' },
  { name: 'Black',    hex: '#0f172a' },
  { name: 'Yellow',   hex: '#facc15' },
  { name: 'Violet',   hex: '#7c3aed' },
  { name: 'Rose',     hex: '#f472b6' },
  { name: 'Aqua',     hex: '#22d3ee' },
];

// Buffer tube (loose-tube) colors — same as fibers but applied to whole tubes
// in a multi-tube cable (e.g. ОК-96 = 8 tubes × 12 fibers).
export const TIA_598_TUBE_COLORS = TIA_598_COLORS;

export interface FiberRef {
  cableId: string;
  tubeIndex: number;     // 0-based tube number (0 for cables with only 1 tube)
  fiberIndex: number;    // 0-based fiber within tube
}

export function fiberColorAt(index: number): { name: string; hex: string } {
  return TIA_598_COLORS[index % 12];
}

// Number of buffer tubes for a given cable type. Loose-tube cables typically
// have 12 fibers/tube; 4-fiber cables are single-tube tight-buffered.
export function tubeCount(fibers: number): number {
  if (fibers <= 12) return 1;
  return Math.ceil(fibers / 12);
}

export function fibersPerTube(fibers: number): number {
  if (fibers <= 12) return fibers;
  return 12;
}
