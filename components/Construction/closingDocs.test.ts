import { describe, it, expect } from 'vitest';
import { prepareSectionAct, sectionActDocInput } from './actInput';
import {
  actDocHtml, fixationDocHtml, protocolDocHtml, protocolFileName, actFileName,
} from './actDocument';
import { supervisionDocHtml, supervisionFileName } from './supervisionLog';
import { docxParts, parseDocHtml, parseRuns } from './docxExport';
import { buildDocFile, fileNameFor, isLandscapeDoc, builtNote } from './docOutput';
import { sectionDoc, deviationDoc, stateDoc, routeDoc, measureDoc } from './docShare';
import { buildScheme, withSchemeAttached } from './asBuilt';
import { measureProtocolsPage } from './fieldDocs';
import { docPath } from '@/lib/docLink';
import type { Contractor, DailyWorkEntry, Deviation, PlanRoute } from '@/types/construction';

/**
 * Документы «Закрытия» — АСР, ОСР, акт фиксации, тетрадь и протокол
 * мобильной группы — уходили только старым HTML с расширением .doc. Здесь
 * каждый проходит настоящую сборку в .docx, а ссылки на них получают свои
 * постоянные адреса.
 */

const now = '2026-09-18T00:00:00.000Z';

function entry(over: Partial<DailyWorkEntry> = {}): DailyWorkEntry {
  return {
    kind: 'ground', id: 'g1', date: '2026-09-10', smu: '',
    oblast: 'Акмолинская область', rayon: 'Аршалынский',
    uchastok: 'Еленовка', kato: '191',
    byMethod: { 'кабелеукладчик': 11100 },
    materials: { 'Лента': 11100, 'ФИТИНГ': 20 },
    contractor: 'TERRA TECH', downtime: 'дождь до обеда',
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
    protocol: { number: '17', date: '2026-09-12' },
    author: 'Ербол', createdAt: now, updatedAt: now, ...over,
  };
}

const contractors: Contractor[] = [
  { id: 'tt', name: 'TERRA TECH', fullName: 'ТОО «Терра Тех»' },
];

const prep = prepareSectionAct({
  ground: [entry(), entry({ id: 'g2', date: '2026-09-12', byMethod: { 'бар': 900 } })],
  deviations: [deviation()],
  actFields: { 'Еленовка': { actNumber: 'АСР-2026-014', actDate: '2026-09-20' } },
  contractors,
}, 'Еленовка');

const v = prep.totals.variants[0];
const fixation = fixationDocHtml({
  uchastok: 'Еленовка', oblast: prep.oblast, rayon: prep.rayon, contractor: prep.contractor,
  lengthM: v.lengthM, designDepthM: 1.2, actualDepthM: 0.5,
  dateFrom: prep.totals.dateFrom, dateTo: prep.totals.dateTo,
});
const supervision = supervisionDocHtml({
  entries: prep.entries, deviations: prep.deviations,
  from: prep.totals.dateFrom, to: prep.totals.dateTo, contractor: prep.contractor, uchastok: 'Еленовка',
});
const protocol = protocolDocHtml({ deviation: deviation(), protocol: deviation().protocol });

const DOCS: { name: string; html: string; tables: number }[] = [
  { name: 'АСР', html: actDocHtml(sectionActDocInput(prep, 'ASR')), tables: 2 },
  { name: 'ОСР', html: actDocHtml(sectionActDocInput(prep, 'OSR')), tables: 2 },
  { name: 'акт фиксации', html: fixation, tables: 2 },
  { name: 'тетрадь технадзора', html: supervision, tables: 1 },
  { name: 'протокол мобильной группы', html: protocol, tables: 2 },
];

const LEAKS = ['<td', '<tr', '<div', '<span', '<b>', '<i>', 'class=', 'style=', '&nbsp;'];

