import { describe, it, expect } from 'vitest';
import {
  actRows, actDocHtml, actFileName, protocolDocHtml, protocolFileName,
  share, withRayonWord, esc, ruDateWords, bareOblast, bareRayon,
  deviationSummary, protocolRef, volsTitle, actHeading, ActRowKey,
  fixationDocHtml, fixationFileName,
} from './actDocument';
import { computeSectionAct, DEFAULT_ACT_MANUAL } from './sectionAct';
import type { DailyWorkEntry, Deviation } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function entry(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: 'g1', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', rayon: 'Аршалынский',
    uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 11100 },
    materials: { 'Лента': 11100, 'ФИТИНГ': 20 },
    contractor: 'TERRA TECH',
    createdAt: now, updatedAt: now, ...over,
  };
}

function deviation(over: Partial<Deviation> = {}): Deviation {
  return {
    id: 'd1', kind: 'depth', date: '2026-09-11',
    oblast: 'Акмолинская область', rayon: 'Аршалынский',
    uchastok: 'Еленовка', kato: '191',
    lengthM: 50, designDepthM: 1.2, actualDepthM: 0.5,
    reason: 'Скальный грунт',
    author: 'Ербол', createdAt: now, updatedAt: now, ...over,
  };
}

const row = (rows: ReturnType<typeof actRows>, key: ActRowKey) => rows.find((r) => r.key === key)!;

describe('таблица акта — ровно по бланку', () => {
  const t = computeSectionAct([entry()]);
  const main = t.variants[0];

  it('строки идут в порядке бланка и с его формулировками', () => {
    const labels = actRows(t, main, DEFAULT_ACT_MANUAL, 'OSR').map((r) => r.label);
    expect(labels).toEqual([
      '1.Защитной МКТ проложено всего:',
      'Кабелеукладчиком с двукратной пропоркой __ категорий',
      'Вручную __ категорий',
      'Экскаватором __ категорий',
      'По существующей канализации',
      'Бар',
      'Переходы методом горизонтально-направленного бурения с защитой ПЭТ-63мм',
      'Переходы методом горизонтально-направленного бурения с защитой ПЭТ-110мм',
      'Переходы открытым способом с защитой ПЭТ-63мм',
      'Переходы открытым способом с защитой Ст труба -63мм',
      '2. Глубина прокладки защитной МКТ составляет',
      '',
      '3. При прокладке использовано комплектов для сращивания защитной МКТ',
      '4. Прокладка предупредительной-сигнальной ленты на глубине ½ от глубины МКТ',
      '5. На участке выполнено переходов (акты на скрытые работы прилагаются)',
      '6. Рекультивация (выполнена, не выполнена)',
      '7. Восстановление а/бетонных покрытий (выполнено, не выполнено, не предусматривается проектом)',
    ]);
  });

  it('первая строка у АСР называется трубой, у ОСР — МКТ', () => {
    expect(row(actRows(t, main, DEFAULT_ACT_MANUAL, 'ASR'), 'total').label)
      .toBe('1.Защитной полиэтиленовой трубы проложено всего:');
    expect(row(actRows(t, main, DEFAULT_ACT_MANUAL, 'OSR'), 'total').label)
      .toBe('1.Защитной МКТ проложено всего:');
  });

  it('глубина занимает две строки: проект и факт', () => {
    const rows = actRows(t, main, DEFAULT_ACT_MANUAL);
    expect(row(rows, 'depth').value).toBe('по проекту - 1,2 м');
    expect(row(rows, 'depthFact').value).toBe('фактический - 1,2 м');
    expect(row(rows, 'depthFact').cont).toBe(true);
  });

  it('единицы измерения — те же, что в бланке', () => {
    const rows = actRows(t, main, DEFAULT_ACT_MANUAL);
    expect(row(rows, 'total').unit).toBe('км');
    expect(row(rows, 'kits').unit).toBe('шт.');
    expect(row(rows, 'crossings').unit).toBe('пер.');
    expect(row(rows, 'recult').unit).toBeUndefined();
  });

  it('рекультивация и покрытия пишутся с заглавной, как в бланке', () => {
    const rows = actRows(t, main, DEFAULT_ACT_MANUAL);
    expect(row(rows, 'recult').value).toBe('Выполнена');
    expect(row(rows, 'pavement').value).toBe('Не предусмотрено проектом');
  });
});

