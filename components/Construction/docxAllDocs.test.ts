import { describe, it, expect } from 'vitest';
import { docxParts } from './docxExport';
import { buildScheme, schemeDocPage } from './asBuilt';
import { volumeSheet, costSheet, volumeDocPage } from './volumeDocs';
import {
  periodReport, periodDocPage, snpReadiness, readinessDocHtml,
} from './periodReports';
import {
  hiddenWorksPage, remarksPage, letterPage, measureProtocolPage,
  photoReportPage, remarksFromDeviations,
} from './fieldDocs';
import type { DailyWorkEntry, PlanRoute } from '@/types/construction';

/**
 * Каждый документ, который уходит заказчику, — через настоящую сборку.
 *
 * Юнит-тесты проверяют разбор по кускам, а ломается оно на стыке: `<path>`
 * внутри схемы читался абзацем и проглатывал полдокумента, и ни один
 * тест этого не видел, потому что схему никто не пропускал через сборку
 * целиком.
 *
 * Здесь проверяется ровно одно, зато на всех: разметка HTML в документ
 * не протекает, а то, что должно было стать абзацами и таблицами, ими и
 * стало.
 */

const e = (p: Partial<DailyWorkEntry> = {}): DailyWorkEntry => ({
  id: 'a', kind: 'ground', date: '2026-07-25', smu: 'СМУ-1',
  oblast: 'Акмолинская область', rayon: 'Бурабайский', uchastok: 'Зеренда', kato: '1',
  byMethod: { 'бар': 1240 }, materials: { 'МКТ': 1265, 'Лента': 1240 },
  drillM: 72, drillCount: 2, contractor: 'ТОО «Дозер»',
  createdAt: '', updatedAt: '', ...p,
} as DailyWorkEntry);

const rows = [
  e(),
  e({ id: 'b', date: '2026-07-26', byMethod: { 'бар': 860, 'вручную': 120 } }),
];

const route: PlanRoute = {
  id: 'r1', name: 'Зеренда — Серафимовка', uchastok: 'Зеренда',
  coords: [[52, 71], [52, 71.02]], lengthM: 2226, source: 'plan.kml',
  createdAt: '', updatedAt: '',
};

const period = { from: '2026-07-01', to: '2026-07-31' };
const sheet = volumeSheet(rows, period);
const report = periodReport(rows, period);

/** Документ и то, чего в нём не может не быть. */
const DOCS: { name: string; html: string; tables: number }[] = [
  { name: 'ведомость объёмов', html: volumeDocPage({ sheet }), tables: 1 },
  {
    name: 'КС-2',
    html: volumeDocPage({ sheet, cost: costSheet(sheet, { 'бар': 300 }) }),
    tables: 1,
  },
  { name: 'отчёт за период', html: periodDocPage({ report }), tables: 1 },
  {
    name: 'справка о готовности',
    html: `<body class="act-doc">${readinessDocHtml(snpReadiness([]))}</body>`,
    tables: 1,
  },
  { name: 'исполнительная схема', html: schemeDocPage({ scheme: buildScheme(route, []) }), tables: 1 },
  { name: 'акт скрытых работ', html: hiddenWorksPage({ uchastok: 'Зеренда', rows }), tables: 1 },
  { name: 'реестр замечаний', html: remarksPage(remarksFromDeviations([])), tables: 1 },
  {
    name: 'письмо заказчику',
    html: letterPage({ to: 'АО «Транстелеком»', subject: 'Тема', body: 'Строка.\nВторая.' }),
    tables: 1,
  },
  {
    name: 'протокол измерений',
    html: measureProtocolPage({ objectName: 'Муфта №1', records: [] }),
    tables: 1,
  },
  {
    name: 'фотоотчёт',
    html: photoReportPage({ title: 'ФОТООТЧЁТ', ...period, items: [] }),
    tables: 0,
  },
];

/** То, что в документе Ворда означает непереваренный HTML. */
const LEAKS = ['<td', '<tr', '<div', '<span', '<svg', '<path', '<img', 'class=', 'style='];

