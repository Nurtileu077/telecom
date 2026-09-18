import { describe, it, expect } from 'vitest';
import {
  actRows, actDocHtml, actFileName, protocolDocHtml, protocolFileName,
  share, withRayonWord, esc,
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

describe('строки акта', () => {
  it('основной акт берёт остаток трассы, а не всю длину', () => {
    const t = computeSectionAct([entry()], [deviation()]);
    const main = t.variants.find((v) => v.isMain)!;
    const rows = actRows(t, main, DEFAULT_ACT_MANUAL);
    expect(rows[0].value).toBe('11,050');
  });

  it('акт на отклонение несёт свою глубину', () => {
    const t = computeSectionAct([entry()], [deviation()]);
    const dev = t.variants.find((v) => !v.isMain)!;
    const rows = actRows(t, dev, DEFAULT_ACT_MANUAL);
    const depth = rows.find((r) => r.n === '2')!;
    expect(depth.value).toBe('по проекту — 1,2 м, фактически — 0,5 м');
    expect(rows[0].value).toBe('0,050');
  });

  it('переходы целиком остаются в основном акте', () => {
    const t = computeSectionAct([entry({ drillCount: 3, openCrossings: 1 })], [deviation()]);
    const main = t.variants.find((v) => v.isMain)!;
    const dev = t.variants.find((v) => !v.isMain)!;
    expect(actRows(t, main, DEFAULT_ACT_MANUAL).find((r) => r.n === '5')!.value).toBe('4');
    expect(actRows(t, dev, DEFAULT_ACT_MANUAL).find((r) => r.n === '5')!.value).toBe('0');
  });

  it('фитинги и лента делятся пропорционально длине', () => {
    const t = computeSectionAct([entry()], [deviation()]);
    const dev = t.variants.find((v) => !v.isMain)!;
    const rows = actRows(t, dev, DEFAULT_ACT_MANUAL);
    // 20 фитингов на 11 100 м, из них 50 м — это 0 штук после округления.
    expect(rows.find((r) => r.n === '3')!.value).toBe('0');
    expect(rows.find((r) => r.n === '4')!.value).toBe('0,050');
  });

  it('акт без протокола так и говорит', () => {
    const t = computeSectionAct([entry()], [deviation()]);
    const dev = t.variants.find((v) => !v.isMain)!;
    const rows = actRows(t, dev, DEFAULT_ACT_MANUAL);
    expect(rows.at(-1)!.value).toBe('протокол мобильной группы не оформлен');
  });

  it('с протоколом ссылается на его номер', () => {
    const t = computeSectionAct(
      [entry()],
      [deviation({ protocol: { number: '17', date: '2026-09-12' } })],
    );
    const dev = t.variants.find((v) => !v.isMain)!;
    const rows = actRows(t, dev, DEFAULT_ACT_MANUAL);
    expect(rows.at(-1)!.value).toContain('№17');
    expect(rows.at(-1)!.value).toContain('12.09.2026');
  });

  it('столбики и маркеры появляются, только когда их вносили', () => {
    const t = computeSectionAct([entry()]);
    const main = t.variants[0];
    expect(actRows(t, main, DEFAULT_ACT_MANUAL).some((r) => r.label.includes('столбиков'))).toBe(false);
    expect(actRows(t, main, { ...DEFAULT_ACT_MANUAL, markerPosts: 4 })
      .some((r) => r.label.includes('столбиков'))).toBe(true);
  });
});

describe('файл акта', () => {
  const t = computeSectionAct([entry()], [deviation()]);
  const doc = actDocHtml({
    kind: 'ASR', uchastok: 'Еленовка',
    oblast: 'Акмолинская область', rayon: 'Аршалынский',
    contractor: 'ТОО «СК Фаворит Инжиниринг»', performer: 'TERRA TECH',
    dateFrom: t.dateFrom, dateTo: t.dateTo,
    totals: t, variants: t.variants, fields: DEFAULT_ACT_MANUAL,
  });

  it('содержит основание и заголовок акта', () => {
    expect(doc).toContain('СН РК 1.03-00-2022');
    expect(doc).toContain('АКТ ОСВИДЕТЕЛЬСТВОВАНИЯ СКРЫТЫХ РАБОТ');
  });

  it('оба акта идут в одном файле с разрывом страницы', () => {
    expect(doc.match(/class="sheet"/g)).toHaveLength(2);
    expect(doc).toContain('page-break-before:always');
  });

  it('называет подрядчика по документам и фактического исполнителя', () => {
    expect(doc).toContain('ТОО «СК Фаворит Инжиниринг»');
    expect(doc).toContain('TERRA TECH');
  });

  it('о неоформленном протоколе предупреждает прямо в документе', () => {
    expect(doc).toContain('не подлежит подписанию');
  });

  it('ОСР ссылается на своё основание', () => {
    const osr = actDocHtml({
      kind: 'OSR', uchastok: 'Еленовка', totals: t, variants: t.variants,
      fields: DEFAULT_ACT_MANUAL,
    });
    expect(osr).toContain('Приложение 12 к ОДС/П-14-4-4-01');
  });

  it('имя файла говорит, что внутри', () => {
    expect(actFileName('ASR', 'Еленовка', '2026-09-18')).toBe('АСР Еленовка 2026-09-18.doc');
  });

  it('имя файла не ломается о слэш в названии участка', () => {
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

  it('угловые скобки в названии не ломают разметку', () => {
    expect(esc('<b>СМУ</b>')).toBe('&lt;b&gt;СМУ&lt;/b&gt;');
  });
});
