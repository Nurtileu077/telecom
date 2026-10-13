import { describe, it, expect } from 'vitest';
import type { DailyWorkEntry, PlanRoute, SnpProgress } from '@/types/construction';
import { sideByName, pickMainRoute, lineOfUnmarked, mainRouteByKato, crewLineIn } from './routeMain';
import { routeWork } from './routeSegments';
import { routeViews } from './routeStyle';
import { routeLengthM } from './routeProgress';
import { lineForPoint } from './shiftPlace';
import { emptyJournal, setMainRoute, loadPlanRoutes } from './journalStore';

const now = '2026-10-01T00:00:00.000Z';

function line(id: string, name: string, coords: [number, number][], over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id, name, uchastok: 'Еленовка', coords, lengthM: routeLengthM(coords),
    source: 'тест', createdAt: now, updatedAt: now, ...over,
  };
}

/** Основная — на восток 7 км, вариант — на северо-восток 11 км, отвод к школе — 2 км на север. */
const MAIN = line('main', 'ОМ — Еленовка', [[51, 71], [51, 71.1]]);
const ALT = line('alt', 'Еленовка альтернативный вариант', [[51, 71], [51.07, 71.1]]);
const SCHOOL = line('school', 'Еленовка отвод к школе', [[51, 71.05], [51.02, 71.05]]);

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

const allOf191 = new Map([['main', '191'], ['alt', '191'], ['school', '191']]);

describe('основная линия села', () => {
  it('вариант длиннее основной — основной остаётся та, что вариантом не названа', () => {
    expect(ALT.lengthM).toBeGreaterThan(MAIN.lengthM);
    expect(pickMainRoute([ALT, MAIN, SCHOOL])?.id).toBe('main');
  });

  it('слова «альтернативный», «вариант», «отвод» узнаются и по-русски, без границы слова', () => {
    expect(sideByName({ name: 'Еленовка альтернативный' })).toBe(true);
    expect(sideByName({ name: 'Отвод к школе' })).toBe(true);
    expect(sideByName({ name: 'ОМ — Еленовка' })).toBe(false);
    // Папка KML тоже говорит: «Варианты» лежат отдельно от основной.
    expect(sideByName({ name: 'Еленовка', folder: 'Варианты' })).toBe(true);
  });

  it('назначенная человеком основная сильнее длины и названия', () => {
    expect(pickMainRoute([MAIN, { ...SCHOOL, main: true }, ALT])?.id).toBe('school');
  });

  it('все линии названы вариантами — основной берём самую длинную, а не никакую', () => {
    expect(pickMainRoute([SCHOOL, ALT])?.id).toBe('alt');
  });
});

