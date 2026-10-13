import { describe, it, expect } from 'vitest';
import type { DailyWorkEntry, PlanRoute, SnpProgress } from '@/types/construction';
import {
  sideByName, pickMainRoute, lineOfUnmarked, mainRouteByKato, crewLineIn, lineStem, mainGroup,
  lineIndex,
} from './routeMain';
import { sectionLineFinder } from './routeSection';
import { routeWork } from './routeSegments';
import { routeViews, lineLook, mainLineNote, STAGE_LINE_COLOR } from './routeStyle';
import { routeLengthM } from './routeProgress';
import { lineForPoint, proposeStop, shiftsOnRoute } from './shiftPlace';
import { emptyJournal, setMainRoute, loadPlanRoutes, splitPlanRoute, placeRunFrom } from './journalStore';

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

describe('разрезанная трасса села — одна основная линия', () => {
  const progress: SnpProgress[] = [{
    kato: '191', snp: 'Еленовка', stages: { mkt: { status: 'in_progress' } }, updatedAt: now,
  }];
  /** Основную режут на 5-м км: стык бригад. */
  const cut = (main?: boolean) => splitPlanRoute(
    { ...emptyJournal(), planRoutes: [{ ...MAIN, main }, ALT, SCHOOL] }, 'main', 5000, 'Инженер',
  ).planRoutes;

  it('номера половин в имени линию не меняют', () => {
    expect(lineStem('ОМ — Еленовка (1)')).toBe(lineStem('ОМ — Еленовка'));
    expect(lineStem('ОМ — Ёленовка (1) (2)')).toBe('ом — еленовка');
    expect(lineStem('Трасса 1')).not.toBe(lineStem('Трасса 2'));
  });

  it('разрезанная пополам трасса села обе половины красит', () => {
    const views = routeViews(cut(), { progress });
    const halves = views.filter((v) => v.id.startsWith('main-'));
    expect(halves).toHaveLength(2);
    for (const v of halves) {
      expect(v.side).toBeUndefined();
      expect(v.color).toBe(STAGE_LINE_COLOR.mkt);
      expect(lineLook(v, () => false).planOnly).toBe(false);
    }
    // Отвод и вариант остаются не основными.
    expect(views.filter((v) => v.side).map((v) => v.id).sort()).toEqual(['alt', 'school']);
    // Смены без отметки — на длинную половину, она в группе первая.
    expect(halves.find((v) => v.id === 'main-a')?.mainGroup).toEqual(['main-a', 'main-b']);
  });

  it('половины назначенной основной обе основные', () => {
    const views = routeViews(cut(true), { progress });
    expect(views.filter((v) => !v.side).map((v) => v.id).sort()).toEqual(['main-a', 'main-b']);
  });

  it('одна трасса, нарисованная в KML двумя кусками под одним именем, — одна основная линия', () => {
    const a = line('k1', 'ОМ — Еленовка', [[51, 71], [51, 71.06]]);
    const b = line('k2', 'ОМ — Еленовка', [[51, 71.06], [51, 71.1]]);
    expect(mainGroup([a, b, SCHOOL]).map((r) => r.id)).toEqual(['k1', 'k2']);
  });

  it('копают на одной половине — вторая без работ остаётся проектом и названа куском основной', () => {
    const views = routeViews(cut(), { progress });
    const b = views.find((v) => v.id === 'main-b')!;
    const look = lineLook(b, (id) => id === 'main-a');
    expect(look).toEqual({ planOnly: true, idleLabel: 'кусок основной линии села — работ на нём не отмечено' });
    const text = mainLineNote(b, (id) => views.find((v) => v.id === id)?.name ?? '');
    expect(text).toContain('Кусок основной линии села');
    expect(text).not.toContain('Не основная');
  });

  it('одноимённые куски на деле разные линии — человек разводит их кнопкой', () => {
    const a = line('k1', 'Еленовка', [[51, 71], [51, 71.06]]);
    const b = line('k2', 'Еленовка', [[51, 71.06], [51.02, 71.06]]);
    const j = { ...emptyJournal(), planRoutes: [a, b] };
    const next = setMainRoute(j, 'k1', ['k1', 'k2'], 'Инженер');
    const views = routeViews(next.planRoutes, { progress });
    expect(views.find((v) => v.id === 'k2')?.side).toBe(true);
  });

  it('колонна дошла до места разреза — остаток смены за концом, и точкой его кладут на вторую половину', () => {
    const planRoutes = cut();
    const head = planRoutes.find((r) => r.id === 'main-a')!;
    const tail = planRoutes.find((r) => r.id === 'main-b')!;
    const headM = routeLengthM(head.coords);
    const end = head.coords[head.coords.length - 1];
    // Отметка рукой за 200 м до разреза, назавтра 700 м без отметки.
    const marked = shift('2026-10-05', 600, {
      stop: { routeId: 'main-a', lat: 51, lon: 71 + ((headM - 200) / headM) * (end[1] - 71), manual: true },
    });
    const next = shift('2026-10-06', 700);
    const ground = [marked, next];
    const kato = new Map(planRoutes.map((r) => [r.id, '191']));
    const work = routeWork(planRoutes, kato, ground);
    const onHead = work.unplaced.find((u) => u.routeId === 'main-a');
    expect(onHead?.pastEnd?.endM).toBeCloseTo(500, -1);
    expect(onHead?.meters).toBe(0);
    const run = onHead?.runs.find((r) => r.pastEnd);
    expect(run?.firstEntryId).toBe(next.id);

    // Точку ставят у начала второй половины — с карточки первой.
    const j = { ...emptyJournal(), planRoutes, ground, progress };
    const res = placeRunFrom(j, 'main-a', next.id, { lat: tail.coords[0][0], lon: tail.coords[0][1] + 0.0001 }, {
      author: 'Инженер',
    });
    if ('error' in res) throw new Error(res.error);
    expect(res.state.ground.find((e) => e.id === next.id)?.stop?.routeId).toBe('main-b');
    expect(res.text).toContain('«ОМ — Еленовка (2)»');
    const after = routeWork(planRoutes, kato, res.state.ground);
    expect(after.unplaced.find((u) => u.routeId === 'main-a')).toBeUndefined();
    expect(after.segments.some((sg) => sg.routeId === 'main-b')).toBe(true);
  });
});