describe('документы «Закрытия» собираются в .docx', () => {
  for (const d of DOCS) {
    describe(d.name, () => {
      const doc = docxParts(d.html, { landscape: isLandscapeDoc(d.html) }).text['word/document.xml'];

      it('разметка HTML в документ не протекает', () => {
        for (const leak of LEAKS) expect(doc).not.toContain(leak);
      });

      it('таблицы на месте', () => {
        expect(doc.match(/<w:tbl>/g)?.length ?? 0).toBeGreaterThanOrEqual(d.tables);
      });

      it('в тексте нет отступов исходника', () => {
        for (const m of doc.matchAll(/<w:t[^>]*?>([\s\S]*?)<\/w:t>/g)) {
          expect(m[1]).not.toMatch(/\n| {3,}/);
        }
      });
    });
  }

  it('акт по отклонению начинается с нового листа, как в печати', () => {
    expect(prep.totals.variants.length).toBe(2);
    const doc = docxParts(actDocHtml(sectionActDocInput(prep, 'ASR'))).text['word/document.xml'];
    expect(doc.match(/<w:br w:type="page"\/>/g)?.length).toBe(1);
  });

  it('первый лист разрывом не начинается — пустой страницы в начале нет', () => {
    const blocks = parseDocHtml('<body><div style="page-break-before:always"><p>Текст</p></div></body>');
    expect(blocks[0].type).toBe('p');
  });

  it('протоколы по муфтам разведены по листам и в .docx', () => {
    const html = measureProtocolsPage([
      { objectName: 'Муфта №1', records: [] },
      { objectName: 'Муфта №2', records: [] },
    ], 'Протоколы измерений — Еленовка');
    expect(parseDocHtml(html).filter((b) => b.type === 'pagebreak')).toHaveLength(1);
  });

  it('тетрадь технадзора остаётся альбомной', () => {
    expect(isLandscapeDoc(supervision)).toBe(true);
    expect(docxParts(supervision, { landscape: true }).text['word/document.xml'])
      .toContain('w:orient="landscape"');
  });

  it('акт со схемой-приложением остаётся книжным', () => {
    const route: PlanRoute = {
      id: 'r1', name: 'ОМ — Еленовка', uchastok: 'Еленовка',
      coords: [[52, 71], [52, 71.02]], lengthM: 1400, source: 'plan.kml', createdAt: '', updatedAt: '',
    };
    const html = withSchemeAttached(
      actDocHtml(sectionActDocInput(prep, 'ASR')), { scheme: buildScheme(route, []) }, 'АСР-2026-014',
    );
    expect(isLandscapeDoc(html)).toBe(false);
  });

  it('предупреждение акта фиксации о малой глубине остаётся жирным', () => {
    const doc = docxParts(fixation).text['word/document.xml'];
    expect(doc).toMatch(/<w:b\/><\/w:rPr><w:t xml:space="preserve">Глубина заложения меньше проектной\.<\/w:t>/);
  });

  it('жирное тегом читает так же, как жирное классом', () => {
    expect(parseRuns('Итого: <b>1 200</b> м и <strong>ещё</strong>')).toEqual([
      { text: 'Итого: ' }, { text: '1 200', bold: true }, { text: ' м и ' }, { text: 'ещё', bold: true },
    ]);
  });

  it('у протокола мобильной группы осталось место под подпись', () => {
    const doc = docxParts(protocol).text['word/document.xml'];
    expect(doc).toContain('____________________');
  });
});

