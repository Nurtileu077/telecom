import { LayMethod, Deviation, MobileGroupProtocol } from '@/types/construction';
import {
  SectionActTotals, SectionActVariant, SectionActManual, actKm,
  ACT_MATERIALS_DEFAULT, ACT_NEXT_WORKS_DEFAULT, ACT_GEN_CONTRACTOR_DEFAULT,
} from './sectionAct';

/**
 * Закрывающие документы — по бланкам заказчика, слово в слово.
 *
 * Акт, набранный «по смыслу», на приёмке возвращают: там сверяют не цифры,
 * а формулировки. Поэтому здесь воспроизведены два настоящих бланка —
 * АСР (СН РК 1.03-00-2022) и ОСР (Приложение 12 к ОДС/П-14-4-4-01) — с их
 * заголовками, подстрочными пояснениями в скобках, порядком пунктов и
 * подписями. Всё, что в бланке напечатано типографски, здесь константа;
 * всё, что вписывают от руки, — поле.
 *
 * Таблица у обоих бланков одна и та же, 17 строк, различается только
 * первая: в ОСР это «Защитной МКТ», в АСР — «Защитной полиэтиленовой
 * трубы». Считает её одна функция и для экрана, и для файла: экран здесь
 * не пересказ документа, а он сам — тот же HTML.
 *
 * Файл — Word-совместимый HTML: Word открывает его как документ и даёт
 * править, а библиотеки на полтора мегабайта в поле не появляется.
 */

export type ActKind = 'ASR' | 'OSR';

export const ACT_KIND_SPECS: Record<ActKind, {
  short: string;
  /** Что напечатано в правом верхнем углу бланка. */
  basis: string;
  /** Заголовок листа. У АСР в него вписывают номер — см. actHeading. */
  title: string;
}> = {
  ASR: {
    short: 'АСР',
    basis: 'СН РК 1.03-00-2022',
    title: 'Акт № ____освидетельствования скрытых работ',
  },
  OSR: {
    short: 'ОСР',
    basis: 'Приложение 12 к\nОДС/П-14-4-4-01',
    title: 'Освидетельствование скрытых работ по прокладке защитной '
      + 'полиэтиленовой трубы и предупредительной ленты',
  },
};

/** Заголовок листа с подставленным номером акта, если он уже присвоен. */
export function actHeading(kind: ActKind, fields: SectionActManual): string {
  if (kind !== 'ASR') return ACT_KIND_SPECS.OSR.title;
  const n = (fields.actNumber ?? '').trim();
  return n
    ? `Акт № ${n} освидетельствования скрытых работ`
    : ACT_KIND_SPECS.ASR.title;
}

// ── Таблица ──────────────────────────────────────────────────────────────────

/** Ключ строки — чтобы искать её в коде и в тестах, не цепляясь за текст. */
export type ActRowKey =
  | 'total' | 'method' | 'gnbPet63' | 'gnbPet110' | 'openPet63' | 'openSteel63'
  | 'depth' | 'depthFact' | 'kits' | 'tape' | 'crossings' | 'recult' | 'pavement';

export interface ActRow {
  key: ActRowKey;
  label: string;
  value: string;
  unit?: string;
  /** Продолжение предыдущей строки: в бланке у неё нет подписи слева. */
  cont?: boolean;
  /** Значение введено руками — в журнале такого показателя нет. */
  manual?: boolean;
}

/** Порядок способов в бланке отличается от порядка колонок в журнале. */
export const ACT_METHOD_ORDER: LayMethod[] = [
  'кабелеукладчик', 'вручную', 'экскаватор', 'сущ_канализация', 'бар',
];

/** Формулировки бланка — они не совпадают с подписями в журнале. */
export const ACT_METHOD_LABEL: Record<LayMethod, string> = {
  'кабелеукладчик': 'Кабелеукладчиком с двукратной пропоркой __ категорий',
  'вручную': 'Вручную __ категорий',
  'экскаватор': 'Экскаватором __ категорий',
  'сущ_канализация': 'По существующей канализации',
  'бар': 'Бар',
};

