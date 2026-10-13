import { describe, it, expect } from 'vitest';
import type { Deviation, PlanRoute, SiteObject } from '@/types/construction';
import {
  buildScheme, schemeDocHtml, schemeAttachmentHtml, schemeSvg, objectMarks,
} from './asBuilt';
import {
  schemeDeviationsFor, placeDeviations, lengthWithDeviations, factLine,
} from './schemeDeviations';
import { routeLengthM } from './routeProgress';

/**
 * Болото обошли в стороне от проекта, обход нарисовали на карте,
 * протокол мобильной группы подписали — а исполнительная схема рисовала
 * проектную линию с проектной длиной и спорила с протоколом заказчика.
 */

const now = '2026-09-12T00:00:00.000Z';

/** Трасса на восток по экватору: 0,001° долготы ≈ 111 м. */
function route(): PlanRoute {
  return {
    id: 'r1', name: 'Аксу — Карабулак', coords: [[0, 0], [0, 0.01]],
    lengthM: 0, source: 'plan.kml', createdAt: now, updatedAt: now,
  };
}

/** Обход: с 0,003° уходим на север на 0,002°, идём до 0,006° и возвращаемся. */
const BYPASS = [
  { lat: 0, lon: 0.003 }, { lat: 0.002, lon: 0.003 },
  { lat: 0.002, lon: 0.006 }, { lat: 0, lon: 0.006 },
];

function dev(over: Partial<Deviation> = {}): Deviation {
  return {
    id: 'd1', kind: 'route', date: '2026-09-10', oblast: '', uchastok: 'Карабулак', kato: '',
    lengthM: 780, coords: BYPASS, reason: 'Обход болота',
    protocol: { number: '14', date: '2026-09-12' },
    author: 'Ербол', createdAt: now, updatedAt: now, ...over,
  };
}

function obj(lat: number, lon: number, name: string): SiteObject {
  return { id: name, kind: 'mufta', name, lat, lon, createdAt: now, updatedAt: now };
}

const PROJECT = routeLengthM(route().coords);
/** Сколько проекта заменил обход: от 0,003° до 0,006°. */
const REPLACED = routeLengthM([[0, 0.003], [0, 0.006]]);

describe('схема по факту', () => {
  it('протяжённость — проект, где кусок заменён обходом длиной из протокола', () => {
    const s = buildScheme(route(), [], { deviations: [dev()] });
    expect(s.mode).toBe('fact');
    expect(s.totalM).toBeCloseTo(PROJECT - REPLACED + 780, 3);
    expect(s.projectM).toBeCloseTo(PROJECT, 6);
    expect(s.factM).toBeCloseTo(s.totalM, 3);
  });

  it('пролёт обхода — ровно длина из протокола, а не по точкам телефона', () => {
    const s = buildScheme(route(), [], { deviations: [dev()] });
    const sp = s.spans.find((x) => x.from === 'Начало отклонения')!;
    expect(sp.to).toBe('Конец отклонения');
    expect(sp.meters).toBeCloseTo(780, 6);
    expect(sp.dev).toBe(1);
  });

  it('муфта, поставленная на обходе, стоит на обходе, а не «в стороне» от проекта', () => {
    const s = buildScheme(route(), [obj(0.002, 0.0045, 'Муфта у болота')], { deviations: [dev()] });
    const m = s.marks.find((x) => x.label === 'Муфта у болота')!;
    expect(m).toBeTruthy();
    expect(m.offsetM).toBeUndefined();
    const from = s.marks.find((x) => x.kind === 'devFrom')!;
    const to = s.marks.find((x) => x.kind === 'devTo')!;
    expect(m.atM).toBeGreaterThan(from.atM);
    expect(m.atM).toBeLessThan(to.atM);
    expect(s.skipped).toEqual([]);
  });

  it('объекты после обхода сдвигаются на разницу обхода и проекта', () => {
    const plain = buildScheme(route(), [obj(0, 0.008, 'Муфта №5')]);
    const fact = buildScheme(route(), [obj(0, 0.008, 'Муфта №5')], { deviations: [dev()] });
    const a = plain.marks.find((x) => x.label === 'Муфта №5')!.atM;
    const b = fact.marks.find((x) => x.label === 'Муфта №5')!.atM;
    expect(b - a).toBeCloseTo(780 - REPLACED, 3);
  });

  it('обход, нарисованный против хода трассы, ложится по ходу', () => {
    const back = buildScheme(route(), [], { deviations: [dev({ coords: [...BYPASS].reverse() })] });
    const fwd = buildScheme(route(), [], { deviations: [dev()] });
    expect(back.totalM).toBeCloseTo(fwd.totalM, 6);
    expect(back.deviations[0].projectM).toBeCloseTo(REPLACED, 3);
  });

  it('на рисунке обход прерывистый и подписан обеими длинами', () => {
    const svg = schemeSvg(buildScheme(route(), [], { deviations: [dev()] }));
    expect(svg).toContain('stroke-dasharray="6,4"');
    expect(svg).toContain(`отклонение №1: обход 780 м вместо ${Math.round(REPLACED)} м по проекту`);
    expect(svg).not.toContain('NaN');
  });
});

