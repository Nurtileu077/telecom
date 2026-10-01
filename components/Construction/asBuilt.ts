import type { SiteObject, PlanRoute } from '@/types/construction';
import { SITE_OBJECT_SPECS } from '@/types/construction';
import { esc, ACT_DOC_CSS, fmtDate } from './actDocument';
import { nearestOnRoute } from './measureTool';
import { routeLengthM } from './routeProgress';
import { formatMeters } from './mapDecor';
import { term, type Bilingual, type TermPair } from './bilingual';
import { normName } from './areaImport';
import { routeEnds } from './routeStyle';

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
  /**
   * Насколько отметка отстоит от линии — её сняли не на самой трассе.
   * Есть только тогда, когда смещение больше погрешности телефона и его
   * надо показать на листе.
   */
  offsetM?: number;
  /**
   * Метры по схеме: сумма пролётов до этой отметки.
   *
   * Совпадает с `atM`, пока пролёты считаются по координатам. Где пролёт
   * померили на объекте, отметка встаёт по замеру: иначе под муфтой
   * стояло бы «1,66 км», а под пролётом к ней — «2 000 м», и лист спорил
   * бы сам с собой.
   */
  chainM: number;
  /** Пролёт от предыдущей отметки по замеру на объекте — из карточки. */
  spanM?: number;
  /** Чем мерили этот пролёт. */
  spanBy?: string;
}

/**
 * Насколько замер может разойтись с координатами без вопросов.
 *
 * Две точки телефона дают до 50 м, а кабель по метке длиннее линии на
 * изгибы и запасы — на несколько процентов. Сверх этого расхождение
 * значит, что неверна запись или точка, и это надо увидеть до подписи.
 */
export function spanTolerance(measuredM: number): number {
  return Math.max(50, measuredM * 0.05);
}

/**
 * С какого смещения объект называем «в стороне».
 *
 * Телефон в поле даёт точку с погрешностью до 25 м: ближе — это шум
 * приёмника, и подписывать каждую муфту «в 12 м от оси» значит залить
 * схему оговорками, которые ничего не говорят. Дальше — это уже место:
 * муфту поставили у дороги, а не на трассе, или точку сняли не там.
 */
export const OFFSET_NOTE_M = 25;

export interface Scheme {
  route: string;
  totalM: number;
  marks: SchemeMark[];
  /**
   * Расстояния между соседними отметками.
   *
   * Номера отметок хранятся рядом с длиной нарочно. Пролёты короче
   * метра мы пропускаем — две отметки в одной точке пролётом не
   * считаются, — и после первого же пропуска порядковый номер пролёта
   * перестаёт совпадать с номером отметки. Рисунок, который считал бы
   * их равными, подписал бы длины на пролёт левее.
   */
  spans: {
    from: string; to: string; meters: number; fromIndex: number; toIndex: number;
    /**
     * Один из концов снят в стороне от линии: длина посчитана по его
     * проекции на трассу и верна не точнее этого смещения. В ведомости
     * такой пролёт идёт со знаком «≈», а не с точностью до метра.
     */
    approx?: boolean;
    /**
     * Пролёт померили на объекте: длина взята из карточки, а не из
     * координат. Координатная длина остаётся рядом для сверки.
     */
    measured?: { by?: string; mapM: number };
    /** Замер и координаты расходятся больше, чем объясняет погрешность. */
    mismatch?: boolean;
  }[];
  /** Сумма пролётов: с замерами она может отличаться от длины линии. */
  chainTotalM: number;
  /** Объекты, которые к трассе не отнеслись: слишком далеко. */
  skipped: string[];
  /**
   * Объекты без участка, стоящие у самой линии.
   *
   * Чьи они — не знаем: могут быть наши, могут быть соседей. Молча
   * взять их — значит однажды подписать чужую муфту, молча выбросить —
   * потерять свою. Называем и просим указать участок.
   */
  unassigned: string[];
}

export interface SchemeOptions {
  /** Дальше этого от линии объект к ней не относится. */
  maxOffsetM?: number;
  from?: string;
  to?: string;
  /** Объекты без участка: в схему не берём, но называем те, что у линии. */
  unassigned?: SiteObject[];
  /**
   * Сёла журнала (`placeNames`): по ним узнаём концы в названии трассы.
   * Те же, что у карты, — иначе одно название разберётся по-разному.
   */
  places?: Set<string>;
}

