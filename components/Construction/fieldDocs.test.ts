import { describe, it, expect } from 'vitest';
import {
  hiddenWorksHtml, hiddenWorksPage, hiddenWorksFile, HIDDEN_BEDDING_DEFAULT, hiddenDepth,
  measureProtocolsPage,
  photoCaption, photoReportHtml, remarksFromDeviations, remarksHtml, letterHtml,
  measureProtocolHtml, measureProtocolFile,
} from './fieldDocs';
import type {
  DailyWorkEntry, Deviation, FieldPhoto, SpliceRecord,
} from '@/types/construction';

function e(patch: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    id: 'x', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
    oblast: 'Акмолинская область', uchastok: 'Зеренда — Серафимовка', kato: '1',
    byMethod: { 'бар': 400 }, materials: {}, createdAt: '', updatedAt: '', ...patch,
  } as DailyWorkEntry;
}

describe('hiddenWorksHtml', () => {
  const rows = [
    e({ id: 'a', date: '2026-07-25', byMethod: { 'бар': 400 } }),
    e({ id: 'b', date: '2026-07-27', byMethod: { 'бар': 600 } }),
  ];

  it('называет участок, период и протяжённость', () => {
    const html = hiddenWorksHtml({ uchastok: 'Зеренда — Серафимовка', rows });
    expect(html).toContain('скрытых работ');
    expect(html).toContain('Зеренда — Серафимовка');
    expect(html).toContain('25.07.2026');
    expect(html).toContain('1 000');
  });

  it('песок без ввода не выдумывает — оставляет строку под руку', () => {
    const html = hiddenWorksHtml({ uchastok: 'У1', rows });
    expect(html).not.toContain(HIDDEN_BEDDING_DEFAULT);
    expect(html).not.toContain('песком 100 мм');
    expect(html).toContain('Подсыпка и присыпка песком');
    expect(html).toContain('______');
  });

  it('вписанный песок и засыпка попадают в акт', () => {
    const html = hiddenWorksHtml({
      uchastok: 'У1', rows, bedding: 'песок 150 мм', backfill: 'грунтом с трамбовкой',
    });
    expect(html).toContain('песок 150 мм');
    expect(html).toContain('по обратной засыпке траншеи грунтом с трамбовкой');
  });

  it('глубину с отклонением показывает по протяжённости и с протоколом', () => {
    const html = hiddenWorksHtml({
      uchastok: 'У1', rows, designDepthM: 1.2,
      depths: [
        { actualDepthM: 1.2, lengthM: 950 },
        { actualDepthM: 0.5, lengthM: 50, protocol: '№17 от 12.09.2026' },
      ],
    });
    expect(html).toContain('Глубина заложения по проекту');
    expect(html).toContain('1,20 м — на 950 м; 0,50 м — на 50 м (протокол МГ №17 от 12.09.2026)');
  });

  it('одна глубина без отклонений — одной цифрой', () => {
    expect(hiddenDepth({ depths: [{ actualDepthM: 1.2, lengthM: 1000 }] }))
      .toEqual({ text: '1,20', single: true });
    expect(hiddenDepth({})).toEqual({ text: '1,20', single: true });
  });

  it('фактическую глубину показывает вместо проектной', () => {
    expect(hiddenWorksHtml({ uchastok: 'У1', rows, depthM: 0.8 })).toContain('0,80');
  });

  it('технадзор появляется в подписях, только когда он есть', () => {
    expect(hiddenWorksHtml({ uchastok: 'У1', rows })).not.toContain('Технический надзор');
    expect(hiddenWorksHtml({ uchastok: 'У1', rows, supervisor: 'Иванов И.' }))
      .toContain('Технический надзор');
  });

  it('погода попадает в акт, если она записана', () => {
    const withWeather = [e({ weather: { tMinC: -12, tMaxC: -4, code: 73, source: 'archive' } })];
    expect(hiddenWorksHtml({ uchastok: 'У1', rows: withWeather })).toContain('снег');
  });

  it('страница открывается Word, имя файла говорит об участке', () => {
    expect(hiddenWorksPage({ uchastok: 'У1', rows })).toContain('office:word');
    expect(hiddenWorksFile({ uchastok: 'Зеренда/Серафимовка', rows: [], date: '2026-07-25' }))
      .toBe('Акт скрытых работ Зеренда Серафимовка 2026-07-25.doc');
  });
});

