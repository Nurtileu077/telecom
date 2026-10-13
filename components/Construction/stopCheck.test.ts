import { describe, it, expect } from 'vitest';
import type { DailyWorkEntry, PlanRoute } from '@/types/construction';
import {
  stopMismatch, describeStopMismatch, ductMarksMeters, marksMismatch, stopTolerance,
} from './stopCheck';
import { routeWork } from './routeSegments';
import { routeLengthM } from './routeProgress';
import { proposeStop, placeShifts } from './shiftPlace';
import { checkEntry } from './entryChecks';
import { emptyJournal, moveShiftStop, restoreShape } from './journalStore';
import { changeFeed } from './changeLog';

const now = '2026-10-01T00:00:00.000Z';
/** Прямая на восток, около 14 км: место на ней читается по долготе. */
const LINE: [number, number][] = [[51, 71], [51, 71.2]];
const TOTAL = routeLengthM(LINE);
const lonAt = (m: number) => 71 + (m / TOTAL) * 0.2;

const ROUTE: PlanRoute = {
  id: 'r1', name: 'ОМ — Еленовка', uchastok: 'Еленовка', coords: LINE, lengthM: TOTAL,
  source: 'тест', createdAt: now, updatedAt: now,
};

let seq = 0;
function shift(date: string, meters: number, over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  seq += 1;
  return {
    kind: 'ground', id: `s${seq}`, date, smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    contractor: 'Дозер', column: '1-колонна',
    byMethod: { 'кабелеукладчик': meters }, materials: {},
    createdAt: `${date}T10:00:00.000Z`, updatedAt: now, ...over,
  };
}
const atMap = (m: number) => ({ stop: { routeId: 'r1', lat: 51, lon: lonAt(m), manual: true } });
const agreed = () => ({ stop: { routeId: 'r1', lat: 51, lon: 71 } });

describe('отметка против метров смены', () => {
  it('точку передвинули с 3-го км на 9-й при 500 м в смене — расхождение названо вместе с дырой', () => {
    const m = stopMismatch({ beforeM: 3000, atM: 9000, meters: 500 })!;
    expect(m.kind).toBe('gap');
    expect(m.diffM).toBe(5500);
    const text = describeStopMismatch(m, { crewName: '1-колонна (Дозер)' });
    expect(text).toContain('Прошлая смена колонны «1-колонна (Дозер)» кончилась на 3,00 км, отметка — на 9,00 км');
    expect(text).toContain('это 6 000 м по линии, а в смене 500 м — расходится больше чем на 3 %');
    expect(text).toContain('Между ними 5 500 м останутся не закрашены');
  });

  it('промах пальца в полсотни метров расхождением не считается', () => {
    expect(stopTolerance(500)).toBe(50);
    expect(stopMismatch({ beforeM: 3000, atM: 3540, meters: 500 })).toBeNull();
    // На длинной смене порог — 3 %: 4 км ± 120 м.
    expect(stopMismatch({ beforeM: 0, atM: 4110, meters: 4000 })).toBeNull();
    expect(stopMismatch({ beforeM: 0, atM: 4200, meters: 4000 })?.kind).toBe('gap');
  });

  it('прокол в той же смене двигает колонну — это не расхождение', () => {
    expect(stopMismatch({ beforeM: 3000, atM: 3580, meters: 500, drillM: 80 })).toBeNull();
  });

  it('точка ближе, чем метры, — часть метров ложится на пройденное, так и сказано', () => {
    const m = stopMismatch({ beforeM: 3000, atM: 3200, meters: 500 })!;
    expect(m.kind).toBe('short');
    expect(describeStopMismatch(m)).toContain('300 м из метров смены лягут на уже закрашенное');
  });

  it('точка позади прошлого места — спрашиваем, не развернулась ли колонна', () => {
    const m = stopMismatch({ beforeM: 3000, atM: 2000, meters: 500 })!;
    expect(m.kind).toBe('behind');
    expect(describeStopMismatch(m)).toContain('1 000 м по линии назад');
    expect(describeStopMismatch(m)).toContain('выберите, куда идёт');
  });

  it('колонна навстречу: её путь считается к началу линии', () => {
    expect(stopMismatch({ beforeM: 9000, atM: 8500, meters: 500, back: true })).toBeNull();
    expect(stopMismatch({ beforeM: 9000, atM: 3000, meters: 500, back: true })?.kind).toBe('gap');
  });
});

