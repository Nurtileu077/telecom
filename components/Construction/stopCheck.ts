import type { DailyWorkEntry, DuctMark } from '@/types/construction';
import type { RoutePlacement } from './shiftPlace';

/**
 * Отметка «остановились здесь» против метров смены и меток трубы.
 *
 * Инженер передвинул «остановились здесь» с 3-го км на 9-й, а в смене
 * 500 м. Либо колонна перескочила кусок (оставили под прокол, переехали),
 * либо ошиблись точкой, либо метрами. Раньше это молча проглатывалось:
 * смена закрашивалась у новой точки, а шесть километров между ними
 * оставались проектом, и никто не спрашивал почему.
 *
 * Что верно при расхождении — точка или метры — система не решает и сама
 * ничего не правит. Метры смены идут в акт и в деньги, их подтверждают
 * метки трубы; точка говорит, где копали. Обе цифры — со слов человека,
 * и выбрать между ними может только он. Наше дело — показать расхождение
 * до сохранения и после, на карточке трассы и в «Проверках».
 *
 * Порог — 3 % от метров смены, но не меньше 50 м: точку ставят пальцем по
 * карте, и полсотни метров — это промах пальца, а не расхождение.
 */

export const STOP_SHARE = 0.03;
export const STOP_MIN_M = 50;

export function stopTolerance(meters: number): number {
  return Math.max(STOP_MIN_M, Math.max(0, meters) * STOP_SHARE);
}

export interface StopMismatch {
  /** Где колонна стояла до этой смены, метры от начала линии. */
  beforeM: number;
  /** Где отметка, метры от начала линии. */
  atM: number;
  /** Путь по линии от прошлого места до отметки — по ходу колонны; меньше нуля — назад. */
  movedM: number;
  meters: number;
  drillM: number;
  /**
   * 'gap' — отметка дальше, чем дают метры: между сменами кусок остаётся
   * незакрашенным; 'short' — ближе: часть метров ложится на уже пройденное;
   * 'behind' — отметка позади прошлого места колонны.
   */
  kind: 'gap' | 'short' | 'behind';
  /** На сколько расходится, метры. */
  diffM: number;
}

/**
 * Расходится ли отметка с метрами.
 *
 * Прокол ГНБ в той же смене двигает колонну, но в метры по способам не
 * входит: отметка дальше метров на длину прокола — не расхождение.
 */
export function stopMismatch(o: {
  beforeM: number;
  atM: number;
  meters: number;
  drillM?: number;
  back?: boolean;
}): StopMismatch | null {
  const movedM = o.back ? o.beforeM - o.atM : o.atM - o.beforeM;
  const drillM = Math.max(0, o.drillM ?? 0);
  const tol = stopTolerance(o.meters);
  const base = { beforeM: o.beforeM, atM: o.atM, movedM, meters: o.meters, drillM };
  if (movedM < -tol) return { ...base, kind: 'behind', diffM: o.meters - movedM };
  if (movedM < o.meters - tol) return { ...base, kind: 'short', diffM: o.meters - movedM };
  if (movedM > o.meters + drillM + tol) return { ...base, kind: 'gap', diffM: movedM - o.meters - drillM };
  return null;
}

const km = (m: number) => `${(Math.max(0, m) / 1000).toFixed(2).replace('.', ',')} км`;
const meters = (m: number) => `${Math.round(Math.max(0, m)).toLocaleString('ru')} м`;
const day = (iso?: string) => (iso ? iso.split('-').reverse().join('.') : '');

/** Расхождение словами: что видно и что с этим делать. */
export function describeStopMismatch(
  m: StopMismatch,
  o: { crewName?: string; date?: string } = {},
): string {
  const crew = o.crewName ? ` колонны «${o.crewName}»` : '';
  const when = o.date ? `${day(o.date)}: ` : '';
  const drill = m.drillM > 0 ? ` и ${meters(m.drillM)} прокола` : '';
  const head = `${when}Прошлая смена${crew} кончилась на ${km(m.beforeM)}, отметка — на ${km(m.atM)}: `
    + `это ${meters(Math.abs(m.movedM))} по линии${m.movedM < 0 ? ' назад' : ''}, а в смене ${meters(m.meters)}${drill}`
    + ' — расходится больше чем на 3 %.';
  if (m.kind === 'gap') {
    return `${head} Между ними ${meters(m.diffM)} останутся не закрашены. Так и было — перескочили `
      + 'кусок под прокол или переехали, — сохраняйте; нет — поправьте точку или метры.';
  }
  if (m.kind === 'short') {
    return `${head} ${meters(m.diffM)} из метров смены лягут на уже закрашенное. Проверьте точку или метры.`;
  }
  return `${head} Отметка позади прошлого места: если колонна развернулась — выберите, куда идёт; `
    + 'если ошиблись точкой — поставьте её заново.';
}

/** Расхождение у сохранённой смены — для карточки трассы и «Проверок». */
export interface ShiftMismatch {
  routeId: string;
  entryId: string;
  date: string;
  text: string;
  mismatch: StopMismatch;
}

/**
 * Сохранённые смены, у которых отметка разошлась с метрами.
 *
 * Только смены с отметкой рукой и с известным прошлым местом колонны:
 * без прошлого места сравнивать не с чем, а посчитанная точка («Верно»)
 * и есть метры.
 */
export function placementMismatches(
  routeId: string,
  pl: RoutePlacement,
  shifts: DailyWorkEntry[],
  crewName: (e: DailyWorkEntry) => string,
): ShiftMismatch[] {
  const byId = new Map(shifts.map((e) => [e.id, e]));
  const out: ShiftMismatch[] = [];
  for (const p of pl.placed) {
    if (p.prevM === undefined) continue;
    const e = byId.get(p.entryId);
    if (!e) continue;
    // Отметка — конец смены по ходу колонны.
    const atM = p.back ? p.fromM : p.toM;
    const m = stopMismatch({ beforeM: p.prevM, atM, meters: p.meters, drillM: e.drillM, back: p.back });
    if (!m) continue;
    out.push({
      routeId,
      entryId: e.id,
      date: e.date,
      mismatch: m,
      text: describeStopMismatch(m, { crewName: crewName(e) || undefined, date: e.date }),
    });
  }
  return out;
}

// ── Метки трубы ──────────────────────────────────────────────────────────────

/**
 * Сколько трубы ушло по меткам.
 *
 * Метки пишут «с какой на какую»: «4000 — 2490» — с метки 4000 до метки
 * 2490, это 1 510 м; «4003 — 0000» — бухта ушла вся. Метка, записанная не
 * числом (номер бухты «Б-12»), длины не даёт, и тогда по меткам не
 * считаем вовсе: половина меток — это не половина трубы.
 */
export function ductMarksMeters(marks?: DuctMark[]): number | null {
  if (!marks || marks.length === 0) return null;
  let sum = 0;
  for (const m of marks) {
    const start = m.coil.trim();
    if (!/^\d+([.,]\d+)?$/.test(start) || !Number.isFinite(m.meters)) return null;
    sum += Math.abs(parseFloat(start.replace(',', '.')) - m.meters);
  }
  return Math.round(sum);
}

/** Метки трубы против метров смены: null — сходятся или считать не по чему. */
export function marksMismatch(
  shiftM: number,
  marks?: DuctMark[],
): { marksM: number; shiftM: number; diffM: number } | null {
  const marksM = ductMarksMeters(marks);
  if (marksM === null || shiftM <= 0) return null;
  const diffM = Math.abs(marksM - shiftM);
  return diffM > stopTolerance(shiftM) ? { marksM, shiftM, diffM } : null;
}