describe('схема по проекту с отклонениями', () => {
  const s = () => buildScheme(route(), [obj(0.002, 0.0045, 'Муфта у болота')], {
    deviations: [dev()], mode: 'project',
  });

  it('линия и длина проектные, а длина по факту названа рядом', () => {
    const x = s();
    expect(x.totalM).toBeCloseTo(PROJECT, 6);
    const html = schemeDocHtml({ scheme: x });
    expect(html).toContain('Протяжённость по проекту');
    expect(html).toContain('по факту, с отклонениями');
    expect(html).toContain('Схема по проекту');
  });

  it('отрезок отклонения отмечен, но его длина — проектная и так и подписана', () => {
    const sp = s().spans.find((x) => x.dev === 1)!;
    expect(sp.meters).toBeCloseTo(REPLACED, 3);
    expect(schemeDocHtml({ scheme: s() })).toContain('(по проекту, отклонение №1)');
  });

  it('муфта на обходе на проектную линию не притягивается', () => {
    // 0,002° ≈ 222 м от проекта: дальше порога, и это честно.
    expect(s().skipped[0]).toContain('Муфта у болота');
  });

  it('на рисунке линия сплошная, скобка говорит, что на земле иначе', () => {
    const svg = schemeSvg(s());
    expect(svg).not.toContain('stroke-dasharray="6,4"');
    expect(svg).toContain('отклонение №1: по факту 780 м');
  });
});

describe('таблица отклонений', () => {
  it('в обоих видах называет протокол и обе длины — по ней схему сверяют', () => {
    for (const mode of ['fact', 'project'] as const) {
      const html = schemeDocHtml({ scheme: buildScheme(route(), [], { deviations: [dev()], mode }) });
      expect(html).toContain('Отклонения от проекта');
      expect(html).toContain('протокол МГ №14 от 12.09.2026');
      expect(html).toContain('<td class="val">780</td>');
      expect(html).toContain(`<td class="val">${Math.round(REPLACED)}</td>`);
      expect(html).toContain('Обход болота');
    }
  });

  it('и в приложении к акту — тоже', () => {
    const html = schemeAttachmentHtml({ scheme: buildScheme(route(), [], { deviations: [dev()] }) }, '14');
    expect(html).toContain('Отклонения от проекта');
    expect(html).toContain('(обход, отклонение №1)');
  });

  it('ориентир из карточки подписывает концы вместо «начала» и «конца»', () => {
    const s = buildScheme(route(), [], { deviations: [dev({ fromPoint: 'ПК 3+00', toPoint: 'у моста' })] });
    expect(s.marks.map((m) => m.label)).toEqual(['Аксу', 'ПК 3+00', 'у моста', 'Карабулак']);
    expect(schemeDocHtml({ scheme: s })).toContain('ПК 3+00 — у моста');
  });

  it('без протокола — оговорка до подписи, а не молчание', () => {
    const html = schemeDocHtml({ scheme: buildScheme(route(), [], { deviations: [dev({ protocol: undefined })] }) });
    expect(html).toContain('протокол МГ не оформлен');
    expect(html).toContain('Протокол мобильной группы не оформлен: отклонение №1');
    expect(html.indexOf('не оформлен: отклонение')).toBeLessThan(html.indexOf('Составил'));
  });

  it('без отклонений лист прежний — ни таблицы, ни слов о виде схемы', () => {
    const html = schemeDocHtml({ scheme: buildScheme(route(), []) });
    expect(html).not.toContain('Отклонения от проекта');
    expect(html).not.toContain('Схема по факту');
    expect(html).toContain('Протяжённость:');
  });

  it('концы отклонения объектами не считаются: схема без муфт так и говорит', () => {
    const s = buildScheme(route(), [], { deviations: [dev()] });
    expect(objectMarks(s)).toEqual([]);
    expect(schemeDocHtml({ scheme: s })).toContain('Объектов участка в журнале нет');
  });
});