export function methodActLabel(m: string): string {
  return ACT_METHOD_LABEL[m as LayMethod] ?? m;
}

/** Доля показателя, приходящаяся на этот акт по длине. */
export function share(value: number, total: number, part: number): number {
  if (!total) return 0;
  return Math.round((value * part) / total);
}

export function fmtDepth(m: number): string {
  return String(m).replace('.', ',');
}

export function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru');
}

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «10» сентября 2026 г. — так дата стоит в шапке АСР. */
export function ruDateWords(iso?: string): string {
  if (!iso) return '«___» ____________ 20___ г.';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '«___» ____________ 20___ г.';
  return `«${String(d.getUTCDate()).padStart(2, '0')}» ${MONTHS_RU[d.getUTCMonth()]} ${d.getUTCFullYear()} г.`;
}

/** В журнале район пишут и со словом «район», и без — не удваиваем. */
export function withRayonWord(rayon: string): string {
  const r = rayon.trim();
  return /район/i.test(r) ? r : `${r} район`;
}

/** В шапке ОСР порядок обратный: «Область Акмолинская, район Бурабайский». */
export function bareOblast(s?: string): string {
  return (s ?? '').replace(/\s*област[ьи]\s*/gi, ' ').trim();
}

export function bareRayon(s?: string): string {
  return (s ?? '').replace(/\s*район[а-я]*\s*/gi, ' ').trim();
}

function capFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Строки таблицы акта — единственная версия, общая для экрана и файла.
 */
export function actRows(
  totals: SectionActTotals,
  v: SectionActVariant,
  fields: SectionActManual,
  kind: ActKind = 'OSR',
): ActRow[] {
  const rows: ActRow[] = [{
    key: 'total',
    label: kind === 'ASR'
      ? '1.Защитной полиэтиленовой трубы проложено всего:'
      : '1.Защитной МКТ проложено всего:',
    value: actKm(v.lengthM), unit: 'км',
  }];

  for (const m of ACT_METHOD_ORDER) {
    rows.push({
      key: 'method',
      label: ACT_METHOD_LABEL[m],
      value: actKm(share(totals.byMethod[m], totals.totalM, v.lengthM)),
      unit: 'км',
    });
  }

  rows.push(
    {
      key: 'gnbPet63',
      label: 'Переходы методом горизонтально-направленного бурения с защитой ПЭТ-63мм',
      value: actKm(fields.gnbPet63M ?? 0), unit: 'км', manual: true,
    },
    {
      key: 'gnbPet110',
      label: 'Переходы методом горизонтально-направленного бурения с защитой ПЭТ-110мм',
      value: actKm(fields.gnbPet110M ?? 0), unit: 'км', manual: true,
    },
    {
      key: 'openPet63',
      label: 'Переходы открытым способом с защитой ПЭТ-63мм',
      value: actKm(fields.openPet63M ?? 0), unit: 'км', manual: true,
    },
    {
      key: 'openSteel63',
      label: 'Переходы открытым способом с защитой Ст труба -63мм',
      value: actKm(fields.openSteel63M ?? 0), unit: 'км', manual: true,
    },
    {
      key: 'depth',
      label: '2. Глубина прокладки защитной МКТ составляет',
      value: `по проекту - ${fmtDepth(v.designDepthM)} м`,
    },
    {
      key: 'depthFact', label: '', cont: true,
      value: `фактический - ${fmtDepth(v.actualDepthM)} м`,
    },
    {
      key: 'kits',
      label: '3. При прокладке использовано комплектов для сращивания защитной МКТ',
      value: String(share(totals.splicingKits, totals.totalM, v.lengthM)), unit: 'шт.',
    },
    {
      key: 'tape',
      label: '4. Прокладка предупредительной-сигнальной ленты на глубине ½ от глубины МКТ',
      value: actKm(share(totals.tapeM, totals.totalM, v.lengthM)), unit: 'км',
    },
    {
      key: 'crossings',
      label: '5. На участке выполнено переходов (акты на скрытые работы прилагаются)',
      // Переходы целиком относятся к основному акту: делить прокол между
      // глубинами нечем, а приписывать его отклонению — неправда.
      value: String(v.isMain ? totals.crossingsTotal : 0), unit: 'пер.',
    },
    {
      key: 'recult',
      label: '6. Рекультивация (выполнена, не выполнена)',
      value: capFirst(fields.recultivation ?? ''), manual: true,
    },
    {
      key: 'pavement',
      label: '7. Восстановление а/бетонных покрытий (выполнено, не выполнено, не предусматривается проектом)',
      value: capFirst(fields.pavement ?? ''), manual: true,
    },
  );

  return rows;
}

