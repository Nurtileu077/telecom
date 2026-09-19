import { JournalState, fmtKm } from './journalStore';
import { regionProgress, pace } from './management';
import { openDeviations } from './journalStore';
import { esc, fmtDate } from './actDocument';

/**
 * Отчёт заказчику одной страницей.
 *
 * Заказчику нужен прогресс, а не доступ внутрь: он спрашивает «сколько по
 * Акмолинской» и «когда закончите», а не «какая колонна где стоит» и
 * «почему у вас простой». Поэтому отдаём отдельный документ, а не доступ
 * в журнал: это честнее и проще, чем выдавать роль «только смотреть» и
 * потом следить, чтобы в неё случайно не протекло лишнее.
 *
 * Внутрь не попадают: подрядчики и колонны, причины простоя, деньги,
 * незакрытые отклонения, фамилии. Всё это — внутренняя кухня, и заказчик
 * по ней решений не принимает.
 */

export interface PublicReportInput {
  journal: JournalState;
  /** Одна область или всё сразу. */
  oblast?: string;
  /** Кто отправляет — подрядчик по документам. */
  contractor?: string;
  /** На какое число собран отчёт. */
  asOf?: string;
}

export function publicReportHtml(input: PublicReportInput): string {
  const j = input.journal;
  const ctx = {
    orders: j.orders,
    ground: j.ground,
    aerial: j.aerial,
    progress: j.progress,
    crews: j.crews,
    deviations: openDeviations(j),
  };
  const regions = regionProgress(ctx).filter((r) => !input.oblast || r.name === input.oblast);
  const p = pace(ctx);
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);

  const planM = regions.reduce((s, r) => s + r.planM, 0);
  const factM = regions.reduce((s, r) => s + r.factM, 0);
  const pct = planM > 0 ? Math.round((factM / planM) * 100) : null;

  const rows = regions.map((r) => {
    const share = r.planM > 0 ? Math.min(1, r.factM / r.planM) : 0;
    return `
      <tr>
        <td>${esc(r.name)}</td>
        <td class="n">${fmtKm(r.planM)}</td>
        <td class="n">${fmtKm(r.factM)}</td>
        <td class="n">${r.planM > 0 ? `${Math.round((r.factM / r.planM) * 100)}%` : '—'}</td>
        <td class="bar">
          <div class="track"><div class="fill" style="width:${Math.round(share * 100)}%"></div></div>
        </td>
      </tr>`;
  }).join('');

  const finish = p.finishDate
    ? new Date(`${p.finishDate}T00:00:00Z`).toLocaleDateString('ru', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    : null;

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ход строительства ВОЛС${input.oblast ? ` — ${esc(input.oblast)}` : ''}</title>
<style>
  :root {
    --bg: #ffffff; --ink: #14202b; --muted: #5c6b77;
    --line: #d3dade; --accent: #0f7a85; --surface: #f5f7f8;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0e151b; --ink:#e4ebf0; --muted:#93a4b1; --line:#2a3945;
            --accent:#2fa7b2; --surface:#151e26; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 48px;
    background: var(--bg); color: var(--ink);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size: clamp(22px, 5vw, 30px); margin: 0 0 4px; line-height: 1.15; }
  .sub { color: var(--muted); margin: 0 0 20px; font-size: 14px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 22px; }
  .kpi { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
  .kpi .k { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .kpi .v { font-size: 24px; font-weight: 600; line-height: 1.2; }
  .kpi .u { font-size: 12px; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; }
  th { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.bar { width: 30%; }
  .track { height: 6px; background: var(--surface); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); border-radius: 3px; }
  footer { margin-top: 28px; color: var(--muted); font-size: 12.5px; }
  @media (max-width: 560px) { td.bar { display: none; } th:last-child { display: none; } }
</style></head>
<body><div class="wrap">
  <h1>Ход строительства ВОЛС</h1>
  <p class="sub">
    ${input.oblast ? `${esc(input.oblast)} · ` : ''}на ${esc(fmtDate(asOf))}
    ${input.contractor ? ` · ${esc(input.contractor)}` : ''}
  </p>

  <div class="kpis">
    <div class="kpi"><div class="k">Выполнено</div>
      <div class="v">${pct === null ? '—' : `${pct}%`}</div>
      <div class="u">${fmtKm(factM)} из ${fmtKm(planM)} км</div></div>
    <div class="kpi"><div class="k">Темп</div>
      <div class="v">${Math.round(p.metersPerDay).toLocaleString('ru')}</div>
      <div class="u">метров в рабочий день</div></div>
    <div class="kpi"><div class="k">Осталось</div>
      <div class="v">${fmtKm(p.remainingM)}</div>
      <div class="u">км${p.daysLeft !== null ? ` · ${p.daysLeft} раб. дней` : ''}</div></div>
    <div class="kpi"><div class="k">Ожидаемое окончание</div>
      <div class="v" style="font-size:17px;padding-top:6px">${finish ?? '—'}</div>
      <div class="u">${finish ? 'при нынешнем темпе' : 'темпа пока нет'}</div></div>
  </div>

  <table>
    <tr><th>Область</th><th style="text-align:right">План, км</th>
        <th style="text-align:right">Факт, км</th><th style="text-align:right">%</th><th></th></tr>
    ${rows || '<tr><td colspan="5">Данных по областям нет</td></tr>'}
  </table>

  <footer>
    План — плановые объёмы ВОЛС из реестра заказа. Факт — подземная прокладка
    и подвес по дневным отчётам; исправления учитываются только после
    подтверждения. Темп и прогноз считаются по рабочим дням.
  </footer>
</div></body></html>`;
}

export function publicReportFileName(oblast?: string, asOf?: string): string {
  const safe = (oblast ?? '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 40);
  const d = asOf ?? new Date().toISOString().slice(0, 10);
  return `Ход строительства${safe ? ` ${safe}` : ''} ${d}.html`;
}