describe('смена ложится на одну линию села', () => {
  it('без отметки — только на основную: отвод и вариант её метры не красят', () => {
    const work = routeWork([MAIN, ALT, SCHOOL], allOf191, [shift('2026-10-01', 800)]);
    expect(work.unplaced.map((u) => u.routeId)).toEqual(['main']);
    expect(work.unplaced[0].meters).toBe(800);
  });

  it('«Верно» на основной красит только основную', () => {
    const agreed = shift('2026-10-01', 800, { stop: { routeId: 'main', lat: 51, lon: 71 } });
    const work = routeWork([MAIN, ALT, SCHOOL], allOf191, [agreed, shift('2026-10-02', 500)]);
    expect(new Set(work.segments.map((s) => s.routeId))).toEqual(new Set(['main']));
    expect(work.unplaced).toHaveLength(0);
  });

  it('колонна ушла на отвод — её смены без отметки идут по отводу, пока она не отметится в другом месте', () => {
    const onSchool = shift('2026-10-03', 300, { stop: { routeId: 'school', lat: 51.004, lon: 71.05, manual: true } });
    const next = shift('2026-10-04', 200);
    const lineOf = lineOfUnmarked(
      [shift('2026-10-01', 800), onSchool, next],
      mainRouteByKato([MAIN, ALT, SCHOOL], allOf191),
    );
    expect(lineOf.get(next.id)).toBe('school');
  });

  it('другая колонна без отметки идёт по основной, а не по отводу чужой колонны', () => {
    const onSchool = shift('2026-10-03', 300, { stop: { routeId: 'school', lat: 51.004, lon: 71.05, manual: true } });
    const other = shift('2026-10-04', 200, { column: '2-колонна' });
    const lineOf = lineOfUnmarked([onSchool, other], mainRouteByKato([MAIN, ALT, SCHOOL], allOf191));
    expect(lineOf.get(other.id)).toBe('main');
  });

  it('смены, записанные до отметки на отводе, остаются на основной', () => {
    const before = shift('2026-10-01', 500);
    const onSchool = shift('2026-10-03', 300, { stop: { routeId: 'school', lat: 51.004, lon: 71.05, manual: true } });
    const lineOf = lineOfUnmarked([onSchool, before], mainRouteByKato([MAIN, ALT, SCHOOL], allOf191));
    expect(lineOf.get(before.id)).toBe('main');
  });

  it('форма знает линию колонны в селе — по последней её отметке', () => {
    const live = new Set(['main', 'alt', 'school']);
    const ground = [
      shift('2026-10-01', 500, { stop: { routeId: 'main', lat: 51, lon: 71 } }),
      shift('2026-10-03', 300, { stop: { routeId: 'school', lat: 51.004, lon: 71.05, manual: true } }),
    ];
    expect(crewLineIn(ground, { contractor: 'Дозер', column: '1-колонна' }, '191', live)).toBe('school');
    expect(crewLineIn(ground, { contractor: 'Дозер', column: '1-колонна' }, '191', live, '2026-10-02')).toBe('main');
    expect(crewLineIn(ground, { contractor: 'Дозер', column: '2-колонна' }, '191', live)).toBeNull();
  });

  it('точку поставили у отвода — смена переходит на отвод; далеко от всех — линия та же', () => {
    expect(lineForPoint({ lat: 51.01, lon: 71.0501 }, [MAIN, ALT, SCHOOL], 'main')).toBe('school');
    expect(lineForPoint({ lat: 50.9, lon: 71.05 }, [MAIN, ALT, SCHOOL], 'main')).toBe('main');
  });
});

describe('линии села на карте', () => {
  const progress: SnpProgress[] = [{ kato: '191', snp: 'Еленовка', stages: {}, updatedAt: now }];

  it('отвод и вариант помечены не основными, основная — нет', () => {
    const views = routeViews([MAIN, ALT, SCHOOL], { progress });
    const side = Object.fromEntries(views.map((v) => [v.id, !!v.side]));
    expect(side).toEqual({ main: false, alt: true, school: true });
  });

  it('«Сделать основной» снимает метку с прочих линий села и остаётся в журнале изменений', () => {
    const j = { ...emptyJournal(), planRoutes: [{ ...MAIN, main: true }, ALT, SCHOOL] };
    const next = setMainRoute(j, 'school', ['main', 'alt', 'school'], 'Инженер');
    expect(next.planRoutes.filter((r) => r.main).map((r) => r.id)).toEqual(['school']);
    expect(next.changes[0]).toMatchObject({ kind: 'route_main', routeId: 'school', author: 'Инженер' });
    const views = routeViews(next.planRoutes, { progress });
    expect(views.find((v) => !v.side)?.id).toBe('school');
  });

  it('повторная загрузка того же файла основную линию не снимает', () => {
    const j = { ...emptyJournal(), planRoutes: [MAIN, { ...SCHOOL, main: true }] };
    const again = loadPlanRoutes(j, [{ ...SCHOOL }]).state;
    expect(again.planRoutes.find((r) => r.id === 'school')?.main).toBe(true);
  });
});