// ── Отклонения ───────────────────────────────────────────────────────────────

/** Пункт об отклонениях от ПСД: в бланке он один и тот же в обоих актах. */
export function deviationSummary(v: SectionActVariant): string {
  if (v.isMain) return 'нет';
  const depth = `допущено уменьшение глубины заложения до ${fmtDepth(v.actualDepthM)} м `
    + `вместо проектной ${fmtDepth(v.designDepthM)} м на протяжении ${actKm(v.lengthM)} км`;
  const reasons = [...new Set(v.deviations.map((d: Deviation) => d.reason).filter(Boolean))];
  return reasons.length ? `${depth} (${reasons.join(', ')})` : depth;
}

/** «№17 от 12.09.2026» либо пустой бланк с прочерками. */
export function protocolRef(v: SectionActVariant): string {
  const p: MobileGroupProtocol | undefined = v.protocols[0];
  if (!p?.number?.trim()) return '№______ от _______';
  return `№${p.number} от ${fmtDate(p.date)}`;
}

// ── Разметка ─────────────────────────────────────────────────────────────────

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Пустая строка бланка: в оригинале это подчёркивания, а не рамка. */
function blank(n: number): string {
  return '_'.repeat(n);
}

/** Значение или прочерк нужной длины — так бланк остаётся бланком. */
function or(v: string | undefined, n: number): string {
  const s = (v ?? '').trim();
  return s ? esc(s) : blank(n);
}

export interface ActDocInput {
  kind: ActKind;
  uchastok: string;
  oblast?: string;
  rayon?: string;
  /** Подрядчик по документам — тот, от чьего имени сдаются работы. */
  contractor?: string;
  /** Кто фактически вёл работы, если это не подрядчик по документам. */
  performer?: string;
  dateFrom?: string;
  dateTo?: string;
  totals: SectionActTotals;
  variants: SectionActVariant[];
  fields: SectionActManual;
}

function actTable(rows: ActRow[]): string {
  const body = rows.map((r) => `
      <tr>
        ${r.cont
          ? '<td class="lbl"></td>'
          : `<td class="lbl">${esc(r.label)}</td>`}
        <td class="val"${r.unit ? '' : ' colspan="2"'}>${esc(r.value)}</td>
        ${r.unit ? `<td class="unit">${esc(r.unit)}</td>` : ''}
      </tr>`).join('');
  return `<table class="act">${body}
    </table>`;
}

/** Участок ВОЛС: «от М№1 до здания АТС п. Мадениет, Зеленоборский с.о.» */
export function volsTitle(input: ActDocInput): string {
  const f = input.fields;
  const from = (f.volsFrom ?? '').trim();
  const to = (f.volsTo ?? '').trim();
  const so = (f.selsovet ?? '').trim();
  const tail = so ? `, ${so} с.о.` : '';
  if (from && to) return `от ${from} до ${to}${tail}`;
  if (to) return `до ${to}${tail}`;
  return `${input.uchastok}${tail}`;
}

/** АСР: «наименование и место расположения объекта». */
export function objectTitle(input: ActDocInput): string {
  const manual = (input.fields.objectName ?? '').trim();
  if (manual) return manual;
  const place = [input.oblast, input.rayon ? withRayonWord(input.rayon) : '']
    .filter(Boolean).join(', ');
  const so = (input.fields.selsovet ?? '').trim();
  return [
    'Обеспечение высокоскоростным доступом к сети Интернет Республики Казахстан',
    volsTitle({ ...input, fields: { ...input.fields, selsovet: '' } }),
  ].join(' ') + (place ? `, ${place}` : '') + (so ? `, с.о.${so}` : '');
}

