'use client';
import { useMemo, useState } from 'react';
import {
  FileDown, Package, AlertTriangle, Check, Hash, Loader2,
} from 'lucide-react';
import type { JournalState } from './journalStore';
import { actRegistry, nextActNumber, formatActNumber } from './docRegistry';
import {
  volumeSheet, costSheet, volumeDocPage, volumeDocFile, type WorkPrices,
} from './volumeDocs';
import {
  periodReport, paceChange, periodDocPage, periodDocFile,
  snpReadiness, readinessDocHtml, weekRange,
} from './periodReports';
import { actDocHtml, actFileName, ACT_DOC_CSS, esc, type ActKind } from './actDocument';
import { computeSectionAct } from './sectionAct';
import { effectiveProgress } from './stageDerive';
import {
  hiddenWorksPage, hiddenWorksFile, remarksFromDeviations, remarksPage,
  photoReportPage, letterPage, measureProtocolPage, measureProtocolFile,
} from './fieldDocs';
import { getPhotoBlob } from './photoStore';
import { downloadText, downloadBlob } from '@/lib/download';

/**
 * Документы.
 *
 * До сих пор каждый документ рождался отдельно и по месту: акт — в
 * закрытии участка, отчёт — в сводке, ведомость — в голове у инженера.
 * А спрашивают их пачкой: «пришлите за неделю» — и человек собирает
 * четыре файла из трёх разных экранов.
 *
 * Здесь они лежат вместе, и видно, что готово, а что нет.
 */

interface Props {
  journal: JournalState;
  from: string;
  to: string;
  /** Кого писать подрядчиком по умолчанию. */
  contractor?: string;
  author?: string;
  onFlash?: (text: string) => void;
  onOpenSection?: (uchastok: string) => void;
  onSetActNumber?: (uchastok: string, number: string) => void;
}

const DOC_MIME = 'application/msword;charset=utf-8';

/**
 * Сводный реестр за период.
 *
 * Его просят при сдаче этапа: одной таблицей, что по какому участку
 * оформлено и чего не хватает. Собирать её руками — полдня.
 */
function registryDocHtml(
  rows: ReturnType<typeof actRegistry>,
  from: string,
  to: string,
): string {
  const body = rows.map((r, i) => '<tr>'
    + `<td class="val">${i + 1}</td>`
    + `<td class="lbl">${esc(r.uchastok)}</td>`
    + `<td class="val">${esc(r.number ?? '—')}</td>`
    + `<td class="val">${r.date ? new Date(`${r.date}T00:00:00Z`).toLocaleDateString('ru') : '—'}</td>`
    + `<td class="lbl">${r.missing.length ? esc(`не хватает: ${r.missing.join(', ')}`) : 'оформлен'}</td>`
    + '</tr>').join('');
  const ready = rows.filter((r) => r.missing.length === 0).length;
  return '<h1>СВОДНЫЙ РЕЕСТР ДОКУМЕНТОВ</h1>'
    + `<p class="center">за период ${esc(from)} — ${esc(to)}</p>`
    + `<p>Всего участков: <span class="b">${rows.length}</span>, оформлено полностью: `
    + `<span class="b">${ready}</span>.</p>`
    + '<table class="act"><tr>'
    + '<td class="val b">№</td><td class="lbl b">Участок</td><td class="val b">Номер акта</td>'
    + '<td class="val b">Дата</td><td class="lbl b">Состояние</td></tr>'
    + body + '</table>';
}