describe('отклонения, которые на схему не ложатся', () => {
  it('одна точка: где обход вернулся на трассу, неизвестно — не выдумываем, а называем', () => {
    const s = buildScheme(route(), [], { deviations: [dev({ coords: [BYPASS[0]] })] });
    expect(s.deviations).toEqual([]);
    expect(s.deviationsUnplaced[0]).toContain('снята одна точка');
    expect(s.totalM).toBeCloseTo(PROJECT, 6);
    expect(schemeDocHtml({ scheme: s })).toContain('Протяжённость по факту их не учитывает');
  });

  it('конец далеко от линии к трассе не притягивается', () => {
    const far = [{ lat: 0, lon: 0.003 }, { lat: 0.01, lon: 0.006 }];
    const s = buildScheme(route(), [], { deviations: [dev({ coords: far })] });
    expect(s.deviations).toEqual([]);
    expect(s.deviationsUnplaced[0]).toMatch(/конец в [\d ]+ м от линии/);
  });

  it('два обхода одного куска — проект не вычитается дважды', () => {
    const s = buildScheme(route(), [], { deviations: [dev(), dev({ id: 'd2', reason: 'Повтор' })] });
    expect(s.deviations).toHaveLength(1);
    expect(s.deviationsUnplaced[0]).toContain('перекрывается с отклонением №1');
    expect(s.totalM).toBeCloseTo(PROJECT - REPLACED + 780, 3);
  });

  it('два разных обхода нумеруются по ходу трассы', () => {
    const second = dev({
      id: 'd2', lengthM: 300, reason: 'Обход ТТС',
      coords: [{ lat: 0, lon: 0.0085 }, { lat: 0.0005, lon: 0.009 }, { lat: 0, lon: 0.0095 }],
    });
    const s = buildScheme(route(), [], { deviations: [second, dev()] });
    expect(s.deviations.map((d) => d.reason)).toEqual(['Обход болота', 'Обход ТТС']);
    expect(s.marks.filter((m) => m.kind === 'devFrom').map((m) => m.label))
      .toEqual(['Начало отклонения 1', 'Начало отклонения 2']);
  });
});

describe('какие отклонения идут в схему трассы', () => {
  it('по глубине — нет: линию оно не двигает, оно живёт в актах', () => {
    const { own } = schemeDeviationsFor([dev({ kind: 'depth' })], route());
    expect(own).toEqual([]);
  });

  it('своё узнаёт по участку тем же правилом, что и объекты', () => {
    expect(schemeDeviationsFor([dev({ uchastok: 'с. Карабулак' })], route()).own).toHaveLength(1);
    expect(schemeDeviationsFor([dev({ uchastok: 'Кенжеколь' })], route()).own).toEqual([]);
  });

  it('чужое на самой линии называется на экране, но в лист не идёт', () => {
    const { own, others } = schemeDeviationsFor([dev({ uchastok: 'Кенжеколь' })], route());
    const s = buildScheme(route(), [], { deviations: own, otherDeviations: others });
    expect(s.deviationsForeign[0]).toContain('участок «Кенжеколь»');
    expect(schemeDocHtml({ scheme: s })).not.toContain('Кенжеколь');
  });
});

describe('длина участка по факту', () => {
  it('обход заменяет кусок проекта, а не дописывается к нему', () => {
    const { placed } = placeDeviations(route().coords, [dev()], 120);
    expect(lengthWithDeviations(PROJECT, placed)).toBeCloseTo(PROJECT - REPLACED + 780, 3);
    // Раньше форма рисования говорила «трасса + обход».
    expect(lengthWithDeviations(PROJECT, placed)).toBeLessThan(PROJECT + 780);
  });

  it('фактическая линия сходится со схемой по длине', () => {
    const { placed } = placeDeviations(route().coords, [dev()], 120);
    const line = factLine(route().coords, placed);
    expect(line.totalM).toBeCloseTo(lengthWithDeviations(PROJECT, placed), 6);
    expect(line.toScheme(routeLengthM(line.coords))).toBeCloseTo(line.totalM, 6);
  });
});