const CAP_FIO = '(фамилия, имя, отчество (при наличии), организация, должность)';

function asrSheet(input: ActDocInput, v: SectionActVariant): string {
  const f = input.fields;
  const spec = ACT_KIND_SPECS.ASR;

  return `
      <p class="right">${esc(spec.basis)}</p>
      <h1>${esc(actHeading('ASR', f))}</h1>
      <p class="center">г. ${or(f.city, 12)} ${esc(ruDateWords(f.actDate))}</p>
      <p class="obj">${esc(objectTitle(input))}</p>
      <p class="cap">(наименование и место расположения объекта)</p>
      <p>Мы, нижеподписавшиеся:</p>
      <p>представителя подрядчика (генподрядчика) работ ${
        or(f.genContractor ?? ACT_GEN_CONTRACTOR_DEFAULT, 20)}${blank(21)}</p>
      <p class="rule">${blank(81)}</p>
      <p class="cap">${CAP_FIO}</p>
      <p>представителя технического надзора заказчика</p>
      <p class="rule">${blank(81)}</p>
      <p class="cap">${CAP_FIO}</p>
      <p>представителя технического надзора заказчика</p>
      <p class="rule">${blank(81)}</p>
      <p class="cap">${CAP_FIO}</p>
      <p>представителя проектной организации (в случаях осуществления авторского надзора проектной организацией)</p>
      <p class="rule">${blank(81)}</p>
      <p class="cap">${CAP_FIO}</p>
      <p>а также представителей, дополнительно участвующих в освидетельствовании:</p>
      ${f.extraParticipants?.trim() ? `<p>${esc(f.extraParticipants.trim())}</p>` : ''}
      <p class="rule">${blank(81)}</p>
      <p class="cap">${CAP_FIO}</p>
      <p>Произвела осмотр работ, выполненных ${
        esc(input.performer || input.contractor || blank(30))}</p>
      <p class="cap">наименование подрядчика (генподрядчика)</p>
      <p>и составила настоящий акт о нижеследующим:</p>
      <p>К освидетельствованию предъявлены следующие работы</p>
      ${actTable(actRows(input.totals, v, f, 'ASR'))}
      <p class="cap">(наименование скрытых работ)</p>
      <p>2. Работы выполнены по проектно-сметной документации ${or(f.psd, 39)}</p>
      <p class="cap">(наименование проектной организации, № чертежей и дата их составления или
        идентификационные параметры эскиза/записи в журнале авторского надзора)</p>
      <p>3. При выполнении работ применены ${esc(f.materials ?? ACT_MATERIALS_DEFAULT)}</p>
      <p class="cap">(наименование материалов, конструкций, изделий со ссылкой на сертификаты
        или другие документы, подтверждающие качество и сертификаты о происхождении товара
        формы СТ-KZ и индустриальные сертификаты)</p>
      <p>Исполнителем работ предъявлены следующие дополнительные доказательства соответствия
        работ предъявляемым к ним требованиям, приложенные (не приложенные) к настоящему акту</p>
      <p class="rule">${blank(81)}</p>
      <p class="cap">(исполнительные схемы и чертежи, заключения лаборатории и так далее)</p>
      <p>4. При выполнении работ отсутствуют (или допущены) отклонения от проектно-сметной
        документации ${esc(deviationSummary(v))}${
          v.isMain ? '' : `. Протокол Мобильной группы ${esc(protocolRef(v))}`}</p>
      <p class="cap">(при наличии отклонений указывается, кем согласовано, № чертежей и дата согласования)</p>
      <p>5. Даты: начала работ ${esc(fmtDate(input.dateFrom))}</p>
      <p class="ind">окончания работ ${esc(fmtDate(input.dateTo))}</p>
      <p class="center b">Решение комиссии</p>
      <p>Работы выполнены в соответствии с проектно-сметной документацией и требованиями
        действующих нормативных документов.</p>
      <p>На основании изложенного разрешается производство последующих работ по устройству
        (монтажу) ${esc(f.nextWorks ?? ACT_NEXT_WORKS_DEFAULT)}${blank(28)}</p>
      <p class="cap">(наименование последующих работ и конструкций)</p>
      ${v.blocked
        ? '<p class="warn">Протокол мобильной группы не оформлен — акт не подлежит подписанию.</p>'
        : ''}
      <table class="sign">
        <tr><td>Представитель<br/>подрядчика (генподрядчика)</td><td class="s">${blank(18)}<br/><span class="cap">(подпись)</span></td></tr>
        <tr><td>Представитель<br/>Технического надзора<br/>заказчика</td><td class="s">${blank(18)}<br/><span class="cap">(подпись)</span></td></tr>
        <tr><td>Представитель<br/>Технического надзора<br/>заказчика</td><td class="s">${blank(18)}<br/><span class="cap">(подпись)</span></td></tr>
        <tr><td>Представителя авторского надзора</td><td class="s">${blank(18)}<br/><span class="cap">(подпись)</span></td></tr>
        <tr><td>Дополнительные участники:<br/>фамилия, имя, отчество (при его наличии)</td><td class="s">${blank(18)}<br/><span class="cap">(подпись)</span></td></tr>
      </table>`;
}

