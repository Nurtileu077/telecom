import { OpticalBudgetInputs, OpticalBudgetResult } from '@/types/network';

const SPLITTER_LOSS: Record<string, number> = {
  '1:4': 7.3, '1:8': 10.5, '1:16': 13.8, 'none': 0,
};
const CABLE_LOSS_DB_PER_KM = 0.35;
const CONNECTOR_LOSS = 0.3;
const SPLICE_LOSS = 0.1;
const ONT_SENSITIVITY = -27;

export function calculateOpticalBudget(inp: OpticalBudgetInputs): OpticalBudgetResult {
  const cableLoss = inp.distanceKm * CABLE_LOSS_DB_PER_KM;
  const spl1 = SPLITTER_LOSS[inp.splitter1] || 0;
  const spl2 = SPLITTER_LOSS[inp.splitter2] || 0;
  const connLoss = inp.connectors * CONNECTOR_LOSS;
  const spliceLoss = inp.splices * SPLICE_LOSS;
  const totalLoss = cableLoss + spl1 + spl2 + connLoss + spliceLoss + inp.reserveDb;
  const rxPower = inp.txPowerDbm - totalLoss;
  const margin = rxPower - ONT_SENSITIVITY;

  const breakdown = [
    { name: `Кабель ${inp.distanceKm} км @ 0.35 дБ/км`, lossDb: cableLoss },
    { name: `Сплиттер L1 ${inp.splitter1}`, lossDb: spl1 },
    { name: `Сплиттер L2 ${inp.splitter2}`, lossDb: spl2 },
    { name: `Разъёмы (${inp.connectors} × 0.3 дБ)`, lossDb: connLoss },
    { name: `Сварки (${inp.splices} × 0.1 дБ)`, lossDb: spliceLoss },
    { name: `Эксплуатационный запас`, lossDb: inp.reserveDb },
  ];

  const status: 'ok' | 'warning' | 'fail' =
    margin >= 3 ? 'ok' : margin >= 0 ? 'warning' : 'fail';

  return { rxPowerDbm: rxPower, totalLossDb: totalLoss, breakdown, status, margin };
}