describe('все документы собираются в .docx', () => {
  for (const d of DOCS) {
    describe(d.name, () => {
      const doc = docxParts(d.html).text['word/document.xml'];

      it('разметка HTML в документ не протекает', () => {
        for (const leak of LEAKS) expect(doc).not.toContain(leak);
      });

      it('текст документа не потерян', () => {
        expect(doc.match(/<w:p[ >/]/g)?.length ?? 0).toBeGreaterThan(2);
      });

      it('таблицы на месте', () => {
        expect(doc.match(/<w:tbl>/g)?.length ?? 0).toBeGreaterThanOrEqual(d.tables);
      });

      it('ничего не осталось неэкранированным', () => {
        const texts = [...doc.matchAll(/<w:t[^>]*?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
        for (const t of texts) expect(t).not.toMatch(/&(?!(amp|lt|gt|quot|#\d+);)/);
      });

      it('в тексте нет отступов исходника', () => {
        const texts = [...doc.matchAll(/<w:t[^>]*?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
        for (const t of texts) {
          expect(t).not.toMatch(/\n/);
          expect(t).not.toMatch(/ {3,}/);
        }
      });

      it('каждая ячейка таблицы несёт абзац', () => {
        const cells = doc.match(/<w:tc>/g)?.length ?? 0;
        const withPara = doc.match(/<w:tc><w:tcPr>[\s\S]*?<w:p>/g)?.length ?? 0;
        expect(withPara).toBe(cells);
      });

      it('ширины колонок складываются в сто процентов', () => {
        for (const row of doc.match(/<w:tr>[\s\S]*?<\/w:tr>/g) ?? []) {
          const ws = [...row.matchAll(/<w:tcW w:w="(\d+)" w:type="pct"\/>/g)]
            .map((m) => Number(m[1]));
          if (ws.length === 0) continue;
          // В OOXML процент задаётся в пятидесятых долях.
          expect(ws.reduce((a, b) => a + b, 0) / 50).toBeCloseTo(100, 0);
        }
      });
    });
  }

  it('альбомный лист остаётся альбомным', () => {
    const land = docxParts(schemeDocPage({ scheme: buildScheme(route, []) }), { landscape: true })
      .text['word/document.xml'];
    expect(land).toContain('w:orient="landscape"');
  });
});

/**
 * Фотоотчёт через свой настоящий генератор, а не через выдуманную
 * разметку: снимки в нём и есть документ, и подпись под каждым — это
 * где и когда снято.
 */
describe('фотоотчёт со снимками', () => {
  function pngUrl(w: number, h: number): string {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); Buffer.from('IHDR').copy(b, 12);
    b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
    return `data:image/png;base64,${b.toString('base64')}`;
  }

  const photo = (id: string, over: Record<string, unknown> = {}) => ({
    id, kind: 'entry' as const, refId: 'e1',
    lat: 52.1, lon: 71.2, geoSource: 'exif' as const,
    takenAt: '2026-07-25T09:00:00.000Z',
    uchastok: 'Зеренда', createdAt: '', updatedAt: '', ...over,
  });

  const html = photoReportPage({
    title: 'ФОТООТЧЁТ',
    from: '2026-07-01',
    to: '2026-07-31',
    items: [
      { photo: photo('p1') as never, dataUrl: pngUrl(1600, 1200) },
      // Этот снимок не нашёлся на устройстве: генератор пишет так сам.
      { photo: photo('p2') as never },
      { photo: photo('p3') as never, dataUrl: pngUrl(1200, 1600) },
    ],
  });

  const { text, media } = docxParts(html);
  const doc = text['word/document.xml'];

  it('вложены оба целых снимка', () => {
    expect(media).toHaveLength(2);
    expect(doc.match(/<w:drawing>/g)).toHaveLength(2);
  });

  it('о невложенном сказано прямо в документе', () => {
    expect(doc).toContain('снимок не вложен');
  });

  it('подпись есть у каждого снимка: координаты и время съёмки', () => {
    // Именно по ним потом доказывают, что это тот самый участок.
    expect(doc.match(/52\.10000, 71\.20000/g)).toHaveLength(3);
    expect(doc.match(/25\.07\.2026/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('снимок без координат помечен, а не выдаётся за привязанный', () => {
    const noGeo = photoReportPage({
      title: 'ФОТООТЧЁТ',
      items: [{ photo: photo('p9', { lat: undefined, lon: undefined }) as never,
        dataUrl: pngUrl(800, 600) }],
    });
    expect(docxParts(noGeo).text['word/document.xml']).toContain('без координат');
  });

  it('вертикальный снимок не растянут в горизонтальный', () => {
    const tall = media.find((m) => m.heightEmu > m.widthEmu);
    expect(tall).toBeTruthy();
    expect(tall!.heightEmu / tall!.widthEmu).toBeCloseTo(1600 / 1200, 2);
  });

  it('разметка отчёта в документ не протекла', () => {
    for (const leak of LEAKS) expect(doc).not.toContain(leak);
  });

  it('число снимков в шапке совпадает с тем, что приложено', () => {
    expect(doc).toContain('Снимков: 3');
  });
});

/**
 * Вложенные блоки в фотоотчёте обрывали разбор: у снимка, которого нет
 * на устройстве, подпись терялась целиком — а по ней и видно, что это
 * за место и когда снято.
 */
describe('подпись под снимком не теряется', () => {
  function pngUrl(w: number, h: number): string {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); Buffer.from('IHDR').copy(b, 12);
    b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
    return `data:image/png;base64,${b.toString('base64')}`;
  }
  const ph = (id: string) => ({
    id, kind: 'entry' as const, refId: 'e1', lat: 52.1, lon: 71.2,
    geoSource: 'exif' as const, takenAt: '2026-07-25T09:00:00.000Z',
    createdAt: '', updatedAt: '',
  });

  const doc = docxParts(photoReportPage({
    title: 'ФОТООТЧЁТ',
    items: [
      { photo: ph('p1') as never, dataUrl: pngUrl(1600, 1200) },
      { photo: ph('p2') as never },
      { photo: ph('p3') as never, dataUrl: pngUrl(1200, 1600) },
    ],
  })).text['word/document.xml'];

  it('подпись есть под каждым снимком, включая невложенный', () => {
    expect(doc.match(/52\.10000, 71\.20000/g)).toHaveLength(3);
  });

  it('и не слипается с пометкой о том, что снимка нет', () => {
    expect(doc).not.toMatch(/вложен\]\d/);
    expect(doc).toMatch(/снимок не вложен\]\s/);
  });
});