describe('деление участка по глубине', () => {
  it('основной акт берёт остаток трассы, а не всю длину', () => {
    const t = computeSectionAct([entry()], [deviation()]);
    const main = t.variants.find((v) => v.isMain)!;
    expect(row(actRows(t, main, DEFAULT_ACT_MANUAL), 'total').value).toBe('11,050');
  });

  it('акт на отклонение несёт свою глубину', () => {
    const t = computeSectionAct([entry()], [deviation()]);
    const dev = t.variants.find((v) => !v.isMain)!;
    const rows = actRows(t, dev, DEFAULT_ACT_MANUAL);
    expect(row(rows, 'depth').value).toBe('по проекту - 1,2 м');
    expect(row(rows, 'depthFact').value).toBe('фактический - 0,5 м');
    expect(row(rows, 'total').value).toBe('0,050');
  });

  it('переходы целиком остаются в основном акте', () => {
    const t = computeSectionAct([entry({ drillCount: 3, openCrossings: 1 })], [deviation()]);
    const main = t.variants.find((v) => v.isMain)!;
    const dev = t.variants.find((v) => !v.isMain)!;
    expect(row(actRows(t, main, DEFAULT_ACT_MANUAL), 'crossings').value).toBe('4');
    expect(row(actRows(t, dev, DEFAULT_ACT_MANUAL), 'crossings').value).toBe('0');
  });

  it('фитинги и лента делятся пропорционально длине', () => {
    const t = computeSectionAct([entry()], [deviation()]);
    const dev = t.variants.find((v) => !v.isMain)!;
    const rows = actRows(t, dev, DEFAULT_ACT_MANUAL);
    // 20 фитингов на 11 100 м, из них 50 м — это 0 штук после округления.
    expect(row(rows, 'kits').value).toBe('0');
    expect(row(rows, 'tape').value).toBe('0,050');
  });
});

describe('пункт об отклонениях', () => {
  it('у основного акта отклонений нет', () => {
    const t = computeSectionAct([entry()]);
    expect(deviationSummary(t.variants[0])).toBe('нет');
  });

  it('акт на отклонение называет глубину, длину и причину', () => {
    const t = computeSectionAct([entry()], [deviation()]);
    const dev = t.variants.find((v) => !v.isMain)!;
    const s = deviationSummary(dev);
    expect(s).toContain('0,5 м вместо проектной 1,2 м');
    expect(s).toContain('0,050 км');
    expect(s).toContain('Скальный грунт');
  });

  it('без протокола остаётся бланк с прочерками', () => {
    const t = computeSectionAct([entry()], [deviation()]);
    expect(protocolRef(t.variants.find((v) => !v.isMain)!)).toBe('№______ от _______');
  });

  it('с протоколом подставляет его номер и дату', () => {
    const t = computeSectionAct(
      [entry()],
      [deviation({ protocol: { number: '17', date: '2026-09-12' } })],
    );
    expect(protocolRef(t.variants.find((v) => !v.isMain)!)).toBe('№17 от 12.09.2026');
  });
});

describe('АСР по бланку СН РК', () => {
  const t = computeSectionAct([entry()], [deviation()]);
  const doc = actDocHtml({
    kind: 'ASR', uchastok: 'Еленовка',
    oblast: 'Акмолинская область', rayon: 'Аршалынский',
    contractor: 'АО «Транстелеком»', performer: 'ТОО «СК Фаворит Инжиниринг»',
    dateFrom: t.dateFrom, dateTo: t.dateTo,
    totals: t, variants: t.variants,
    fields: { ...DEFAULT_ACT_MANUAL, actDate: '2026-09-10', volsFrom: 'НРП', volsTo: 'здания АТС п. Обалы' },
  });

  it('несёт основание и заголовок бланка', () => {
    expect(doc).toContain('СН РК 1.03-00-2022');
    expect(doc).toContain('Акт № ____освидетельствования скрытых работ');
  });

  it('дата в шапке — словами, как в бланке', () => {
    expect(doc).toContain('«10» сентября 2026 г.');
  });

  it('содержит преамбулу и подстрочники бланка', () => {
    expect(doc).toContain('Мы, нижеподписавшиеся:');
    expect(doc).toContain('представителя технического надзора заказчика');
    expect(doc).toContain('(фамилия, имя, отчество (при наличии), организация, должность)');
    expect(doc).toContain('и составила настоящий акт о нижеследующим:');
    expect(doc).toContain('К освидетельствованию предъявлены следующие работы');
    expect(doc).toContain('(наименование скрытых работ)');
  });

  it('называет генподрядчика и того, кто вёл работы', () => {
    expect(doc).toContain('представителя подрядчика (генподрядчика) работ АО «Транстелеком»');
    expect(doc).toContain('Произвела осмотр работ, выполненных ТОО «СК Фаворит Инжиниринг»');
  });

  it('заканчивается решением комиссии и разрешением следующих работ', () => {
    expect(doc).toContain('Решение комиссии');
    expect(doc).toContain('разрешается производство последующих работ по устройству');
    expect(doc).toContain('Задувка волоконно-оптического кабеля');
    expect(doc).toContain('(наименование последующих работ и конструкций)');
  });

  it('проставляет даты начала и окончания работ', () => {
    expect(doc).toContain('5. Даты: начала работ 10.09.2026');
    expect(doc).toContain('окончания работ 10.09.2026');
  });

  it('оба акта идут в одном файле с разрывом страницы', () => {
    expect(doc.match(/class="sheet"/g)).toHaveLength(2);
    expect(doc).toContain('page-break-before:always');
  });

  it('о неоформленном протоколе предупреждает прямо в документе', () => {
    expect(doc).toContain('не подлежит подписанию');
  });

  it('номер акта, если он присвоен, встаёт в заголовок', () => {
    expect(actHeading('ASR', { actNumber: '12' })).toBe('Акт № 12 освидетельствования скрытых работ');
  });
});