describe('магистраль без КАТО', () => {
  /** Магистраль между сёлами, на восток около 14 км; КАТО у неё нет. */
  const TRUNK = line('trunk', 'Акбулак — Жалтыр', [[52, 70], [52, 70.2]], { uchastok: undefined });
  const SECTION = 'Магистраль Акбулак — Жалтыр';
  const onTrunk = (date: string, meters: number, over: Partial<DailyWorkEntry> = {}) =>
    shift(date, meters, { kato: '', uchastok: SECTION, ...over });
  const none = new Map<string, string>();

  it('смена без отметки на магистрали продолжает колонну, а не пропадает', () => {
    const agreed = onTrunk('2026-10-01', 900, { stop: { routeId: 'trunk', lat: 52, lon: 70 } });
    const next = onTrunk('2026-10-02', 600);
    const work = routeWork([TRUNK], none, [agreed, next]);
    expect(work.lineless).toEqual([]);
    const painted = work.segments.filter((sg) => sg.routeId === 'trunk')
      .reduce((m, sg) => m + (sg.toM - sg.fromM), 0);
    expect(painted).toBeCloseTo(1500, 0);
    // Назавтра форма видит и её метры: колонна стоит на 1,5 км, а не на 0,9.
    const idx = lineIndex([TRUNK], none, [agreed, next], sectionLineFinder([TRUNK], { katoByRouteId: none, namesakeIds: new Set() }));
    const shifts = shiftsOnRoute('trunk', undefined, [agreed, next], idx.live, idx.lineOf);
    const p = proposeStop(TRUNK, shifts, 400, '2026-10-03', { contractor: 'Дозер', column: '1-колонна' });
    expect(p?.beforeM).toBeCloseTo(1500, 0);
  });

  it('колонна отметилась на магистрали — следующая смена без КАТО идёт по той же линии, хотя по имени подходят и другие', () => {
    const marked = onTrunk('2026-10-01', 500, { stop: { routeId: 'trunk', lat: 52, lon: 70.02, manual: true } });
    const next = onTrunk('2026-10-02', 300);
    // По имени участка нашлась бы другая линия — отметка колонны сильнее.
    const lineOf = lineOfUnmarked([marked, next], new Map(), new Set(['trunk', 'village']), () => 'village');
    expect(lineOf.get(next.id)).toBe('trunk');
    expect(crewLineIn([marked], { contractor: 'Дозер', column: '1-колонна' }, undefined, new Set(['trunk', 'village']), undefined, SECTION))
      .toBe('trunk');
  });

  it('колонна здесь ещё не отмечалась — линия участка по имени, где совпало полнее всего', () => {
    const village = line('village', 'ОМ — Акбулак', [[52, 69.9], [52, 70]], { uchastok: 'Акбулак' });
    const kato = new Map([['village', '111']]);
    const find = sectionLineFinder([TRUNK, village], { katoByRouteId: kato, namesakeIds: new Set() });
    expect(find(SECTION)).toBe('trunk');
    const work = routeWork([TRUNK, village], kato, [onTrunk('2026-10-01', 700)]);
    // Место не названо — штрих на магистрали, а не пропажа.
    expect(work.unplaced.map((u) => [u.routeId, u.meters])).toEqual([['trunk', 700]]);
  });

  it('по имени участка подходят линии двух сёл-тёзок — без КАТО не выбираем, смена в «Проверках»', () => {
    const a = line('a', 'ОМ — Акбулак', [[52, 69], [52, 69.05]]);
    const b = line('b', 'ОМ — Акбулак', [[53, 70], [53, 70.05]]);
    const kato = new Map([['a', '111'], ['b', '222']]);
    const lost = shift('2026-10-01', 400, { kato: '', uchastok: 'Акбулак' });
    const work = routeWork([a, b], kato, [lost]);
    expect(work.lineless.map((e) => e.id)).toEqual([lost.id]);
    expect(work.unplaced).toEqual([]);
  });

  it('линии участка нет совсем — смена в «Проверках», а не теряется', () => {
    const lost = shift('2026-10-01', 400, { kato: '', uchastok: 'Неизвестный участок' });
    expect(routeWork([TRUNK], none, [lost]).lineless.map((e) => e.id)).toEqual([lost.id]);
  });
});