/**
 * Какие объекты идут в схему участка.
 *
 * Только свои. Раньше участок без своих объектов получал в схему все
 * объекты журнала, и чужие муфты вставали на его трассу с правдоподобным
 * метражом — заказчик подписывал схему с отметками соседнего села.
 */
export function schemeObjectsFor(
  objects: SiteObject[],
  uchastok: string | undefined,
): { own: SiteObject[]; unassigned: SiteObject[] } {
  const key = normName(uchastok ?? '');
  const own = key ? objects.filter((o) => normName(o.uchastok ?? '') === key) : [];
  const unassigned = objects.filter((o) => !normName(o.uchastok ?? ''));
  return { own, unassigned };
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
      chainM: hit.atM,
      label: o.name || SITE_OBJECT_SPECS[o.kind].label,
      kind: o.kind,
      offsetM: hit.deviationM > OFFSET_NOTE_M ? hit.deviationM : undefined,
      spanM: o.spanM !== undefined && Number.isFinite(o.spanM) && o.spanM > 0 ? o.spanM : undefined,
      spanBy: o.spanM ? o.spanBy?.trim() || undefined : undefined,
    });
  }

  const unassigned: string[] = [];
  for (const o of opts.unassigned ?? []) {
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
    const hit = nearestOnRoute({ lat: o.lat, lon: o.lon }, route.coords);
    if (!hit || hit.deviationM > maxOffset) continue;
    unassigned.push(o.name || SITE_OBJECT_SPECS[o.kind].label);
  }

  // Концы трассы — всегда отметки: с них схему и читают. Подписи — те
  // же, что у концов линии на карте. Раньше схема резала название по
  // тире сама: карта и лист называли концы «ОМ — Акбеит» по-разному, а
  // «Кызыл-Жар» превращался в конец «Жар».
  const ends = routeEnds(route, opts.places ?? new Set());
  const startLabel = opts.from || ends.from || 'Начало';
  const endLabel = opts.to || ends.to || 'Конец';
  marks.push({ atM: 0, chainM: 0, label: startLabel, kind: 'start' });
  marks.push({ atM: totalM, chainM: totalM, label: endLabel, kind: 'end' });

  marks.sort((a, b) => a.atM - b.atM);

  /**
   * Пролёты.
   *
   * Записанный в карточке пролёт — это «от предыдущей отметки схемы до
   * этого объекта»: от соседней муфты, ККС или начала трассы, считая в
   * ту сторону, куда идёт трасса. Такой пролёт меряли на земле — метками
   * трубы или кабеля, — и он точнее разницы двух точек телефона, каждая
   * из которых ±25 м. Поэтому в ведомость идёт он, а координатная длина
   * остаётся рядом — для сверки.
   */
  const spans: Scheme['spans'] = [];
  for (let i = 1; i < marks.length; i += 1) {
    const mapM = marks[i].atM - marks[i - 1].atM;
    const measuredM = marks[i].spanM;
    if (measuredM !== undefined) {
      spans.push({
        from: marks[i - 1].label,
        to: marks[i].label,
        meters: measuredM,
        fromIndex: i - 1,
        toIndex: i,
        measured: { by: marks[i].spanBy, mapM },
        mismatch: Math.abs(measuredM - mapM) > spanTolerance(measuredM) ? true : undefined,
      });
    } else if (mapM >= 1) {
      spans.push({
        from: marks[i - 1].label,
        to: marks[i].label,
        meters: mapM,
        fromIndex: i - 1,
        toIndex: i,
        approx: marks[i - 1].offsetM !== undefined || marks[i].offsetM !== undefined
          ? true : undefined,
      });
    }
    // Отметка встаёт по сумме пролётов до неё: с замером — по замеру.
    const span = spans[spans.length - 1];
    marks[i].chainM = marks[i - 1].chainM
      + (span && span.toIndex === i ? span.meters : Math.max(0, mapM));
  }

  const chainTotalM = marks.length ? marks[marks.length - 1].chainM : 0;
  return { route: route.name, totalM, marks, spans, chainTotalM, skipped, unassigned };
}

/** Пролёты по замеру, которые спорят с координатами. */
export function spanMismatches(s: Scheme): string[] {
  return s.spans
    .filter((sp) => sp.mismatch && sp.measured)
    .map((sp) => `${sp.from} — ${sp.to}: замер ${Math.round(sp.meters).toLocaleString('ru')} м, `
      + `по координатам ${Math.round(sp.measured!.mapM).toLocaleString('ru')} м`);
}

