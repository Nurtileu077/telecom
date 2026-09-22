import {
  DailyWorkEntry, Deviation, FieldPhoto, DESIGN_DEPTH_M,
} from '@/types/construction';
import { esc, ACT_DOC_CSS, fmtDate, ruDateWords } from './actDocument';
import { entryMeters } from './entriesTable';
import { formatWeather } from './weather';

/**
 * Документы, которые рождаются прямо на объекте.
 *
 * Акт скрытых работ подписывают в траншее, до засыпки: потом проверить
 * нечего — глубину, песок и ленту видно ровно один раз. Фотоотчёт
 * собирают из тех же снимков, что уже приложены к сменам. Реестр
 * замечаний ведут в тетради, а он и так есть в отклонениях.
 *
 * Все они складываются из записанного, и переписывать ради них ничего
 * не надо.
 */

const page = (title: string, body: string) => `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>@page { size: A4; margin: 1.5cm; } body { margin: 0; }
${ACT_DOC_CSS}
  .act-doc .photos { display: block; }
  .act-doc .ph { display: inline-block; width: 48%; vertical-align: top; margin: 0 1% 8pt 0; }
  .act-doc .ph img { width: 100%; border: 0.5pt solid #000; }
  .act-doc .ph .cap { font-size: 8pt; text-align: left; margin-top: 2pt; }
</style></head><body class="act-doc">${body}</body></html>`;

// ── Акт освидетельствования скрытых работ ────────────────────────────────────

export interface HiddenWorksInput {
  uchastok: string;
  oblast?: string;
  rayon?: string;
  rows: DailyWorkEntry[];
  /** Фактическая глубина, если она отличается от проектной. */
  depthM?: number;
  /** Чем подсыпали и укрыли — по умолчанию как в проекте. */
  bedding?: string;
  /** Подписанты. */
  contractor?: string;
  customer?: string;
  supervisor?: string;
  number?: string;
  date?: string;
  city?: string;
}

export const HIDDEN_BEDDING_DEFAULT =
  'подсыпка песком 100 мм, засыпка песком 100 мм над трубой, '
  + 'лента ЛСС на 400 мм выше трубы, обратная засыпка грунтом с уплотнением';

/**
 * Акт скрытых работ.
 *
 * Подписывают до засыпки: после неё глубину, песок и ленту проверить
 * уже нечем. Поэтому в акте только то, что видно в траншее, и ничего
 * про объёмы — их закрывают другим актом.
 */