function osrSheet(input: ActDocInput, v: SectionActVariant): string {
  const f = input.fields;
  const spec = ACT_KIND_SPECS.OSR;
  const oblast = bareOblast(input.oblast);
  const rayon = bareRayon(input.rayon);

  return `
      <p class="right">${esc(spec.basis).replace(/\n/g, '<br/>')}</p>
      <h1>${esc(spec.title)}</h1>
      <p>Область ${or(oblast, 16)}, район ${or(rayon, 16)}</p>
      <p>Участок ВОЛС: ${esc(volsTitle(input))}</p>
      <p class="cap">(наименование участка ВОЛС)</p>
      <p>1. Прокладка защитной полиэтиленовой трубы и предупредительной ленты</p>
      <p class="cap">(наименование скрытых работ)</p>
      ${actTable(actRows(input.totals, v, f, 'OSR'))}
      <p>Глубина прокладки защитной полиэтиленовой трубы составляет по проекту ${
        esc(fmtDepth(v.designDepthM))} м, фактически ${esc(fmtDepth(v.actualDepthM))} м;</p>
      <p>Обваловка (выполнено, не выполнено, предусмотрено / не предусмотрено) ${
        or(f.obvalovka, 12)};</p>
      <p>Восстановление, а/бетонных покрытий (выполнено, не выполнено, выполнено частично,
        не требуется, не предусматривается проектом) ${or(f.pavement, 12)};</p>
      <p>Установлено идентификационных столбиков ${
        f.markerPosts === undefined ? blank(4) : esc(String(f.markerPosts))} шт.</p>
      <p>Установлено шаровых маркеров ${
        f.ballMarkers === undefined ? blank(4) : esc(String(f.ballMarkers))} шт.</p>
      <p class="ind">2. При выполнении работ применены:</p>
      <p class="ind">- ${esc(f.materials ?? ACT_MATERIALS_DEFAULT)}</p>
      <p>3. При выполнении допущены отклонения от проектно-сметной документации ${
        esc(deviationSummary(v))}.</p>
      <p>Протокол Мобильной группы ${esc(v.isMain ? '№______ от _______' : protocolRef(v))}</p>
      <p>4. Дата начала работ:${
        input.dateFrom ? ` ${esc(fmtDate(input.dateFrom))} ` : blank(9)} года, окончания работ ${
        input.dateTo ? `${esc(fmtDate(input.dateTo))} ` : blank(9)} года</p>
      ${v.blocked
        ? '<p class="warn">Протокол мобильной группы не оформлен — акт не подлежит подписанию.</p>'
        : ''}
      <p class="mt">Начальник ПТО ТУСМ-${or(f.tusm, 4)}${blank(55)}</p>
      <p class="cap">(ФИО, подпись)</p>
      <p>Представитель технологического надзора ${blank(49)}</p>
      <p class="cap">(ФИО, подпись)</p>`;
}