describe('файл в выбранном виде', () => {
  it('имя меняет только расширение', () => {
    const name = actFileName('ASR', 'Еленовка', '2026-09-20');
    expect(fileNameFor('docx', name)).toBe('АСР Еленовка 2026-09-20.docx');
    expect(fileNameFor('pdf', name)).toBe('АСР Еленовка 2026-09-20.pdf');
    expect(fileNameFor('doc', name)).toBe('АСР Еленовка 2026-09-20.doc');
    expect(fileNameFor('doc', 'Протокол МГ Еленовка.docx')).toBe('Протокол МГ Еленовка.doc');
  });

  it('Word собирается настоящим пакетом, а не HTML', async () => {
    const built = await buildDocFile('docx', protocolFileName(deviation()), protocol);
    expect(built.ext).toBe('docx');
    expect(built.file.endsWith('.docx')).toBe(true);
    const head = new Uint8Array(await built.blob.arrayBuffer()).slice(0, 2);
    // Сигнатура zip: .docx — это архив.
    expect(String.fromCharCode(...head)).toBe('PK');
  });

  it('старый .doc — с BOM, иначе Word показывает кракозябры', async () => {
    const built = await buildDocFile('doc', supervisionFileName('Еленовка'), supervision);
    const bytes = new Uint8Array(await built.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(built.blob.type).toContain('msword');
  });

  it('PDF-картинку называет картинкой', () => {
    expect(builtNote({ file: 'АСР.pdf', imageOnly: true })).toContain('картинкой');
    expect(builtNote({ file: 'АСР.pdf' })).toBe('Файл собран: АСР.pdf');
  });
});

describe('ссылки на документы закрытия и прочие', () => {
  const ORG = 'org-1';
  const SNP = { projectId: 'snp', projectName: 'СНП' };
  const path = (d: { address: Parameters<typeof docPath>[1] }) => docPath(ORG, d.address, 'pdf');
  const obl = ['Акмолинская область'];

  it('АСР и ОСР одного села — разные ссылки', () => {
    expect(path(sectionDoc(SNP, 'аср', 'АСР', 'Еленовка', obl)))
      .not.toBe(path(sectionDoc(SNP, 'оср', 'ОСР', 'Еленовка', obl)));
  });

  it('у каждого протокола мобильной группы своя ссылка, даже на одном участке', () => {
    const a = deviationDoc(SNP, deviation({ id: 'd1' }));
    const b = deviationDoc(SNP, deviation({ id: 'd2', date: '2026-09-14' }));
    expect(path(a)).not.toBe(path(b));
    expect(a.title).toBe('Протокол мобильной группы, Еленовка, 11.09.2026 · Акмолинская область · проект СНП');
  });

  it('справка о готовности одна на всё время, пока не сменили область', () => {
    const a = stateDoc(SNP, 'справка о готовности', 'Справка о готовности');
    const b = stateDoc(SNP, 'справка о готовности', 'Справка о готовности');
    const c = stateDoc({ ...SNP, oblast: 'Костанайская область' }, 'справка о готовности', 'Справка о готовности');
    expect(path(a)).toBe(path(b));
    expect(path(a)).not.toBe(path(c));
    expect(a.title).toBe('Справка о готовности · проект СНП');
  });

  it('схема по факту и схема по проекту — разные ссылки', () => {
    const r = { id: 'r1', name: 'ОМ — Еленовка' };
    expect(path(routeDoc(SNP, r, 'fact'))).not.toBe(path(routeDoc(SNP, r, 'project')));
    expect(routeDoc(SNP, r, 'fact', 'по факту').title)
      .toBe('Исполнительная схема, ОМ — Еленовка (по факту) · проект СНП');
  });

  it('протокол одной муфты не ложится на протокол всего участка', () => {
    const all = measureDoc(SNP, 'Еленовка', obl);
    const one = measureDoc(SNP, 'Еленовка', obl, { id: 'm1', name: 'Муфта №3' });
    expect(path(all)).not.toBe(path(one));
    expect(one.title).toBe('Протокол измерений, Еленовка, Муфта №3 · Акмолинская область · проект СНП');
  });

  it('переименованная муфта ссылку не меняет', () => {
    expect(path(measureDoc(SNP, 'Еленовка', obl, { id: 'm1', name: 'Муфта №3' })))
      .toBe(path(measureDoc(SNP, 'Еленовка', obl, { id: 'm1', name: 'МС-3' })));
  });
});
