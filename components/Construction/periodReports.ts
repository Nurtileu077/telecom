import {
  DailyWorkEntry, SnpProgress, SNP_STAGES, SNP_STAGE_SPECS,
} from '@/types/construction';
import { esc, ACT_DOC_CSS, fmtDate } from './actDocument';
import { entryMeters, groupByWeek, weekStart } from './entriesTable';
import { stageStatus } from './stageTasks';

/**
 * Отчёты за период.
 *
 * Их пишут каждую неделю, каждый месяц и на каждый запрос заказчика —
 * и каждый раз заново: открывают журнал, складывают метры, пересчитывают
 * темп, вспоминают, где просели. Работы на полдня, а всё, что нужно,
 * уже записано.
 */

export interface PeriodFilter {
  from?: string;
  to?: string;
  contractor?: string;
}

function inPeriod(e: DailyWorkEntry, f: PeriodFilter): boolean {
  if (f.from && (e.date || '') < f.from) return false;
  if (f.to && (e.date || '') > f.to) return false;
  if (f.contractor && (e.contractor || '') !== f.contractor) return false;
  return true;
}

export interface SectionLine {
  uchastok: string;
  meters: number;
  shifts: number;
  contractors: string[];
}

export interface PeriodReport {
  from: string;
  to: string;
  meters: number;
  shifts: number;
  days: number;
  perShift: number;
  perDay: number;
  /** Разрез по участкам — от большего. */
  sections: SectionLine[];
  /** Метры по неделям: по ним видно, где провал. */
  weeks: { week: string; label: string; meters: number }[];
  /** Дни без работ внутри периода: их объясняют отдельно. */
  idleDays: string[];
  /** Что мешало: причины простоя из смен. */
  downtime: { reason: string; days: number }[];
}