describe('ОСР по приложению 12', () => {
  const t = computeSectionAct([entry()]);
  const doc = actDocHtml({
    kind: 'OSR', uchastok: 'Еленовка',
    oblast: 'Акмолинская область', rayon: 'Бурабайский район',
    dateFrom: t.dateFrom, dateTo: t.dateTo,
    totals: t, variants: t.variants,
    fields: {
      ...DEFAULT_ACT_MANUAL,
      volsFrom: 'М№1', volsTo: 'здания АТС п. Мадениет', selsovet: 'Зеленоборский',
      tusm: '10', markerPosts: 3, ballMarkers: 2,
    },
  });

  it('несёт шапку приложения и заголовок работ', () => {
    expect(doc).toContain('Приложение 12 к');
    expect(doc).toContain('ОДС/П-14-4-4-01');
    expect(doc).toContain('Освидетельствование скрытых работ по прокладке защитной '
      + 'полиэтиленовой трубы и предупредительной ленты');
  });

  it('область и район — без повтора слов «область» и «район»', () => {
    expect(doc).toContain('Область Акмолинская, район Бурабайский');
  });

  it('участок ВОЛС собирается из точек и сельского округа', () => {
    expect(doc).toContain('Участок ВОЛС: от М№1 до здания АТС п. Мадениет, Зеленоборский с.о.');
    expect(doc).toContain('(наименование участка ВОЛС)');
  });

  it('под таблицей идут строки бланка', () => {
    expect(doc).toContain('Глубина прокладки защитной полиэтиленовой трубы составляет по проекту 1,2 м, фактически 1,2 м;');
    expect(doc).toContain('Обваловка (выполнено, не выполнено, предусмотрено / не предусмотрено)');
    expect(doc).toContain('Установлено идентификационных столбиков 3 шт.');
    expect(doc).toContain('Установлено шаровых маркеров 2 шт.');
    expect(doc).toContain('2. При выполнении работ применены:');
    expect(doc).toContain('Пакет микротрубок kCl-SRV-G 2х14/10 tc-blue');
    expect(doc).toContain('3. При выполнении допущены отклонения от проектно-сметной документации нет.');
    expect(doc).toContain('Протокол Мобильной группы №______ от _______');
  });

  it('подписывают начальник ПТО ТУСМ и технологический надзор', () => {
    expect(doc).toContain('Начальник ПТО ТУСМ-10');
    expect(doc).toContain('Представитель технологического надзора');
    expect(doc).toContain('(ФИО, подпись)');
  });

  it('столбики без значения остаются прочерком', () => {
    const blank = actDocHtml({
      kind: 'OSR', uchastok: 'Еленовка', totals: t, variants: t.variants,
      fields: DEFAULT_ACT_MANUAL,
    });
    expect(blank).toContain('Установлено идентификационных столбиков ____ шт.');
  });
});

describe('имя файла', () => {
  it('говорит, что внутри', () => {
    expect(actFileName('ASR', 'Еленовка', '2026-09-18')).toBe('АСР Еленовка 2026-09-18.doc');
  });

  it('не ломается о слэш в названии участка', () => {
    expect(actFileName('OSR', 'сущ. ОМ / Темирлик', '2026-09-18'))
      .toBe('ОСР сущ. ОМ   Темирлик 2026-09-18.doc');
  });
});