/**
 * Один файл на участок: основной акт и акты по отклонениям идут листами
 * подряд. Их подписывают вместе, и разносить их по файлам — лишняя работа
 * для того, кто потом это отправляет.
 */
export function actDocBody(input: ActDocInput): string {
  return input.variants.map((v, i) => {
    const sheet = input.kind === 'ASR' ? asrSheet(input, v) : osrSheet(input, v);
    return `
    <div class="sheet"${i > 0 ? ' style="page-break-before:always"' : ''}>${sheet}
    </div>`;
  }).join('');
}

/**
 * Оформление бланка. Одно и то же и в файле, и на экране: предпросмотр,
 * который отличается от документа, ничего не проверяет.
 */
export const ACT_DOC_CSS = `
  .act-doc { font-family: "Times New Roman", serif; font-size: 12pt; color: #000; background: #fff; }
  .act-doc p { margin: 0 0 2pt; text-align: justify; line-height: 1.15; }
  .act-doc h1 { font-size: 12pt; font-weight: bold; text-align: center; margin: 8pt 0; }
  .act-doc .right { text-align: right; }
  .act-doc .center { text-align: center; }
  .act-doc .b { font-weight: bold; }
  .act-doc .ind { text-indent: 28pt; }
  .act-doc .obj { text-align: center; font-weight: bold; margin-top: 6pt; }
  .act-doc .cap { font-size: 9pt; text-align: center; margin: 0 0 6pt; }
  .act-doc .rule { word-break: break-all; }
  .act-doc .warn { font-weight: bold; margin: 6pt 0; }
  .act-doc .mt { margin-top: 18pt; }
  .act-doc table.act { width: 100%; border-collapse: collapse; margin: 6pt 0; }
  .act-doc table.act td { border: 0.5pt solid #000; padding: 2pt 4pt; font-size: 12pt; vertical-align: middle; }
  .act-doc table.act td.lbl { text-align: justify; }
  .act-doc table.act td.val { text-align: center; width: 18%; white-space: nowrap; }
  .act-doc table.act td.unit { text-align: left; width: 8%; white-space: nowrap; }
  .act-doc table.sign { width: 100%; border-collapse: collapse; margin-top: 18pt; }
  .act-doc table.sign td { padding: 4pt 4pt 10pt; vertical-align: bottom; }
  .act-doc table.sign td.s { width: 42%; text-align: center; }
`;

