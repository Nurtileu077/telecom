// GPON optical power budget calculation
// Reference: ITU-T G.984.2 — Class B+ has 28 dB budget.
// We compute total loss from OLT TX (avg +5 dBm) to ONT RX along each
// subscriber's path: cables (km × 0.35 dB), splices, connectors, splitters.

import {
  District, Cable, Subscriber, SplitterRatio,
} from '@/types/network';

export const LOSS_PER_KM_DB = 0.35;           // single-mode 9/125 @ 1310 nm
export const LOSS_PER_SPLICE_DB = 0.10;       // fusion splice
export const LOSS_PER_CONNECTOR_DB = 0.50;    // SC/APC mating
export const OLT_TX_DBM = 5.0;                // typical Class B+ OLT TX power
export const ONT_SENSITIVITY_DBM = -27.0;     // worst-case Class B+ ONT
export const BUDGET_DB = OLT_TX_DBM - ONT_SENSITIVITY_DBM; // 32 dB max
export const ENGINEERING_MARGIN_DB = 3.0;     // reserved for aging/repairs
export const SAFE_LOSS_DB = BUDGET_DB - ENGINEERING_MARGIN_DB; // 29 dB working
export const WARN_LOSS_DB = SAFE_LOSS_DB - 3; // 26 dB orange zone

// Splitter insertion loss (typical PLC values)
export const SPLITTER_LOSS_DB: Record<SplitterRatio, number> = {
  '1:2':  3.6,
  '1:4':  7.2,
  '1:8':  10.5,
  '1:16': 13.7,
  '1:32': 17.0,
  '1:64': 21.0,
};

export interface SubBudget {
  subId: string;
  oltId: string;
  tbId: string;
  orkId: string;
  totalLossDB: number;
  rxPowerDBm: number;          // OLT_TX_DBM - totalLossDB
  status: 'ok' | 'warn' | 'fail';
  breakdown: {
    cableKm: number;
    cableLoss: number;
    splices: number;
    spliceLoss: number;
    connectors: number;
    connectorLoss: number;
    l1Splitter: number;
    l2Splitter: number;
  };
}

function pickCable(cables: Cable[], fromId: string, toId: string): Cable | undefined {
  return cables.find((c) => (c.fromId === fromId && c.toId === toId) || (c.fromId === toId && c.toId === fromId));
}

export function calculateSubscriberBudgets(districts: District[], cables: Cable[]): SubBudget[] {
  const results: SubBudget[] = [];

  for (const district of districts) {
    const olt = district.olt;
    const l1Loss = SPLITTER_LOSS_DB[olt.l1Splitter] ?? 0;

    for (const tb of olt.transitBoxes) {
      const oltTbCable = pickCable(cables, olt.id, tb.id);
      const oltTbKm = (oltTbCable?.lengthM ?? 0) / 1000;

      for (const ork of tb.orks) {
        const tbOrkCable = pickCable(cables, tb.id, ork.id);
        const tbOrkKm = (tbOrkCable?.lengthM ?? 0) / 1000;
        const l2Loss = SPLITTER_LOSS_DB[ork.splitter] ?? 0;

        for (const sub of ork.subscribers) {
          const dropCable = pickCable(cables, ork.id, sub.id);
          const dropKm = (dropCable?.lengthM ?? 0) / 1000;

          const cableKm = oltTbKm + tbOrkKm + dropKm;
          const cableLoss = cableKm * LOSS_PER_KM_DB;

          // Splices: 1 inside TB (mufta), 1 inside ORK box, ≈ 4 splices per spool join
          // Approximation: 1 splice per cable segment + 2 at TB + 1 at ORK
          const splices = 4; // OLT→TB join, TB enter, TB→ORK join, ORK enter
          const spliceLoss = splices * LOSS_PER_SPLICE_DB;

          // Connectors: at OLT port, ONT side, plus any patch-cord joins (≈ 4)
          const connectors = 4;
          const connectorLoss = connectors * LOSS_PER_CONNECTOR_DB;

          const totalLossDB = cableLoss + spliceLoss + connectorLoss + l1Loss + l2Loss;
          const rxPowerDBm = OLT_TX_DBM - totalLossDB;

          const status: SubBudget['status'] =
            totalLossDB <= WARN_LOSS_DB ? 'ok' :
            totalLossDB <= SAFE_LOSS_DB ? 'warn' : 'fail';

          results.push({
            subId: sub.id, oltId: olt.id, tbId: tb.id, orkId: ork.id,
            totalLossDB, rxPowerDBm, status,
            breakdown: {
              cableKm, cableLoss,
              splices, spliceLoss,
              connectors, connectorLoss,
              l1Splitter: l1Loss,
              l2Splitter: l2Loss,
            },
          });
        }
      }
    }
  }

  return results;
}

// Aggregate stats for the sidebar overview
export interface BudgetStats {
  total: number;
  ok: number;
  warn: number;
  fail: number;
  worstSub: SubBudget | null;
  averageLossDB: number;
}

export function budgetStats(budgets: SubBudget[]): BudgetStats {
  if (budgets.length === 0) {
    return { total: 0, ok: 0, warn: 0, fail: 0, worstSub: null, averageLossDB: 0 };
  }
  let worst = budgets[0];
  let sum = 0;
  let ok = 0, warn = 0, fail = 0;
  for (const b of budgets) {
    if (b.totalLossDB > worst.totalLossDB) worst = b;
    sum += b.totalLossDB;
    if (b.status === 'ok') ok++; else if (b.status === 'warn') warn++; else fail++;
  }
  return { total: budgets.length, ok, warn, fail, worstSub: worst, averageLossDB: sum / budgets.length };
}