describe('протокол мобильной группы', () => {
  it('переносит обстоятельства из карточки отклонения', () => {
    const html = protocolDocHtml({ deviation: deviation() });
    expect(html).toContain('Скальный грунт');
    expect(html).toContain('0,5 м вместо проектной 1,2 м');
    expect(html).toContain('Аршалынский район');
  });

  it('пустой бланк остаётся бланком с прочерками', () => {
    const html = protocolDocHtml({ deviation: deviation() });
    expect(html).toContain('№ ______');
    expect(html).toContain('Решение: ');
  });

  it('заполненный протокол подставляет номер и решение', () => {
    const html = protocolDocHtml({
      deviation: deviation(),
      protocol: { number: '17', date: '2026-09-12', note: 'Согласовано уменьшение глубины.' },
    });
    expect(html).toContain('№ 17');
    expect(html).toContain('Согласовано уменьшение глубины.');
  });

  it('отклонение по трассе не выдумывает глубину', () => {
    const html = protocolDocHtml({
      deviation: deviation({ kind: 'route', actualDepthM: undefined }),
    });
    expect(html).toContain('изменение трассы');
    expect(html).not.toContain('по проекту 1,2 м');
  });

  it('координаты попадают в документ, если их снимали', () => {
    const html = protocolDocHtml({
      deviation: deviation({ coords: [{ lat: 51.123456, lon: 71.654321 }] }),
    });
    expect(html).toContain('51.123456, 71.654321');
  });

  it('имя файла содержит участок и дату', () => {
    expect(protocolFileName(deviation())).toBe('Протокол МГ Еленовка 2026-09-11.doc');
  });
});

describe('мелочи, на которых ломаются документы', () => {
  it('доля от нулевого итога — ноль, а не NaN', () => {
    expect(share(10, 0, 5)).toBe(0);
  });

  it('слово «район» не удваивается', () => {
    expect(withRayonWord('Бейнеуский район')).toBe('Бейнеуский район');
    expect(withRayonWord('Аршалынский')).toBe('Аршалынский район');
  });

  it('в шапке ОСР слова «область» и «район» не повторяются', () => {
    expect(bareOblast('Акмолинская область')).toBe('Акмолинская');
    expect(bareOblast('Акмолинская')).toBe('Акмолинская');
    expect(bareRayon('Бурабайский район')).toBe('Бурабайский');
    expect(bareRayon('Бурабайского района')).toBe('Бурабайского');
  });

  it('дата словами не выдумывается из пустоты', () => {
    expect(ruDateWords()).toBe('«___» ____________ 20___ г.');
    expect(ruDateWords('2026-01-01')).toBe('«01» января 2026 г.');
  });

  it('участок ВОЛС без точек берёт название участка', () => {
    expect(volsTitle({
      kind: 'OSR', uchastok: 'Еленовка',
      totals: computeSectionAct([entry()]), variants: [], fields: {},
    })).toBe('Еленовка');
  });

  it('угловые скобки в названии не ломают разметку', () => {
    expect(esc('<b>СМУ</b>')).toBe('&lt;b&gt;СМУ&lt;/b&gt;');
  });
});

describe('акт фиксации участка', () => {
  it('несёт границы, протяжённость и обе глубины', () => {
    const html = fixationDocHtml({
      uchastok: 'Еленовка', oblast: 'Акмолинская область', rayon: 'Аршалынский',
      contractor: 'ТОО «СК Фаворит Инжиниринг»',
      fromPoint: 'НРП', toPoint: 'здание АТС',
      lengthM: 11100, designDepthM: 1.2, actualDepthM: 1.2,
      dateFrom: '2026-08-25', dateTo: '2026-09-03', tusm: '10',
    });
    expect(html).toContain('Акт фиксации участка прокладки');
    expect(html).toContain('НРП');
    expect(html).toContain('здание АТС');
    expect(html).toContain('11,100 км');
    expect(html).toContain('ТУСМ-10');
    expect(html).toContain('ЦКС');
    expect(html).toContain('25.08.2026 — 03.09.2026');
  });

  it('меньшая глубина названа прямо, а не спрятана в цифре', () => {
    const html = fixationDocHtml({
      uchastok: 'Еленовка', lengthM: 50, designDepthM: 1.2, actualDepthM: 0.5,
    });
    expect(html).toContain('меньше проектной');
    expect(html).toContain('протокол мобильной группы');
  });

  it('проектная глубина — обычный акт без оговорок', () => {
    const html = fixationDocHtml({
      uchastok: 'Еленовка', lengthM: 5000, designDepthM: 1.2, actualDepthM: 1.2,
    });
    expect(html).toContain('в соответствии с проектной глубиной');
    expect(html).not.toContain('меньше проектной');
  });

  it('имя файла содержит участок', () => {
    expect(fixationFileName('Еленовка', '2026-09-18')).toBe('Акт фиксации Еленовка 2026-09-18.doc');
  });
});
