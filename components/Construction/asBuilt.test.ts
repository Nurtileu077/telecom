import { describe, it, expect } from 'vitest';
import {
  buildScheme, schemeSvg, schemeDocHtml, schemeDocPage, schemeFileName,
  schemeAttachmentHtml, withSchemeAttached,
} from './asBuilt';
import type { SiteObject, PlanRoute } from '@/types/construction';
import { formatMeters } from './mapDecor';

/**
 * Трасса строго на восток по экватору: на нём градус долготы даёт
 * примерно 111,3 км, и метры в тестах считаются в уме.
 */
function route(lonEnd = 0.01): PlanRoute {
  return {
    id: 'r1',
    name: 'Аксу — Карабулак',
    coords: [[0, 0], [0, lonEnd]],
    lengthM: 0,
    source: 'plan.kml',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

function obj(p: Partial<SiteObject> & { lat: number; lon: number }): SiteObject {
  return {
    id: `o-${p.lat}-${p.lon}`,
    kind: 'mufta',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...p,
  };
}

describe('buildScheme', () => {
  it('ставит объект туда, где он стоит на трассе', () => {
    const s = buildScheme(route(), [obj({ lat: 0, lon: 0.005, name: 'Муфта №1' })]);
    const m = s.marks.find((x) => x.label === 'Муфта №1')!;
    expect(m).toBeTruthy();
    // Половина трассы: градус долготы на экваторе ≈ 111,3 км.
    expect(m.atM).toBeGreaterThan(540);
    expect(m.atM).toBeLessThan(570);
    expect(s.totalM).toBeGreaterThan(1100);
  });

  it('концы трассы — всегда отметки, и они по краям', () => {
    const s = buildScheme(route(), []);
    expect(s.marks).toHaveLength(2);
    expect(s.marks[0]).toMatchObject({ atM: 0, kind: 'start', label: 'Аксу' });
    expect(s.marks[1].kind).toBe('end');
    expect(s.marks[1].label).toBe('Карабулак');
    expect(s.marks[1].atM).toBe(s.totalM);
  });

  it('берёт названия концов из настроек, если их задали', () => {
    const s = buildScheme(route(), [], { from: 'АТС Аксу', to: 'Школа' });
    expect(s.marks[0].label).toBe('АТС Аксу');
    expect(s.marks[1].label).toBe('Школа');
  });

  it('отметки идут по порядку вдоль трассы, а не в порядке ввода', () => {
    const s = buildScheme(route(), [
      obj({ lat: 0, lon: 0.008, name: 'Дальняя' }),
      obj({ lat: 0, lon: 0.002, name: 'Ближняя' }),
    ]);
    expect(s.marks.map((m) => m.label)).toEqual(['Аксу', 'Ближняя', 'Дальняя', 'Карабулак']);
  });

  it('далёкий объект не притягивается к линии, а называется отдельно', () => {
    // 0,01° широты ≈ 1,1 км в стороне — это не наш объект.
    const s = buildScheme(route(), [obj({ lat: 0.01, lon: 0.005, name: 'Чужая муфта' })]);
    expect(s.marks.map((m) => m.label)).not.toContain('Чужая муфта');
    expect(s.skipped).toHaveLength(1);
    expect(s.skipped[0]).toContain('Чужая муфта');
    expect(s.skipped[0]).toContain('м в стороне');
  });

  it('небольшой промах — отметка остаётся, но с оговоркой', () => {
    // 0,0005° ≈ 55 м: муфту снимали от дороги, а не по оси трассы.
    const s = buildScheme(route(), [obj({ lat: 0.0005, lon: 0.005, name: 'Муфта №2' })]);
    const m = s.marks.find((x) => x.label === 'Муфта №2')!;
    expect(m).toBeTruthy();
    expect(m.offsetM).toBeGreaterThan(50);
    expect(s.skipped).toHaveLength(0);
  });

  it('порог отклонения можно задвинуть', () => {
    const far = [obj({ lat: 0.004, lon: 0.005, name: 'На обочине' })];
    expect(buildScheme(route(), far).skipped).toHaveLength(1);
    expect(buildScheme(route(), far, { maxOffsetM: 600 }).skipped).toHaveLength(0);
  });

  it('объект без координат пропускает, а не роняет схему', () => {
    const s = buildScheme(route(), [
      obj({ kind: 'kks', name: 'ККС без координат', lat: NaN, lon: 0.005 }),
    ]);
    expect(s.marks).toHaveLength(2);
    expect(s.skipped).toHaveLength(0);
  });

  it('пролёты идут между соседями и в сумме дают длину трассы', () => {
    const s = buildScheme(route(), [
      obj({ lat: 0, lon: 0.003, name: 'М1' }),
      obj({ lat: 0, lon: 0.007, kind: 'kks', name: 'ККС 12' }),
    ]);
    expect(s.spans.map((x) => `${x.from}→${x.to}`)).toEqual([
      'Аксу→М1', 'М1→ККС 12', 'ККС 12→Карабулак',
    ]);
    const sum = s.spans.reduce((a, x) => a + x.meters, 0);
    expect(sum).toBeCloseTo(s.totalM, 3);
  });

  it('объект у самого начала не даёт пролёта в ноль метров', () => {
    const s = buildScheme(route(), [obj({ lat: 0, lon: 0, name: 'АТС' })]);
    expect(s.spans.every((x) => x.meters >= 1)).toBe(true);
  });

  it('трасса из одной точки не собирается в схему, но и не падает', () => {
    const r: PlanRoute = { ...route(), coords: [[0, 0]] };
    const s = buildScheme(r, [obj({ lat: 0, lon: 0, name: 'М1' })]);
    expect(s.totalM).toBe(0);
    expect(s.marks).toHaveLength(2);
    expect(s.spans).toHaveLength(0);
  });

  it('объект без имени подписан своим типом', () => {
    const s = buildScheme(route(), [obj({ lat: 0, lon: 0.005, kind: 'kks' })]);
    expect(s.marks.map((m) => m.label)).toContain('ККС');
  });
});

describe('schemeSvg', () => {
  it('рисует по одной отметке на каждую', () => {
    const s = buildScheme(route(), [
      obj({ lat: 0, lon: 0.003, name: 'М1' }),
      obj({ lat: 0, lon: 0.007, name: 'М2' }),
    ]);
    const svg = schemeSvg(s);
    expect(svg).toContain('<svg');
    for (const m of s.marks) expect(svg).toContain(`>${m.label}</text>`);
  });

  it('отметки стоят по своим метрам, а не вповалку', () => {
    const s = buildScheme(route(), [obj({ lat: 0, lon: 0.005, name: 'Середина' })]);
    // Отметка на половине трассы должна оказаться примерно посередине
    // рисунка: 70 отступ + 430 от 860 линии.
    expect(s.marks[1].atM / s.totalM).toBeCloseTo(0.5, 2);
    expect(svgNumbers(schemeSvg(s), 'circle').cx).toBeCloseTo(500, 0);
  });

  it('нулевая длина не даёт NaN в координатах', () => {
    const r: PlanRoute = { ...route(), coords: [[0, 0], [0, 0]] };
    const svg = schemeSvg(buildScheme(r, []));
    expect(svg).not.toContain('NaN');
  });

  it('экранирует названия — кавычка в имени не ломает разметку', () => {
    const s = buildScheme(route(), [obj({ lat: 0, lon: 0.005, name: 'Муфта "А" & Б' })]);
    const svg = schemeSvg(s);
    expect(svg).not.toContain('Муфта "А" & Б');
    expect(svg).toContain('&amp;');
  });

  it('подписывает трассу и её длину внизу листа', () => {
    const svg = schemeSvg(buildScheme(route(), []));
    expect(svg).toContain('Аксу — Карабулак');
    expect(svg).toContain('км');
  });
});

/** Достать координаты первой фигуры такого типа — чтобы проверить раскладку. */
function svgNumbers(svg: string, tag: string): { cx: number } {
  const m = svg.match(new RegExp(`<${tag} cx="([\\d.]+)"`));
  return { cx: m ? Number(m[1]) : NaN };
}

describe('schemeDocHtml', () => {
  const scheme = () => buildScheme(route(), [
    obj({ lat: 0, lon: 0.003, name: 'Муфта №1' }),
    obj({ lat: 0, lon: 0.007, kind: 'kks', name: 'ККС 12' }),
  ]);

  it('собирает лист с заголовком, схемой и ведомостью пролётов', () => {
    const html = schemeDocHtml({ scheme: scheme(), number: '14', date: '2026-05-20' });
    expect(html).toContain('ИСПОЛНИТЕЛЬНАЯ СХЕМА');
    expect(html).toContain('№ 14');
    expect(html).toContain('<svg');
    expect(html).toContain('Муфта №1 — ККС 12');
    expect(html).toContain('20.05.2026');
  });

  it('номера строк идут подряд от единицы', () => {
    const html = schemeDocHtml({ scheme: scheme() });
    const nums = [...html.matchAll(/<td class="val">(\d+)<\/td><td class="lbl">/g)]
      .map((m) => m[1]);
    expect(nums).toEqual(['1', '2', '3']);
  });

  it('предупреждает о том, что на схему не попало', () => {
    const s = buildScheme(route(), [obj({ lat: 0.01, lon: 0.005, name: 'Чужая' })]);
    const html = schemeDocHtml({ scheme: s });
    expect(html).toContain('Не отнесены к трассе');
    expect(html).toContain('Чужая');
  });

  it('без потерянных объектов предупреждения нет', () => {
    expect(schemeDocHtml({ scheme: scheme() })).not.toContain('Не отнесены к трассе');
  });

  it('подписи внизу — кто составил и кто проверил', () => {
    const html = schemeDocHtml({
      scheme: scheme(), contractor: 'СК Фаворит Инжиниринг', customer: 'АО «Транстелеком»',
    });
    expect(html).toContain('Составил');
    expect(html).toContain('СК Фаворит Инжиниринг');
    expect(html).toContain('Проверил');
  });

  it('лист открывается Вордом и ложится на альбомный А4', () => {
    const page = schemeDocPage({ scheme: scheme() });
    expect(page).toContain('urn:schemas-microsoft-com:office:word');
    expect(page).toContain('size: A4 landscape');
    expect(page).toContain('charset="utf-8"');
  });
});

describe('schemeFileName', () => {
  it('в имени видно, что за трасса и на какое число', () => {
    expect(schemeFileName('Аксу — Карабулак', '2026-05-20'))
      .toBe('Исполнительная схема Аксу — Карабулак 2026-05-20.doc');
  });

  it('убирает то, что файловая система не примет', () => {
    const name = schemeFileName('Аксу/Карабулак: 1*2?', '2026-05-20');
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toContain('Аксу');
  });

  it('безымянная трасса всё равно получает имя файла', () => {
    expect(schemeFileName('   ', '2026-05-20')).toContain('трасса');
  });
});

/**
 * Схему всё равно прикладывают к акту — просто отдельным файлом, который
 * по дороге теряется: акт дошёл, схема осталась в папке «Загрузки».
 */
describe('схема приложением к акту', () => {
  const scheme = () => buildScheme(route(), [
    obj({ lat: 0, lon: 0.005, name: 'Муфта №1' }),
  ]);

  it('начинается с новой страницы и подписана как приложение', () => {
    const html = schemeAttachmentHtml({ scheme: scheme() }, '14');
    expect(html).toContain('page-break-before:always');
    expect(html).toContain('Приложение к акту № 14');
  });

  it('без номера акта пишет просто «Приложение»', () => {
    const html = schemeAttachmentHtml({ scheme: scheme() });
    expect(html).toContain('Приложение<');
    expect(html).not.toContain('к акту');
  });

  it('несёт и рисунок, и ведомость пролётов', () => {
    const html = schemeAttachmentHtml({ scheme: scheme() }, '14');
    expect(html).toContain('<svg');
    expect(html).toContain('Муфта №1');
    expect(html).toContain('<table class="act">');
  });

  it('вкладывается внутрь готового документа, а не рядом с ним', () => {
    const doc = '<html><body class="act-doc"><h1>АКТ</h1></body></html>';
    const out = withSchemeAttached(doc, { scheme: scheme() }, '14');
    expect(out.indexOf('ИСПОЛНИТЕЛЬНАЯ СХЕМА')).toBeGreaterThan(out.indexOf('АКТ'));
    expect(out.indexOf('ИСПОЛНИТЕЛЬНАЯ СХЕМА')).toBeLessThan(out.indexOf('</body>'));
    expect(out.match(/<\/body>/g)).toHaveLength(1);
  });

  it('документ без тела не теряет приложение', () => {
    const out = withSchemeAttached('<h1>АКТ</h1>', { scheme: scheme() });
    expect(out).toContain('ИСПОЛНИТЕЛЬНАЯ СХЕМА');
  });

  it('в приложении лист остаётся книжным, а не поворачивается', () => {
    const html = schemeAttachmentHtml({ scheme: scheme() }, '14');
    expect(html).not.toContain('landscape');
    // Рисунок уже готового акта: он должен помещаться в ширину листа.
    expect(html).toMatch(/viewBox="0 0 640 /);
  });
});

/**
 * Документы в Казахстане оформляют на государственном языке и на
 * русском. Сейчас наши только русские, и в акимате их разворачивают.
 */
describe('двуязычный бланк схемы', () => {
  const scheme = () => buildScheme(route(), [obj({ lat: 0, lon: 0.005, name: 'Муфта №1' })]);

  it('по умолчанию бланк остаётся русским', () => {
    const html = schemeDocHtml({ scheme: scheme() });
    expect(html).toContain('ИСПОЛНИТЕЛЬНАЯ СХЕМА');
    expect(html).not.toContain('СҰЛБА');
  });

  it('включённый режим ставит оба языка в заголовок и в шапку таблицы', () => {
    const html = schemeDocHtml({ scheme: scheme(), lang: 'kk-ru' });
    expect(html).toContain('ОРЫНДАУШЫ СҰЛБА / ИСПОЛНИТЕЛЬНАЯ СХЕМА');
    expect(html).toContain('Ұзындығы, м / Длина, м');
    expect(html).toContain('Жасаған / Составил');
  });

  it('цифры и названия от языка не зависят', () => {
    const html = schemeDocHtml({ scheme: scheme(), lang: 'kk-ru' });
    expect(html).toContain('Муфта №1');
    expect(html).toContain('1,11 км');
  });

  it('свой перевод термина встаёт в документ', () => {
    const html = schemeDocHtml({
      scheme: scheme(), lang: 'kk-ru',
      terms: { uchastok: { ru: 'Участок', kk: 'Телім' } },
    });
    expect(html).toContain('Телім / Участок');
  });

  it('приложение к акту тоже двуязычное, но падеж остаётся русским', () => {
    const html = schemeAttachmentHtml({ scheme: scheme(), lang: 'kk-ru' }, '14');
    expect(html).toContain('Қосымша / Приложение к акту № 14');
  });
});

/**
 * Пролёты короче метра пропускаются: две отметки в одной точке пролётом
 * не считаются. Но после первого же пропуска порядковый номер пролёта
 * перестаёт совпадать с номером отметки — и подписи длин на рисунке
 * съезжали на пролёт левее.
 */
describe('подписи длин при совпавших отметках', () => {
  const twoAtOnce = () => buildScheme(route(), [
    obj({ lat: 0, lon: 0.003, name: 'Муфта №1' }),
    // Ровно там же: ККС стоит в том же колодце.
    obj({ lat: 0, lon: 0.003, kind: 'kks', name: 'ККС 12' }),
    obj({ lat: 0, lon: 0.007, name: 'Муфта №2' }),
  ]);

  it('нулевой пролёт в ведомость не попадает', () => {
    const s = twoAtOnce();
    expect(s.marks).toHaveLength(5);
    expect(s.spans.every((sp) => sp.meters >= 1)).toBe(true);
    expect(s.spans.length).toBeLessThan(s.marks.length - 1);
  });

  it('каждый пролёт помнит, между какими отметками он лежит', () => {
    for (const sp of twoAtOnce().spans) {
      const s = twoAtOnce();
      expect(s.marks[sp.fromIndex].label).toBe(sp.from);
      expect(s.marks[sp.toIndex].label).toBe(sp.to);
    }
  });

  it('длина пролёта сходится с расстоянием между его отметками', () => {
    const s = twoAtOnce();
    for (const sp of s.spans) {
      expect(sp.meters).toBeCloseTo(s.marks[sp.toIndex].atM - s.marks[sp.fromIndex].atM, 6);
    }
  });

  it('на рисунке подписей длин столько же, сколько пролётов', () => {
    const s = twoAtOnce();
    const svg = schemeSvg(s);
    const spanLabels = [...svg.matchAll(/fill="#334155">([^<]+)<\/text>/g)].map((m) => m[1]);
    expect(spanLabels).toHaveLength(s.spans.length);
  });

  it('и каждая подпись равна длине своего пролёта', () => {
    const s = twoAtOnce();
    const svg = schemeSvg(s);
    for (const sp of s.spans) {
      expect(svg).toContain(`>${formatMeters(sp.meters)}</text>`);
    }
  });
});
