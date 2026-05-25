// Bandwidth + load analysis for the Sergek-cameras domain.
// Per-OLT and per-ОРКСП sums of camera bandwidth requirements plus capacity
// utilisation, used by validateNetwork to flag overloaded equipment and by
// the sidebar / AI tool to surface load distribution.

import {
  District, SplitterRatio, CAMERA_MIN_BANDWIDTH_MBPS, CameraKind, ProjectSide,
} from '@/types/network';

// GPON downstream effective per port — 2.5 Gbps / splitter ratio
// (conservative; real overhead ~10% but fine for design-time check).
const GPON_PORT_DS_MBPS = 2500;

const SPLITTER_N: Record<SplitterRatio, number> = {
  '1:2': 2, '1:4': 4, '1:8': 8, '1:16': 16, '1:32': 32, '1:64': 64,
};

export function splitterCapacityMbps(ratio: SplitterRatio): number {
  return GPON_PORT_DS_MBPS / SPLITTER_N[ratio];
}

export interface OrkLoad {
  id: string;
  district: string;
  splitter: SplitterRatio;
  capacityMbps: number;       // полоса на абонента после сплиттера
  cameras: number;
  load: { lu: number; intersection: number; ovn: number };
  maxCamBwMbps: number;       // максимальная требуемая полоса среди подключённых
  utilisation: number;        // 0-100%
  overloaded: boolean;        // maxCamBwMbps > capacityMbps
}

export interface OltLoad {
  id: string;
  district: string;
  cameras: number;
  load: { lu: number; intersection: number; ovn: number };
  bySide: Record<ProjectSide, number>;
  totalBwMbps: number;        // sum (camera.minBwMbps)
  maxCamerasPerOlt: number;
  overcapacity: boolean;      // cameras > maxCamerasPerOlt
}

export interface BandwidthReport {
  olts: OltLoad[];
  orks: OrkLoad[];
  totals: {
    cameras: number;
    bySide: Record<ProjectSide, number>;
    byKind: Record<CameraKind, number>;
    totalBwMbps: number;
  };
}

export function bandwidthReport(
  districts: District[],
  maxCamerasPerOlt = 512,
): BandwidthReport {
  const olts: OltLoad[] = [];
  const orks: OrkLoad[] = [];
  const totals = {
    cameras: 0,
    bySide: { apk: 0, ovn: 0 } as Record<ProjectSide, number>,
    byKind: { lu: 0, intersection: 0, ovn: 0, unknown: 0 } as Record<CameraKind, number>,
    totalBwMbps: 0,
  };

  for (const d of districts) {
    let oltCams = 0;
    const oltLoad = { lu: 0, intersection: 0, ovn: 0 };
    const oltBySide: Record<ProjectSide, number> = { apk: 0, ovn: 0 };
    let oltBw = 0;

    for (const tb of d.olt.transitBoxes) {
      for (const ork of tb.orks) {
        const orkLoad = { lu: 0, intersection: 0, ovn: 0 };
        let maxBw = 0;
        for (const s of ork.subscribers) {
          const kind: CameraKind = s.kind ?? 'unknown';
          const bw = s.minBandwidthMbps ?? CAMERA_MIN_BANDWIDTH_MBPS[kind];
          oltBw += bw;
          if (bw > maxBw) maxBw = bw;
          if (kind === 'lu')           { orkLoad.lu++;           oltLoad.lu++;           totals.byKind.lu++; }
          else if (kind === 'intersection') { orkLoad.intersection++; oltLoad.intersection++; totals.byKind.intersection++; }
          else if (kind === 'ovn')      { orkLoad.ovn++;          oltLoad.ovn++;          totals.byKind.ovn++; }
          else                          { orkLoad.ovn++;          oltLoad.ovn++;          totals.byKind.unknown++; }
          const side: ProjectSide = s.side ?? (kind === 'ovn' ? 'ovn' : 'apk');
          oltBySide[side]++;
          totals.bySide[side]++;
          oltCams++;
          totals.cameras++;
          totals.totalBwMbps += bw;
        }
        const cap = splitterCapacityMbps(ork.splitter);
        const subs = ork.subscribers.length;
        // Загрузка ОРКСП по числу подключённых камер vs кол-во портов сплиттера.
        // Дополнительно проверка: максимальная полоса камеры влезает в порт.
        const portsUsed = subs;
        const portsAvail = SPLITTER_N[ork.splitter];
        const util = portsAvail > 0 ? Math.round((portsUsed / portsAvail) * 100) : 0;
        orks.push({
          id: ork.id,
          district: d.name,
          splitter: ork.splitter,
          capacityMbps: cap,
          cameras: subs,
          load: orkLoad,
          maxCamBwMbps: maxBw,
          utilisation: util,
          overloaded: maxBw > cap || portsUsed > portsAvail,
        });
      }
    }
    olts.push({
      id: d.olt.id,
      district: d.name,
      cameras: oltCams,
      load: oltLoad,
      bySide: oltBySide,
      totalBwMbps: oltBw,
      maxCamerasPerOlt,
      overcapacity: oltCams > maxCamerasPerOlt,
    });
  }

  return { olts, orks, totals };
}