describe('photoCaption', () => {
  const photo: FieldPhoto = {
    id: 'p1', kind: 'entry', refId: 'e1', lat: 53.0912, lon: 69.1234,
    geoSource: 'exif', takenAt: '2026-07-25T09:30:00.000Z',
    note: 'траншея до засыпки', author: 'Прораб',
    createdAt: '', updatedAt: '',
  };

  it('говорит, что на снимке, когда и где', () => {
    const cap = photoCaption(photo);
    expect(cap).toContain('траншея до засыпки');
    expect(cap).toContain('53.09120');
    expect(cap).toContain('Прораб');
  });

  it('снимок без координат помечен честно', () => {
    expect(photoCaption({ ...photo, lat: undefined, lon: undefined }))
      .toContain('без координат');
  });
});

describe('photoReportHtml', () => {
  const photo: FieldPhoto = {
    id: 'p1', kind: 'entry', refId: 'e1', geoSource: 'none',
    takenAt: '2026-07-25T09:30:00.000Z', createdAt: '', updatedAt: '',
  };

  it('считает снимки и вкладывает картинки', () => {
    const html = photoReportHtml({
      title: 'ФОТООТЧЁТ',
      items: [{ photo, dataUrl: 'data:image/png;base64,AAA' }],
    });
    expect(html).toContain('Снимков: 1');
    expect(html).toContain('data:image/png;base64,AAA');
  });

  it('снимки раскладываются под заголовками групп', () => {
    const html = photoReportHtml({
      title: 'ФОТООТЧЁТ',
      groups: [
        { title: 'Еленовка — Прокладка МКТ', items: [{ photo }] },
        { title: 'Еленовка — ГНБ / переходы', items: [{ photo }, { photo }] },
      ],
    });
    expect(html).toContain('Снимков: 3');
    expect(html.indexOf('Прокладка МКТ')).toBeLessThan(html.indexOf('ГНБ / переходы'));
  });

  it('часть большого отчёта называет себя частью и общий счёт', () => {
    const html = photoReportHtml({
      title: 'ФОТООТЧЁТ',
      groups: [{ title: 'Еленовка — Сварка', items: [{ photo }] }],
      part: { index: 2, of: 3, total: 150 },
    });
    expect(html).toContain('ФОТООТЧЁТ (часть 2 из 3)');
    expect(html).toContain('всего в отчёте: 150');
  });

  it('невложенный снимок называется невложенным, а не пропадает', () => {
    expect(photoReportHtml({ title: 'ФОТООТЧЁТ', items: [{ photo }] }))
      .toContain('не вложен');
  });
});

describe('remarksFromDeviations', () => {
  const devs: Deviation[] = [
    {
      id: 'd1', kind: 'depth', date: '2026-07-20', oblast: 'Акмолинская область',
      uchastok: 'У1', kato: '1', lengthM: 120, reason: 'скальный грунт',
      author: 'Прораб', createdAt: '', updatedAt: '',
    },
    {
      id: 'd2', kind: 'route', date: '2026-07-25', oblast: 'Акмолинская область',
      uchastok: 'У2', kato: '2', lengthM: 80, reason: 'обход частного участка',
      protocol: { number: '7', date: '2026-07-28', note: 'согласовано' },
      author: 'Прораб', createdAt: '', updatedAt: '',
    },
  ];

  it('отклонение — это и есть замечание', () => {
    const rows = remarksFromDeviations(devs);
    expect(rows).toHaveLength(2);
    expect(rows[0].what).toContain('обход частного участка');
  });

  it('протокол закрывает замечание', () => {
    const rows = remarksFromDeviations(devs);
    expect(rows.find((r) => r.uchastok === 'У2')?.closed).toBe(true);
    expect(rows.find((r) => r.uchastok === 'У1')?.closed).toBe(false);
  });

  it('в реестре видно, сколько осталось открытым', () => {
    expect(remarksHtml(remarksFromDeviations(devs))).toContain('не закрыто');
  });
});