export function actDocHtml(input: ActDocInput): string {
  const spec = ACT_KIND_SPECS[input.kind];
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/>
<title>${esc(spec.short)} — ${esc(input.uchastok)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 1.5cm 1.5cm 1.5cm 2.5cm; }
  body { margin: 0; }
${ACT_DOC_CSS}</style></head>
<body class="act-doc">${actDocBody(input)}</body></html>`;
}

/** Имя файла: участок и вид акта — чтобы в почте было видно без открытия. */
export function actFileName(kind: ActKind, uchastok: string, date?: string): string {
  const safe = uchastok.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'участок';
  const d = date || new Date().toISOString().slice(0, 10);
  return `${ACT_KIND_SPECS[kind].short} ${safe} ${d}.doc`;
}

// ── Акт фиксации участка прокладки ───────────────────────────────────────────

export interface FixationDocInput {
  uchastok: string;
  oblast?: string;
  rayon?: string;
  contractor?: string;
  performer?: string;
  /** Начало и конец участка — как их называют, а не координатами. */
  fromPoint?: string;
  toPoint?: string;
  lengthM: number;
  designDepthM: number;
  actualDepthM: number;
  dateFrom?: string;
  dateTo?: string;
  /** Номер ТУСМ в подписи. */
  tusm?: string;
  /** Координаты концов, если их снимали. */
  coords?: { lat: number; lon: number }[];
}

/**
 * Акт фиксации участка прокладки.
 *
 * Составляется на каждый участок и подписывается подрядчиком, ТУСМ и ЦКС.
 * Всё, что в нём есть, уже записано: границы, протяжённость, фактическая
 * глубина. Набирать это заново в Word — работа, которой быть не должно.
 */
export function fixationDocHtml(i: FixationDocInput): string {
  const place = [i.oblast, i.rayon ? withRayonWord(i.rayon) : ''].filter(Boolean).join(', ');
  const deep = i.actualDepthM < i.designDepthM - 0.01;

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><title>Акт фиксации участка — ${esc(i.uchastok)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 2cm 1.5cm; }
  body { font-family: "Times New Roman", serif; font-size: 12pt; color: #000; }
  h1 { font-size: 12pt; text-align: center; margin: 10pt 0; font-weight: bold; }
  p { margin: 0 0 3pt; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0; }
  td { border: 0.5pt solid #000; padding: 3pt 5pt; font-size: 12pt; }
  td.k { width: 55%; }
  td.v { text-align: center; }
  .cap { font-size: 9pt; text-align: center; margin: 0 0 6pt; }
  .sign td { border: none; padding: 10pt 6pt 2pt; font-size: 11pt; vertical-align: bottom; }
</style></head>
<body>
  <h1>Акт фиксации участка прокладки</h1>
  <p>Объект: ${esc(i.uchastok)}${place ? `, ${esc(place)}` : ''}</p>
  <p class="cap">(наименование и место расположения участка)</p>
  <p>Подрядчик: ${esc(i.contractor ?? '____________________')}${
    i.performer && i.performer !== i.contractor ? `; работы вёл ${esc(i.performer)}` : ''}</p>
  <table>
    <tr><td class="k">Начало участка</td><td class="v">${esc(i.fromPoint || '____________')}</td></tr>
    <tr><td class="k">Конец участка</td><td class="v">${esc(i.toPoint || '____________')}</td></tr>
    <tr><td class="k">Протяжённость участка</td><td class="v">${actKm(i.lengthM)} км</td></tr>
    <tr><td class="k">Глубина заложения по проекту</td><td class="v">${fmtDepth(i.designDepthM)} м</td></tr>
    <tr><td class="k">Глубина заложения фактическая</td><td class="v">${fmtDepth(i.actualDepthM)} м</td></tr>
    <tr><td class="k">Даты производства работ</td><td class="v">${
      esc(fmtDate(i.dateFrom))} — ${esc(fmtDate(i.dateTo))}</td></tr>
  </table>
  ${i.coords?.length
    ? `<p>Координаты: ${i.coords.map((c) => `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`).join('; ')}</p>`
    : ''}
  ${deep
    ? `<p><b>Глубина заложения меньше проектной.</b> Участок закрывается отдельным
        актом освидетельствования со ссылкой на протокол мобильной группы.</p>`
    : '<p>Работы выполнены в соответствии с проектной глубиной заложения.</p>'}
  <table class="sign">
    <tr>
      <td>Представитель подрядчика<br/>________________________<br/><span class="cap">(ФИО, подпись)</span></td>
      <td>ТУСМ-${esc((i.tusm ?? '').trim() || '____')}<br/>________________________<br/><span class="cap">(ФИО, подпись)</span></td>
      <td>ЦКС<br/>________________________<br/><span class="cap">(ФИО, подпись)</span></td>
    </tr>
  </table>
</body></html>`;
}

export function fixationFileName(uchastok: string, date?: string): string {
  const safe = uchastok.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'участок';
  return `Акт фиксации ${safe} ${date || new Date().toISOString().slice(0, 10)}.doc`;
}

// ── Протокол мобильной группы ────────────────────────────────────────────────

export interface ProtocolDocInput {
  deviation: Deviation;
  protocol?: MobileGroupProtocol;
  contractor?: string;
}

/**
 * Протокол мобильной группы: документ, без которого отклонение не закрыть.
 * Выпускается по факту выезда — систему он интересует как ссылка из акта,
 * а людям нужен бланк с уже вписанными обстоятельствами.
 */