function wordPage(title: string, body: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>@page { size: A4; margin: 1.5cm; } body { margin: 0; }
${ACT_DOC_CSS}</style></head><body class="act-doc">${body}</body></html>`;
}

export default function DocsView({
  journal, from, to, contractor, author, onFlash, onOpenSection, onSetActNumber,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [prices, setPrices] = useState<WorkPrices>({});

  const registry = useMemo(() => actRegistry(journal.actFields ?? {}), [journal.actFields]);
  const sheet = useMemo(
    () => volumeSheet(journal.ground, { from, to, contractor }),
    [journal.ground, from, to, contractor],
  );
  const report = useMemo(
    () => periodReport(journal.ground, { from, to, contractor }),
    [journal.ground, from, to, contractor],
  );
  const pace = useMemo(
    () => paceChange(journal.ground, { from, to, contractor }),
    [journal.ground, from, to, contractor],
  );
  const readiness = useMemo(
    () => snpReadiness(effectiveProgress(journal.progress, journal)),
    [journal],
  );

  const contractors = useMemo(
    () => [...new Set(journal.ground.map((e) => e.contractor).filter((v): v is string => !!v))]
      .sort((a, b) => a.localeCompare(b, 'ru')),
    [journal.ground],
  );

  function save(name: string, html: string) {
    downloadText(name, html, DOC_MIME);
    onFlash?.(`Файл собран: ${name}`);
  }

  /**
   * Пакет за период.
   *
   * «Пришлите за неделю» — это не один файл, а четыре, и собирают их
   * из трёх разных экранов. Складываем в один архив.
   */
  async function pack() {
    setBusy(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      // Раскладываем по папкам: в почте архив из двадцати файлов вперемешку
      // открывают один раз, а потом просят «пришлите нормально».
      const svod = zip.folder('Сводные') ?? zip;
      svod.file(volumeDocFile({ sheet }), volumeDocPage({ sheet, contractor }));
      svod.file(
        periodDocFile({ report, contractor }),
        periodDocPage({ report, pace, contractor, author }),
      );
      svod.file('Справка о готовности.doc',
        wordPage('Справка о готовности', readinessDocHtml(readiness)));

      // Акты по участкам, у которых за период была работа. Участок без
      // заполненных полей в пакет не кладём: пустой бланк в архиве
      // выглядит готовым документом, а он не готов.
      for (const uchastok of report.sections.map((s) => s.uchastok)) {
        const fields = journal.actFields?.[uchastok];
        if (!fields?.actNumber) continue;
        const rows = journal.ground.filter(
          (x) => x.uchastok.trim().toLowerCase() === uchastok.trim().toLowerCase(),
        );
        if (rows.length === 0) continue;
        const totals = computeSectionAct(rows, journal.deviations);
        const sample = rows[0];
        // Область / район / участок — так их и ищут потом в почте.
        const where = [sample.oblast, sample.rayon, uchastok]
          .filter(Boolean)
          .map((x) => String(x).replace(/[\\/:*?"<>|]+/g, ' ').trim())
          .join('/');
        const folder = zip.folder(where || 'Участки') ?? zip;
        for (const kind of ['ASR', 'OSR'] as ActKind[]) {
          folder.file(
            actFileName(kind, uchastok, fields.actDate),
            actDocHtml({
              kind,
              uchastok,
              fields,
              totals,
              variants: totals.variants,
              oblast: sample.oblast,
              rayon: sample.rayon,
              contractor,
              dateFrom: totals.dateFrom,
              dateTo: totals.dateTo,
            }),
          );
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(`Пакет документов ${from}—${to}.zip`, blob);
      onFlash?.('Пакет собран');
    } catch (err) {
      onFlash?.(err instanceof Error ? `Не собралось: ${err.message}` : 'Не собралось');
    } finally {
      setBusy(false);
    }
  }

  const photosInPeriod = useMemo(
    () => journal.photos.filter((p) => {
      const day = (p.exifAt || p.takenAt || p.createdAt || '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    }),
    [journal.photos, from, to],
  );

  const cost = costSheet(sheet, prices);

  return (
    <div className="p-3 space-y-3">
      {/* Пакет */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
        <div className="text-[13px] font-semibold text-[var(--text)]">За период</div>
        <div className="text-[11.5px] text-[var(--text-muted)]">
          {from} — {to}
          {contractor ? ` · ${contractor}` : ''}
          {' · '}
          {Math.round(report.meters).toLocaleString('ru')} м за {report.shifts} смен
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" className="btn btn-primary text-[11.5px]"
                  onClick={pack} disabled={busy || report.shifts === 0}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
            Пакет одним архивом
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  disabled={sheet.rows.length === 0}
                  onClick={() => save(volumeDocFile({ sheet }), volumeDocPage({ sheet, contractor }))}>
            <FileDown size={14} />Ведомость объёмов
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  disabled={report.shifts === 0}
                  onClick={() => save(
                    periodDocFile({ report, contractor }),
                    periodDocPage({ report, pace, contractor, author }),
                  )}>
            <FileDown size={14} />Отчёт за период
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  onClick={() => {
                    const w = weekRange(to || new Date().toISOString().slice(0, 10));
                    const weekly = periodReport(journal.ground, { ...w, contractor });
                    save(
                      periodDocFile({ report: weekly, contractor }),
                      periodDocPage({
                        report: weekly,
                        pace: paceChange(journal.ground, { ...w, contractor }),
                        contractor,
                        author,
                        title: 'НЕДЕЛЬНЫЙ ОТЧЁТ О ВЫПОЛНЕННЫХ РАБОТАХ',
                      }),
                    );
                  }}>
            <FileDown size={14} />Недельный
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  disabled={readiness.length === 0}
                  onClick={() => save('Справка о готовности.doc',
                    wordPage('Справка о готовности', readinessDocHtml(readiness)))}>
            <FileDown size={14} />Справка по сёлам
          </button>
        </div>
        {contractors.length > 0 && (
          <div className="text-[11px] text-[var(--text-muted)]">
            Отчёт по одному подрядчику: выберите его в фильтре сверху —
            в документ попадут только его смены.
          </div>
        )}
      </div>

      {/* Стоимость по факту */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
        <div className="text-[13px] font-semibold text-[var(--text)]">Стоимость по факту</div>
        <div className="text-[11.5px] text-[var(--text-muted)]">
          Впишите расценку за единицу — сумма посчитается. Позиция без расценки
          стоит не ноль, а неизвестно сколько, и в итог не войдёт.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {sheet.rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <label htmlFor={`price-${r.key}`}
                     className="text-[11.5px] text-[var(--text-muted)] min-w-0 flex-1 truncate">
                {r.label}
                <span className="text-[10px]"> · {r.quantity.toLocaleString('ru')} {r.unit}</span>
              </label>
              <input
                id={`price-${r.key}`}
                type="text"
                inputMode="decimal"
                value={prices[r.key] === undefined ? '' : String(prices[r.key])}
                onChange={(ev) => {
                  const v = Number(ev.target.value.replace(',', '.'));
                  setPrices((p) => ({
                    ...p,
                    [r.key]: Number.isFinite(v) && v > 0 ? v : undefined,
                  }));
                }}
                placeholder="₸"
                className="w-20 bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                           px-1.5 py-1 text-[11.5px] text-[var(--text)] font-mono tabular-nums"
              />
            </div>
          ))}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] text-[var(--text-muted)]">Итого</span>
          <span className="font-mono tabular-nums text-[14px] text-[var(--accent)]">
            {cost.total.toLocaleString('ru', { maximumFractionDigits: 2 })} ₸
          </span>
          <button type="button" className="btn btn-ghost text-[11.5px] ml-auto"
                  disabled={cost.total === 0}
                  onClick={() => save(
                    volumeDocFile({ sheet, cost }),
                    volumeDocPage({ sheet, cost, contractor, customer: 'АО «Транстелеком»' }),
                  )}>
            <FileDown size={14} />КС-2
          </button>
        </div>
        {cost.unpriced.length > 0 && (
          <div className="text-[11px] text-[var(--warn)]">
            Без расценки: {cost.unpriced.join(', ')}.
          </div>
        )}
      </div>

      {/* Документы объекта */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
        <div className="text-[13px] font-semibold text-[var(--text)]">Документы объекта</div>
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  disabled={report.sections.length === 0}
                  onClick={() => {
                    // Акт скрытых работ подписывают до засыпки — по тому
                    // участку, который сейчас закрывают.
                    const uchastok = report.sections[0].uchastok;
                    const rows = journal.ground.filter((x) => x.uchastok === uchastok);
                    const input = {
                      uchastok, rows, contractor,
                      customer: 'АО «Транстелеком»',
                      oblast: rows[0]?.oblast, rayon: rows[0]?.rayon,
                      date: to,
                    };
                    save(hiddenWorksFile(input), hiddenWorksPage(input));
                  }}>
            <FileDown size={14} />Акт скрытых работ
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  disabled={journal.deviations.length === 0}
                  onClick={() => save('Реестр замечаний.doc',
                    remarksPage(remarksFromDeviations(journal.deviations)))}>
            <FileDown size={14} />Реестр замечаний
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  disabled={busy || photosInPeriod.length === 0}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      // Снимки лежат на устройстве: вкладываем их в
                      // документ целиком, иначе отчёт придёт без картинок.
                      const items = await Promise.all(photosInPeriod.slice(0, 60).map(
                        async (photo) => {
                          const blob = await getPhotoBlob(photo.id);
                          if (!blob) return { photo };
                          const dataUrl = await new Promise<string | undefined>((res) => {
                            const fr = new FileReader();
                            fr.onload = () => res(String(fr.result));
                            fr.onerror = () => res(undefined);
                            fr.readAsDataURL(blob);
                          });
                          return { photo, dataUrl };
                        },
                      ));
                      save('Фотоотчёт.doc', photoReportPage({
                        title: 'ФОТООТЧЁТ О ВЫПОЛНЕННЫХ РАБОТАХ',
                        from, to, items,
                      }));
                    } finally { setBusy(false); }
                  }}>
            <FileDown size={14} />Фотоотчёт ({photosInPeriod.length})
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  disabled={journal.splices.length === 0}
                  onClick={() => {
                    // Рефлектограмму снимают на объекте, цифры переписывают
                    // в тетрадь, потом в Word — и на каждом переписывании
                    // теряется волокно. Все они уже в журнале сварки.
                    const first = journal.splices[0];
                    const obj = journal.objects.find((o) => o.id === first.objectId);
                    const records = journal.splices.filter(
                      (sp) => sp.objectId === first.objectId,
                    );
                    const input = {
                      objectName: obj?.name || 'Муфта',
                      uchastok: obj?.uchastok,
                      records,
                      contractor,
                      customer: 'АО «Транстелеком»',
                      date: to,
                    };
                    save(measureProtocolFile(input), measureProtocolPage(input));
                  }}>
            <FileDown size={14} />Протокол измерений
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  disabled={registry.length === 0}
                  onClick={() => save('Сводный реестр.doc',
                    wordPage('Сводный реестр документов', registryDocHtml(registry, from, to)))}>
            <FileDown size={14} />Сводный реестр
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  onClick={() => {
                    const subject = window.prompt('Тема письма:', 'О выполненных объёмах');
                    if (subject === null) return;
                    save('Письмо.doc', letterPage({
                      to: 'АО «Транстелеком»',
                      subject,
                      date: to,
                      from: author,
                      body: `За период с ${from} по ${to} выполнено `
                        + `${Math.round(report.meters).toLocaleString('ru')} м `
                        + `(${(report.meters / 1000).toFixed(2).replace('.', ',')} км) `
                        + `за ${report.shifts} смен.\n`
                        + `Участки: ${report.sections.map((x) => x.uchastok).join('; ')}.\n`
                        + 'Просим рассмотреть и принять выполненные работы.',
                    }));
                  }}>
            <FileDown size={14} />Письмо заказчику
          </button>
        </div>
        <div className="text-[10.5px] text-[var(--text-muted)]">
          Цифры в письмо подставляются из журнала: перенесённые руками, они
          через неделю перестают сходиться с актом.
        </div>
      </div>

      {/* Реестр актов */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
        <div className="text-[13px] font-semibold text-[var(--text)]">
          Реестр актов: {registry.length}
        </div>
        {registry.length === 0 ? (
          <div className="text-[11.5px] text-[var(--text-muted)]">
            Актов пока нет. Они появляются, когда закрывают участок.
          </div>
        ) : registry.map((r) => (
          <div key={r.uchastok} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <button type="button"
                      onClick={() => onOpenSection?.(r.uchastok)}
                      className="block text-[12.5px] text-[var(--text)] truncate text-left
                                 hover:text-[var(--accent)]">
                {r.uchastok}
              </button>
              <span className="block text-[10.5px] text-[var(--text-muted)]">
                {r.number || 'без номера'}
                {r.date ? ` · ${new Date(`${r.date}T00:00:00Z`).toLocaleDateString('ru')}` : ''}
              </span>
            </span>
            {r.duplicate && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--danger)]
                               text-[var(--danger)]" title="Такой номер уже есть у другого акта">
                номер задвоен
              </span>
            )}
            {r.missing.length > 0 ? (
              <span className="text-[10.5px] text-[var(--warn)] inline-flex items-center gap-1"
                    title={`Не хватает: ${r.missing.join(', ')}`}>
                <AlertTriangle size={12} />
                {r.missing.length}
              </span>
            ) : (
              <Check size={13} className="text-[var(--accent)]" />
            )}
            {!r.number && onSetActNumber && (
              <button type="button" className="btn btn-ghost btn-icon"
                      title="Выдать следующий свободный номер"
                      onClick={() => {
                        const n = nextActNumber(journal.actFields ?? {}, 'ASR');
                        onSetActNumber(r.uchastok, n);
                        onFlash?.(`Номер выдан: ${n}`);
                      }}>
                <Hash size={13} />
              </button>
            )}
          </div>
        ))}
        <div className="text-[10.5px] text-[var(--text-muted)]">
          Следующий свободный: {formatActNumber('ASR', new Date().getFullYear(), 0).slice(0, 9)}…
          {' '}{nextActNumber(journal.actFields ?? {}, 'ASR')}
        </div>
      </div>
    </div>
  );
}