/** Подпись строки ведомости: откуда и куда, и чем мерили, если мерили. */
function spanLabel(sp: Scheme['spans'][number]): string {
  const base = `${esc(sp.from)} — ${esc(sp.to)}`;
  if (!sp.measured) return base;
  return `${base} <span class="cap">(замер${sp.measured.by ? `: ${esc(sp.measured.by)}` : ''})</span>`;
}

/**
 * «Протяжённость» листа.
 *
 * Длина линии и сумма пролётов с замерами — разные числа, и оба верны
 * по-своему. Пишем оба с подписью, откуда каждое, а не выбираем молча.
 */
function lengthLine(s: Scheme): string {
  const base = `Протяжённость: <span class="b">${esc(formatMeters(s.totalM))}</span>`;
  const byChain = Math.abs(s.chainTotalM - s.totalM) >= 1
    ? ` по трассе, <span class="b">${esc(formatMeters(s.chainTotalM))}</span> по пролётам с замерами`
    : '';
  return `<p>${base}${byChain}, отметок на схеме: <span class="b">${s.marks.length}</span>.</p>`;
}

/** Отметки, снятые в стороне от линии: «Муфта №3 — 90 м». */
export function displacedMarks(s: Scheme): string[] {
  return s.marks
    .filter((m) => m.offsetM !== undefined)
    .map((m) => `${m.label} — ${Math.round(m.offsetM!)} м`);
}

/** Длина пролёта в ведомость: приблизительная — со знаком, а не до метра. */
function spanCell(sp: Scheme['spans'][number]): string {
  const v = Math.round(sp.meters).toLocaleString('ru');
  return sp.approx ? `≈ ${v}` : v;
}

/**
 * Оговорки под схемой.
 *
 * Всё, чего на рисунке не видно, а заказчик должен знать до подписи:
 * что стоит не на линии, что не попало, чьё неизвестно.
 */
