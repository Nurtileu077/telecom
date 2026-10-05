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
import {
  prepareSectionAct, sectionActDocInput, actFieldsOf, hiddenWorksInputFor, sectionsOf,
} from './actInput';
import { unmarkedActFields } from './sectionAct';
import { effectiveProgress } from './stageDerive';
import {
  hiddenWorksPage, hiddenWorksFile, remarksFromDeviations, remarksPage,
  photoReportPage, letterPage, measureProtocolPage, measureProtocolFile,
  measureProtocolsPage, HIDDEN_BEDDING_DEFAULT, HIDDEN_BACKFILL_DEFAULT, hiddenDepth,
  type PhotoReportItem,
} from './fieldDocs';
import {
  measuredObjects, measuredInPeriod, measureInput, otdrAttached, otdrFileName, otdrKey,
  type MeasuredObject,
} from './otdr';
import {
  groupPhotos, splitPhotoReport, photosInRange, photoReportFileName, PHOTOS_PER_PART,
} from './photoReport';
import type { FieldPhoto, SpliceRecord } from '@/types/construction';
import type { SectionActManual } from './sectionAct';
import {
  buildScheme, schemeDocPage, schemeFileName, withSchemeAttached,
  schemeObjectsFor, displacedMarks, spanMismatches, unassignedNote,
} from './asBuilt';
import { routeOfSection, sectionForRoute, sectionMatchesRoute } from './routeSection';
import { withDefaults, missingForPayment, binLooksWrong } from './requisites';
import { normName } from './areaImport';
import { placeNames, routeViews, directionHint } from './routeStyle';
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
  /** Поля бланка участка — песок, засыпка: их вписывают у акта скрытых работ. */
  onChangeActFields?: (uchastok: string, patch: Partial<SectionActManual>) => void;
  /**
   * Развернуть трассу: схема начнётся с другого конца. Это та же правка,
   * что и на карте, — метры смен и колонна развернутся вместе со схемой,
   * иначе схема спорила бы с журналом.
   */
  onReverseRoute?: (routeId: string) => void;
  /**
   * Подписи концов наоборот названию — та же правка, что в карточке
   * трассы на карте: концы на карте и на листе меняются вместе.
   */
  onSwapRouteEnds?: (routeId: string) => void;
  /**
   * Сёла, по которым карта узнаёт концы трасс (`journalPlaces` всего
   * журнала). `journal` здесь сужен выбранной областью, а карта — нет:
   * без этого лист называл бы начало линии не тем селом, что карта.
   */
  places?: Set<string>;
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

/**
 * Файл снимка или рефлектограммы — с устройства, а если он уже ушёл в
 * облако, то по ссылке.
 *
 * После отправки локальная копия удаляется, и раньше фотоотчёт по уже
 * отправленным снимкам выходил сплошь из «[снимок не вложен]».
 */
async function fileOf(localKey: string, url?: string): Promise<Blob | null> {
  const local = await getPhotoBlob(localKey);
  if (local) return local;
  if (!url) return null;
  try {
    const res = await fetch(url);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

function dataUrlOf(blob: Blob): Promise<string | undefined> {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => res(undefined);
    fr.readAsDataURL(blob);
  });
}

const otdrBlob = (r: SpliceRecord) => fileOf(otdrKey(r.id), r.otdrUrl);
const photoBlob = (p: FieldPhoto) => fileOf(p.id, p.url);

/** Куда в архиве класть документ: всё, у чего есть метод file. */
type ZipFolder = { file: (name: string, data: string | Blob) => unknown };

