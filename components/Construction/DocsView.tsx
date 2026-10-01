'use client';
import { useMemo, useState } from 'react';
import {
  FileDown, Package, AlertTriangle, Check, Hash, Loader2, Copy,
  Link as LinkIcon,
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
import { prepareSectionAct, sectionActDocInput, actFieldsOf } from './actInput';
import { unmarkedActFields } from './sectionAct';
import { effectiveProgress } from './stageDerive';
import {
  hiddenWorksPage, hiddenWorksFile, remarksFromDeviations, remarksPage,
  photoReportPage, letterPage, measureProtocolPage, measureProtocolFile,
} from './fieldDocs';
import {
  buildScheme, schemeDocPage, schemeFileName, withSchemeAttached,
  schemeObjectsFor, displacedMarks, spanMismatches,
} from './asBuilt';
import { withDefaults, missingForPayment, binLooksWrong } from './requisites';
import { normName } from './areaImport';
import {
  loadBilingual, saveBilingual, loadTerms, BILINGUAL_LABEL, type Bilingual,
} from './bilingual';
import {
  buildDocx, docxFileName, loadDocFormat, saveDocFormat,
  DOC_FORMATS, DOC_FORMAT_LABEL, DOC_FORMAT_HINT, type DocFormat,
} from './docxExport';
import { htmlToPdfBlob, pdfFileName } from '@/lib/pdf';
import { shareDocument } from '@/lib/supabase';
import { journalCloudEnabled } from './journalRemote';
import {
  LINK_LIVES, DEFAULT_LINK_LIFE, lifeByKey, linkMessage, validFor,
} from '@/lib/docLink';
import { errorLine } from '@/lib/errors';
import { getPhotoBlob } from './photoStore';
import { downloadText, downloadBlob } from '@/lib/download';
import { toCsv, csvBlob } from '@/lib/csv';
import { LAY_METHODS, LAY_METHOD_LABEL } from '@/types/construction';

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
  /**
   * Развернуть трассу: схема начнётся с другого конца. Это та же правка,
   * что и на карте, — метры смен и колонна развернутся вместе со схемой,
   * иначе схема спорила бы с журналом.
   */
  onReverseRoute?: (routeId: string) => void;
}

const DOC_MIME = 'application/msword;charset=utf-8';