/** Все даты периода — чтобы увидеть не только сделанное, но и пустые дни. */
function daysBetween(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // Больше года в один отчёт не собирают, а бесконечный цикл на кривых
  // датах дороже пропущенной строки.
  for (let guard = 0; d <= end && guard < 400; guard++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function periodReport(rows: DailyWorkEntry[], filter: PeriodFilter = {}): PeriodReport {
  const list = rows.filter((e) => inPeriod(e, filter));
  const dates = list.map((e) => e.date).filter(Boolean).sort();
  const from = filter.from || dates[0] || '';
  const to = filter.to || dates[dates.length - 1] || '';

  const bySection = new Map<string, SectionLine>();
  const worked = new Set<string>();
  const downtime = new Map<string, Set<string>>();

  for (const e of list) {
    const key = e.uchastok || '—';
    const line = bySection.get(key)
      ?? { uchastok: key, meters: 0, shifts: 0, contractors: [] as string[] };
    line.meters += entryMeters(e);
    line.shifts += 1;
    if (e.contractor && !line.contractors.includes(e.contractor)) {
      line.contractors.push(e.contractor);
    }
    bySection.set(key, line);
    if (e.date) worked.add(e.date);
    const reason = e.downtime?.trim();
    if (reason && e.date) {
      const set = downtime.get(reason) ?? new Set<string>();
      set.add(e.date);
      downtime.set(reason, set);
    }
  }

  const meters = list.reduce((s, e) => s + entryMeters(e), 0);
  const weeks = groupByWeek(list).map((w) => ({
    week: w.week, label: w.label, meters: w.meters,
  }));

  return {
    from,
    to,
    meters,
    shifts: list.length,
    days: worked.size,
    perShift: list.length ? meters / list.length : 0,
    perDay: worked.size ? meters / worked.size : 0,
    sections: [...bySection.values()].sort((a, b) => b.meters - a.meters),
    weeks,
    idleDays: daysBetween(from, to).filter((d) => !worked.has(d)),
    downtime: [...downtime.entries()]
      .map(([reason, days]) => ({ reason, days: days.size }))
      .sort((a, b) => b.days - a.days),
  };
}

/** Сравнение с предыдущим отрезком той же длины: «быстрее или медленнее». */
export interface PaceChange {
  previousM: number;
  currentM: number;
  /** Доля изменения: 0.2 — на пятую часть быстрее. */
  change: number;
}

export function paceChange(rows: DailyWorkEntry[], filter: PeriodFilter): PaceChange | null {
  if (!filter.from || !filter.to) return null;
  const span = daysBetween(filter.from, filter.to).length;
  if (span === 0) return null;

  const prevTo = new Date(`${filter.from}T00:00:00Z`);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (span - 1));

  const current = periodReport(rows, filter).meters;
  const previous = periodReport(rows, {
    ...filter,
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  }).meters;

  if (previous === 0) return null;
  return { previousM: previous, currentM: current, change: (current - previous) / previous };
}

const m = (v: number) => `${Math.round(v).toLocaleString('ru')} м`;
const km = (v: number) => `${(v / 1000).toFixed(2).replace('.', ',')} км`;

export interface PeriodDocInput {
  report: PeriodReport;
  pace?: PaceChange | null;
  title?: string;
  contractor?: string;
  author?: string;
}

/**
 * Отчёт документом.
 *
 * Тот же бланк годится и для недельного отчёта заказчику, и для отчёта
 * по одному субподрядчику: различает их только строка с именем и
 * выборка, а не содержание.
 */
export function periodDocHtml(input: PeriodDocInput): string {
  const r = input.report;
  const title = input.title || 'ОТЧЁТ О ВЫПОЛНЕННЫХ РАБОТАХ';

  const sections = r.sections.map((s, i) => '<tr>'
    + `<td class="val">${i + 1}</td>`
    + `<td class="lbl">${esc(s.uchastok)}</td>`
    + `<td class="val">${esc(s.contractors.join(', ') || '—')}</td>`
    + `<td class="val">${s.shifts}</td>`
    + `<td class="val">${Math.round(s.meters).toLocaleString('ru')}</td>`
    + '</tr>').join('');

  const weeks = r.weeks.length > 1
    ? '<p class="mt b">По неделям</p><table class="act">'
      + r.weeks.map((w) => '<tr>'
        + `<td class="lbl">${esc(w.label)}</td>`
        + `<td class="val">${Math.round(w.meters).toLocaleString('ru')} м</td>`
        + '</tr>').join('')
      + '</table>'
    : '';

  const pace = input.pace
    ? `<p>Темп относительно предыдущего периода: `
      + `<span class="b">${input.pace.change >= 0 ? '+' : '−'}`
      + `${Math.abs(Math.round(input.pace.change * 100))}%</span> `
      + `(было ${m(input.pace.previousM)}, стало ${m(input.pace.currentM)}).</p>`
    : '';

  const idle = r.idleDays.length
    ? `<p>Дней без работ: <span class="b">${r.idleDays.length}</span>`
      + (r.downtime.length
        ? ` — ${esc(r.downtime.map((d) => `${d.reason} (${d.days})`).join('; '))}`
        : '')
      + '.</p>'
    : '';

  return `<h1>${esc(title)}</h1>`
    + `<p class="center">за период ${esc(fmtDate(r.from))} — ${esc(fmtDate(r.to))}</p>`
    + (input.contractor ? `<p>Подрядчик: <span class="b">${esc(input.contractor)}</span></p>` : '')
    + `<p>Выполнено: <span class="b">${esc(km(r.meters))}</span> (${esc(m(r.meters))}) `
    + `за ${r.shifts} смен в ${r.days} рабочих дней.</p>`
    + `<p>В среднем ${esc(m(r.perShift))} за смену, ${esc(m(r.perDay))} за рабочий день.</p>`
    + pace
    + idle
    + '<p class="mt b">По участкам</p>'
    + '<table class="act"><tr>'
    + '<td class="val b">№</td><td class="lbl b">Участок</td>'
    + '<td class="val b">Подрядчик</td><td class="val b">Смен</td><td class="val b">Метры</td>'
    + '</tr>'
    + sections
    + '<tr><td class="val"></td><td class="lbl b">Итого</td><td class="val"></td>'
    + `<td class="val b">${r.shifts}</td>`
    + `<td class="val b">${Math.round(r.meters).toLocaleString('ru')}</td></tr>`
    + '</table>'
    + weeks
    + (input.author
      ? `<table class="sign"><tr><td class="s">${esc(input.author)}<br/>_______________</td></tr></table>`
      : '');
}

export function periodDocPage(input: PeriodDocInput): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><title>${esc(input.title ?? 'Отчёт')}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>@page { size: A4; margin: 1.5cm; } body { margin: 0; }
${ACT_DOC_CSS}</style></head>
<body class="act-doc">${periodDocHtml(input)}</body></html>`;
}

export function periodDocFile(input: PeriodDocInput): string {
  const who = input.contractor ? ` ${input.contractor}` : '';
  return `Отчёт${who} ${input.report.from}—${input.report.to}.doc`;
}

// ── Справка о готовности села ────────────────────────────────────────────────

export interface SnpReadiness {
  kato: string;
  snp: string;
  rayon?: string;
  /** Доля закрытых этапов, 0..1. */
  done: number;
  /** Что закрыто и что осталось — словами. */
  closed: string[];
  left: string[];
}

/**
 * Готовность по сёлам.
 *
 * Заказчик спрашивает не «сколько метров», а «когда включите
 * Серафимовку». Ответ на это — список закрытых и незакрытых этапов, и
 * он уже есть в журнале.
 */
export function snpReadiness(progress: SnpProgress[]): SnpReadiness[] {
  return progress.map((p) => {
    const closed: string[] = [];
    const left: string[] = [];
    for (const s of SNP_STAGES) {
      const label = SNP_STAGE_SPECS[s].label;
      if (stageStatus(p, s) === 'done') closed.push(label); else left.push(label);
    }
    return {
      kato: p.kato,
      snp: p.snp,
      rayon: p.rayon,
      done: SNP_STAGES.length ? closed.length / SNP_STAGES.length : 0,
      closed,
      left,
    };
  }).sort((a, b) => b.done - a.done || a.snp.localeCompare(b.snp, 'ru'));
}

export function readinessDocHtml(rows: SnpReadiness[], title = 'СПРАВКА О ГОТОВНОСТИ'): string {
  const body = rows.map((r, i) => '<tr>'
    + `<td class="val">${i + 1}</td>`
    + `<td class="lbl">${esc(r.snp)}${r.rayon ? `, ${esc(r.rayon)}` : ''}</td>`
    + `<td class="val">${Math.round(r.done * 100)}%</td>`
    + `<td class="lbl">${esc(r.left.join(', ') || 'всё закрыто')}</td>`
    + '</tr>').join('');

  const ready = rows.filter((r) => r.done >= 1).length;
  return `<h1>${esc(title)}</h1>`
    + `<p class="center">на ${esc(fmtDate(new Date().toISOString().slice(0, 10)))}</p>`
    + `<p>Всего сёл: <span class="b">${rows.length}</span>, `
    + `полностью закрыто: <span class="b">${ready}</span>.</p>`
    + '<table class="act"><tr>'
    + '<td class="val b">№</td><td class="lbl b">Село</td>'
    + '<td class="val b">Готовность</td><td class="lbl b">Осталось</td>'
    + '</tr>' + body + '</table>';
}

/** Неделя, в которую попадает дата, — начало и конец, для заголовка отчёта. */
export function weekRange(date: string): { from: string; to: string } {
  const from = weekStart(date);
  if (!from) return { from: '', to: '' };
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return { from, to: d.toISOString().slice(0, 10) };
}