export default function DocsView({
  journal, from, to, contractor, author, onFlash, onOpenSection, onSetActNumber,
  onChangeActFields, onReverseRoute, onSwapRouteEnds, places: mapPlaces,
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
  // Неделя сплошного дождя — тоже отчёт: смены простоя в него входят, и
  // кнопка не должна гаснуть только потому, что метров ноль.
  const anyShift = report.shifts + report.idleShifts > 0;
  const progressNow = useMemo(() => effectiveProgress(journal.progress, journal), [journal]);
  const readiness = useMemo(() => snpReadiness(progressNow), [progressNow]);
  // Сёла, по которым узнаём концы в названии трассы, — те же, что у карты:
  // схема и подписи на линии должны называть концы одинаково. Журнал здесь
  // сужен областью, поэтому сёла приходят от панели, по всему журналу.
  const places = useMemo(
    () => mapPlaces ?? placeNames(progressNow),
    [mapPlaces, progressNow],
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
    // Трассу участка ищем тем же правилом, что форма смены и пакет:
    // участок «Акбеит» и трасса «ОМ — Акбеит» без папки — одно и то же.
    return routeOfSection(journal.planRoutes, report.sections[0]?.uchastok)
      ?? journal.planRoutes[0];
  }, [journal.planRoutes, schemeRouteId, report.sections]);

  // Объекты берём только своего участка: на соседнем стоят свои муфты, и
  // на схеме они окажутся чужими отметками с правдоподобным метражом.
  // Своих нет — схема остаётся с одними концами и так и говорит, а не
  // добирает чужие.
  const schemeObjects = useMemo(
    () => schemeObjectsFor(journal.objects, schemeRoute),
    [journal.objects, schemeRoute],
  );

  // Какой участок назвать объектам без участка: тот, под которым по этой
  // трассе пишут смены, — с ним объект попадёт и в схему, и в протоколы.
  const schemeSection = useMemo(
    () => (schemeRoute ? sectionForRoute(schemeRoute, journal.ground.map((e) => e.uchastok)) : undefined),
    [schemeRoute, journal.ground],
  );

  const scheme = useMemo(
    () => (schemeRoute
      ? buildScheme(schemeRoute, schemeObjects.own, {
        unassigned: schemeObjects.unassigned,
        others: schemeObjects.others,
        section: schemeSection,
        places,
      })
      : null),
    [schemeRoute, schemeObjects, schemeSection, places],
  );

  // Та же трасса глазами карты: по обводкам сёл видно, не начинается ли
  // счёт посреди села, куда трасса ведёт, — до подписи листа, а не после.
  const schemeHint = useMemo(() => {
    if (!schemeRoute) return null;
    // Подписи — по тем же сёлам, что у листа: иначе подсказка спорила бы
    // с концами, которые лист называет строкой выше.
    const [v] = routeViews([schemeRoute], { progress: progressNow, areas: journal.areas, places });
    return v ? directionHint(v) : null;
  }, [schemeRoute, progressNow, journal.areas, places]);

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
   * Документ в архив.
   *
   * В архив кладём Word, даже когда по одному сохраняют в PDF: снимок
   * каждой страницы — это минуты на пакет из двадцати документов, а
   * пакет собирают, чтобы отправить его сейчас.
   */
  async function putDoc(folder: ZipFolder, name: string, html: string) {
    if (format === 'doc') folder.file(name, html);
    else folder.file(docxFileName(name), await buildDocx(html));
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
      const put = putDoc;
      let protocols = 0;

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
        // Акт собирается тем же кодом, что и в «Закрытии»: со своими
        // отклонениями, своим исполнителем и теми же полями бланка.
        // Раньше сюда шли отклонения всего журнала, и участок худел на
        // чужую скалу, а исполнитель оставался прочерком.
        const prep = prepareSectionAct(journal, uchastok);
        // Область / район / участок — так их и ищут потом в почте.
        const where = [prep.oblast, prep.rayon, uchastok]
          .filter(Boolean)
          .map((x) => String(x).replace(/[\\/:*?"<>|]+/g, ' ').trim())
          .join('/');
        // Папку заводим, только когда в неё есть что положить: пустая
        // папка участка в архиве читается как «документы потеряли».
        const folderOf = () => zip.folder(where || 'Участки') ?? zip;

        /**
         * Протоколы измерений — к актам участка, с рефлектограммами.
         *
         * Раньше протокол в пакет не попадал вовсе, и его досылали
         * отдельным письмом. Берём муфты участка, по которым мерили в
         * этом периоде; рефлектограмма ложится рядом, а протокол честно
         * пишет, какая легла, а какой не нашлось.
         */
        // Рефлектометр называет файлы одинаково («1550.sor») у всех муфт:
        // одноимённый файл второй муфты затёр бы первый в общей папке.
        const usedOtdr = new Set<string>();
        for (const m of measuredObjects(journal.objects, journal.splices, uchastok)
          .filter((x) => measuredInPeriod(x, from, to))) {
          const folder = folderOf();
          const packed = new Map<string, string>();
          for (const r of m.records) {
            if (!otdrAttached(r)) continue;
            const blob = await otdrBlob(r);
            if (!blob) continue;
            let name = otdrFileName(r, m.name);
            if (usedOtdr.has(name)) name = otdrFileName({ ...r, otdrName: `${m.name} ${r.date} ${name}` });
            usedOtdr.add(name);
            const sub = folder.folder('Рефлектограммы') ?? folder;
            sub.file(name, blob);
            packed.set(r.id, name);
          }
          const input = measureInput(m, {
            customer: partyNames.customer, date: to, contractor, packed,
          });
          await put(folder, measureProtocolFile(input), measureProtocolPage(input));
          protocols += 1;
        }

        if (!actFieldsOf(journal.actFields, uchastok)?.actNumber) continue;
        if (prep.entries.length === 0 || prep.totals.variants.length === 0) continue;
        const fields = prep.fields;
        const gaps = unmarkedActFields(fields);
        if (gaps.length) unmarked.push(`${uchastok} — ${gaps.join(', ')}`);
        const folder = folderOf();
        /**
         * Схема — приложением к акту, а не отдельным файлом.
         *
         * Отдельный файл по дороге теряется: акт дошёл, схема осталась
         * в папке «Загрузки». Берём трассу этого же участка; если её
         * нет — акт уходит как есть, без выдуманной схемы.
         *
         * Трассу и её объекты ищем теми же правилами, что и схема на
         * экране: иначе приложение к акту и файл «Схема» по одной трассе
         * расходились — одно брало муфту, другое теряло.
         */
        const own = routeOfSection(journal.planRoutes, uchastok);
        const attachment = own
          ? (() => {
            const objs = schemeObjectsFor(journal.objects, own);
            return buildScheme(own, objs.own, {
              unassigned: objs.unassigned, section: uchastok, places,
            });
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
      const head = protocols ? `Пакет собран, протоколов измерений: ${protocols}` : 'Пакет собран';
      onFlash?.(unmarked.length
        ? `${head}. В актах не отмечено: ${unmarked.join('; ')}`
        : head);
    } catch (err) {
      onFlash?.(errorLine(err, 'собрать пакет'));
    } finally {
      setBusy(false);
    }
  }

  // День снимка — по местному времени: ночной снимок по UTC вчерашний.
  const photosInPeriod = useMemo(
    () => photosInRange(journal.photos, from, to),
    [journal.photos, from, to],
  );

  // ── Документ по выбранному участку ───────────────────────────────────
  //
  // Акт скрытых работ собирался только по участку с наибольшим метражом
  // за период, протокол — только по первой муфте журнала. Сдают же их по
  // тому участку, который закрывают, и его надо уметь выбрать.
  const sections = useMemo(() => sectionsOf(journal.ground), [journal.ground]);
  const [docSection, setDocSection] = useState('');
  // По умолчанию — участок с наибольшим метражом за период: его чаще всего
  // и закрывают. Это подсказка, а не приговор.
  const section = sections.find((x) => x === docSection)
    ?? report.sections[0]?.uchastok ?? sections[0] ?? '';
  const sectionFields = actFieldsOf(journal.actFields, section) ?? {};
  const hiddenInput = useMemo(
    () => (section
      ? hiddenWorksInputFor(journal, section, { customer: partyNames.customer, date: to, contractor })
      : null),
    [journal, section, partyNames.customer, to, contractor],
  );

  const measured = useMemo(
    () => measuredObjects(journal.objects, journal.splices),
    [journal.objects, journal.splices],
  );
  const measuredHere = useMemo(
    () => measured.filter((m) => normLoose(m.uchastok) === normLoose(section)),
    [measured, section],
  );
  // '*' — все муфты участка; иначе id муфты. Пусто — выбор по умолчанию.
  const [muftaChoice, setMuftaChoice] = useState('');
  const protocolSet: MeasuredObject[] = useMemo(() => {
    if (muftaChoice !== '*') {
      const one = measured.find((m) => m.objectId === muftaChoice);
      if (one) return [one];
    }
    if (measuredHere.length) return measuredHere;
    return measured.slice(0, 1);
  }, [measured, measuredHere, muftaChoice]);
  const muftaValue = protocolSet.length === 1 && (muftaChoice === protocolSet[0].objectId
    || measuredHere.length === 0)
    ? protocolSet[0].objectId
    : '*';

  // Фотоотчёт: по выбранному участку или за период целиком.
  const [photoScope, setPhotoScope] = useState<'section' | 'period'>('section');
  const photoParts = useMemo(() => {
    const groups = groupPhotos(photosInPeriod, journal, photoScope === 'section' ? section : undefined);
    return splitPhotoReport(groups, PHOTOS_PER_PART, photoScope === 'period');
  }, [photosInPeriod, journal, photoScope, section]);
  const photoTotal = photoParts[0]?.total ?? 0;

  /**
   * Фотоотчёт файлами.
   *
   * Больше шестидесяти снимков — несколько частей в одном архиве, а не
   * обрезка: раньше всё сверх шестидесяти молча отбрасывалось, и в отчёт
   * за месяц попадала его первая неделя.
   */
  async function photoReport() {
    setBusy(true);
    try {
      let missing = 0;
      const docs: { name: string; html: string }[] = [];
      for (const part of photoParts) {
        const groups: { title: string; items: PhotoReportItem[] }[] = [];
        for (const g of part.groups) {
          const items = await Promise.all(g.photos.map(async (photo) => {
            const blob = await photoBlob(photo);
            if (!blob) { missing += 1; return { photo }; }
            return { photo, dataUrl: await dataUrlOf(blob) };
          }));
          groups.push({ title: g.title, items });
        }
        const uchastok = photoScope === 'section' ? section : undefined;
        docs.push({
          name: photoReportFileName({ uchastok, from, to, part }),
          html: photoReportPage({
            title: 'ФОТООТЧЁТ О ВЫПОЛНЕННЫХ РАБОТАХ',
            uchastok, from, to, groups, part,
          }),
        });
      }
      if (docs.length === 1) {
        await save(docs[0].name, docs[0].html);
      } else if (docs.length > 1) {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        for (const d of docs) await putDoc(zip, d.name, d.html);
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(photoReportFileName({
          uchastok: photoScope === 'section' ? section : undefined, from, to,
        }).replace(/\.doc$/, '.zip'), blob);
        onFlash?.(`Фотоотчёт: ${docs.length} части по ${PHOTOS_PER_PART} снимков`);
      }
      if (missing > 0) {
        onFlash?.(`Не вложено снимков: ${missing} — файла нет ни на устройстве, ни в облаке`);
      }
    } catch (err) {
      onFlash?.(errorLine(err, 'собрать фотоотчёт'));
    } finally {
      setBusy(false);
    }
  }

  /** Протокол измерений: одна муфта — один протокол, все муфты — пачкой. */
  function protocolDoc(): { name: string; html: string } | null {
    if (protocolSet.length === 0) return null;
    const inputs = protocolSet.map((m) => measureInput(m, {
      customer: partyNames.customer, date: to, contractor,
    }));
    if (inputs.length === 1) {
      return { name: measureProtocolFile(inputs[0]), html: measureProtocolPage(inputs[0]) };
    }
    const safe = section.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 50) || 'участок';
    return {
      name: `Протоколы измерений ${safe} ${to || new Date().toISOString().slice(0, 10)}.doc`,
      html: measureProtocolsPage(inputs, `Протоколы измерений — ${section}`),
    };
  }

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
          {/* Простой называем, а не прячем: заказчик спросит, почему метров
              мало, и ответ должен быть в том же отчёте. */}
          {report.idleShifts > 0 && ` · простой — ${report.idleShifts} смен`}
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
                  disabled={!anyShift}
                  onClick={() => save(
                    periodDocFile({ report, contractor }),
                    periodDocPage({ report, pace, contractor, author }),
                  )}>
            <FileDown size={14} />Отчёт за период
          </button>
          {cloudReady && (
            <button type="button" className="btn btn-ghost text-[11.5px]"
                    disabled={busy || !anyShift}
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
              disabled={!anyShift}
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
                  disabled={journal.deviations.length === 0}
                  onClick={() => save('Реестр замечаний.doc',
                    remarksPage(remarksFromDeviations(journal.deviations)))}>
            <FileDown size={14} />Реестр замечаний
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

        {/* По выбранному участку: акт скрытых работ, протокол, фотоотчёт */}
        <div className="rounded-md border border-[var(--border)] p-2.5 space-y-3">
          <label className="flex items-center gap-2 flex-wrap">
            <span className="text-[11.5px] text-[var(--text-muted)]">Участок</span>
            <select
              value={section}
              onChange={(e) => { setDocSection(e.target.value); setMuftaChoice(''); }}
              disabled={sections.length === 0}
              aria-label="Участок для документов"
              className="min-w-0 flex-1 bg-[var(--bg-canvas)] border border-[var(--border)]
                         rounded px-2 py-1 text-[11.5px] text-[var(--text)]"
            >
              {sections.length === 0 && <option value="">участков нет</option>}
              {sections.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          {!docSection && report.sections[0] && (
            <div className="text-[10.5px] text-[var(--text-muted)]">
              Выбран участок с наибольшим метражом за период — переключите, если
              закрываете другой.
            </div>
          )}

          {/* Акт скрытых работ */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-medium text-[var(--text)]">Акт скрытых работ</div>
            {hiddenInput && (
              <div className="text-[11px] text-[var(--text-muted)]">
                Глубина по проекту {(hiddenInput.designDepthM ?? 1.2).toFixed(2).replace('.', ',')} м,
                фактически {hiddenDepth(hiddenInput).text}
                {hiddenDepth(hiddenInput).single ? ' м' : ''} — из отклонений участка, как в АСР.
              </div>
            )}
            <SandField
              key={`bed-${section}`}
              label="Подсыпка и присыпка песком"
              value={sectionFields.bedding}
              typical={HIDDEN_BEDDING_DEFAULT}
              disabled={!section || !onChangeActFields}
              onCommit={(v) => onChangeActFields?.(section, { bedding: v })}
            />
            <SandField
              key={`back-${section}`}
              label="Обратная засыпка"
              value={sectionFields.backfill}
              typical={HIDDEN_BACKFILL_DEFAULT}
              disabled={!section || !onChangeActFields}
              onCommit={(v) => onChangeActFields?.(section, { backfill: v })}
            />
            <div className="text-[10.5px] text-[var(--text-muted)]">
              Песок видно один раз — в открытой траншее. Что не вписано, акт не
              утверждает: строка остаётся под руку. Вписанное попадает и в АСР/ОСР
              участка.
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" className="btn btn-ghost text-[11.5px]"
                      disabled={!hiddenInput || hiddenInput.rows.length === 0}
                      onClick={() => hiddenInput
                        && save(hiddenWorksFile(hiddenInput), hiddenWorksPage(hiddenInput))}>
                <FileDown size={14} />Акт скрытых работ
              </button>
              {cloudReady && (
                <button type="button" className="btn btn-ghost text-[11.5px]"
                        disabled={busy || !hiddenInput || hiddenInput.rows.length === 0}
                        title="Отдать ссылкой: заказчик всегда открывает текущую версию"
                        onClick={() => hiddenInput && share(
                          'акт скрытых работ', `Акт скрытых работ, ${section}`,
                          hiddenWorksPage(hiddenInput),
                        )}>
                  <LinkIcon size={14} />Ссылкой
                </button>
              )}
            </div>
          </div>

          {/* Протокол измерений */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-medium text-[var(--text)]">Протокол измерений</div>
            {measured.length === 0 ? (
              <div className="text-[11px] text-[var(--text-muted)]">
                Протоколов сварки нет — их вносят в «Паспорте сети», кнопкой «Сварка» у муфты.
              </div>
            ) : (
              <>
                <select
                  value={muftaValue}
                  onChange={(e) => setMuftaChoice(e.target.value)}
                  aria-label="Муфта для протокола"
                  className="w-full bg-[var(--bg-canvas)] border border-[var(--border)]
                             rounded px-2 py-1 text-[11.5px] text-[var(--text)]"
                >
                  {measuredHere.length > 0 && (
                    <option value="*">Все муфты участка ({measuredHere.length})</option>
                  )}
                  {measured.map((m) => (
                    <option key={m.objectId} value={m.objectId}>
                      {m.name} · {m.uchastok || 'участок не указан'}
                    </option>
                  ))}
                </select>
                {(() => {
                  const recs = protocolSet.flatMap((m) => m.records);
                  const withFile = recs.filter(otdrAttached).length;
                  return (
                    <div className={`text-[11px] ${withFile < recs.length
                      ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]'}`}>
                      Рефлектограмм с файлом: {withFile} из {recs.length}.
                      {withFile < recs.length && ' Протокол прямо скажет, каких нет; приложить файл — «Паспорт сети» → «Сварка».'}
                    </div>
                  );
                })()}
                <button type="button" className="btn btn-ghost text-[11.5px]"
                        disabled={protocolSet.length === 0}
                        onClick={() => {
                          // Рефлектограмму снимают на объекте, цифры переписывают
                          // в тетрадь, потом в Word — и на каждом переписывании
                          // теряется волокно. Все они уже в журнале сварки.
                          const doc = protocolDoc();
                          if (doc) save(doc.name, doc.html);
                        }}>
                  <FileDown size={14} />Протокол измерений
                </button>
              </>
            )}
          </div>

          {/* Фотоотчёт */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-medium text-[var(--text)]">Фотоотчёт</div>
            <div className="flex gap-1.5 flex-wrap items-center">
              {(['section', 'period'] as const).map((sc) => (
                <button key={sc} type="button"
                        onClick={() => setPhotoScope(sc)}
                        className={`chip ${photoScope === sc ? 'chip-on' : ''}`}>
                  {sc === 'section' ? 'По участку' : 'Все участки за период'}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              Снимков: {photoTotal}
              {photoParts.length > 1
                ? ` — выйдет ${photoParts.length} части по ${PHOTOS_PER_PART}, архивом. Ни один снимок не отбрасывается.`
                : ''}
              {' '}Внутри — по участкам и этапам: прокладка, ГНБ, задувка, подвес, сварка.
            </div>
            <button type="button" className="btn btn-ghost text-[11.5px]"
                    disabled={busy || photoTotal === 0}
                    onClick={() => { void photoReport(); }}>
              <FileDown size={14} />Фотоотчёт ({photoTotal})
            </button>
          </div>
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
                          // Номер акта того участка, к которому относится
                          // трасса, — по тому же правилу, что и объекты.
                          number: schemeRoute
                            ? registry.find((r) => sectionMatchesRoute(r.uchastok, schemeRoute))?.number
                            : undefined,
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
                    ⇄ Считать с другого конца
                  </button>
                )}
                {/* Линия верная, а название написано против хода работ:
                    меняем подписи, а не переворачиваем метры. Та же
                    кнопка, что в карточке трассы на карте. */}
                {onSwapRouteEnds && (
                  <button type="button" className="btn btn-ghost text-[11px]"
                          onClick={() => onSwapRouteEnds(schemeRoute.id)}>
                    Подписи концов наоборот
                  </button>
                )}
              </div>
            )}
            {schemeHint && (
              <div className="text-[11px] text-[var(--warn)]">{schemeHint}</div>
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
              <div className="text-[11px] text-[var(--warn)]">{unassignedNote(scheme)}</div>
            )}
            {/* Объект с участком, который к этой трассе не подошёл, раньше
                пропадал молча: ни в своих, ни в «без участка». Если он
                стоит на самой линии — называем, с его участком. */}
            {scheme && scheme.foreign.length > 0 && (
              <div className="text-[11px] text-[var(--warn)]">
                На самой линии стоят объекты других участков: {scheme.foreign.join('; ')}.
                В схему не взяты — если они этой трассы, поставьте им участок
                {scheme.section ? ` «${scheme.section}»` : ' трассы'}.
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

/**
 * Поле «песок» или «засыпка».
 *
 * Пишем в журнал по уходу с поля, а не на каждую букву: каждое сохранение
 * — это шаг отмены, и двадцать шагов отмены на одно слово «песок» делают
 * отмену бесполезной. Кнопка «типовое» подставляет строку проекта — то
 * есть человек подтверждает её сам, а не программа за него.
 */
function SandField({ label, value, typical, disabled, onCommit }: {
  label: string;
  value?: string;
  typical: string;
  disabled?: boolean;
  onCommit: (v: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const commit = (v: string) => {
    if (v.trim() !== (value ?? '').trim()) onCommit(v.trim() || undefined);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-[var(--text-muted)]">{label}</span>
      <span className="flex gap-1.5">
        <input
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          placeholder="не вписано — в акте строка под руку"
          className="min-w-0 flex-1 bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                     px-2 py-1 text-[11.5px] text-[var(--text)]"
        />
        {!draft.trim() && !disabled && (
          <button type="button" className="chip" title={typical}
                  onClick={() => { setDraft(typical); commit(typical); }}>
            типовое
          </button>
        )}
      </span>
    </label>
  );
}