export function hiddenWorksHtml(i: HiddenWorksInput): string {
  const meters = i.rows.reduce((s, e) => s + entryMeters(e), 0);
  const dates = i.rows.map((e) => e.date).filter(Boolean).sort();
  const depth = i.depthM ?? DESIGN_DEPTH_M;
  const weather = i.rows.find((e) => e.weather)?.weather;

  return '<h1>АКТ<br/>освидетельствования скрытых работ</h1>'
    + (i.number ? `<p class="center">№ ${esc(i.number)}</p>` : '')
    + `<table class="sign"><tr><td class="s" style="text-align:left">${esc(i.city || '')}</td>`
    + `<td class="s" style="text-align:right">${esc(ruDateWords(i.date))}</td></tr></table>`
    + `<p class="obj">${esc(i.uchastok)}</p>`
    + (i.oblast || i.rayon
      ? `<p class="cap">${esc([i.rayon, i.oblast].filter(Boolean).join(', '))}</p>` : '')
    + '<p class="ind">Комиссия в составе представителей подрядной организации '
    + `<span class="b">${esc(i.contractor || '—')}</span>, заказчика `
    + `<span class="b">${esc(i.customer || '—')}</span>`
    + (i.supervisor ? ` и технического надзора <span class="b">${esc(i.supervisor)}</span>` : '')
    + ' произвела осмотр работ, выполненных до их закрытия последующими '
    + 'работами, и составила настоящий акт о нижеследующем.</p>'
    + '<table class="act">'
    + `<tr><td class="lbl">Период выполнения</td><td class="val">`
    + `${esc(fmtDate(dates[0]))} — ${esc(fmtDate(dates[dates.length - 1]))}</td><td class="unit"></td></tr>`
    + `<tr><td class="lbl">Протяжённость освидетельствуемого участка</td>`
    + `<td class="val">${Math.round(meters).toLocaleString('ru')}</td><td class="unit">м</td></tr>`
    + `<tr><td class="lbl">Глубина заложения</td>`
    + `<td class="val">${depth.toFixed(2).replace('.', ',')}</td><td class="unit">м</td></tr>`
    + `<tr><td class="lbl">Устройство постели и защиты</td>`
    + `<td class="val" colspan="2">${esc(i.bedding || HIDDEN_BEDDING_DEFAULT)}</td></tr>`
    + (weather
      ? `<tr><td class="lbl">Погодные условия</td><td class="val" colspan="2">`
        + `${esc(formatWeather({ date: dates[0] ?? '', ...weather }))}</td></tr>`
      : '')
    + '</table>'
    + '<p class="ind b">Работы выполнены в соответствии с проектной документацией '
    + 'и действующими нормами. Разрешается производство последующих работ '
    + 'по обратной засыпке траншеи.</p>'
    + '<table class="sign"><tr>'
    + `<td class="s">Подрядчик<br/>_______________ / ${esc(i.contractor || '')}</td>`
    + `<td class="s">Заказчик<br/>_______________ / ${esc(i.customer || '')}</td>`
    + '</tr>'
    + (i.supervisor
      ? `<tr><td class="s">Технический надзор<br/>_______________ / ${esc(i.supervisor)}</td>`
        + '<td class="s"></td></tr>'
      : '')
    + '</table>';
}

export function hiddenWorksPage(i: HiddenWorksInput): string {
  return page(`Акт скрытых работ — ${i.uchastok}`, hiddenWorksHtml(i));
}

export function hiddenWorksFile(i: HiddenWorksInput): string {
  const safe = i.uchastok.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'участок';
  return `Акт скрытых работ ${safe} ${i.date || new Date().toISOString().slice(0, 10)}.doc`;
}

// ── Фотоотчёт ────────────────────────────────────────────────────────────────

export interface PhotoReportItem {
  photo: FieldPhoto;
  /** Картинка в виде data:URL — в документ она попадает целиком. */
  dataUrl?: string;
}

export interface PhotoReportInput {
  title: string;
  uchastok?: string;
  from?: string;
  to?: string;
  items: PhotoReportItem[];
}

