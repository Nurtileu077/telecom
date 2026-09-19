import {
  DailyWorkEntry, Deviation, OPERATIONS, OperationKind,
  LAY_METHODS, LAY_METHOD_LABEL, DESIGN_DEPTH_M,
} from '@/types/construction';
import { esc, fmtDate, withRayonWord } from './actDocument';

/**
 * Тетрадь технадзора — форма КТ/33.07.25, Приложение Б.
 *
 * Её заполняют от руки каждый день: дата, адрес участка, что сделано и на
 * какой глубине, подписи технадзора и подрядчика, время начала работ
 * назавтра. Всё это уже введено в дневном отчёте — и вводится один раз,
 * а не второй раз вечером в тетрадь.
 *
 * Строку работ собираем из того, что записано: операции с их метражом,
 * а если подробную часть не заполняли — способы прокладки. Глубину берём
 * проектную, а на участках с отклонением — фактическую, потому что именно
 * её и проверяет технадзор.
 */

export interface SupervisionRow {
  date: string;
  /** Где: участок и метки трубы, если их снимали. */
  address: string;
  /** Что сделано и на какой глубине. */
  works: string;
  /** Кто вёл работы. */
  performer: string;
  /** Во сколько начинают назавтра — последняя графа формы. */
  tomorrow?: string;
  note?: string;
}

function fmtM(m: number): string {
  return `${Math.round(m).toLocaleString('ru')} м`;
}

export function fmtDepth(m: number): string {
  return String(m).replace('.', ',');
}

/** Глубина на этом участке: фактическая, если было отклонение. */
function depthOf(e: DailyWorkEntry, deviations: Deviation[]): number {
  const dev = deviations.find(
    (d) => d.kind === 'depth'
      && d.date === e.date
      && d.uchastok.trim().toLowerCase() === e.uchastok.trim().toLowerCase()
      && d.actualDepthM !== undefined,
  );
  return dev?.actualDepthM ?? DESIGN_DEPTH_M;
}

/**
 * Строка работ — так, как её пишут в тетради.
 * «Пропорка тяжёлой техникой — 6 000 м; Прокладка МКТ на глубину 1,2 м — 4 100 м»
 */
export function worksText(e: DailyWorkEntry, depth: number): string {
  const parts: string[] = [];

  const ops = Object.entries(e.operations ?? {}) as [OperationKind, number][];
  for (const [k, v] of ops) {
    if (!v || !OPERATIONS[k]) continue;
    const spec = OPERATIONS[k];
    // Глубину приписываем только к тому, что кладут в землю: у обваловки
    // и установки КОД её не спрашивают.
    const deep = k === 'lay_mkt' || k === 'lay_mkt_heavy' || k === 'trench_excavator'
      || k === 'trench_bar' || k === 'trench_manual' || k === 'proporka';
    const amount = spec.unit === 'м' ? fmtM(v) : `${v} шт`;
    parts.push(`${spec.label}${deep ? ` на глубину ${fmtDepth(depth)} м` : ''} — ${amount}`);
  }

  // Подробную часть заполняют не всегда. Тогда говорим то, что знаем
  // наверняка: способ прокладки и метраж.
  if (parts.length === 0) {
    for (const m of LAY_METHODS) {
      const v = e.byMethod[m] ?? 0;
      if (v > 0) parts.push(`${LAY_METHOD_LABEL[m]} на глубину ${fmtDepth(depth)} м — ${fmtM(v)}`);
    }
  }

  if (e.blowingM) parts.push(`Задувка ОК — ${fmtM(e.blowingM)}`);
  if (e.drillM) {
    parts.push(`Бестраншейные переходы — ${fmtM(e.drillM)}`
      + (e.drillCount ? `, ${e.drillCount} шт` : ''));
  }
  for (const [k, v] of Object.entries(e.materials)) {
    if (k === 'Лента' && v) parts.push(`Прокладка сигнальной ленты — ${fmtM(v)}`);
  }

  return parts.join('; ');
}

/** Адрес участка: то, чем его называют в тетради. */
export function addressText(e: DailyWorkEntry): string {
  const marks = (e.ductMarks ?? [])
    .filter((m) => m.coil.trim())
    .map((m) => `${m.coil} — ${Math.round(m.meters)}`);
  const place = [e.uchastok, e.rayon ? withRayonWord(e.rayon) : '', e.oblast]
    .filter(Boolean).join(', ');
  return marks.length ? `${place} (метки ${marks.join('; ')})` : place;
}

