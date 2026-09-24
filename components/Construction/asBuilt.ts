import type { SiteObject, PlanRoute } from '@/types/construction';
import { SITE_OBJECT_SPECS } from '@/types/construction';
import { esc, ACT_DOC_CSS, fmtDate } from './actDocument';
import { nearestOnRoute } from './measureTool';
import { routeLengthM } from './routeProgress';
import { formatMeters } from './mapDecor';
import { term, type Bilingual, type TermPair } from './bilingual';

/**
 * Исполнительная схема.
 *
 * Её рисуют в AutoCAD по фотографиям и записям — неделю на участок. А
 * всё, что на ней должно быть, уже записано: трасса из KML, муфты и ККС
 * с координатами, длины между ними считаются.
 *
 * Схема не карта: на ней важен не масштаб местности, а порядок и
 * расстояния. Поэтому рисуем линейку — трассу, вытянутую в прямую, с
 * отметками на своих местах. Так её и читают: «от АТС 420 метров до
 * первой муфты, дальше 1 240 до ККС».
 */

export interface SchemeMark {
  /** Метры от начала трассы. */
  atM: number;
  label: string;
  kind: 'endpoint' | 'mufta' | 'kks' | 'stolb' | 'start' | 'end';
  /** Насколько отметка отстоит от линии — её сняли не на самой трассе. */
  offsetM?: number;
}

export interface Scheme {
  route: string;
  totalM: number;
  marks: SchemeMark[];
  /** Расстояния между соседними отметками. */
  spans: { from: string; to: string; meters: number }[];
  /** Объекты, которые к трассе не отнеслись: слишком далеко. */
  skipped: string[];
}

export interface SchemeOptions {
  /** Дальше этого от линии объект к ней не относится. */
  maxOffsetM?: number;
  from?: string;
  to?: string;
}

/**
 * Собрать схему из трассы и объектов.
 *
 * Объект, снятый в стороне от линии, — это либо не наш объект, либо
 * ошибка координат. Молча притягивать его к трассе нельзя: в схеме
 * появится отметка там, где её нет. Называем такие отдельно.
 */
export function buildScheme(
  route: PlanRoute,
  objects: SiteObject[],
  opts: SchemeOptions = {},
): Scheme {
  const maxOffset = opts.maxOffsetM ?? 120;
  const totalM = routeLengthM(route.coords);

  const marks: SchemeMark[] = [];
  const skipped: string[] = [];

  for (const o of objects) {
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
    const hit = nearestOnRoute({ lat: o.lat, lon: o.lon }, route.coords);
    if (!hit) continue;
    if (hit.deviationM > maxOffset) {
      skipped.push(`${o.name || SITE_OBJECT_SPECS[o.kind].label} (${Math.round(hit.deviationM)} м в стороне)`);
      continue;
    }
    marks.push({
      atM: hit.atM,
      label: o.name || SITE_OBJECT_SPECS[o.kind].label,
      kind: o.kind,
      offsetM: hit.deviationM > 5 ? hit.deviationM : undefined,
    });
  }

  // Концы трассы — всегда отметки: с них схему и читают.
  const startLabel = opts.from || route.name.split(/[—–-]/)[0]?.trim() || 'Начало';
  const endLabel = opts.to || route.name.split(/[—–-]/).pop()?.trim() || 'Конец';
  marks.push({ atM: 0, label: startLabel, kind: 'start' });
  marks.push({ atM: totalM, label: endLabel, kind: 'end' });

  marks.sort((a, b) => a.atM - b.atM);

  const spans: Scheme['spans'] = [];
  for (let i = 1; i < marks.length; i += 1) {
    const meters = marks[i].atM - marks[i - 1].atM;
    if (meters < 1) continue;
    spans.push({ from: marks[i - 1].label, to: marks[i].label, meters });
  }

  return { route: route.name, totalM, marks, spans, skipped };
}

const MARK_STYLE: Record<SchemeMark['kind'], { fill: string; shape: 'circle' | 'square' | 'house' }> = {
  start: { fill: '#0f172a', shape: 'house' },
  end: { fill: '#0f172a', shape: 'house' },
  endpoint: { fill: '#0f172a', shape: 'house' },
  mufta: { fill: '#b45309', shape: 'circle' },
  kks: { fill: '#0369a1', shape: 'square' },
  stolb: { fill: '#475569', shape: 'square' },
};

