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
