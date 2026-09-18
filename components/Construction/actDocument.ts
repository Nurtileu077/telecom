import { LAY_METHODS, LAY_METHOD_LABEL, Deviation, MobileGroupProtocol } from '@/types/construction';
import {
  SectionActTotals, SectionActVariant, SectionActManual, actKm,
} from './sectionAct';

/**
 * Закрывающие документы файлом.
 *
 * Акт нужно отправить: печать в PDF годится для папки, но в переписке ждут
 * документ, который можно открыть и поправить. Собираем Word-совместимый
 * HTML — Word открывает его как документ и даёт редактировать, а лишней
 * библиотеки на полтора мегабайта в поле не появляется.
 *
 * Строки таблицы считает одна функция и для экрана, и для файла: две
 * копии одного акта однажды разойдутся, и разойдутся в худший момент.
 */

export type ActKind = 'ASR' | 'OSR';

export const ACT_KIND_SPECS: Record<ActKind, { short: string; title: string; basis: string }> = {
  ASR: {
    short: 'АСР',
    title: 'АКТ ОСВИДЕТЕЛЬСТВОВАНИЯ СКРЫТЫХ РАБОТ',
    basis: 'СН РК 1.03-00-2022',
  },
  OSR: {
    short: 'ОСР',
    title: 'АКТ ОСВИДЕТЕЛЬСТВОВАНИЯ СКРЫТЫХ РАБОТ',
    basis: 'Приложение 12 к ОДС/П-14-4-4-01',
  },
};

export interface ActRow {
  n?: string;
  label: string;
  value: string;
  unit?: string;
  indent?: boolean;
  strong?: boolean;
  /** Значение введено руками — в журнале такого показателя нет. */
  manual?: boolean;
}

/** Доля показателя, приходящаяся на этот акт по длине. */
export function share(value: number, total: number, part: number): number {
  if (!total) return 0;
  return Math.round((value * part) / total);
}

export function methodActLabel(m: string): string {
  // В акте у кабелеукладчика формулировка своя, остальные совпадают.
  if (m === 'кабелеукладчик') return 'Кабелеукладчиком с двукратной пропоркой';
  return LAY_METHOD_LABEL[m as never] ?? m;
}

export function fmtDepth(m: number): string {
  return String(m).replace('.', ',');
}

export function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru');
}

/** В журнале район пишут и со словом «район», и без — не удваиваем. */
export function withRayonWord(rayon: string): string {
  const r = rayon.trim();
  return /район/i.test(r) ? r : `${r} район`;
}

/**
 * Строки таблицы акта — единственная версия, общая для экрана и файла.
 */
export function actRows(
  totals: SectionActTotals,
  v: SectionActVariant,
  fields: SectionActManual,
): ActRow[] {
  const rows: ActRow[] = [
    { n: '1', label: 'Защитной МКТ проложено всего', value: actKm(v.lengthM), unit: 'км', strong: true },
  ];

  for (const m of LAY_METHODS) {
    rows.push({
      label: methodActLabel(m),
      value: actKm(share(totals.byMethod[m], totals.totalM, v.lengthM)),
      unit: 'км', indent: true,
    });
  }

  rows.push(
    { label: 'Переходы ГНБ с защитой ПЭТ-63мм', value: actKm(fields.gnbPet63M ?? 0), unit: 'км', indent: true, manual: true },
    { label: 'Переходы ГНБ с защитой ПЭТ-110мм', value: actKm(fields.gnbPet110M ?? 0), unit: 'км', indent: true, manual: true },
    { label: 'Переходы открытым способом, ПЭТ-63мм', value: actKm(fields.openPet63M ?? 0), unit: 'км', indent: true, manual: true },
    { label: 'Переходы открытым способом, ст. труба 63мм', value: actKm(fields.openSteel63M ?? 0), unit: 'км', indent: true, manual: true },
    {
      n: '2', label: 'Глубина прокладки защитной МКТ',
      value: `по проекту — ${fmtDepth(v.designDepthM)} м, фактически — ${fmtDepth(v.actualDepthM)} м`,
    },
    {
      n: '3', label: 'Комплектов для сращивания защитной МКТ (фитинги)',
      value: String(share(totals.splicingKits, totals.totalM, v.lengthM)), unit: 'шт',
    },
    {
      n: '4', label: 'Прокладка предупредительно-сигнальной ленты на глубине ½ от МКТ',
      value: actKm(share(totals.tapeM, totals.totalM, v.lengthM)), unit: 'км',
    },
    {
      n: '5', label: 'На участке выполнено переходов',
      // Переходы целиком относятся к основному акту: делить прокол между
      // глубинами нечем, а приписывать его отклонению — неправда.
      value: String(v.isMain ? totals.crossingsTotal : 0), unit: 'пер.',
    },
    { n: '6', label: 'Рекультивация', value: fields.recultivation ?? '—', manual: true },
    { n: '7', label: 'Восстановление а/бетонных покрытий', value: fields.pavement ?? '—', manual: true },
  );

  if (fields.markerPosts || fields.ballMarkers) {
    rows.push(
      { label: 'Установлено идентификационных столбиков', value: String(fields.markerPosts ?? 0), unit: 'шт', manual: true },
      { label: 'Установлено шаровых маркеров', value: String(fields.ballMarkers ?? 0), unit: 'шт', manual: true },
    );
  }

  if (!v.isMain) {
    rows.push({
      label: 'Отклонения от ПСД',
      value: v.protocols.length
        ? v.protocols.map((p) => `Протокол мобильной группы №${p.number} от ${fmtDate(p.date)}`).join('; ')
        : 'протокол мобильной группы не оформлен',
    });
  }

  return rows;
}

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/**
 * Один файл на участок: основной акт и акты по отклонениям идут листами
 * подряд. Их подписывают вместе, и разносить их по файлам — лишняя работа
 * для того, кто потом это отправляет.
 */