/** Подпись под снимком: место, время и откуда взялись координаты. */
export function photoCaption(p: FieldPhoto): string {
  const when = new Date(p.exifAt || p.takenAt || p.createdAt);
  const parts = [
    p.note?.trim(),
    Number.isNaN(when.getTime()) ? '' : when.toLocaleString('ru'),
    p.lat !== undefined && p.lon !== undefined
      ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`
      : 'без координат',
    p.author,
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * Фотоотчёт.
 *
 * Снимки уже приложены к сменам — их только надо разложить по порядку и
 * подписать. Снимок без координат в отчёт попадает, но помечается: по
 * нему нельзя сказать, что это тот самый участок.
 */
export function photoReportHtml(i: PhotoReportInput): string {
  const body = i.items.map((it) => '<div class="ph">'
    + (it.dataUrl ? `<img src="${it.dataUrl}" alt=""/>` : '<div class="cap">[снимок не вложен]</div>')
    + `<div class="cap">${esc(photoCaption(it.photo))}</div>`
    + '</div>').join('');

  return `<h1>${esc(i.title)}</h1>`
    + (i.uchastok ? `<p class="obj">${esc(i.uchastok)}</p>` : '')
    + (i.from
      ? `<p class="center">${esc(fmtDate(i.from))}${i.to && i.to !== i.from ? ` — ${esc(fmtDate(i.to))}` : ''}</p>`
      : '')
    + `<p>Снимков: ${i.items.length}.</p>`
    + `<div class="photos">${body}</div>`;
}

export function photoReportPage(i: PhotoReportInput): string {
  return page(i.title, photoReportHtml(i));
}

// ── Реестр замечаний ─────────────────────────────────────────────────────────

export interface RemarkRow {
  date: string;
  uchastok: string;
  what: string;
  /** Кто выдал: технадзор, заказчик, наш инженер. */
  from?: string;
  closed: boolean;
  closedAt?: string;
  how?: string;
}

/**
 * Замечания из отклонений.
 *
 * Отдельной тетради для них нет и не надо: отклонение — это и есть
 * замечание, а его закрытие — протокол мобильной группы.
 */
export function remarksFromDeviations(devs: Deviation[]): RemarkRow[] {
  return devs.map((d) => ({
    date: d.date,
    uchastok: d.uchastok,
    what: [d.kind, d.reason].filter(Boolean).join(': ') || 'отклонение',
    from: d.author,
    closed: !!d.protocol,
    closedAt: d.protocol?.date,
    how: d.protocol?.note,
  })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function remarksHtml(rows: RemarkRow[], title = 'РЕЕСТР ЗАМЕЧАНИЙ'): string {
  const open = rows.filter((r) => !r.closed).length;
  const body = rows.map((r, i) => '<tr>'
    + `<td class="val">${i + 1}</td>`
    + `<td class="val">${esc(fmtDate(r.date))}</td>`
    + `<td class="lbl">${esc(r.uchastok)}</td>`
    + `<td class="lbl">${esc(r.what)}</td>`
    + `<td class="val">${r.closed ? esc(fmtDate(r.closedAt)) : 'открыто'}</td>`
    + '</tr>').join('');

  return `<h1>${esc(title)}</h1>`
    + `<p>Всего: <span class="b">${rows.length}</span>, из них не закрыто: `
    + `<span class="b">${open}</span>.</p>`
    + '<table class="act"><tr>'
    + '<td class="val b">№</td><td class="val b">Дата</td><td class="lbl b">Участок</td>'
    + '<td class="lbl b">Замечание</td><td class="val b">Закрыто</td>'
    + '</tr>' + body + '</table>';
}

export function remarksPage(rows: RemarkRow[]): string {
  return page('Реестр замечаний', remarksHtml(rows));
}

// ── Письмо заказчику ─────────────────────────────────────────────────────────

export interface LetterInput {
  to: string;
  subject: string;
  body: string;
  from?: string;
  position?: string;
  number?: string;
  date?: string;
}

/**
 * Письмо.
 *
 * Его всё равно пишут — про объёмы, про простой, про согласование. Но
 * цифры в него переносят руками из журнала, и в письме они уже не
 * сходятся с актом. Пусть подставляются.
 */
export function letterHtml(i: LetterInput): string {
  return '<table class="sign"><tr>'
    + `<td class="s" style="text-align:left">${i.number ? `№ ${esc(i.number)}` : ''}`
    + `${i.date ? ` от ${esc(fmtDate(i.date))}` : ''}</td>`
    + `<td class="s" style="text-align:right">${esc(i.to)}</td>`
    + '</tr></table>'
    + `<h1>${esc(i.subject)}</h1>`
    + i.body.split('\n').filter((l) => l.trim())
      .map((l) => `<p class="ind">${esc(l)}</p>`).join('')
    + '<table class="sign"><tr>'
    + `<td class="s">${esc(i.position || '')}<br/>_______________ / ${esc(i.from || '')}</td>`
    + '<td class="s"></td></tr></table>';
}

export function letterPage(i: LetterInput): string {
  return page(i.subject, letterHtml(i));
}