export function protocolDocHtml(input: ProtocolDocInput): string {
  const d = input.deviation;
  const p = input.protocol;
  const place = [d.oblast, d.rayon ? withRayonWord(d.rayon) : ''].filter(Boolean).join(', ');
  const isDepth = d.kind === 'depth';

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><title>Протокол мобильной группы — ${esc(d.uchastok)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 2cm 1.5cm; }
  body { font-family: "Times New Roman", serif; font-size: 11pt; color: #000; }
  h1 { font-size: 13pt; text-align: center; margin: 6pt 0 2pt; text-transform: uppercase; }
  .meta { text-align: center; font-size: 10pt; margin: 0 0 12pt; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3pt 4pt; vertical-align: top; font-size: 10.5pt; }
  td.k { width: 30%; color: #444; }
  .body { margin-top: 10pt; font-size: 11pt; text-align: justify; }
  table.sign { margin-top: 28pt; }
  table.sign td { width: 33%; font-size: 10pt; padding-right: 10pt; }
  .line { display: inline-block; border-bottom: 0.5pt solid #000; width: 90%; }
  .sub { font-size: 8pt; color: #444; }
</style></head>
<body>
  <h1>Протокол мобильной группы</h1>
  <p class="meta">
    № ${p?.number ? esc(p.number) : '______'}
    &nbsp;&nbsp;от ${p?.date ? esc(fmtDate(p.date)) : '«___» ____________ 20___ г.'}
  </p>
  <table>
    <tr><td class="k">Участок:</td><td>${esc(d.uchastok)}${place ? `, ${esc(place)}` : ''}</td></tr>
    <tr><td class="k">КАТО:</td><td>${esc(d.kato || '—')}</td></tr>
    <tr><td class="k">Подрядчик:</td><td>${esc(input.contractor ?? d.contractor ?? '____________________')}</td></tr>
    <tr><td class="k">Дата выявления:</td><td>${esc(fmtDate(d.date))}</td></tr>
    <tr><td class="k">Характер отклонения:</td><td>${isDepth ? 'отклонение по глубине заложения' : 'изменение трассы'}</td></tr>
    ${isDepth ? `<tr><td class="k">Глубина:</td><td>по проекту ${
      fmtDepth(d.designDepthM ?? 1.2)} м, фактически ${
      d.actualDepthM !== undefined ? fmtDepth(d.actualDepthM) : '____'} м</td></tr>` : ''}
    <tr><td class="k">Протяжённость:</td><td>${esc(String(d.lengthM))} м</td></tr>
    ${d.fromPoint || d.toPoint
      ? `<tr><td class="k">Границы участка:</td><td>${esc(d.fromPoint ?? '—')} — ${esc(d.toPoint ?? '—')}</td></tr>`
      : ''}
    ${d.coords?.length
      ? `<tr><td class="k">Координаты:</td><td>${d.coords.map((c) =>
          `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`).join('; ')}</td></tr>`
      : ''}
  </table>
  <p class="body">
    Мобильная группа произвела выезд на указанный участок и установила
    следующее: ${esc(d.reason)}. Отклонение зафиксировано на протяжении
    ${esc(String(d.lengthM))} м${isDepth && d.actualDepthM !== undefined
      ? ` с фактической глубиной заложения ${fmtDepth(d.actualDepthM)} м вместо проектной ${fmtDepth(d.designDepthM ?? 1.2)} м`
      : ''}.
    ${p?.note ? esc(p.note) : 'Решение: ____________________________________________________.'}
  </p>
  <table class="sign">
    <tr>
      <td>Представитель подрядчика<br/><span class="line">&nbsp;</span><br/><span class="sub">подпись, Ф.И.О.</span></td>
      <td>Представитель технадзора<br/><span class="line">&nbsp;</span><br/><span class="sub">подпись, Ф.И.О.</span></td>
      <td>Представитель заказчика<br/><span class="line">&nbsp;</span><br/><span class="sub">подпись, Ф.И.О.</span></td>
    </tr>
  </table>
</body></html>`;
}

export function protocolFileName(d: Deviation): string {
  const safe = d.uchastok.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'участок';
  return `Протокол МГ ${safe} ${d.date || new Date().toISOString().slice(0, 10)}.doc`;
}

/** Word понимает HTML только с этой кодировкой в заголовке файла. */
export const DOC_MIME = 'application/msword;charset=utf-8';