export function actDocHtml(input: ActDocInput): string {
  const spec = ACT_KIND_SPECS[input.kind];
  const place = [input.oblast, input.rayon ? withRayonWord(input.rayon) : '']
    .filter(Boolean).join(', ');

  const sheets = input.variants.map((v, i) => {
    const rows = actRows(input.totals, v, input.fields).map((r) => `
      <tr>
        <td class="lbl"${r.indent ? ' style="padding-left:24pt"' : ''}>
          ${r.n ? `${esc(r.n)}. ` : ''}${esc(r.label)}
        </td>
        <td class="val">${esc(r.value)}${r.unit ? ` ${esc(r.unit)}` : ''}</td>
      </tr>`).join('');

    const title = v.isMain
      ? spec.title
      : `${spec.title} (участок с отклонением по глубине)`;

    return `
    <div class="sheet"${i > 0 ? ' style="page-break-before:always"' : ''}>
      <p class="basis">${esc(spec.basis)}</p>
      <h1>${esc(title)}</h1>
      <p class="meta">
        ${input.fields.actNumber ? `№ ${esc(input.fields.actNumber)}` : '№ ______'}
        &nbsp;&nbsp;от ${input.fields.actDate ? esc(fmtDate(input.fields.actDate)) : '«___» ____________ 20___ г.'}
        ${input.fields.city ? `&nbsp;&nbsp;г. ${esc(input.fields.city)}` : ''}
      </p>
      <table class="head">
        <tr><td class="k">Объект:</td><td>${esc(input.uchastok)}${place ? `, ${esc(place)}` : ''}</td></tr>
        <tr><td class="k">Подрядчик:</td><td>${esc(input.contractor ?? '____________________')}</td></tr>
        ${input.performer && input.performer !== input.contractor
          ? `<tr><td class="k">Работы вёл:</td><td>${esc(input.performer)}</td></tr>` : ''}
        <tr><td class="k">Период работ:</td><td>${esc(fmtDate(input.dateFrom))} — ${esc(fmtDate(input.dateTo))}</td></tr>
      </table>
      <table class="act">${rows}</table>
      ${!v.isMain && v.deviations.length
        ? `<p class="note">Причины отклонения: ${esc([...new Set(v.deviations.map((d: Deviation) => d.reason))].join(', '))}</p>`
        : ''}
      ${!v.isMain && v.blocked
        ? '<p class="warn">Протокол мобильной группы не оформлен — акт не подлежит подписанию.</p>'
        : ''}
      <table class="sign">
        <tr>
          <td>Представитель подрядчика<br/><span class="line">&nbsp;</span><br/><span class="sub">подпись, Ф.И.О.</span></td>
          <td>Представитель технадзора<br/><span class="line">&nbsp;</span><br/><span class="sub">подпись, Ф.И.О.</span></td>
          <td>Представитель заказчика<br/><span class="line">&nbsp;</span><br/><span class="sub">подпись, Ф.И.О.</span></td>
        </tr>
      </table>
    </div>`;
  }).join('');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/>
<title>${esc(spec.short)} — ${esc(input.uchastok)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 2cm 1.5cm; }
  body { font-family: "Times New Roman", serif; font-size: 11pt; color: #000; }
  h1 { font-size: 13pt; text-align: center; margin: 6pt 0; text-transform: uppercase; }
  .basis { text-align: right; font-size: 9pt; color: #444; margin: 0; }
  .meta { text-align: center; font-size: 10pt; margin: 0 0 10pt; }
  table { width: 100%; border-collapse: collapse; }
  table.head td { padding: 2pt 4pt; font-size: 10pt; vertical-align: top; }
  table.head td.k { width: 26%; color: #444; }
  table.act td { border-bottom: 0.5pt solid #999; padding: 3pt 4pt; vertical-align: top; }
  table.act td.val { text-align: right; white-space: nowrap; width: 32%; }
  .note { font-size: 10pt; margin-top: 6pt; }
  .warn { font-size: 10pt; margin-top: 6pt; font-weight: bold; }
  table.sign { margin-top: 24pt; }
  table.sign td { width: 33%; font-size: 10pt; vertical-align: top; padding-right: 10pt; }
  .line { display: inline-block; border-bottom: 0.5pt solid #000; width: 90%; }
  .sub { font-size: 8pt; color: #444; }
</style></head>
<body>${sheets}</body></html>`;
}

/** Имя файла: участок и вид акта — чтобы в почте было видно без открытия. */
export function actFileName(kind: ActKind, uchastok: string, date?: string): string {
  const safe = uchastok.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'участок';
  const d = date || new Date().toISOString().slice(0, 10);
  return `${ACT_KIND_SPECS[kind].short} ${safe} ${d}.doc`;
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