export interface SupervisionInput {
  entries: DailyWorkEntry[];
  deviations?: Deviation[];
  from?: string;
  to?: string;
}

export function supervisionRows(input: SupervisionInput): SupervisionRow[] {
  const devs = input.deviations ?? [];
  return input.entries
    .filter((e) => (!input.from || e.date >= input.from) && (!input.to || e.date <= input.to))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.uchastok.localeCompare(b.uchastok, 'ru'))
    .map((e) => ({
      date: e.date,
      address: addressText(e),
      works: worksText(e, depthOf(e, devs)),
      performer: e.contractor || e.smu || '',
      tomorrow: e.tomorrow?.trim() || undefined,
      note: e.downtime?.trim() || undefined,
    }))
    .filter((r) => r.works || r.note);
}

// ── Документ ─────────────────────────────────────────────────────────────────

export interface SupervisionDocInput extends SupervisionInput {
  /** Подрядчик по документам — от чьего имени ведётся тетрадь. */
  contractor?: string;
  oblast?: string;
  rayon?: string;
  uchastok?: string;
}

/**
 * Тетрадь одним документом. Word-совместимый HTML, как и акты: открывается
 * и правится там, где её потом подписывают.
 */
export function supervisionDocHtml(input: SupervisionDocInput): string {
  const rows = supervisionRows(input);
  const place = [input.oblast, input.rayon ? withRayonWord(input.rayon) : '']
    .filter(Boolean).join(', ');

  const body = rows.map((r, i) => `
      <tr>
        <td class="n">${i + 1}</td>
        <td class="d">${esc(fmtDate(r.date))}</td>
        <td>${esc(r.address)}</td>
        <td>${esc(r.works)}${r.note ? `<br/><i>Простой: ${esc(r.note)}</i>` : ''}</td>
        <td>${esc(r.performer)}</td>
        <td class="s">&nbsp;</td>
        <td class="s">&nbsp;</td>
        <td class="t">${esc(r.tomorrow ?? '')}</td>
      </tr>`).join('');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/>
<title>Тетрадь технадзора${input.uchastok ? ` — ${esc(input.uchastok)}` : ''}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4 landscape; margin: 1.5cm; }
  body { font-family: "Times New Roman", serif; font-size: 11pt; color: #000; }
  h1 { font-size: 12pt; text-align: center; margin: 6pt 0 2pt; }
  .form { text-align: right; font-size: 9pt; margin: 0; }
  .meta { font-size: 10pt; margin: 0 0 8pt; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 0.5pt solid #000; padding: 3pt 4pt; font-size: 10pt; vertical-align: top; }
  th { font-weight: normal; text-align: center; font-size: 9pt; }
  td.n { text-align: center; width: 3%; }
  td.d { white-space: nowrap; width: 8%; }
  td.s { width: 11%; }
  td.t { width: 8%; }
  .sign { margin-top: 16pt; font-size: 10pt; }
</style></head>
<body>
  <p class="form">Форма КТ/33.07.25<br/>Приложение Б</p>
  <h1>Журнал производства работ (тетрадь технического надзора)</h1>
  <p class="meta">
    ${place ? `${esc(place)}<br/>` : ''}
    ${input.uchastok ? `Участок: ${esc(input.uchastok)}<br/>` : ''}
    Подрядчик: ${esc(input.contractor ?? '____________________')}<br/>
    Период: ${esc(fmtDate(input.from))} — ${esc(fmtDate(input.to))}
  </p>
  <table>
    <tr>
      <th>№</th><th>Дата</th><th>Адрес участка (ПК-ПК)</th>
      <th>Наименование работ, глубина, объём</th><th>Исполнитель</th>
      <th>Подпись технадзора</th><th>Подпись подрядчика</th>
      <th>Время начала работ назавтра</th>
    </tr>
    ${body || '<tr><td colspan="8">За период записей нет</td></tr>'}
  </table>
  <p class="sign">
    Представитель технического надзора ________________________ &nbsp;&nbsp;
    Представитель подрядчика ________________________
  </p>
</body></html>`;
}

export function supervisionFileName(uchastok?: string, from?: string, to?: string): string {
  const safe = (uchastok ?? '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 50);
  const period = [from, to].filter(Boolean).join('—') || new Date().toISOString().slice(0, 10);
  return `Тетрадь технадзора ${safe ? `${safe} ` : ''}${period}.doc`;
}