/**
 * Схема рисунком.
 *
 * Чёрно-белая по сути: её печатают и возят в папке, а цветной принтер
 * на объекте есть не всегда. Цвет здесь — подсказка, а не смысл: форма
 * отметки говорит то же самое.
 */
export function schemeSvg(s: Scheme, width = 1000): string {
  const pad = 70;
  const line = width - pad * 2;
  const y = 130;
  // Округляем: доли пикселя на бумаге не видны, а «672.0000000000001»
  // в разметке — мусор, который читают глазами при разборе.
  const x = (m: number) => Math.round(
    (pad + (s.totalM > 0 ? (m / s.totalM) * line : 0)) * 100,
  ) / 100;

  // Подписи чередуем сверху и снизу: на плотном участке они иначе
  // наезжают друг на друга и не читаются.
  const marks = s.marks.map((m, i) => {
    const style = MARK_STYLE[m.kind];
    const cx = x(m.atM);
    const up = i % 2 === 0;
    const labelY = up ? y - 26 : y + 38;
    const tickY1 = up ? y - 10 : y + 10;
    const tickY2 = up ? y - 18 : y + 18;

    const glyph = style.shape === 'circle'
      ? `<circle cx="${cx}" cy="${y}" r="7" fill="${style.fill}" stroke="#fff" stroke-width="2"/>`
      : style.shape === 'square'
        ? `<rect x="${cx - 6}" y="${y - 6}" width="12" height="12" fill="${style.fill}" stroke="#fff" stroke-width="2"/>`
        : `<path d="M ${cx - 8} ${y + 7} L ${cx - 8} ${y - 2} L ${cx} ${y - 10} L ${cx + 8} ${y - 2} L ${cx + 8} ${y + 7} Z" fill="${style.fill}" stroke="#fff" stroke-width="1.5"/>`;

    return `<g>
      <line x1="${cx}" y1="${tickY1}" x2="${cx}" y2="${tickY2}" stroke="#94a3b8" stroke-width="1"/>
      ${glyph}
      <text x="${cx}" y="${labelY}" text-anchor="middle" font-size="12" fill="#0f172a">${esc(m.label)}</text>
      <text x="${cx}" y="${labelY + (up ? -13 : 13)}" text-anchor="middle" font-size="10" fill="#64748b">${esc(formatMeters(m.atM))}</text>
    </g>`;
  }).join('');

  // Длины пролётов — под линией, по центру каждого.
  const spans = s.spans.map((sp, i) => {
    const a = s.marks[i];
    const b = s.marks[i + 1];
    if (!a || !b) return '';
    const cx = (x(a.atM) + x(b.atM)) / 2;
    return `<text x="${cx}" y="${y + 20}" text-anchor="middle" font-size="10" fill="#334155">`
      + `${esc(formatMeters(sp.meters))}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 230" width="${width}" height="230">
    <rect x="0" y="0" width="${width}" height="230" fill="#ffffff"/>
    <line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="#0f172a" stroke-width="3"/>
    ${spans}
    ${marks}
    <text x="${pad}" y="210" font-size="11" fill="#64748b">${esc(s.route)} · ${esc(formatMeters(s.totalM))}</text>
  </svg>`;
}

export interface SchemeDocInput {
  scheme: Scheme;
  /** Двуязычный бланк: государственный язык рядом с русским. */
  lang?: Bilingual;
  /** Свои переводы терминов, если словарные поправили. */
  terms?: Partial<Record<string, TermPair>>;
  oblast?: string;
  rayon?: string;
  contractor?: string;
  customer?: string;
  number?: string;
  date?: string;
}

export function schemeDocHtml(i: SchemeDocInput): string {
  const s = i.scheme;
  const t = (key: string) => term(key as never, i.lang ?? 'off', i.terms ?? {});
  const rows = s.spans.map((sp, n) => '<tr>'
    + `<td class="val">${n + 1}</td>`
    + `<td class="lbl">${esc(sp.from)} — ${esc(sp.to)}</td>`
    + `<td class="val">${Math.round(sp.meters).toLocaleString('ru')}</td>`
    + '</tr>').join('');

  return `<h1>${esc(t('scheme'))}</h1>`
    + (i.number ? `<p class="center">№ ${esc(i.number)}</p>` : '')
    + `<p class="obj">${esc(s.route)}</p>`
    + (i.oblast || i.rayon
      ? `<p class="cap">${esc([i.rayon, i.oblast].filter(Boolean).join(', '))}</p>` : '')
    + (i.date ? `<p class="center">${esc(fmtDate(i.date))}</p>` : '')
    + `<div style="margin:10pt 0">${schemeSvg(s)}</div>`
    + `<p>Протяжённость: <span class="b">${esc(formatMeters(s.totalM))}</span>, `
    + `отметок на схеме: <span class="b">${s.marks.length}</span>.</p>`
    + '<table class="act"><tr>'
    + `<td class="val b">№</td><td class="lbl b">${esc(t('uchastok'))}</td>`
    + `<td class="val b">${esc(t('length'))}</td>`
    + '</tr>' + rows + '</table>'
    + (s.skipped.length
      ? `<p class="warn">Не отнесены к трассе: ${esc(s.skipped.join('; '))}. `
        + 'Проверьте координаты — на схему они не попали.</p>'
      : '')
    + '<table class="sign"><tr>'
    + `<td class="s">${esc(t('composed'))}<br/>_______________ / ${esc(i.contractor || '')}</td>`
    + `<td class="s">${esc(t('checked'))}<br/>_______________ / ${esc(i.customer || '')}</td>`
    + '</tr></table>';
}

export function schemeDocPage(i: SchemeDocInput): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><title>Исполнительная схема — ${esc(i.scheme.route)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>@page { size: A4 landscape; margin: 1.2cm; } body { margin: 0; }
${ACT_DOC_CSS}</style></head>
<body class="act-doc">${schemeDocHtml(i)}</body></html>`;
}

/**
 * Схема приложением к акту.
 *
 * Её всё равно прикладывают — просто отдельным файлом, который по
 * дороге теряется: акт дошёл, схема осталась в папке «Загрузки». Кладём
 * её тем же листом, с новой страницы и с надписью, к чему это
 * приложение.
 *
 * Лист остаётся книжным: акт печатают книжным, и разворачивать одну
 * страницу посреди документа значит получить её вверх ногами в
 * скоросшивателе. Схема по ширине листа читается и так.
 */
export function schemeAttachmentHtml(
  i: SchemeDocInput,
  actNumber?: string,
  width = 640,
): string {
  const s = i.scheme;
  const rows = s.spans.map((sp, n) => '<tr>'
    + `<td class="val">${n + 1}</td>`
    + `<td class="lbl">${esc(sp.from)} — ${esc(sp.to)}</td>`
    + `<td class="val">${Math.round(sp.meters).toLocaleString('ru')}</td>`
    + '</tr>').join('');

  const t = (key: string) => term(key as never, i.lang ?? 'off', i.terms ?? {});
  return '<div style="page-break-before:always">'
    // «к акту» — падеж, а не слово из словаря: собирать фразу из
    // терминов значит получить «Приложение акт № 14».
    + `<p class="right">${esc(t('attachment'))}`
    + `${actNumber ? ` к акту № ${esc(actNumber)}` : ''}</p>`
    + `<h1>${esc(t('scheme'))}</h1>`
    + `<p class="obj">${esc(s.route)}</p>`
    + `<div style="margin:8pt 0">${schemeSvg(s, width)}</div>`
    + `<p>Протяжённость: <span class="b">${esc(formatMeters(s.totalM))}</span>, `
    + `отметок на схеме: <span class="b">${s.marks.length}</span>.</p>`
    + '<table class="act"><tr>'
    + '<td class="val b">№</td><td class="lbl b">Участок</td><td class="val b">Длина, м</td>'
    + '</tr>' + rows + '</table>'
    + (s.skipped.length
      ? `<p class="warn">Не отнесены к трассе: ${esc(s.skipped.join('; '))}.</p>`
      : '')
    + '</div>';
}

/**
 * Вложить схему в готовый документ.
 *
 * Врезаемся перед закрытием тела: так приложение оказывается внутри
 * того же файла, с теми же стилями и той же нумерацией страниц.
 */
export function withSchemeAttached(
  documentHtml: string,
  i: SchemeDocInput,
  actNumber?: string,
): string {
  const attachment = schemeAttachmentHtml(i, actNumber);
  const close = documentHtml.lastIndexOf('</body>');
  if (close < 0) return documentHtml + attachment;
  return documentHtml.slice(0, close) + attachment + documentHtml.slice(close);
}

export function schemeFileName(route: string, date?: string): string {
  const safe = route.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'трасса';
  return `Исполнительная схема ${safe} ${date || new Date().toISOString().slice(0, 10)}.doc`;
}