describe('расхождение сохранённой смены видно назавтра', () => {
  it('на карточке трассы — у смены, передвинутой с 3-го км на 9-й', () => {
    const moved = shift('2026-10-02', 500, atMap(9000));
    const work = routeWork([ROUTE], new Map([['r1', '191']]), [
      shift('2026-10-01', 3000, agreed()),
      moved,
    ]);
    expect(work.mismatches.map((m) => [m.entryId, m.mismatch.kind])).toEqual([[moved.id, 'gap']]);
    expect(work.mismatches[0].text).toContain('02.10.2026: Прошлая смена колонны «1-колонна (Дозер)» кончилась на 3,00 км');
  });

  it('первая отметка колонны на линии ни с чем не сравнивается', () => {
    const work = routeWork([ROUTE], new Map([['r1', '191']]), [shift('2026-10-01', 500, atMap(9000))]);
    expect(work.mismatches).toHaveLength(0);
  });

  it('сошедшаяся отметка в проверки не попадает', () => {
    const work = routeWork([ROUTE], new Map([['r1', '191']]), [
      shift('2026-10-01', 3000, agreed()),
      shift('2026-10-02', 500, atMap(3520)),
    ]);
    expect(work.mismatches).toHaveLength(0);
  });
});

describe('метки трубы против метров', () => {
  it('«4000 — 2490» — это 1 510 м, «4003 — 0000» — бухта вся', () => {
    expect(ductMarksMeters([{ coil: '4000', meters: 2490 }])).toBe(1510);
    expect(ductMarksMeters([{ coil: '4003', meters: 0 }, { coil: '4000', meters: 2490 }])).toBe(5513);
  });

  it('метка не числом длины не даёт — по меткам не считаем вовсе', () => {
    expect(ductMarksMeters([{ coil: 'Б-12', meters: 2490 }, { coil: '4000', meters: 2490 }])).toBeNull();
    expect(ductMarksMeters([])).toBeNull();
  });

  it('метки разошлись с метрами больше 3 % — проверка смены говорит и объясняет счёт', () => {
    expect(marksMismatch(1500, [{ coil: '4000', meters: 2490 }])).toBeNull();
    expect(marksMismatch(1200, [{ coil: '4000', meters: 2490 }])).toEqual({ marksM: 1510, shiftM: 1200, diffM: 310 });
    const warnings = checkEntry(shift('2026-10-01', 1200, { ductMarks: [{ coil: '4000', meters: 2490 }] }), []);
    const w = warnings.find((x) => x.text.startsWith('По меткам трубы'))!;
    expect(w.level).toBe('check');
    expect(w.text).toBe('По меткам трубы ушло 1 510 м, а в смене 1 200 м — расходится больше чем на 3 %.');
    expect(w.hint).toContain('«4000 — 2490» — это 1 510 м');
  });
});

describe('поправка с карты не забывается', () => {
  const journal = (ground: DailyWorkEntry[]) => ({ ...emptyJournal(), planRoutes: [ROUTE], ground });

  it('метку колонны перетащили с 3-го км на 9-й — назавтра счёт от 9-го', () => {
    const first = shift('2026-10-01', 3000, agreed());
    const j = journal([first]);
    const res = moveShiftStop(j, first.id, 'r1', { lat: 51.0003, lon: lonAt(9000) }, { author: 'Инженер' });
    if ('error' in res) throw new Error(res.error);
    const p = proposeStop(ROUTE, res.state.ground, 500, '2026-10-02', first)!;
    expect(p.from).toBe('place');
    expect(p.beforeM).toBeCloseTo(9000, -1);
    expect(p.atM).toBeCloseTo(9500, -1);
    expect(res.text).toContain('следующие смены считаются отсюда');
  });

  it('передвинутая точка разошлась с метрами — сказано сразу', () => {
    const first = shift('2026-10-01', 3000, agreed());
    const second = shift('2026-10-02', 500);
    const res = moveShiftStop(journal([first, second]), second.id, 'r1', { lat: 51, lon: lonAt(9000) }, { author: 'И' });
    if ('error' in res) throw new Error(res.error);
    expect(res.text).toContain('расходится больше чем на 3 %');
    expect(placeShifts(ROUTE, res.state.ground).endM).toBeCloseTo(9000, -1);
  });

  it('метку бросили далеко от линии — место смены не правим', () => {
    const first = shift('2026-10-01', 3000, agreed());
    const res = moveShiftStop(journal([first]), first.id, 'r1', { lat: 51.05, lon: lonAt(9000) }, { author: 'И' });
    expect(res).toEqual({ error: 'Метка далеко от линии колонны — место смены не правим.' });
  });

  it('поправку видно в журнале изменений, и её можно вернуть', () => {
    const first = shift('2026-10-01', 3000, agreed());
    const res = moveShiftStop(journal([first]), first.id, 'r1', { lat: 51, lon: lonAt(9000) }, { author: 'Инженер' });
    if ('error' in res) throw new Error(res.error);
    const item = changeFeed(res.state).find((i) => i.text.startsWith('место смен указано'))!;
    expect(item.text).toContain('остановились не на 3,00 км, а на 9,00 км');
    const back = restoreShape(res.state, item.changeId!, 'Инженер');
    expect(back.ground[0].stop).toEqual(first.stop);
  });
});