function schemeNotes(s: Scheme, full: boolean): string {
  const out: string[] = [];
  const displaced = displacedMarks(s);
  if (displaced.length) {
    out.push(`<p class="warn">Сняты в стороне от линии: ${esc(displaced.join('; '))}. `
      + 'На схеме они стоят на трассе по проекции, и пролёты к ним (≈) верны не точнее '
      + 'этого смещения. Проверьте координаты или переснимите точку.</p>');
  }
  if (s.skipped.length) {
    out.push(`<p class="warn">Не отнесены к трассе: ${esc(s.skipped.join('; '))}.`
      + (full ? ' Проверьте координаты — на схему они не попали.' : '') + '</p>');
  }
  if (s.unassigned.length) {
    out.push(`<p class="warn">У линии есть объекты без участка: ${esc(s.unassigned.join('; '))}. `
      + 'В схему не взяты — укажите у них участок.</p>');
  }
  const mismatched = spanMismatches(s);
  if (mismatched.length) {
    out.push(`<p class="warn">Замер и координаты расходятся: ${esc(mismatched.join('; '))}. `
      + 'Проверьте запись в карточке объекта или его точку.</p>');
  }
  if (s.spans.some((sp) => sp.measured)) {
    out.push('<p class="cap">«Замер» — пролёт по записи в карточке объекта; '
      + 'остальные длины — по координатам вдоль трассы.</p>');
  }
  if (s.marks.length <= 2 && s.skipped.length === 0) {
    out.push('<p>Объектов участка в журнале нет: на схеме только концы трассы.</p>');
  }
  return out.join('');
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
  // Отметки стоят по метрам схемы, а не по координатам: где пролёт
  // померили, рисунок должен сходиться с подписью под ним.
  const scale = s.chainTotalM;
  const x = (m: number) => Math.round(
    (pad + (scale > 0 ? (m / scale) * line : 0)) * 100,
  ) / 100;

  // Подписи чередуем сверху и снизу: на плотном участке они иначе
  // наезжают друг на друга и не читаются.
  const marks = s.marks.map((m, i) => {
    const style = MARK_STYLE[m.kind];
    const cx = x(m.chainM);
    const up = i % 2 === 0;
    const labelY = up ? y - 26 : y + 38;
    const tickY1 = up ? y - 10 : y + 10;
    const tickY2 = up ? y - 18 : y + 18;

    // Снятая в стороне отметка рисуется пустой: на оси её нет, она
    // лишь спроецирована туда, и на бумаге это должно быть видно без
    // цвета. Рядом — на сколько она в стороне.
    const off = m.offsetM !== undefined;
    const fill = off ? '#ffffff' : style.fill;
    const stroke = off ? style.fill : '#fff';
    const glyph = style.shape === 'circle'
      ? `<circle cx="${cx}" cy="${y}" r="7" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
      : style.shape === 'square'
        ? `<rect x="${cx - 6}" y="${y - 6}" width="12" height="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
        : `<path d="M ${cx - 8} ${y + 7} L ${cx - 8} ${y - 2} L ${cx} ${y - 10} L ${cx + 8} ${y - 2} L ${cx + 8} ${y + 7} Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    const offNote = off
      ? `<text x="${cx}" y="${labelY + (up ? -26 : 26)}" text-anchor="middle" font-size="10" fill="#b91c1c">`
        + `в стороне ${Math.round(m.offsetM!)} м</text>`
      : '';

    return `<g>
      <line x1="${cx}" y1="${tickY1}" x2="${cx}" y2="${tickY2}" stroke="#94a3b8" stroke-width="1"/>
      ${glyph}
      <text x="${cx}" y="${labelY}" text-anchor="middle" font-size="12" fill="#0f172a">${esc(m.label)}</text>
      <text x="${cx}" y="${labelY + (up ? -13 : 13)}" text-anchor="middle" font-size="10" fill="#64748b">${esc(formatMeters(m.chainM))}</text>
      ${offNote}
    </g>`;
  }).join('');

  // Длины пролётов — под линией, по центру каждого. Отметки берём по
  // номеру из самого пролёта, а не по его порядку: пропущенные пролёты
  // сдвинули бы все подписи левее.
  const spans = s.spans.map((sp) => {
    const a = s.marks[sp.fromIndex];
    const b = s.marks[sp.toIndex];
    if (!a || !b) return '';
    const cx = (x(a.chainM) + x(b.chainM)) / 2;
    return `<text x="${cx}" y="${y + 20}" text-anchor="middle" font-size="10" fill="#334155">`
      + `${sp.approx ? '≈ ' : ''}${esc(formatMeters(sp.meters))}${sp.measured ? ' (замер)' : ''}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 230" width="${width}" height="230">
    <rect x="0" y="0" width="${width}" height="230" fill="#ffffff"/>
    <line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="#0f172a" stroke-width="3"/>
    ${spans}
    ${marks}
    <text x="${pad}" y="210" font-size="11" fill="#64748b">${esc(s.route)} · ${esc(formatMeters(s.totalM))}${
  Math.abs(s.chainTotalM - s.totalM) >= 1
    ? ` по трассе · ${esc(formatMeters(s.chainTotalM))} по пролётам с замерами` : ''}</text>
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
    + `<td class="lbl">${spanLabel(sp)}</td>`
    + `<td class="val">${spanCell(sp)}</td>`
    + '</tr>').join('');

  return `<h1>${esc(t('scheme'))}</h1>`
    + (i.number ? `<p class="center">№ ${esc(i.number)}</p>` : '')
    + `<p class="obj">${esc(s.route)}</p>`
    + (i.oblast || i.rayon
      ? `<p class="cap">${esc([i.rayon, i.oblast].filter(Boolean).join(', '))}</p>` : '')
    + (i.date ? `<p class="center">${esc(fmtDate(i.date))}</p>` : '')
    + `<div style="margin:10pt 0">${schemeSvg(s)}</div>`
    + lengthLine(s)
    + '<table class="act"><tr>'
    + `<td class="val b">№</td><td class="lbl b">${esc(t('uchastok'))}</td>`
    + `<td class="val b">${esc(t('length'))}</td>`
    + '</tr>' + rows + '</table>'
    + schemeNotes(s, true)
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
    + `<td class="lbl">${spanLabel(sp)}</td>`
    + `<td class="val">${spanCell(sp)}</td>`
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
    + lengthLine(s)
    + '<table class="act"><tr>'
    + '<td class="val b">№</td><td class="lbl b">Участок</td><td class="val b">Длина, м</td>'
    + '</tr>' + rows + '</table>'
    + schemeNotes(s, false)
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