/** Участок в KML и в журнале пишут по-разному — сверяем нестрого. */
const normLoose = (v: string | undefined) => normName(v ?? '');

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
  onReverseRoute,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [prices, setPrices] = useState<WorkPrices>({});
  const [schemeRouteId, setSchemeRouteId] = useState('');
  const [linkLife, setLinkLife] = useState(DEFAULT_LINK_LIFE.key);
  // Без облака ссылку давать неоткуда: документ останется файлом.
  const cloudReady = journalCloudEnabled();
  const [link, setLink] = useState<
    { url: string; until: string; text: string; subject: string } | null
  >(null);
  const [format, setFormat] = useState<DocFormat>(() => loadDocFormat());
  const [lang, setLang] = useState<Bilingual>(() => loadBilingual());
  const docTerms = useMemo(() => loadTerms(), []);

  /**
   * Реквизиты берём из журнала, а не из кода.
   *
   * Подряд меняется: сегодня работы идут под одним заказчиком, завтра
   * под другим. Название, зашитое в программу, приходится править в
   * каждом выгруженном документе руками.
   */
  const req = useMemo(() => withDefaults(journal.requisites), [journal.requisites]);
  const partyNames = useMemo(
    () => ({ contractor: contractor || req.contractor.name, customer: req.customer.name }),
    [contractor, req],
  );

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

  /**
   * Трасса под схему.
   *
   * По умолчанию — та, что относится к участку, который сейчас закрывают:
   * схему просят именно под сдачу. Если такой нет, берём первую: пустой
   * выбор в списке хуже, чем не тот, который можно переключить.
   */
  const schemeRoute = useMemo(() => {
    const byId = journal.planRoutes.find((r) => r.id === schemeRouteId);
    if (byId) return byId;
    const uchastok = report.sections[0]?.uchastok;
    return journal.planRoutes.find((r) => r.uchastok === uchastok) ?? journal.planRoutes[0];
  }, [journal.planRoutes, schemeRouteId, report.sections]);

  // Объекты берём только своего участка: на соседнем стоят свои муфты, и
  // на схеме они окажутся чужими отметками с правдоподобным метражом.
  // Своих нет — схема остаётся с одними концами и так и говорит, а не
  // добирает чужие.
  const schemeObjects = useMemo(
    () => (schemeRoute
      ? schemeObjectsFor(journal.objects, schemeRoute.uchastok || schemeRoute.name)
      : { own: [], unassigned: [] }),
    [journal.objects, schemeRoute],
  );

  const scheme = useMemo(
    () => (schemeRoute
      ? buildScheme(schemeRoute, schemeObjects.own, { unassigned: schemeObjects.unassigned })
      : null),
    [schemeRoute, schemeObjects],
  );

  /**
   * Сохранить документ.
   *
   * HTML с расширением .doc открывается только настольным Вордом, да и
   * тот ругается. Тот же документ, собранный настоящим пакетом,
   * открывается Вордом на телефоне и Гугл-Документами — а куратор
   * читает его из машины.
   */
  async function save(name: string, html: string, landscape = false) {
    if (format === 'doc') {
      downloadText(name, html, DOC_MIME);
      onFlash?.(`Файл собран: ${name}`);
      return;
    }
    if (format === 'pdf') {
      // Снимок страницы делает браузер, и на длинном документе это
      // занимает секунды: без отметки о работе кнопка выглядит нажатой
      // впустую, и её жмут ещё раз.
      setBusy(true);
      try {
        const file = pdfFileName(name);
        downloadBlob(file, await htmlToPdfBlob(html, ACT_DOC_CSS, { landscape }));
        onFlash?.(`Файл собран: ${file}`);
      } catch {
        onFlash?.('PDF не собрался. Сохраните в Word — документ тот же.');
      } finally {
        setBusy(false);
      }
      return;
    }
    const file = docxFileName(name);
    downloadBlob(file, await buildDocx(html, { landscape }));
    onFlash?.(`Файл собран: ${file}`);
  }

  /**
   * Собрать документ тем же способом, что и на сохранение.
   *
   * Отдельно от самого сохранения, потому что ссылке нужен не скачанный
   * файл, а его содержимое: имя и способ должны совпадать, иначе по
   * ссылке уйдёт не то, что отдали вложением.
   */
  async function buildFile(
    name: string, html: string, landscape: boolean,
  ): Promise<{ blob: Blob; ext: string }> {
    if (format === 'doc') {
      return { blob: new Blob([html], { type: DOC_MIME }), ext: 'doc' };
    }
    if (format === 'pdf') {
      return { blob: await htmlToPdfBlob(html, ACT_DOC_CSS, { landscape }), ext: 'pdf' };
    }
    return { blob: await buildDocx(html, { landscape }), ext: 'docx' };
  }

  /**
   * Отдать ссылкой, а не файлом.
   *
   * Акт уходит вложением, потом в нём находят ошибку, отправляют второй —
   * и у заказчика их два, а какой верный, видно только по дате письма.
   * Ссылка одна, и по ней всегда то, что лежит сейчас.
   */
  async function share(kind: string, subject: string, html: string, landscape = false) {
    setBusy(true);
    try {
      const { blob, ext } = await buildFile(subject, html, landscape);
      const life = lifeByKey(linkLife);
      const { url, until } = await shareDocument(kind, subject, ext, blob, life);
      const text = linkMessage(subject, url, life, until);
      setLink({ url, until, text, subject });
      try {
        await navigator.clipboard.writeText(text);
        onFlash?.(`Ссылка скопирована, ${validFor(until, new Date())}`);
      } catch {
        onFlash?.('Ссылка готова — скопируйте её ниже');
      }
    } catch (e) {
      onFlash?.(errorLine(e, 'собрать ссылку'));
    } finally {
      setBusy(false);
    }
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
      // Что в актах осталось неотмеченным: архив уходит в почту целиком, и
      // пустую графу рекультивации там заметят уже у заказчика.
      const unmarked: string[] = [];
      // В пакет кладём то же, что и по одному: переключатель формата
      // общий, иначе в архиве окажется не то, что человек выбрал.
      // В архив кладём Word, даже когда по одному сохраняют в PDF: снимок
      // каждой страницы — это минуты на пакет из двадцати документов, а
      // пакет собирают, чтобы отправить его сейчас.
      const put = async (folder: InstanceType<typeof JSZip>, name: string, html: string) => {
        if (format === 'doc') folder.file(name, html);
        else folder.file(docxFileName(name), await buildDocx(html));
      };

      // Раскладываем по папкам: в почте архив из двадцати файлов вперемешку
      // открывают один раз, а потом просят «пришлите нормально».
      const svod = zip.folder('Сводные') ?? zip;
      await put(svod, volumeDocFile({ sheet }), volumeDocPage({ sheet, contractor }));
      await put(
        svod,
        periodDocFile({ report, contractor }),
        periodDocPage({ report, pace, contractor, author }),
      );
      await put(svod, 'Справка о готовности.doc',
        wordPage('Справка о готовности', readinessDocHtml(readiness)));

      // Акты по участкам, у которых за период была работа. Участок без
      // заполненных полей в пакет не кладём: пустой бланк в архиве
      // выглядит готовым документом, а он не готов.
      for (const uchastok of report.sections.map((s) => s.uchastok)) {
        if (!actFieldsOf(journal.actFields, uchastok)?.actNumber) continue;
        // Акт собирается тем же кодом, что и в «Закрытии»: со своими
        // отклонениями, своим исполнителем и теми же полями бланка.
        // Раньше сюда шли отклонения всего журнала, и участок худел на
        // чужую скалу, а исполнитель оставался прочерком.
        const prep = prepareSectionAct(journal, uchastok);
        if (prep.entries.length === 0 || prep.totals.variants.length === 0) continue;
        const fields = prep.fields;
        const gaps = unmarkedActFields(fields);
        if (gaps.length) unmarked.push(`${uchastok} — ${gaps.join(', ')}`);
        // Область / район / участок — так их и ищут потом в почте.
        const where = [prep.oblast, prep.rayon, uchastok]
          .filter(Boolean)
          .map((x) => String(x).replace(/[\\/:*?"<>|]+/g, ' ').trim())
          .join('/');
        const folder = zip.folder(where || 'Участки') ?? zip;
        /**
         * Схема — приложением к акту, а не отдельным файлом.
         *
         * Отдельный файл по дороге теряется: акт дошёл, схема осталась
         * в папке «Загрузки». Берём трассу этого же участка; если её
         * нет — акт уходит как есть, без выдуманной схемы.
         */
        const own = journal.planRoutes.find((r) => normLoose(r.uchastok) === normLoose(uchastok))
          ?? journal.planRoutes.find((r) => normLoose(r.name) === normLoose(uchastok));
        const attachment = own
          ? (() => {
            const objs = schemeObjectsFor(journal.objects, uchastok);
            return buildScheme(own, objs.own, { unassigned: objs.unassigned });
          })()
          : null;

        for (const kind of ['ASR', 'OSR'] as ActKind[]) {
          const body = actDocHtml(sectionActDocInput(prep, kind));
          await put(
            folder,
            actFileName(kind, uchastok, fields.actDate),
            attachment
              ? withSchemeAttached(
                body, { scheme: attachment, lang, terms: docTerms }, fields.actNumber,
              )
              : body,
          );
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(`Пакет документов ${from}—${to}.zip`, blob);
      onFlash?.(unmarked.length
        ? `Пакет собран. В актах не отмечено: ${unmarked.join('; ')}`
        : 'Пакет собран');
    } catch (err) {
      onFlash?.(errorLine(err, 'собрать пакет'));
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
      {/*
        Чего не хватает в реквизитах.
        Про это вспоминают, когда акт уже ушёл и вернулся из бухгалтерии.
      */}
      {missingForPayment(req).length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/40
                        bg-[var(--warn)]/10 px-3 py-2 text-[11.5px] text-[var(--warn)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            В реквизитах не хватает: {missingForPayment(req).join(', ')}.
            <span className="block text-[var(--text-muted)]">
              Документы соберутся и так, но акт на оплату без этого в бухгалтерии
              развернут. Заполняется один раз — вкладка «Реквизиты».
            </span>
          </span>
        </div>
      )}
      {(binLooksWrong(req.contractor.bin) || binLooksWrong(req.customer.bin)) && (
        <div className="text-[11px] text-[var(--warn)]">
          БИН похож на опечатку: в нём двенадцать цифр.
        </div>
      )}

      {/* Язык бланка. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-[var(--text-muted)]">Бланк</span>
        {(['off', 'kk-ru', 'ru-kk'] as Bilingual[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setLang(m); saveBilingual(m); }}
            className={`chip ${m === lang ? 'chip-on' : ''}`}
          >
            {BILINGUAL_LABEL[m]}
          </button>
        ))}
      </div>
      {lang !== 'off' && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/40
                        bg-[var(--warn)]/10 px-3 py-2 text-[11.5px] text-[var(--warn)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Сверьте термины перед первым документом.
            <span className="block text-[var(--text-muted)]">
              Перевод шапок взят из типовых бланков, но подписью его никто не
              заверял. Ошибка в шапке документа, который подписывают, обходится
              дороже, чем его отсутствие — посмотрите глазами один раз.
            </span>
          </span>
        </div>
      )}

      {/* Формат — общий для всех документов на этом экране. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-[var(--text-muted)]">Сохранять как</span>
        {DOC_FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => { setFormat(f); saveDocFormat(f); }}
            title={DOC_FORMAT_HINT[f]}
            className={`chip ${f === format ? 'chip-on' : ''}`}
          >
            {DOC_FORMAT_LABEL[f]}
          </button>
        ))}
        <span className="w-full text-[10.5px] text-[var(--text-muted)]">
          {DOC_FORMAT_HINT[format]}
        </span>
      </div>

      {/* Ссылка вместо файла */}
      {cloudReady && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-[var(--text-muted)]">Ссылка живёт</span>
          {LINK_LIVES.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLinkLife(l.key)}
              title={l.hint}
              className={`chip ${l.key === linkLife ? 'chip-on' : ''}`}
            >
              {l.label}
            </button>
          ))}
          <span className="w-full text-[10.5px] text-[var(--text-muted)]">
            Заказчику не нужен вход: ссылка подписанная. Срок нужен потому, что
            письма пересылают, а папки «Загрузки» живут годами.
          </span>
        </div>
      )}

      {link && (
        <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)]
                        p-3 space-y-2">
          <div className="flex items-baseline gap-2">
            <LinkIcon size={13} className="text-[var(--accent)]" />
            <span className="text-[12.5px] font-semibold text-[var(--text)] min-w-0 flex-1 truncate">
              {link.subject}
            </span>
            <span className="text-[10.5px] text-[var(--text-muted)] shrink-0">
              {validFor(link.until, new Date())}
            </span>
          </div>
          <textarea
            readOnly
            value={link.text}
            rows={4}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Письмо со ссылкой"
            className="w-full bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                       px-2 py-1.5 text-[11px] text-[var(--text)] font-mono"
          />
          <div className="flex gap-1.5 flex-wrap">
            <button type="button" className="btn btn-ghost text-[11px]"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link.text);
                        onFlash?.('Скопировано');
                      } catch {
                        onFlash?.('Выделите текст и скопируйте вручную');
                      }
                    }}>
              <Copy size={13} />Скопировать письмо
            </button>
            <button type="button" className="btn btn-ghost text-[11px]"
                    onClick={() => setLink(null)}>
              Закрыть
            </button>
          </div>
          <div className="text-[10.5px] text-[var(--text-muted)] leading-snug">
            Соберёте документ заново — по этой же ссылке будет новая версия.
            Перезапрашивать её заказчику не нужно.
          </div>
        </div>
      )}

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
          {cloudReady && (
            <button type="button" className="btn btn-ghost text-[11.5px]"
                    disabled={busy || report.shifts === 0}
                    title="Отдать ссылкой: заказчик всегда открывает текущую версию"
                    onClick={() => share(
                      'отчёт за период',
                      `Отчёт за период ${from} — ${to}`,
                      periodDocPage({ report, pace, contractor, author }),
                    )}>
              <LinkIcon size={14} />Ссылкой
            </button>
          )}
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
          {/* Бухгалтерия в 1С, руководитель в Google Таблицах. Писать
              интеграцию с каждым — годы; отдать таблицу, которую они и
              так читают, — один файл. */}
          {(['excel-ru', 'plain'] as const).map((dialect) => (
            <button
              key={dialect}
              type="button"
              className="btn btn-ghost text-[11.5px]"
              disabled={report.shifts === 0}
              title={dialect === 'excel-ru'
                ? 'CSV для 1С и русского Excel: точка с запятой, запятая в дробях'
                : 'CSV для Google Таблиц: запятая, точка в дробях'}
              onClick={() => {
                const rows = journal.ground
                  .filter((e) => (!from || e.date >= from) && (!to || e.date <= to)
                    && (!contractor || e.contractor === contractor))
                  .map((e) => [
                    e.date, e.oblast, e.rayon ?? '', e.uchastok, e.kato,
                    e.contractor ?? '', e.column ?? '', e.smu,
                    ...LAY_METHODS.map((m) => e.byMethod[m] ?? 0),
                    e.drillM ?? 0, e.drillCount ?? 0, e.blowingM ?? 0,
                    e.note ?? '', e.downtime ?? '', e.author ?? '',
                  ]);
                const headers = [
                  'Дата', 'Область', 'Район', 'Участок', 'КАТО',
                  'Подрядчик', 'Колонна', 'СМУ',
                  ...LAY_METHODS.map((m) => LAY_METHOD_LABEL[m]),
                  'ГНБ, м', 'Проколов', 'Задувка, м',
                  'Примечание', 'Простой', 'Автор',
                ];
                downloadBlob(
                  `Журнал ${from || 'всё'}—${to || 'всё'}.csv`,
                  csvBlob(toCsv(headers, rows, { dialect }), dialect),
                );
                onFlash?.('Таблица выгружена');
              }}
            >
              <FileDown size={14} />CSV {dialect === 'excel-ru' ? 'для 1С' : 'для Google'}
            </button>
          ))}
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
                    volumeDocPage({ sheet, cost, contractor, customer: partyNames.customer }),
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
                      customer: partyNames.customer,
                      oblast: rows[0]?.oblast, rayon: rows[0]?.rayon,
                      date: to,
                    };
                    save(hiddenWorksFile(input), hiddenWorksPage(input));
                  }}>
            <FileDown size={14} />Акт скрытых работ
          </button>
          {cloudReady && (
            <button type="button" className="btn btn-ghost text-[11.5px]"
                    disabled={busy || report.sections.length === 0}
                    title="Отдать ссылкой: заказчик всегда открывает текущую версию"
                    onClick={() => {
                      const uchastok = report.sections[0].uchastok;
                      const rows = journal.ground.filter((x) => x.uchastok === uchastok);
                      share('акт скрытых работ', `Акт скрытых работ, ${uchastok}`,
                        hiddenWorksPage({
                          uchastok, rows, contractor,
                          customer: partyNames.customer,
                          oblast: rows[0]?.oblast, rayon: rows[0]?.rayon,
                          date: to,
                        }));
                    }}>
              <LinkIcon size={14} />Ссылкой
            </button>
          )}
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
                      customer: partyNames.customer,
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
                      to: partyNames.customer,
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

      {/* Исполнительная схема */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
        <div className="text-[13px] font-semibold text-[var(--text)]">Исполнительная схема</div>
        {journal.planRoutes.length === 0 ? (
          <div className="text-[11.5px] text-[var(--text-muted)]">
            Схему рисуем по трассе. Загрузите KML — и она соберётся сама.
          </div>
        ) : (
          <>
            <div className="flex gap-1.5 items-center flex-wrap">
              <select
                value={schemeRoute?.id ?? ''}
                onChange={(e) => setSchemeRouteId(e.target.value)}
                aria-label="Трасса для схемы"
                className="min-w-0 flex-1 bg-[var(--bg-canvas)] border border-[var(--border)]
                           rounded px-2 py-1 text-[11.5px] text-[var(--text)]"
              >
                {journal.planRoutes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {(r.lengthM / 1000).toFixed(1).replace('.', ',')} км
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost text-[11.5px]"
                      disabled={!scheme}
                      onClick={() => scheme && save(
                        schemeFileName(scheme.route, to),
                        schemeDocPage({
                          scheme,
                          lang,
                          terms: docTerms,
                          number: registry.find((r) => r.uchastok === schemeRoute?.uchastok)?.number,
                          date: to,
                          contractor,
                          customer: partyNames.customer,
                          oblast: schemeObjects.own[0]?.oblast,
                          rayon: schemeObjects.own[0]?.rayon,
                        }),
                        true,
                      )}>
                <FileDown size={14} />Схема
              </button>
            </div>
            {/* С какого конца начинается лист — спрашивают первым делом:
                схема, начатая от села, когда бригада шла от магистрали,
                читается задом наперёд, и все метры в ней перевёрнуты. */}
            {scheme && schemeRoute && (
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="text-[var(--text)]">
                  Схема идёт от «{scheme.marks.find((m) => m.kind === 'start')?.label}»
                  {' '}к «{scheme.marks.find((m) => m.kind === 'end')?.label}»
                  {schemeRoute.reversed ? ' — счёт развёрнут против файла' : ''}
                </span>
                {onReverseRoute && (
                  <button type="button" className="btn btn-ghost text-[11px]"
                          onClick={() => {
                            if (!window.confirm(
                              'Начать схему с другого конца?\n\nВместе со схемой с другого '
                              + 'конца пойдут метры смен, стрелки на карте и точка колонны. '
                              + 'Вернуть можно в журнале изменений.',
                            )) return;
                            onReverseRoute(schemeRoute.id);
                          }}>
                    ⇄ С другого конца
                  </button>
                )}
              </div>
            )}
            {scheme && (
              <div className="text-[11px] text-[var(--text-muted)]">
                Отметок: {scheme.marks.length}, пролётов: {scheme.spans.length}
                {scheme.spans.some((sp) => sp.measured)
                  ? ` (по замеру из карточек — ${scheme.spans.filter((sp) => sp.measured).length})`
                  : ''},
                {' '}протяжённость {(scheme.totalM / 1000).toFixed(2).replace('.', ',')} км.
              </div>
            )}
            {scheme && spanMismatches(scheme).length > 0 && (
              <div className="text-[11px] text-[var(--warn)]">
                Замер и координаты расходятся: {spanMismatches(scheme).join('; ')}.
                Проверьте пролёт в карточке объекта или его точку.
              </div>
            )}
            {scheme && displacedMarks(scheme).length > 0 && (
              <div className="text-[11px] text-[var(--warn)]">
                В стороне от линии: {displacedMarks(scheme).join('; ')}. На листе они
                отмечены пустым значком, пролёты к ним — со знаком «≈».
              </div>
            )}
            {scheme && scheme.skipped.length > 0 && (
              <div className="text-[11px] text-[var(--warn)]">
                Не отнесены к трассе: {scheme.skipped.join('; ')}. Проверьте координаты.
              </div>
            )}
            {scheme && scheme.unassigned.length > 0 && (
              <div className="text-[11px] text-[var(--warn)]">
                У линии объекты без участка: {scheme.unassigned.join('; ')}. В схему не взяты —
                укажите у них участок.
              </div>
            )}
            {scheme && scheme.marks.length <= 2 && scheme.skipped.length === 0 && (
              <div className="text-[11px] text-[var(--text-muted)]">
                Своих объектов у участка нет — на схеме только концы трассы.
              </div>
            )}
            <div className="text-[10.5px] text-[var(--text-muted)]">
              Линейка, а не карта: важен порядок отметок и расстояния между ними —
              так схему и читают на объекте.
            </div>
          </>
        )}
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