describe('letterHtml', () => {
  it('подставляет адресата, тему и подпись', () => {
    const html = letterHtml({
      to: 'АО «Транстелеком»',
      subject: 'О выполненных объёмах за июль',
      body: 'Сообщаем, что за июль проложено 12,4 км.\nПросим принять работы.',
      from: 'Ахметов А.',
      position: 'Директор',
      number: '145',
      date: '2026-08-01',
    });
    expect(html).toContain('Транстелеком');
    expect(html).toContain('№ 145');
    expect(html).toContain('12,4 км');
    expect(html).toContain('Директор');
  });

  it('пустые строки письма не превращаются в пустые абзацы', () => {
    const html = letterHtml({ to: 'А', subject: 'Б', body: 'один\n\n\nдва' });
    expect((html.match(/<p class="ind">/g) ?? [])).toHaveLength(2);
  });
});

describe('measureProtocolHtml', () => {
  const records: SpliceRecord[] = [{
    id: 's1', objectId: 'o1', date: '2026-07-25', device: 'Fujikura 70S',
    waveNm: 1550,
    fibers: [
      { fiber: 1, lossDb: 0.04, to: 'на Еленовку' },
      { fiber: 2, lossDb: 0.18, to: 'школа' },
      { fiber: 3, to: 'резерв' },
    ],
    createdAt: '', updatedAt: '',
  }];

  it('показывает все волокна и считает выходящие за норму', () => {
    const html = measureProtocolHtml({ objectName: 'Муфта №3', records });
    expect(html).toContain('ПРОТОКОЛ');
    expect(html).toContain('на Еленовку');
    expect(html).toContain('0,18');
    expect(html).toContain('Стыков выше нормы: 1');
  });

  it('неизмеренное волокно так и называется', () => {
    expect(measureProtocolHtml({ objectName: 'М', records })).toContain('не измерено');
  });

  it('когда всё в норме — так и написано', () => {
    const ok = [{ ...records[0], fibers: [{ fiber: 1, lossDb: 0.03 }] }];
    expect(measureProtocolHtml({ objectName: 'М', records: ok }))
      .toContain('в пределах нормы');
  });

  it('свой предел важнее умолчания', () => {
    const html = measureProtocolHtml({ objectName: 'М', records, limitDb: 0.3 });
    expect(html).toContain('в пределах нормы');
  });

  it('аппарат и длина волны попадают в шапку', () => {
    const html = measureProtocolHtml({ objectName: 'М', records });
    expect(html).toContain('Fujikura 70S');
    expect(html).toContain('1550');
  });

  it('имя файла говорит о муфте', () => {
    expect(measureProtocolFile({ objectName: 'Муфта №3', records, date: '2026-07-25' }))
      .toBe('Протокол измерений Муфта №3 2026-07-25.doc');
  });

  it('стык выше нормы выделен, а не размечен двумя классами сразу', () => {
    const html = measureProtocolHtml({ objectName: 'М', records, limitDb: 0.1 });
    expect(html).toContain('<td class="val b">0,18</td>');
    expect(html).not.toMatch(/class="val" class=/);
  });

  it('рефлектограммы перечислены приложением со своим состоянием', () => {
    const html = measureProtocolHtml({
      objectName: 'М', records,
      otdr: [{ name: 'OTDR_m3.sor', status: 'прилагается — папка «Рефлектограммы»' }],
    });
    expect(html).toContain('Приложения — рефлектограммы');
    expect(html).toContain('OTDR_m3.sor');
    expect(html).toContain('прилагается');
  });

  it('без рефлектограмм протокол прямо говорит, что их нет', () => {
    expect(measureProtocolHtml({ objectName: 'М', records }))
      .toContain('Рефлектограммы к протоколу не приложены');
  });

  it('протоколы нескольких муфт идут листами одного документа', () => {
    const html = measureProtocolsPage(
      [{ objectName: 'Муфта №1', records }, { objectName: 'Муфта №2', records }],
      'Протоколы измерений — Еленовка',
    );
    expect(html).toContain('Муфта №1');
    expect(html).toContain('Муфта №2');
    expect(html.match(/page-break-before:always/g)).toHaveLength(1);
  });
});
