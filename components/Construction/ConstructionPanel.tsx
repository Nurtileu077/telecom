'use client';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  X, Upload, Loader2, AlertTriangle, MapPin, Wrench, Boxes,
  Plus, Download, Trash2, CloudOff, Pencil, Check, Ban, Building2, Clock,
  Ruler, FileWarning, RefreshCw, CloudCheck, Route, FileDown, HardHat,
  Share2, HelpCircle,
} from 'lucide-react';
import { getActorName } from '@/lib/appRole';
import { importJournal, type JournalImportResult } from './JournalImport';
import { buildJournalWorkbook, journalFileName } from './JournalExport';
import DailyEntryForm from './DailyEntryForm';
import {
  JournalState, JournalFilter, emptyJournal, loadJournal, saveJournal, mergeJournal,
  matchesFilter, groundTotals, metersBy, metersByDay, lastWorkDate, distinct,
  fmtKm, fmtMeters, shiftDays, MATERIAL_LABEL, addGroundEntry, removeEntry,
  submitCorrection, approveCorrection, rejectCorrection, pendingCorrections,
  hasPendingCorrection, diffEntries, loadJournalRole, saveJournalRole,
  addDeviation, removeDeviation, openDeviations, isDeviationClosed,
  upsertCrew, removeCrew, upsertDelivery, removeDelivery,
  addPlanRoutes, removePlanSource, planSources, plural, setProgress, setStage,
  addAreas, removeAreaSource, areaSources, setMaterialPrice, upsertDrill,
  upsertObject, removeObject, setSectionProgress, scopeJournal, scopeToContractor,
  smuList, deleteRoute,
  bulkPatchEntries, setDisputed, restoreFromTrash, purgeTrash, markPresented,
  upsertRate, removeRate, upsertPayment, removePayment,
  upsertRequest, setRequestStatus, removeRequest, upsertPlan, removePlan,
  upsertSiteRecord, removeSiteRecord, setRequisites,
  restoreShape, upsertDrumRecord, removeDrumRecord, addPhoto, removePhoto,
  upsertSplice, removeSplice, upsertIncident, removeIncident,
} from './journalStore';
import { crewsFromJournal, type DerivedCrew } from './crewDerive';
import {
  groupPoints, endpointKindOf, POINT_GROUPS, type PointGroup,
} from './pointKind';
import { placeCrews } from './crewPlace';
import { routeViews, routeTitle } from './routeStyle';
import { buildKml, kmlFileName } from './kmlExport';
import ChecksView from './ChecksView';
import TimesheetView from './TimesheetView';
import DocsView from './DocsView';
import ViewPrefs from '@/components/Layout/ViewPrefs';
import HelpSheet from './HelpSheet';
import MaintenanceView from './MaintenanceView';
import RequisitesView from './RequisitesView';
import { errorLine } from '@/lib/errors';
import { loadImports, saveImports, noteImport } from './backup';
import { demoJournal } from './demoData';
import { reminders } from './siteRecords';
import { hasNews, lastSeenVersion, markVersionSeen } from '@/lib/version';
import {
  loadFilters, saveFilters, upsertFilter, removeFilter, describeFilter,
  type SavedFilter,
} from '@/lib/shortcuts';
import PayrollView from './PayrollView';
import ResourcesView from './ResourcesView';
import PlanView from './PlanView';
import SiteRecordsView from './SiteRecordsView';
import EntriesTable from './EntriesTable';
import QuickEntryBar from './QuickEntryBar';
import Glyph from '@/components/Layout/Glyph';
import SheetImport from './SheetImport';
import type { QuickParse } from './quickEntry';
import { planFact } from './entriesTable';
import { normName } from './areaImport';
import { downloadText } from '@/lib/download';
import ChangeLogView from './ChangeLogView';
import PassportView from './PassportView';
import IncidentsView from './IncidentsView';
import { uploadPending } from './photoStore';
import { storageUploadJournalPhoto } from '@/lib/supabase';
import DeviationForm from './DeviationForm';
import CrewForm from './CrewForm';
import SectionClosing from './SectionClosing';
import MaterialsView from './MaterialsView';
import StagesView from './StagesView';
import ManagementView from './ManagementView';
import DayReport from './DayReport';
import TodayView from './TodayView';
import DrillsView from './DrillsView';
import DrillForm from './DrillForm';
import ObjectsView from './ObjectsView';
import { protocolDocHtml, protocolFileName, DOC_MIME } from './actDocument';
import {
  journalCloudEnabled, syncJournal, loadLastSyncAt, saveLastSyncAt,
} from './journalRemote';
import { materialForecast, lowStock } from './materialForecast';
import { importPlanFile } from './planImport';
import { pendingTasks, seedProgress, handoffTasks } from './stageTasks';
import { effectiveProgress } from './stageDerive';
import {
  LAY_METHOD_LABEL, MATERIAL_UNIT, JOURNAL_ROLES, JOURNAL_ROLE_LIST, DEVIATION_KIND_LABEL,
  CREW_KINDS, CREW_STATUS, SNP_STAGE_SPECS,
  type LayMethod, type MaterialKind, type DailyWorkEntry,
  type CorrectionRequest, type JournalRole, type Deviation, type Crew,
  type DrillLogEntry,
} from '@/types/construction';

type Period = 'day' | 'week' | 'month' | 'all';
type View = 'today' | 'summary' | 'management' | 'entries' | 'corrections' | 'deviations' | 'crews' | 'closing' | 'materials' | 'stages' | 'drills' | 'objects' | 'passport' | 'incidents' | 'log' | 'checks' | 'timesheet' | 'docs' | 'payroll' | 'resources' | 'plan' | 'records' | 'maintenance' | 'requisites';

const PERIOD_LABEL: Record<Period, string> = {
  day: 'Последний день', week: '7 дней', month: '30 дней', all: 'Всё время',
};

interface Props {
  onClose: () => void;
  /** Спрятать панель и дать выбрать точку на карте. null — передумали. */
  onRequestPick?: (label: string) => Promise<{ lat: number; lon: number } | null>;
  /** Объект, который попросили открыть с карты. */
  editObjectId?: string | null;
  onDoneEditObject?: () => void;
  /** Показать движение колонн за день на карте. */
  onPlayDay?: (date: string) => void;
  /** Показать трассу села на карте — «от и до». */
  onShowRoute?: (kato: string) => void;
  /** Показать на карте конкретную линию — её рамкой. */
  onShowCoords?: (coords: [number, number][]) => void;
}

export default function ConstructionPanel({
  onClose, onRequestPick, editObjectId, onDoneEditObject, onPlayDay, onShowRoute,
  onShowCoords,
}: Props) {
  const [journal, setJournal] = useState<JournalState>(emptyJournal);
  const [period, setPeriod] = useState<Period>('month');
  const [oblast, setOblast] = useState('');
  const [smu, setSmu] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<JournalImportResult['stats'] | null>(null);
  // Стройка открывается вопросом «что делать сегодня», а не графиком за
  // месяц: график — это вечерний вопрос.
  const [view, setView] = useState<View>('today');
  const [formOpen, setFormOpen] = useState(false);
  /**
   * Что уже разобрано из строки — чтобы форма открылась заполненной.
   * Переписывать в неё то, что человек только что написал словами, —
   * ровно та работа, от которой быстрый ввод и избавляет.
   */
  const [prefill, setPrefill] = useState<QuickParse | null>(null);
  /** Справка: клавиши и словарь. Открывается по «?». */
  const [helpOpen, setHelpOpen] = useState(false);
  /**
   * Показательный режим.
   *
   * Данные живут только в памяти вкладки: настоящий журнал не трогаем ни
   * на секунду, а выйти можно в любой момент и ничего не потерять.
   */
  /**
   * Версия сменилась с прошлого захода.
   *
   * «У меня не так, как у тебя» кончается, когда обоим видно, что
   * версия другая. Отметка гаснет, как только человек открыл «что
   * нового»: значок, который горит всегда, перестаёт значить что-либо.
   */
  const [news, setNews] = useState(false);
  useEffect(() => { setNews(hasNews(lastSeenVersion())); }, []);

  const [demoOn, setDemoOn] = useState(false);
  const demoOnRef = useRef(false);
  useEffect(() => { demoOnRef.current = demoOn; }, [demoOn]);
  /**
   * Сохранённые разрезы.
   *
   * «Акмолинская, Дозер, июль» набирают каждое утро заново, хотя разрез
   * один и тот же. Живут на устройстве: у каждого он свой.
   */
  /**
   * Чей это подрядчик, когда роль — субподрядчик.
   *
   * Держим на устройстве: это не право доступа, а настройка вида.
   * Настоящее ограничение появится вместе со входом по паролю.
   */
  const [ownContractor, setOwnContractor] = useState('');
  useEffect(() => {
    try { setOwnContractor(window.localStorage.getItem('optiq-own-contractor') ?? ''); } catch { /* приватный режим */ }
  }, []);

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  useEffect(() => { setSavedFilters(loadFilters()); }, []);
  /** Запись, которую сейчас исправляют. */
  const [editing, setEditing] = useState<DailyWorkEntry | null>(null);
  const [devFormOpen, setDevFormOpen] = useState(false);
  const [editingDev, setEditingDev] = useState<Deviation | null>(null);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  /** Точки из загруженного KML: что это — решает человек, не система. */
  const [pendingPoints, setPendingPoints] = useState<
    { points: import('./planImport').RawPoint[]; source: string } | null
  >(null);
  const [drillFormOpen, setDrillFormOpen] = useState(false);
  const [editingDrill, setEditingDrill] = useState<DrillLogEntry | null>(null);
  const [crewFormOpen, setCrewFormOpen] = useState(false);
  const [editingCrew, setEditingCrew] = useState<Crew | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const cloud = journalCloudEnabled();
  const [role, setRole] = useState<JournalRole>('mkt');
  /** Показать вкладки, которых у этой роли нет в списке по умолчанию. */
  const [allTabs, setAllTabs] = useState(false);
  /**
   * Разделы, спрятанные руками.
   *
   * У каждого есть два-три, в которые он не заходит никогда. Живут на
   * устройстве: это настройка вида, а не право доступа.
   */
  const [hiddenViews, setHiddenViews] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('optiq-hidden-views');
      const v = raw ? JSON.parse(raw) : [];
      if (Array.isArray(v)) setHiddenViews(v.filter((x) => typeof x === 'string'));
    } catch { /* приватный режим */ }
  }, []);
  const toggleHiddenView = useCallback((v: string) => {
    setHiddenViews((prev) => {
      const next = prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v];
      try { window.localStorage.setItem('optiq-hidden-views', JSON.stringify(next)); } catch { /* приватный режим */ }
      return next;
    });
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Чужая книга, которую разбираем по колонкам вместе с человеком. */
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const planRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setJournal(loadJournal());
    const r = loadJournalRole();
    setRole(r);
    // Журнал открывается там, где у этой роли работа: ГНБщику нужны
    // проколы, руководству — сводка, отчётности — очередь заявок.
    setView(JOURNAL_ROLES[r].home as View);
    setSyncedAt(loadLastSyncAt());
  }, []);

  // Нажали «Изменить» в попапе объекта — открываем его раздел, иначе
  // карточка появилась бы за другим экраном.
  useEffect(() => {
    if (editObjectId) setView('objects');
  }, [editObjectId]);

  const actor = useMemo(() => getActorName() || 'Без имени', []);

  /** Общая точка записи: сохраняем и честно сообщаем о переполнении. */
  /**
   * Что было до последних правок.
   *
   * Отмена нужна не «на всякий случай»: удалённая не та строка — это
   * пропавшие метры в акте, а найти и вписать их заново дольше, чем
   * нажать Ctrl+Z. Держим два десятка шагов в памяти вкладки: это
   * отмена, а не история — история живёт в журнале изменений.
   */
  const historyRef = useRef<JournalState[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  /** Короткое сообщение: «скопировано», «отменено». */
  const [flash, setFlashRaw] = useState<string | null>(null);
  const setFlash = useCallback((text: string | null) => {
    setFlashRaw(text);
    if (text) window.setTimeout(() => setFlashRaw(null), 2200);
  }, []);

  const write = useCallback((next: JournalState) => {
    setJournal(next);
    // В показе не сохраняем: выдуманные смены не должны попасть в
    // настоящий журнал ни при каких обстоятельствах.
    if (demoOnRef.current) return;
    if (!saveJournal(next)) {
      setError('Данные показаны, но не сохранены: переполнено хранилище браузера. Выгрузите журнал в Excel и очистите старые проекты.');
    } else {
      setError('');
    }
  }, []);

  const persist = useCallback((next: JournalState) => {
    historyRef.current = [...historyRef.current, loadJournal()].slice(-20);
    setCanUndo(true);
    write(next);
  }, [write]);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    setCanUndo(historyRef.current.length > 0);
    if (!prev) return;
    write(prev);
    setFlash('Отменено');
  }, [write, setFlash]);

  /**
   * Новый день — пишем сразу. Исправление — только заявкой: цифры в сводке
   * не должны меняться задним числом без ведома отчётности.
   */
  const handleFormSave = useCallback((
    entry: DailyWorkEntry,
    reason?: string,
    stop?: { lat: number; lon: number; routeId: string; doneM: number; manual: boolean },
  ) => {
    const base = loadJournal();
    if (editing && reason) {
      persist(submitCorrection(base, { entry: editing, proposed: entry, reason, author: actor }));
      setView('corrections');
    } else {
      // День закрывает инженер на объекте — его имя и остаётся в записи.
      let next = addGroundEntry(base, { ...entry, author: entry.author || actor });
      // Докуда дошли — по этому потом едет метка колонны и строится
      // вчерашний день в движении.
      if (stop && entry.kato) {
        next = setSectionProgress(next, entry.kato, {
          routeId: stop.routeId,
          doneM: stop.doneM,
          lat: stop.lat,
          lon: stop.lon,
          date: entry.date,
          manual: stop.manual,
        });
      }
      persist(next);
    }
    setEditing(null);
    setReport(null);
  }, [persist, editing, actor]);

  const handleApprove = useCallback((id: string) => {
    persist(approveCorrection(loadJournal(), id, actor));
  }, [persist, actor]);

  const handleReject = useCallback((id: string) => {
    const note = prompt('Причина отказа (необязательно):') ?? undefined;
    persist(rejectCorrection(loadJournal(), id, actor, note));
  }, [persist, actor]);

  const handleSaveDeviation = useCallback((d: Deviation) => {
    const base = loadJournal();
    const withAuthor = { ...d, author: d.author || actor };
    // Правка существующего отклонения = замена по id.
    persist(addDeviation(removeDeviation(base, d.id), withAuthor));
    setEditingDev(null);
  }, [persist, actor]);

  const handleDeleteDeviation = useCallback((id: string) => {
    if (!confirm('Удалить отклонение?')) return;
    persist(removeDeviation(loadJournal(), id));
  }, [persist]);

  const handleSaveCrew = useCallback((c: Crew) => {
    persist(upsertCrew(loadJournal(), c));
    setEditingCrew(null);
  }, [persist]);

  const handleDeleteCrew = useCallback((id: string) => {
    if (!confirm('Удалить колонну?')) return;
    persist(removeCrew(loadJournal(), id));
  }, [persist]);

  const handleDelete = useCallback((id: string) => {
    // Не спрашиваем «вы уверены»: строка уходит в корзину, и вернуть её
    // проще, чем прочитать вопрос. Предупреждение на каждое действие
    // учит нажимать «да», не читая.
    persist(removeEntry(loadJournal(), id, actor));
    setFlash('Запись в корзине — вернуть можно в «Проверках»');
  }, [persist, actor, setFlash]);

  /**
   * Отправка локальных фото. Отдельным шагом перед обменом журналом:
   * файлы тяжёлые, и их судьба не должна решать судьбу цифр.
   */
  const uploadPendingPhotos = useCallback(async (base: JournalState) => {
    if (!journalCloudEnabled() || base.photos.every((p) => !p.pending)) {
      return { state: base, sent: 0, failed: 0, changed: false };
    }
    const { photos, sent, failed } = await uploadPending(
      base.photos,
      (id, blob) => storageUploadJournalPhoto(id, blob),
    );
    return { state: { ...base, photos }, sent, failed, changed: sent > 0 || failed > 0 };
  }, []);

  /**
   * Обмен с облаком. Слитое состояние обязательно сохраняем локально —
   * иначе при следующем обмене чужие правки придут заново.
   */
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      // Сначала файлы, потом журнал: карточка со ссылкой уйдёт в том же
      // обмене, и у соседа фото откроется сразу, а не «в следующий раз».
      const withPhotos = await uploadPendingPhotos(loadJournal());
      if (withPhotos.changed) saveJournal(withPhotos.state);

      const res = await syncJournal(loadJournal(), actor);
      if (!res.ok) {
        setSyncNote({ tone: 'warn', text: res.message });
        return;
      }
      setJournal(res.merged);
      saveJournal(res.merged);
      saveLastSyncAt(res.at);
      setSyncedAt(res.at);
      const { pulled, pushed, conflicts, removed } = res.stats;
      const parts = [
        pulled ? `получено ${pulled}` : '',
        pushed ? `отправлено ${pushed}` : '',
        conflicts ? `расхождений ${conflicts}` : '',
        removed ? `удалено ${removed}` : '',
      ].filter(Boolean);
      const photoNote = withPhotos.sent
        ? ` Фото отправлено: ${withPhotos.sent}.`
        : '';
      const photoWarn = withPhotos.failed
        ? ` Не ушло фото: ${withPhotos.failed} — попробуйте при связи получше.`
        : '';
      setSyncNote({
        tone: withPhotos.failed ? 'warn' : 'ok',
        text: (res.firstPush
          ? 'Журнал впервые выгружен в облако.'
          : parts.length ? `Синхронизировано: ${parts.join(', ')}.` : 'Всё уже совпадало.')
          + photoNote + photoWarn,
      });
    } finally {
      setSyncing(false);
    }
  }, [actor]);

  /**
   * Загрузка KML: и проектные трассы, и обводки районов с сёлами.
   *
   * В файле из Google Earth лежит и то и другое. План кладём отдельно от
   * факта, контуры — отдельно от плана.
   */
  const handlePlanFile = useCallback(async (file: File) => {
    setBusy(true); setError(''); setReport(null);
    try {
      const base = loadJournal();
      const res = await importPlanFile(file, base.orders, (done, total) => {
        // Большой файл читается заметно долго: молчащая кнопка читается
        // как «зависло», и человек жмёт её второй раз.
        if (total > 800) setFlash(`Читаю ${file.name}: ${done} из ${total}`);
      });
      if (res.routes.length === 0 && res.areas.areas.length === 0) {
        // Объясняем, что именно было в файле: «ничего не загрузилось» без
        // причины заставляет грузить тот же файл снова и снова.
        const st = res.stats;
        const found = [
          st.placemarks ? `меток ${st.placemarks}` : '',
          st.points ? `точек ${st.points}` : '',
          st.lines ? `линий ${st.lines}` : '',
          st.polygons ? `контуров ${st.polygons}` : '',
        ].filter(Boolean).join(', ');
        setError(
          `Ни трасс, ни обводок не добавилось. В файле: ${found || 'ничего не распознано'}.`
          + (st.droppedCoords ? ` Не разобрано координат: ${st.droppedCoords}.` : '')
          + (st.lines && !res.routes.length
            ? ' Линии есть, но короче двух точек — такие не берём.'
            : '')
          + (!st.lines && !st.polygons
            ? ' Нужен KML/KMZ, в котором есть LineString (трасса) или Polygon (обводка).'
            : ''),
        );
        return;
      }
      let next = base;
      if (res.routes.length) next = addPlanRoutes(next, res.routes);
      if (res.areas.areas.length) next = addAreas(next, res.areas.areas);
      persist(next);

      const parts: string[] = [];
      if (res.routes.length) {
        parts.push(`${res.routes.length} ${plural(res.routes.length, 'трасса', 'трассы', 'трасс')}`
          + ` (${(res.totalM / 1000).toFixed(1)} км)`);
      }
      const { byKind, matched } = res.areas;
      if (byKind.rayon) parts.push(`${byKind.rayon} ${plural(byKind.rayon, 'район', 'района', 'районов')}`);
      if (byKind.oblast) parts.push(`${byKind.oblast} ${plural(byKind.oblast, 'область', 'области', 'областей')}`);
      if (byKind.snp) {
        parts.push(`${byKind.snp} ${plural(byKind.snp, 'село', 'села', 'сёл')}`
          + (matched ? `, из них ${matched} связано с реестром` : ', ни одно не связано с реестром'));
      }
      const dropped = res.stats.droppedCoords
        ? ` Не разобрано координат: ${res.stats.droppedCoords}.`
        : '';
      setSyncNote({ tone: 'ok', text: `Загружено: ${parts.join(', ')}.${dropped}` });

      // Точки сами не раскладываем: в одном файле это столбы, в другом —
      // разметка обследования годичной давности. Спрашиваем.
      if (res.points.length > 0) {
        setPendingPoints({ points: res.points, source: file.name });
      }
    } catch (e) {
      setError(errorLine(e, 'прочитать файл'));
    } finally { setBusy(false); }
  }, [persist]);

  const handleExport = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await buildJournalWorkbook(journal);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = journalFileName();
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorLine(e, 'собрать файл'));
    } finally { setBusy(false); }
  }, [journal]);


  /**
   * Горячие клавиши.
   *
   * Те же, что везде: Esc закрывает, Ctrl+Z отменяет, «/» ставит курсор
   * в поиск, N открывает новую запись. Пока их нет, каждое действие —
   * это поиск кнопки глазами.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA'
        || el?.isContentEditable;

      if (e.key === 'Escape') {
        if (typing) { (el as HTMLElement).blur(); return; }
        onClose();
        return;
      }
      if ((e.key === 'z' || e.key === 'я') && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (typing) return;
        e.preventDefault();
        undo();
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        const box = document.getElementById('entries-search') as HTMLInputElement | null;
        if (box) { e.preventDefault(); box.focus(); box.select(); }
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.key === 'n' || e.key === 'т') {
        e.preventDefault();
        setEditing(null);
        setFormOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, undo]);

  // Корзина не должна расти вечно: что пролежало месяц — выбрасываем.
  useEffect(() => {
    const cleaned = purgeTrash(journal);
    if (cleaned !== journal) write(cleaned);
    // Один раз при открытии журнала: чаще незачем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Загрузка книги.
   *
   * Сначала пробуем как нашу выгрузку — там известны и листы, и колонки.
   * Не узнали ни одной записи — значит, это чужая таблица прораба, и её
   * надо разбирать по колонкам вместе с человеком: заставлять его
   * переделывать книгу под нашу форму бессмысленно.
   */
  const handleFile = useCallback(async (file: File) => {
    setBusy(true); setError(''); setReport(null);
    try {
      const res = await importJournal(file);
      const known = res.ground.length + res.aerial.length
        + res.drills.length + res.orders.length;
      if (known === 0) {
        setSheetFile(file);
        return;
      }
      persist(mergeJournal(loadJournal(), res));
      setReport(res.stats);
      rememberImport(file.name, {
        смены: res.ground.length,
        подвес: res.aerial.length,
        проколы: res.drills.length,
        заказ: res.orders.length,
      });
    } catch {
      // Не разобрали своим разбором — попробуем разобрать по колонкам.
      setSheetFile(file);
    } finally { setBusy(false); }
  }, [persist]);

  // ── Период считаем от последнего дня, по которому вообще есть данные,
  //    а не от сегодня: в журнал пишут задним числом, и «вчера» по календарю
  //    чаще всего пусто. Отклонения учитываем наравне с выработкой — иначе
  //    только что внесённая запись выпадает за границу окна и «пропадает».
  const anchor = useMemo(() => {
    const last = lastWorkDate(journal.ground);
    const lastDev = journal.deviations.reduce((m, d) => (d.date > m ? d.date : m), '');
    return lastDev > last ? lastDev : last;
  }, [journal.ground, journal.deviations]);
  const filter: JournalFilter = useMemo(() => {
    const f: JournalFilter = { oblast: oblast || undefined, smu: smu || undefined };
    if (period !== 'all' && anchor) {
      f.to = anchor;
      f.from = period === 'day' ? anchor : shiftDays(anchor, period === 'week' ? -6 : -29);
    }
    return f;
  }, [period, oblast, smu, anchor]);

  const ground = useMemo(() => journal.ground.filter((e) => matchesFilter(e, filter)), [journal.ground, filter]);
  const drills = useMemo(() => journal.drills.filter((e) => matchesFilter(e, filter)), [journal.drills, filter]);
  const totals = useMemo(() => groundTotals(ground), [ground]);
  const allTotals = useMemo(() => groundTotals(journal.ground), [journal.ground]);
  const byOblast = useMemo(() => metersBy(ground, (e) => e.oblast), [ground]);
  const bySmu = useMemo(() => metersBy(ground, (e) => e.smu), [ground]);
  const days = useMemo(() => metersByDay(ground).slice(-30), [ground]);
  const mappedPoints = useMemo(() => drills.reduce((s, d) => s + d.points.length, 0), [drills]);
  const drillsWithCoords = useMemo(() => drills.filter((d) => d.points.length > 0).length, [drills]);

  /**
   * Выбранная область держится во всех разрезах.
   *
   * Выбрать «Акмолинская» в сводке, зайти в день и увидеть там Мангистау —
   * значит один раз поверить чужой цифре. Поэтому сужаем журнал целиком,
   * а не каждый список по отдельности.
   */
  const scoped = useMemo(() => {
    const byRegion = scopeJournal(journal, oblast);
    // Субподрядчику показываем только его: в общем журнале чужие объёмы
    // и чужие деньги, и именно поэтому ему обычно не показывают ничего.
    return JOURNAL_ROLES[role].ownContractorOnly
      ? scopeToContractor(byRegion, ownContractor)
      : byRegion;
  }, [journal, oblast, role, ownContractor]);

  // Доска и сводки смотрят на журнал с выведенными этапами: руками
  // отмечать шесть этапов на шестистах сёлах никто не станет, а журнал
  // и так знает, где что делают.
  const live = useMemo<JournalState>(() => ({
    ...scoped,
    progress: effectiveProgress(scoped.progress, scoped),
  }), [scoped]);

  // Колонны, которых нет в справочнике, но которые видно по журналу:
  // заводить их руками — работа ради работы.
  const autoCrews = useMemo(() => crewsFromJournal(scoped), [scoped]);

  // Список колонн показывает то же, что карта: место у бригады считается
  // по последнему отчёту, и «не на карте» должно означать «её там нет»,
  // а не «мы не посчитали».
  const placed = useMemo(
    () => placeCrews([...scoped.crews, ...autoCrews], scoped),
    [scoped, autoCrews],
  );

  // У каких сёл трасса вообще есть: кнопка «посмотреть трассу», которая
  // ничего не показывает, хуже отсутствующей.
  const routeKatos = useMemo(() => {
    const views = routeViews(scoped.planRoutes, { progress: live.progress });
    return new Set(views.map((v) => v.kato).filter((k): k is string => !!k));
  }, [scoped.planRoutes, live.progress]);

  /**
   * Выгрузка в KML.
   *
   * Файл пришёл от проектировщика, правился на стройке и должен уйти к
   * нему обратно — иначе поправки живут только у нас, а в проекте
   * остаётся вчерашняя трасса. Цвет линии сохраняем тот же, что на
   * карте: по нему в Google Earth сразу видно, докуда дошли.
   */
  /**
   * Записать, что загрузили.
   *
   * «Откуда это взялось» спрашивают через месяц, когда файла уже нет, а
   * цифры в журнале есть.
   */
  const rememberImport = useCallback((file: string, counts: Record<string, number>) => {
    saveImports(noteImport(loadImports(), {
      id: `imp-${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      file,
      counts,
      author: actor,
    }));
  }, [actor]);

  const handleExportKml = useCallback(() => {
    const views = routeViews(scoped.planRoutes, {
      progress: live.progress,
    });
    const byId = new Map(views.map((v) => [v.id, v]));
    const xml = buildKml({
      name: oblast ? `Optiq — ${oblast}` : 'Optiq — трассы и объекты',
      description: `Выгружено ${new Date().toLocaleString('ru')}`,
      folders: [
        {
          name: 'Трассы',
          lines: scoped.planRoutes.map((r) => {
            const v = byId.get(r.id);
            return {
              name: v ? routeTitle(v) : (r.name || 'Трасса'),
              coords: r.coords,
              color: v?.color,
              description: [
                r.name,
                `${(r.lengthM / 1000).toFixed(3)} км`,
                v?.stage ? SNP_STAGE_SPECS[v.stage].label : 'работ не было',
                r.source,
              ].filter(Boolean).join(' · '),
            };
          }),
        },
        {
          name: 'Контуры',
          lines: scoped.areas.map((a) => ({
            name: a.name, coords: a.coords, closed: true, color: '#94a3b8',
            description: a.source,
          })),
        },
        {
          name: 'Объекты',
          points: scoped.objects.map((o) => ({
            name: o.name || o.kind,
            lat: o.lat,
            lon: o.lon,
            description: [o.kind, o.endpointKind, o.uchastok, o.note]
              .filter(Boolean).join(' · '),
          })),
        },
      ],
    });
    downloadText(kmlFileName(oblast || 'optiq'), xml,
      'application/vnd.google-earth.kml+xml');
  }, [scoped, live.progress, oblast]);

  /**
   * Где факт разошёлся с проектом.
   *
   * Проектная длина известна из KML, фактическая складывается из смен.
   * Расхождение само по себе не ошибка — трассу переносят, — но узнать
   * о нём лучше на стройке, а не при сдаче.
   */
  const planFactRows = useMemo(
    () => planFact(scoped.ground, scoped.planRoutes),
    [scoped.ground, scoped.planRoutes],
  );

  /** О чём пора напомнить: сроки разрешений и допусков. */
  const recordReminders = useMemo(() => reminders(scoped.records), [scoped.records]);

  const pending = useMemo(() => pendingCorrections(journal), [journal]);
  const openDevs = useMemo(() => openDeviations(journal), [journal]);
  const tasks = useMemo(
    () => pendingTasks(live.progress, { orders: journal.orders, drills: journal.drills }),
    [live.progress, journal.orders, journal.drills],
  );
  const handoffs = useMemo(() => handoffTasks(tasks), [tasks]);
  const lowMaterials = useMemo(
    () => lowStock(materialForecast(journal.ground, journal.deliveries, { oblast: oblast || undefined })),
    [journal.ground, journal.deliveries, oblast],
  );
  const devs = useMemo(
    () => journal.deviations.filter((d) => matchesFilter({ ...d, smu: '' }, { ...filter, smu: undefined })),
    [journal.deviations, filter],
  );
  const byContractor = useMemo(
    () => metersBy(ground, (e) => e.contractor || ''),
    [ground],
  );
  const oblasts = useMemo(() => distinct(journal.ground, (e) => e.oblast), [journal.ground]);
  // СМУ снова ставят: в списке семь постоянных плюс всё, что встретилось.
  const smus = useMemo(() => smuList(journal), [journal]);
  const empty = journal.ground.length === 0 && journal.orders.length === 0;

  // Фильтры показываем только там, где они что-то меняют. Переключатель,
  // который ничего не делает, хуже отсутствующего: он врёт о том, что
  // цифры на экране отфильтрованы.
  const usesPeriod = view === 'summary' || view === 'entries' || view === 'deviations';
  // Область сужает журнал целиком, поэтому переключатель нужен везде,
  // где этот журнал показывают. В заявках его нет: там очередь на
  // подтверждение, а не разрез по местам.
  const usesOblast = view !== 'corrections';
  const usesSmu = view === 'summary' || view === 'entries';

  /**
   * Вкладки роли. Роль ничего не запрещает — она убирает с глаз чужое:
   * ГНБщику не нужны акты, руководству не нужна форма закрытия дня.
   * Всё остальное открывается кнопкой «Ещё», а текущая вкладка видна
   * всегда, даже если в список роли не входит.
   */
  const ALL_VIEWS: [View, string][] = [
    ['today', 'Сегодня'], ['summary', 'Сводка'], ['management', 'Руководству'],
    ['entries', 'Записи'], ['crews', 'Колонны'], ['stages', 'Этапы'],
    ['drills', 'Проколы'], ['objects', 'Объекты'], ['passport', 'Паспорт'],
    ['incidents', 'Аварии'], ['deviations', 'Отклонения'], ['materials', 'Материалы'],
    ['closing', 'Закрытие'], ['corrections', 'Заявки'], ['log', 'Изменения'],
    ['plan', 'План'], ['docs', 'Документы'], ['payroll', 'Расчёты'], ['resources', 'Ресурсы'],
    ['records', 'Допуски'], ['requisites', 'Реквизиты'], ['maintenance', 'Обслуживание'],
    ['checks', 'Проверки'], ['timesheet', 'Табель'],
  ];
  const roleViews = new Set(JOURNAL_ROLES[role].views);
  /**
   * Что показывать вкладками.
   *
   * Роль убирает чужое, а спрятанное руками убирает и своё: у каждого
   * есть два-три раздела, в которые он не заходит никогда, и они всё
   * равно занимают место.
   *
   * Текущая вкладка видна всегда — иначе, спрятав её, человек потеряет
   * то, что сейчас открыто.
   */
  const shownViews = (allTabs
    ? ALL_VIEWS
    : ALL_VIEWS.filter(([v]) => roleViews.has(v) || v === view)
  ).filter(([v]) => !hiddenViews.includes(v) || v === view);

  return (
    <div className="fixed inset-0 z-[9998] bg-[var(--bg-canvas)] flex flex-col journal-panel">
      {/* Короткое сообщение о том, что действие прошло. */}
      {flash && (
        <div className="fixed left-1/2 -translate-x-1/2 top-3 z-[9999] px-3 py-1.5 rounded-full
                        bg-[var(--bg-surface)] border border-[var(--accent)]/50 text-[12px]
                        text-[var(--accent)] shadow-xl"
             data-print="hide" role="status">
          {flash}
          {canUndo && (
            <button type="button" onClick={undo}
                    className="ml-2 underline underline-offset-2 hover:text-[var(--text)]">
              отменить
            </button>
          )}
        </div>
      )}

      {/*
        Тому, кто ходит клавишей Tab, иначе приходится протабать всю
        панель кнопок и весь ряд вкладок, прежде чем дойти до таблицы.
      */}
      <a href="#journal-content" className="skip-link" data-print="hide">
        К содержимому
      </a>

      {/* Шапка */}
      <div data-print="hide" className="flex items-center gap-2 px-3 md:px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0"
           style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top, 0px))' }}>
        <Wrench size={17} className="text-[var(--accent)] shrink-0" />
        <h2 className="text-sm font-semibold text-[var(--text)] shrink-0">Журнал стройки</h2>
        {anchor && (
          <span className="text-[11px] font-mono text-[var(--text-muted)] hidden sm:inline">
            данные по {new Date(`${anchor}T00:00:00Z`).toLocaleDateString('ru')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {/* На солнце тёмная тема не читается — это не вкус, а
              невозможность работать. */}
          <ViewPrefs compact />
          <button type="button" className="btn btn-ghost btn-icon"
                  title="Справка: горячие клавиши и словарь (?)"
                  aria-label="Справка"
                  onClick={() => setHelpOpen(true)}>
            <HelpCircle size={15} />
          </button>
          {cloud ? (
            <button type="button" className="btn btn-ghost text-[11px]" onClick={handleSync} disabled={syncing}
                    title={syncedAt ? `Синхронизировано ${new Date(syncedAt).toLocaleString('ru')}` : 'Обмен с облаком'}>
              {syncing
                ? <Loader2 size={14} className="animate-spin" />
                : syncedAt ? <CloudCheck size={14} /> : <RefreshCw size={14} />}
              <span className="hidden md:inline">
                {syncing ? 'Обмен…' : syncedAt
                  ? new Date(syncedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
                  : 'Синхронизировать'}
              </span>
            </button>
          ) : (
            <span className="hidden md:inline-flex items-center gap-1 text-[10.5px] text-[var(--text-muted)] px-1.5"
                  title="Журнал хранится только в этом браузере: облако не настроено">
              <CloudOff size={13} />только здесь
            </span>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          <button type="button" className="btn btn-ghost btn-icon" title="Загрузить журнал из Excel"
                  onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          </button>
          <button type="button" className="btn btn-ghost btn-icon" title="Выгрузить в Excel"
                  onClick={handleExport} disabled={busy || empty}>
            <Download size={15} />
          </button>
          <input ref={planRef} type="file" accept=".kml,.kmz" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePlanFile(f); e.target.value = ''; }} />
          <button type="button" className="btn btn-ghost text-[11px]"
                  title="Загрузить KML/KMZ: проектные трассы и обводки районов и сёл"
                  onClick={() => planRef.current?.click()} disabled={busy}>
            <Route size={15} /><span className="hidden sm:inline">KML</span>
          </button>
          <button type="button" className="btn btn-ghost btn-icon"
                  title="Выгрузить трассы, контуры и объекты в KML — открыть в Google Earth или отдать проектировщику"
                  onClick={handleExportKml}
                  disabled={busy || (scoped.planRoutes.length + scoped.areas.length
                    + scoped.objects.length === 0)}>
            <Share2 size={15} />
          </button>
          <button type="button" className="journal-primary btn btn-primary text-[11px]"
                  onClick={() => setFormOpen(true)}>
            <Plus size={15} /><span className="hidden sm:inline">Закрыть день</span>
          </button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Закрыть"><X size={16} /></button>
        </div>
      </div>

      {/* Фильтры */}
      {!empty && (
        <div className="journal-tabs flex flex-wrap items-center gap-1.5 px-3 md:px-4 py-2
                        border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
          <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md mr-1">
            {shownViews.map(([v, label]) => {
              const badge = v === 'corrections' ? pending.length
                : v === 'deviations' ? openDevs.length
                : v === 'materials' ? lowMaterials.length
                : v === 'records' ? recordReminders.length
                : v === 'maintenance' ? (news ? 1 : 0)
                : v === 'stages' ? handoffs.length : 0;
              return (
                <button key={v} type="button" onClick={() => {
                    setView(v);
                    if (v === 'maintenance' && news) { markVersionSeen(); setNews(false); }
                  }}
                  // Правой кнопкой — спрятать: у каждого есть разделы,
                  // в которые он не заходит никогда.
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    if (v === view) return;
                    toggleHiddenView(v);
                    setFlash(hiddenViews.includes(v)
                      ? `«${label}» снова виден`
                      : `«${label}» спрятан — вернуть через «Ещё»`);
                  }}
                  title={hiddenViews.includes(v)
                    ? 'Правой кнопкой — вернуть в список'
                    : 'Правой кнопкой — спрятать раздел'}
                  className={`px-2.5 py-1 text-[11px] rounded transition-colors inline-flex items-center gap-1 ${
                    hiddenViews.includes(v) ? 'opacity-50 ' : ''}${
                    view === v ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-medium' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                  {label}
                  {badge > 0 && (
                    <span className="min-w-[16px] px-1 rounded-full bg-[var(--warn)] text-[#041016] text-[9.5px] font-semibold leading-[15px] text-center">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
            {shownViews.length < ALL_VIEWS.length && (
              <button type="button" onClick={() => setAllTabs(true)}
                      title="Показать все разделы журнала"
                      className="px-2.5 py-1 text-[11px] rounded text-[var(--text-muted)] hover:text-[var(--text)]">
                Ещё
              </button>
            )}
            {allTabs && (
              <button type="button" onClick={() => setAllTabs(false)}
                      title="Оставить только свои разделы"
                      className="px-2.5 py-1 text-[11px] rounded text-[var(--text-muted)] hover:text-[var(--text)]">
                Свернуть
              </button>
            )}
          </div>
          <select value={role} title="Кто вы в журнале — от этого зависит, что видно сразу"
                  onChange={(e) => {
                    const r = e.target.value as JournalRole;
                    setRole(r);
                    saveJournalRole(r);
                    setAllTabs(false);
                    setView(JOURNAL_ROLES[r].home as View);
                  }}
                  className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)]">
            {JOURNAL_ROLE_LIST.map((r) => (
              <option key={r} value={r}><Glyph name={JOURNAL_ROLES[r].icon} /> {JOURNAL_ROLES[r].label}</option>
            ))}
          </select>
          {/* Субподрядчику показываем только его — значит надо знать, чей он. */}
          {JOURNAL_ROLES[role].ownContractorOnly && (
            <select
              value={ownContractor}
              onChange={(e) => {
                setOwnContractor(e.target.value);
                try { window.localStorage.setItem('optiq-own-contractor', e.target.value); } catch { /* приватный режим */ }
              }}
              title="Чей журнал показывать"
              className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)] max-w-[170px]"
            >
              <option value="">Выберите подрядчика</option>
              {[...new Set(journal.ground.map((e) => e.contractor).filter(Boolean))]
                .sort((a, b) => (a as string).localeCompare(b as string, 'ru'))
                .map((c) => <option key={c} value={c as string}>{c}</option>)}
            </select>
          )}
          {usesPeriod && (
            <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md">
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                <button key={p} type="button" onClick={() => setPeriod(p)}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${
                    period === p ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
          )}
          {usesOblast && (
            <select value={oblast} onChange={(e) => setOblast(e.target.value)}
                    className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)] max-w-[190px]">
              <option value="">Все области</option>
              {oblasts.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {usesSmu && (
            <select value={smu} onChange={(e) => setSmu(e.target.value)}
                    className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)]">
              <option value="">Все СМУ</option>
              {smus.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {(usesOblast || usesSmu) && (oblast || smu) && (
            <button type="button" className="btn btn-ghost text-[11px]" onClick={() => { setOblast(''); setSmu(''); }}>Сбросить</button>
          )}

          {/* Сохранённые фильтры: «Акмолинская, Дозер, июль» набирают
              каждое утро заново, хотя разрез один и тот же. */}
          {savedFilters.map((f) => (
            <button
              key={f.id}
              type="button"
              className="btn btn-ghost text-[11px]"
              title="Применить этот разрез"
              onClick={() => {
                setOblast(f.value.oblast ?? '');
                setSmu(f.value.smu ?? '');
                if (f.value.period) setPeriod(f.value.period as Period);
              }}
              onContextMenu={(ev) => {
                ev.preventDefault();
                if (!confirm(`Убрать фильтр «${f.name}»?`)) return;
                setSavedFilters((prev) => {
                  const next = removeFilter(prev, f.id);
                  saveFilters(next);
                  return next;
                });
              }}
            >
              ★ {f.name}
            </button>
          ))}
          {(usesOblast || usesSmu) && (oblast || smu) && (
            <button
              type="button"
              className="btn btn-ghost text-[11px]"
              title="Запомнить этот разрез"
              onClick={() => {
                const value = { oblast: oblast || undefined, smu: smu || undefined, period };
                const name = window.prompt('Название фильтра:', describeFilter(value));
                if (name === null || !name.trim()) return;
                setSavedFilters((prev) => {
                  const next = upsertFilter(prev, {
                    id: `f-${Date.now().toString(36)}`,
                    name: name.trim(),
                    value,
                    at: new Date().toISOString(),
                  });
                  saveFilters(next);
                  return next;
                });
                setFlash('Фильтр запомнен');
              }}
            >
              Запомнить
            </button>
          )}
        </div>
      )}

      {/* Показательные данные: видно всегда, выйти можно в любой момент. */}
      {demoOn && (
        <div className="flex items-center gap-2 px-3 md:px-4 py-1.5 text-[11.5px]
                        bg-[var(--warn)]/15 text-[var(--warn)] shrink-0" data-print="hide">
          <span>
            Показательные данные — выдуманный объект. Настоящий журнал не тронут.
          </span>
          <button type="button" className="btn btn-ghost text-[11px] ml-auto"
                  onClick={() => { setDemoOn(false); setJournal(loadJournal()); }}>
            Выйти из показа
          </button>
        </div>
      )}

      {/* Содержимое */}
      <div id="journal-content" tabIndex={-1}
           className="journal-scroll flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4">
        {error && (
          <div className="mb-3 flex items-start gap-2 p-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[12px] text-[var(--danger)]">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}

        {syncNote && (
          <div className="mb-3 flex items-start gap-2 p-2.5 rounded-lg text-[12px]"
               style={{
                 borderWidth: 1, borderStyle: 'solid',
                 borderColor: syncNote.tone === 'ok' ? 'var(--success)' : 'var(--warn)',
                 background: syncNote.tone === 'ok'
                   ? 'color-mix(in srgb, var(--success) 10%, transparent)'
                   : 'color-mix(in srgb, var(--warn) 10%, transparent)',
                 color: 'var(--text)',
               }}>
            {syncNote.tone === 'ok'
              ? <CloudCheck size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
              : <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />}
            <span className="flex-1">{syncNote.text}</span>
            <button type="button" onClick={() => setSyncNote(null)}
                    className="text-[var(--text-muted)] hover:text-[var(--text)]">
              <X size={14} />
            </button>
          </div>
        )}

        {pendingPoints && (
          <PointImport
            points={pendingPoints.points}
            source={pendingPoints.source}
            onCancel={() => setPendingPoints(null)}
            onImport={(chosen) => {
              const now = new Date().toISOString();
              let next = loadJournal();
              chosen.forEach(({ point, kind, endpointKind }, i) => {
                next = upsertObject(next, {
                  id: `obj-${pendingPoints.source}-${i}`,
                  kind,
                  name: point.name || undefined,
                  lat: point.lat, lon: point.lon,
                  uchastok: point.folder,
                  endpointKind,
                  state: kind === 'mufta' ? 'planned' : undefined,
                  author: actor,
                  createdAt: now, updatedAt: now,
                  sync: 'local',
                });
              });
              persist(next);
              setPendingPoints(null);
              setView('objects');
            }}
          />
        )}

        {report && (
          <div className="mb-3 p-3 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent-dim)] text-[12px] text-[var(--text)]">
            <div className="font-semibold mb-1 text-[var(--accent)]">Журнал загружен</div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-[var(--text-muted)]">
              <span>реестр СНП: <b className="text-[var(--text)]">{report.orderRows}</b></span>
              <span>подземка: <b className="text-[var(--text)]">{report.groundRows}</b></span>
              <span>подвес: <b className="text-[var(--text)]">{report.aerialRows}</b></span>
              <span>ГНБ: <b className="text-[var(--text)]">{report.drillRows}</b></span>
              <span>точек на карту: <b className="text-[var(--accent)]">{report.drillPoints}</b></span>
              {report.drillAmbiguous > 0 && <span>уточнено по области: <b className="text-[var(--warn)]">{report.drillAmbiguous}</b></span>}
              {report.drillUnparsed > 0 && <span>без координат: <b className="text-[var(--warn)]">{report.drillUnparsed}</b></span>}
            </div>
          </div>
        )}

        {empty ? (
          <EmptyJournal
            onPick={() => fileRef.current?.click()}
            onAdd={() => setFormOpen(true)}
            busy={busy}
            onDemo={() => {
              // Показательный журнал не сохраняем в хранилище: настоящий
              // остаётся нетронутым, а выход из показа ничего не теряет.
              setDemoOn(true);
              setJournal(demoJournal());
              setFlash('Показательные данные — настоящий журнал не тронут');
            }}
          />
        ) : view === 'today' ? (
          <TodayView
            journal={live}
            onOpenView={(v) => setView(v)}
            onAddEntry={() => setFormOpen(true)}
            onSetStage={(kato, stage, patch) => {
              const row = live.progress.find((p) => p.kato === kato);
              persist(setStage(loadJournal(), kato, stage, patch, actor,
                row && { snp: row.snp, oblast: row.oblast, rayon: row.rayon }));
            }}
          />
        ) : view === 'management' ? (
          <ManagementView journal={live} onOpenView={(v) => setView(v)} />
        ) : view === 'objects' ? (
          <ObjectsView
            journal={scoped}
            author={actor}
            editingId={editObjectId}
            onRequestPick={onRequestPick}
            onSave={(o) => persist(upsertObject(loadJournal(), o))}
            onDelete={(id) => {
              if (!confirm('Удалить объект?')) return;
              persist(removeObject(loadJournal(), id));
            }}
            onDoneEditing={() => onDoneEditObject?.()}
          />
        ) : view === 'drills' ? (
          <DrillsView
            journal={scoped}
            onAdd={() => { setEditingDrill(null); setDrillFormOpen(true); }}
            onEdit={(d) => { setEditingDrill(d); setDrillFormOpen(true); }}
            onMarkDone={(d) => {
              // Закрытие прокола — та же форма, но открытая на «сделано»:
              // метраж и координаты без неё взять неоткуда.
              setEditingDrill({ ...d, status: 'done', date: new Date().toISOString().slice(0, 10) });
              setDrillFormOpen(true);
            }}
            onDelete={(id) => {
              if (!confirm('Удалить прокол?')) return;
              persist(removeEntry(loadJournal(), id));
            }}
          />
        ) : view === 'stages' ? (
          <StagesView
            journal={live}
            onShowRoute={onShowRoute}
            routeKatos={routeKatos}
            onSeed={() => {
              const base = loadJournal();
              persist(setProgress(base, seedProgress(base.orders, base.ground, base.progress)));
            }}
            onSetStage={(kato, stage, patch) => {
              const row = live.progress.find((p) => p.kato === kato);
              persist(setStage(loadJournal(), kato, stage, patch, actor,
                row && { snp: row.snp, oblast: row.oblast, rayon: row.rayon }));
            }}
          />
        ) : view === 'materials' ? (
          <MaterialsView
            journal={scoped}
            author={actor}
            onSaveDrum={(d) => persist(upsertDrumRecord(loadJournal(), d))}
            onRemoveDrum={(id) => {
              if (!confirm('Удалить барабан? Метки задувки останутся в отчётах.')) return;
              persist(removeDrumRecord(loadJournal(), id));
            }}
            onAddDelivery={(d) => persist(upsertDelivery(loadJournal(), d))}
            onSetPrice={(m, price) => persist(setMaterialPrice(loadJournal(), m, price))}
            onRemoveDelivery={(id) => {
              if (!confirm('Удалить поставку?')) return;
              persist(removeDelivery(loadJournal(), id));
            }}
          />
        ) : view === 'closing' ? (
          <SectionClosing
            journal={scoped}
            onChangeFields={(uch, f) => {
              const base = loadJournal();
              persist({ ...base, actFields: { ...base.actFields, [uch]: f } });
            }}
          />
        ) : view === 'passport' ? (
          <PassportView
            journal={scoped}
            author={actor}
            onSaveSplice={(r) => persist(upsertSplice(loadJournal(), r))}
            onRemoveSplice={(id) => {
              if (!confirm('Удалить протокол сварки?')) return;
              persist(removeSplice(loadJournal(), id));
            }}
            onEditObject={(id) => { onDoneEditObject?.(); setView('objects'); void id; }}
          />
        ) : view === 'incidents' ? (
          <IncidentsView
            journal={scoped}
            author={actor}
            onRequestPick={onRequestPick}
            onSave={(i) => persist(upsertIncident(loadJournal(), i))}
            onRemove={(id) => {
              if (!confirm('Удалить запись об аварии?')) return;
              persist(removeIncident(loadJournal(), id));
            }}
          />
        ) : view === 'requisites' ? (
          <RequisitesView
            requisites={journal.requisites}
            onFlash={setFlash}
            onSave={(r) => persist(setRequisites(loadJournal(), r))}
          />
        ) : view === 'maintenance' ? (
          <MaintenanceView
            journal={journal}
            author={actor}
            lastSyncAt={syncedAt ?? undefined}
            onFlash={setFlash}
            onRestore={(j) => { persist(j); setFlash('Журнал заменён копией'); }}
          />
        ) : view === 'records' ? (
          <SiteRecordsView
            records={scoped.records}
            author={actor}
            onFlash={setFlash}
            onUpsert={(r) => persist(upsertSiteRecord(loadJournal(), r))}
            onRemove={(id) => persist(removeSiteRecord(loadJournal(), id))}
          />
        ) : view === 'plan' ? (
          <PlanView
            journal={scoped}
            author={actor}
            onFlash={setFlash}
            onAddPlan={(row) => persist(upsertPlan(loadJournal(), row))}
            onRemovePlan={(id) => persist(removePlan(loadJournal(), id))}
          />
        ) : view === 'resources' ? (
          <ResourcesView
            journal={scoped}
            requests={scoped.requests}
            from={filter.from}
            to={filter.to}
            author={actor}
            onFlash={setFlash}
            onAddRequest={(r) => persist(upsertRequest(loadJournal(), r))}
            onSetRequestStatus={(id, st) => persist(setRequestStatus(loadJournal(), id, st))}
            onRemoveRequest={(id) => persist(removeRequest(loadJournal(), id))}
          />
        ) : view === 'payroll' ? (
          <PayrollView
            journal={scoped}
            from={filter.from}
            to={filter.to}
            author={actor}
            onFlash={setFlash}
            onAddRate={(r) => persist(upsertRate(loadJournal(), r))}
            onRemoveRate={(id) => persist(removeRate(loadJournal(), id))}
            onAddPayment={(p) => persist(upsertPayment(loadJournal(), p))}
            onRemovePayment={(id) => persist(removePayment(loadJournal(), id))}
          />
        ) : view === 'docs' ? (
          <DocsView
            journal={scoped}
            from={filter.from ?? ''}
            to={filter.to ?? anchor ?? ''}
            author={actor}
            onFlash={setFlash}
            onOpenSection={() => setView('closing')}
            onSetActNumber={(uchastok, number) => {
              const base = loadJournal();
              persist({
                ...base,
                actFields: {
                  ...base.actFields,
                  [uchastok]: { ...(base.actFields?.[uchastok] ?? {}), actNumber: number },
                },
                updatedAt: new Date().toISOString(),
              });
            }}
          />
        ) : view === 'timesheet' ? (
          <TimesheetView
            rows={ground}
            crews={placed}
            onCopied={(n) => setFlash(`Табель скопирован: ${n} строк`)}
          />
        ) : view === 'checks' ? (
          <ChecksView
            journal={scoped}
            planFactRows={planFactRows}
            onRestore={(id) => persist(restoreFromTrash(loadJournal(), id))}
            onShow={(coords) => { onShowCoords?.(coords); onClose(); }}
            onDeleteRoute={(id) => {
              if (!confirm('Удалить эту трассу?\nВернуть её можно будет в журнале изменений.')) return;
              persist(deleteRoute(loadJournal(), id, actor));
            }}
          />
        ) : view === 'log' ? (
          <ChangeLogView
            journal={journal}
            oblast={oblast || undefined}
            onRestore={(id) => persist(restoreShape(loadJournal(), id, actor))}
          />
        ) : view === 'crews' ? (
          <CrewsList
            rows={placed.filter((c) => !c.derived)}
            derived={placed.filter((c): c is DerivedCrew => !!c.derived)}
            onAdd={() => { setEditingCrew(null); setCrewFormOpen(true); }}
            onEdit={(c) => { setEditingCrew(c); setCrewFormOpen(true); }}
            onDelete={handleDeleteCrew}
            onAdopt={(list) => {
              let base = loadJournal();
              for (const c of list) base = upsertCrew(base, c);
              persist(base);
            }}
          />
        ) : view === 'deviations' ? (
          <DeviationsList
            rows={devs}
            onAdd={() => { setEditingDev(null); setDevFormOpen(true); }}
            onEdit={(d) => { setEditingDev(d); setDevFormOpen(true); }}
            onDelete={handleDeleteDeviation}
          />
        ) : view === 'corrections' ? (
          <CorrectionsList
            rows={[...journal.corrections].reverse()}
            canDecide={!!JOURNAL_ROLES[role].canApprove}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ) : view === 'entries' ? (
          <div className="flex flex-col gap-2">
          {/* Смена одной строкой: отчёт с объекта приходит текстом, и
              переписывать его в форму руками незачем. */}
          <QuickEntryBar
            journal={journal}
            author={actor}
            onSubmit={(entry) => {
              persist(addGroundEntry(loadJournal(), entry));
              setFlash('Смена записана');
            }}
            onOpenForm={(parsed) => {
              setEditing(null);
              setPrefill(parsed);
              setFormOpen(true);
            }}
          />
          <EntriesTable
            rows={ground}
            journal={journal}
            onFlash={setFlash}
            onDelete={handleDelete}
            onEdit={(e) => { setEditing(e); setFormOpen(true); }}
            onShowOnMap={(e) => {
              // Карту показываем по участку: у записи своих координат нет,
              // а трасса участка — есть.
              const hit = scoped.planRoutes.find(
                (r) => normName(r.uchastok ?? r.name) === normName(e.uchastok),
              );
              if (!hit) return;
              onShowCoords?.(hit.coords);
              onClose();
            }}
            onBulkPatch={(ids, patch) => persist(bulkPatchEntries(loadJournal(), ids, patch, actor))}
            onDispute={(e) => {
              if (e.disputed) {
                persist(setDisputed(loadJournal(), e.id, false, undefined, actor));
                return;
              }
              const why = window.prompt(
                'В чём спор? Например: «не приняли 320 м», «нет подписи технадзора»',
                '',
              );
              if (why === null) return;
              persist(setDisputed(loadJournal(), e.id, true, why.trim(), actor));
            }}
            onRepeat={(e) => {
              // Повторяем цифры, но не дату и не отметки: назавтра это
              // другая смена, а не копия вчерашней.
              const { id, createdAt, updatedAt, presentedAt, presentedTo,
                disputed, disputeNote, ...rest } = e;
              setEditing(null);
              setPrefill({
                byMethod: rest.byMethod,
                uchastok: rest.uchastok,
                contractor: rest.contractor,
                column: rest.column,
                smu: rest.smu,
                tech: rest.tech,
                drillM: rest.drillM,
                drillCount: rest.drillCount,
                blowingM: rest.blowingM,
                matched: [], leftover: [],
              });
              setFormOpen(true);
            }}
            onPresent={(ids) => {
              const to = window.prompt('Кому предъявили? Фамилия технадзора:', '');
              if (to === null) return;
              persist(markPresented(loadJournal(), ids, to.trim()));
              setFlash(`Отмечено как предъявленное: ${ids.length}`);
            }}
            onCopied={(n) => setFlash(`Скопировано строк: ${n}`)}
          />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Ключевые цифры */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Kpi label="Проложено за период" value={fmtKm(totals.meters)} unit="км" accent />
              <Kpi label="Всего в журнале" value={fmtKm(allTotals.meters)} unit="км" />
              <Kpi label="Бестраншейно (ГНБ/ГНП)" value={fmtKm(totals.drillM)} unit={`км · ${totals.drillCount} шт`} />
              {openDevs.length > 0 ? (
                <button type="button" onClick={() => setView('deviations')} className="text-left">
                  <Kpi label="Отклонений без протокола" value={String(openDevs.length)}
                       unit="нужен протокол МГ" warn />
                </button>
              ) : (
                <Kpi label="Точек ГНБ на карте" value={String(mappedPoints)}
                     unit={`в ${drillsWithCoords} из ${drills.length} записей`} />
              )}
            </div>

            {/* Выработка по дням */}
            {days.length > 1 && (
              <DayChart days={days} picked={dayOpen} onPick={(d) => setDayOpen(d)} />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <BarList title="По областям" icon={<MapPin size={13} />} rows={byOblast}
                       picked={oblast} onPick={(n) => setOblast(oblast === n ? '' : n)} />
              <BarList title="По подрядчикам" icon={<Building2 size={13} />} rows={byContractor} />
              <BarList title="По СМУ" icon={<Wrench size={13} />} rows={bySmu}
                       picked={smu} onPick={(n) => setSmu(smu === n ? '' : n)} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <MethodBlock byMethod={totals.byMethod} total={totals.meters} />
              <MaterialBlock byMaterial={totals.byMaterial} />
            </div>

            <KmlSources
              plans={planSources(journal)}
              areas={areaSources(journal)}
              onRemove={(source) => {
                if (!confirm(`Убрать всё, что пришло из «${source}»?`)) return;
                persist(removeAreaSource(removePlanSource(loadJournal(), source), source));
              }}
            />
          </div>
        )}
      </div>

      {drillFormOpen && (
        <DrillForm
          journal={journal}
          initial={editingDrill}
          author={actor}
          onRequestPick={onRequestPick}
          onSave={(d) => persist(upsertDrill(loadJournal(), d))}
          onClose={() => { setDrillFormOpen(false); setEditingDrill(null); }}
        />
      )}

      {dayOpen && (
        <DayReport journal={scoped} date={dayOpen} oblast={oblast || undefined}
                   onClose={() => setDayOpen(null)}
                   onPlay={onPlayDay ? () => { onPlayDay(dayOpen); setDayOpen(null); } : undefined} />
      )}

      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />

      {sheetFile && (
        <SheetImport
          file={sheetFile}
          oblast={oblast || undefined}
          author={actor}
          onClose={() => setSheetFile(null)}
          onDone={(entries) => {
            let next = loadJournal();
            for (const e of entries) next = addGroundEntry(next, e);
            persist(next);
            rememberImport(sheetFile.name, { смены: entries.length });
            setSheetFile(null);
            setFlash(`Загружено строк: ${entries.length}`);
          }}
        />
      )}

      {formOpen && (
        <DailyEntryForm
          journal={journal}
          initial={editing}
          prefill={prefill}
          author={actor}
          onAddPhoto={(p) => persist(addPhoto(loadJournal(), p))}
          onRemovePhoto={(id) => persist(removePhoto(loadJournal(), id))}
          onRequestPick={onRequestPick}
          onSave={handleFormSave}
          onClose={() => { setFormOpen(false); setEditing(null); setPrefill(null); }}
        />
      )}

      {devFormOpen && (
        <DeviationForm
          journal={journal}
          initial={editingDev}
          onSave={handleSaveDeviation}
          onRequestPick={onRequestPick}
          onClose={() => { setDevFormOpen(false); setEditingDev(null); }}
        />
      )}

      {crewFormOpen && (
        <CrewForm
          journal={journal}
          initial={editingCrew}
          onSave={handleSaveCrew}
          onRequestPick={onRequestPick}
          onClose={() => { setCrewFormOpen(false); setEditingCrew(null); }}
        />
      )}
    </div>
  );
}

function CrewsList({ rows, derived, onAdd, onEdit, onDelete, onAdopt }: {
  rows: Crew[];
  /** Видны по журналу, но в справочник не заведены. */
  derived: DerivedCrew[];
  onAdd: () => void;
  onEdit: (c: Crew) => void;
  onDelete: (id: string) => void;
  onAdopt: (list: Crew[]) => void;
}) {
  const sorted = useMemo(
    () => [...rows, ...derived].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [rows, derived],
  );
  const placed = sorted.filter((c) => typeof c.lat === 'number' && typeof c.lon === 'number').length;
  const isDerived = (c: Crew) => derived.some((d) => d.id === c.id);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-[11.5px] text-[var(--text-muted)] flex-1">
          Колонны видны на карте: цвет — вид работ, кольцо — состояние.
          Чтобы перебросить бригаду, перетащите её метку.
          {sorted.length > 0 && <> На карте <b className="text-[var(--text)]">{placed}</b> из {sorted.length}.</>}
        </p>
        <button type="button" className="btn btn-primary text-[11px] shrink-0" onClick={onAdd}>
          <Plus size={14} />Колонна
        </button>
      </div>

      {/* Выведенные по журналу: заводить их руками — работа ради работы,
          но состав и технику знает только тот, кто там был. */}
      {derived.length > 0 && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[11.5px] text-[var(--text-muted)]">
          <HardHat size={15} className="shrink-0 mt-0.5" />
          <span className="flex-1">
            По журналу работают ещё <b className="text-[var(--text)]">{derived.length}</b> колонн —
            они уже на карте пунктиром. Заведите, чтобы вписать состав и технику.
          </span>
          <button type="button" className="btn text-[11px] shrink-0"
                  onClick={() => onAdopt(derived.map(({ derived: _d, days: _n, lastDate: _l, ...c }) => c))}>
            Завести все
          </button>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-12 flex flex-col items-center gap-2">
          <span className="text-2xl">🚜</span>
          <p className="text-[12.5px] text-[var(--text-muted)]">
            Колонны не заведены, и в журнале их не видно — в дневных отчётах
            нет ни номера колонны, ни подрядчика
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {sorted.map((c) => {
            const kind = CREW_KINDS[c.kind];
            const st = CREW_STATUS[c.status];
            const onDuty = c.members.filter((m) => !m.dayOff).length;
            const off = c.members.length - onDuty;
            const equip = Object.values(c.equipment ?? {}).reduce((s, v) => s + (v || 0), 0);
            const onMap = typeof c.lat === 'number' && typeof c.lon === 'number';
            const auto = isDerived(c);
            return (
              <div key={c.id}
                   className="rounded-lg border bg-[var(--bg-surface)] p-3 flex flex-col gap-1.5"
                   style={auto
                     ? { borderColor: 'var(--border)', borderStyle: 'dashed' }
                     : { borderColor: 'var(--border)' }}>
                <div className="flex items-start gap-2">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0"
                        style={{ background: `${kind.color}22`, border: `2px solid ${st.color}` }}>
                    <Glyph name={kind.icon} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-[var(--text)] truncate">{c.name}</span>
                      <span className="text-[10px]" style={{ color: st.color }}>● {st.label}</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      {[kind.label, c.uchastok, c.contractor].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {auto ? (
                    <button type="button" className="btn text-[10.5px] shrink-0"
                            title="Завести колонну в справочник — чтобы вписать состав и технику"
                            onClick={() => {
                              const { derived: _d, days: _n, lastDate: _l, ...plain } =
                                derived.find((d) => d.id === c.id)!;
                              onAdopt([plain]);
                            }}>
                      Завести
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => onEdit(c)} title="Изменить"
                              className="btn btn-ghost btn-icon shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)]">
                        <Pencil size={14} />
                      </button>
                      <button type="button" onClick={() => onDelete(c.id)} title="Удалить"
                              className="btn btn-ghost btn-icon shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)]">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
                  {auto ? (
                    <span className="text-[var(--text-muted)]">{c.note}</span>
                  ) : (
                    <>
                      <span>👷 в строю <b className="text-[var(--text)]">{onDuty}</b> из {c.members.length}</span>
                      {off > 0 && <span className="text-[var(--warn)]">выходной: {off}</span>}
                      <span>🔧 техника: <b className="text-[var(--text)]">{equip}</b></span>
                    </>
                  )}
                  {!onMap && <span className="text-[var(--warn)]">не на карте</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Протокол мобильной группы файлом.
 *
 * Пустой бланк заполнять руками незачем: обстоятельства уже записаны в
 * карточке отклонения. Оформленный протокол выгружается с номером и
 * решением, неоформленный — бланком с прочерками под подпись.
 */
function downloadProtocol(d: Deviation) {
  const html = protocolDocHtml({ deviation: d, protocol: d.protocol });
  // BOM — иначе Word открывает кириллицу кракозябрами.
  const blob = new Blob(['\ufeff', html], { type: DOC_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = protocolFileName(d);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DeviationsList({ rows, onAdd, onEdit, onDelete }: {
  rows: Deviation[];
  onAdd: () => void;
  onEdit: (d: Deviation) => void;
  onDelete: (id: string) => void;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [rows],
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-[11.5px] text-[var(--text-muted)] flex-1">
          Отклонение по глубине или трассе требует протокола мобильной группы — его номер уходит в Приложение&nbsp;12.
        </p>
        <button type="button" className="btn btn-primary text-[11px] shrink-0" onClick={onAdd}>
          <Plus size={14} />Зафиксировать
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-12 flex flex-col items-center gap-2">
          <Ruler size={22} className="text-[var(--text-muted)]" />
          <p className="text-[12.5px] text-[var(--text-muted)]">Отклонений не зафиксировано</p>
        </div>
      ) : sorted.map((d) => {
        const closed = isDeviationClosed(d);
        const tone = closed ? 'var(--success)' : 'var(--warn)';
        return (
          <div key={d.id} className="rounded-lg border bg-[var(--bg-surface)] p-3 flex flex-col gap-1.5"
               style={{ borderColor: closed ? 'var(--border)' : 'var(--warn)' }}>
            <div className="flex items-start gap-2 flex-wrap">
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ color: tone, border: `1px solid ${tone}` }}>
                {closed ? 'Протокол есть' : 'Без протокола'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)]">
                {DEVIATION_KIND_LABEL[d.kind]}
              </span>
              <span className="text-[12.5px] text-[var(--text)] font-medium truncate">{d.uchastok || '—'}</span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {d.date ? new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ru') : '—'}
              </span>
              <span className="ml-auto font-mono tabular-nums text-[13px] text-[var(--text)]">
                {d.lengthM.toLocaleString('ru')} м
              </span>
            </div>

            <div className="text-[11.5px] text-[var(--text-muted)]">
              {d.kind === 'depth' && d.actualDepthM !== undefined && (
                <span className="text-[var(--text)] font-mono mr-2">
                  глубина {d.actualDepthM} м
                  <span className="text-[var(--text-muted)]"> / проект {d.designDepthM ?? 1.2} м</span>
                </span>
              )}
              {d.reason}
              {(d.fromPoint || d.toPoint) && ` · ${d.fromPoint || '?'} → ${d.toPoint || '?'}`}
              {d.contractor && ` · ${d.contractor}`}
            </div>

            <div className="flex items-center gap-2">
              {d.protocol ? (
                <span className="text-[11px] text-[var(--success)] inline-flex items-center gap-1">
                  <Check size={12} />Протокол №{d.protocol.number} от{' '}
                  {d.protocol.date ? new Date(`${d.protocol.date}T00:00:00Z`).toLocaleDateString('ru') : '—'}
                </span>
              ) : (
                <span className="text-[11px] text-[var(--warn)] inline-flex items-center gap-1">
                  <FileWarning size={12} />Протокол мобильной группы не оформлен
                </span>
              )}
              <button type="button" onClick={() => downloadProtocol(d)}
                      title="Скачать протокол мобильной группы — откроется в Word"
                      className="btn btn-ghost btn-icon ml-auto text-[var(--text-muted)] hover:text-[var(--accent)]">
                <FileDown size={14} />
              </button>
              <button type="button" onClick={() => onEdit(d)} title="Изменить"
                      className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--accent)]">
                <Pencil size={14} />
              </button>
              <button type="button" onClick={() => onDelete(d.id)} title="Удалить"
                      className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--danger)]">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CorrectionsList({ rows, canDecide, onApprove, onReject }: {
  rows: CorrectionRequest[];
  canDecide: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 flex flex-col items-center gap-2">
        <Check size={22} className="text-[var(--text-muted)]" />
        <p className="text-[12.5px] text-[var(--text-muted)]">Заявок на исправление нет</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {!canDecide && rows.some((r) => r.status === 'pending') && (
        <p className="text-[11.5px] text-[var(--text-muted)] px-1">
          Подтверждать исправления может только отчётность — переключите роль вверху.
        </p>
      )}
      {rows.map((r) => {
        const diff = diffEntries(r.before, r.proposed);
        const tone = r.status === 'approved' ? 'var(--success)'
          : r.status === 'rejected' ? 'var(--danger)' : 'var(--warn)';
        const label = r.status === 'approved' ? 'Подтверждено'
          : r.status === 'rejected' ? 'Отклонено' : 'Ждёт подтверждения';
        return (
          <div key={r.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 flex flex-col gap-2">
            <div className="flex items-start gap-2 flex-wrap">
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ color: tone, border: `1px solid ${tone}` }}>{label}</span>
              <span className="text-[12.5px] text-[var(--text)] font-medium truncate">
                {r.before.uchastok || '—'}
              </span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {r.before.date ? new Date(`${r.before.date}T00:00:00Z`).toLocaleDateString('ru') : '—'}
              </span>
              <span className="ml-auto text-[10.5px] text-[var(--text-muted)] inline-flex items-center gap-1">
                <Clock size={11} />{new Date(r.createdAt).toLocaleString('ru')} · {r.author}
              </span>
            </div>

            <p className="text-[12px] text-[var(--text)]">
              <span className="text-[var(--text-muted)]">Причина: </span>{r.reason}
            </p>

            {diff.length === 0 ? (
              <p className="text-[11.5px] text-[var(--text-muted)]">Значения не изменились</p>
            ) : (
              <div className="rounded-md border border-[var(--border)] overflow-hidden">
                {diff.map((d, i) => (
                  <div key={i} className="flex items-baseline gap-2 px-2 py-1 text-[11.5px] border-b border-[var(--border)] last:border-0">
                    <span className="text-[var(--text-muted)] flex-1 truncate">{d.label}</span>
                    <span className="font-mono tabular-nums text-[var(--danger)] line-through">{d.before}</span>
                    <span className="text-[var(--text-muted)]">→</span>
                    <span className="font-mono tabular-nums text-[var(--success)]">{d.after}</span>
                  </div>
                ))}
              </div>
            )}

            {r.status === 'pending' ? (
              canDecide && (
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary text-[11px] flex-1 sm:flex-none sm:px-4" onClick={() => onApprove(r.id)}>
                    <Check size={14} />Подтвердить
                  </button>
                  <button type="button" className="btn btn-ghost text-[11px] flex-1 sm:flex-none sm:px-4" onClick={() => onReject(r.id)}>
                    <Ban size={14} />Отклонить
                  </button>
                </div>
              )
            ) : (
              <p className="text-[11px] text-[var(--text-muted)]">
                {r.decidedBy} · {r.decidedAt ? new Date(r.decidedAt).toLocaleString('ru') : ''}
                {r.decisionNote ? ` — ${r.decisionNote}` : ''}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Составные части ──────────────────────────────────────────────────────────

function Kpi({ label, value, unit, accent, warn }: {
  label: string; value: string; unit?: string; accent?: boolean; warn?: boolean;
}) {
  const cls = warn
    ? 'border-[var(--warn)]/50 bg-[var(--warn)]/10'
    : accent
      ? 'border-[var(--accent)]/35 bg-[var(--accent-dim)]'
      : 'border-[var(--border)] bg-[var(--bg-surface)]';
  const valueColor = warn ? 'text-[var(--warn)]' : accent ? 'text-[var(--accent)]' : 'text-[var(--text)]';
  return (
    <div className={`rounded-lg border p-3 h-full ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-tight">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-2xl font-semibold font-mono tabular-nums ${valueColor}`}>{value}</span>
        {unit && <span className="text-[11px] text-[var(--text-muted)]">{unit}</span>}
      </div>
    </div>
  );
}

function DayChart({ days, onPick, picked }: {
  days: { date: string; meters: number }[];
  onPick?: (date: string) => void;
  picked?: string | null;
}) {
  const max = Math.max(...days.map((d) => d.meters), 1);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
        Выработка по дням
        <span className="ml-1.5 normal-case tracking-normal text-[10px]">— нажмите на день</span>
      </div>
      <div className="flex items-end gap-[3px] h-24">
        {days.map((d) => (
          <button key={d.date} type="button" onClick={() => onPick?.(d.date)}
                  title={`${new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ru')} — открыть день`}
                  className="flex-1 min-w-[3px] group relative flex items-end h-full cursor-pointer">
            <div className={`w-full rounded-t-sm transition-colors ${
                   picked === d.date ? 'bg-[var(--accent)]' : 'bg-[var(--accent)]/60 group-hover:bg-[var(--accent)]'}`}
                 style={{ height: `${Math.max(2, (d.meters / max) * 100)}%` }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block
                            whitespace-nowrap rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)]
                            px-1.5 py-0.5 text-[10px] font-mono text-[var(--text)] z-10">
              {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' })} · {fmtKm(d.meters)} км
            </div>
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-mono text-[var(--text-muted)]">
        <span>{new Date(`${days[0].date}T00:00:00Z`).toLocaleDateString('ru')}</span>
        <span>пик {fmtKm(max)} км</span>
        <span>{new Date(`${days[days.length - 1].date}T00:00:00Z`).toLocaleDateString('ru')}</span>
      </div>
    </div>
  );
}

function BarList({ title, icon, rows, onPick, picked }: {
  title: string; icon: React.ReactNode;
  rows: { name: string; meters: number; entries: number }[];
  onPick?: (name: string) => void;
  picked?: string;
}) {
  const max = Math.max(...rows.map((r) => r.meters), 1);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
        {icon}{title}
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">Нет данных за период</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.slice(0, 9).map((r) => (
            <button key={r.name} type="button" disabled={!onPick}
                    onClick={() => onPick?.(r.name)}
                    className={`text-left w-full ${onPick ? 'cursor-pointer hover:opacity-80' : ''}`}>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className={`truncate ${picked === r.name ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}
                      title={r.name}>{r.name}</span>
                <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0">
                  {fmtKm(r.meters)} км · {r.entries}
                </span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-[var(--bg-canvas)] overflow-hidden">
                <div className={`h-full rounded-full ${picked === r.name ? 'bg-[var(--accent)]' : 'bg-[var(--accent)]/70'}`}
                     style={{ width: `${(r.meters / max) * 100}%` }} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Загруженные KML — трассы и обводки.
 *
 * Без списка загруженный не тот файл остаётся на карте навсегда: удалить
 * его неоткуда, и человек начинает грузить поверх, надеясь перекрыть.
 */
function KmlSources({ plans, areas, onRemove }: {
  plans: { source: string; routes: number; lengthM: number }[];
  areas: { source: string; areas: number }[];
  onRemove: (source: string) => void;
}) {
  const names = [...new Set([...plans.map((p) => p.source), ...areas.map((a) => a.source)])];
  if (names.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
        <Route size={13} />Загруженные KML ({names.length})
      </div>
      <div className="flex flex-col gap-1">
        {names.map((source) => {
          const p = plans.find((x) => x.source === source);
          const a = areas.find((x) => x.source === source);
          const parts = [
            p ? `${p.routes} ${plural(p.routes, 'трасса', 'трассы', 'трасс')} · ${(p.lengthM / 1000).toFixed(1)} км` : '',
            a ? `${a.areas} ${plural(a.areas, 'контур', 'контура', 'контуров')}` : '',
          ].filter(Boolean);
          return (
            <div key={source} className="flex items-center gap-2 text-[11.5px] py-1 border-b border-[var(--border)] last:border-0">
              <span className="text-[var(--text)] truncate" title={source}>{source}</span>
              <span className="ml-auto text-[10.5px] text-[var(--text-muted)] shrink-0">{parts.join(' · ')}</span>
              <button type="button" onClick={() => onRemove(source)} title="Убрать с карты"
                      className="btn btn-ghost btn-icon shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)]">
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MethodBlock({ byMethod, total }: { byMethod: Record<string, number>; total: number }) {
  const rows = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Способы прокладки</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">Нет данных за период</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map(([m, v]) => (
            <div key={m} className="flex items-baseline justify-between gap-2 text-[11px] py-0.5 border-b border-[var(--border)] last:border-0">
              <span className="text-[var(--text)] truncate">{LAY_METHOD_LABEL[m as LayMethod] ?? m}</span>
              <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0">
                {fmtKm(v)} км
                <span className="ml-1.5 text-[var(--accent)]">{total ? Math.round((v / total) * 100) : 0}%</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MaterialBlock({ byMaterial }: { byMaterial: Record<string, number> }) {
  const rows = Object.entries(byMaterial).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
        <Boxes size={13} />Материалы за период
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">Нет данных за период</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {rows.map(([m, v]) => {
            const unit = MATERIAL_UNIT[m as MaterialKind] ?? 'шт';
            return (
              <div key={m} className="flex items-baseline justify-between gap-2 text-[11px] py-0.5">
                <span className="text-[var(--text)] truncate">{MATERIAL_LABEL[m as MaterialKind] ?? m}</span>
                <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0">
                  {unit === 'м' ? fmtMeters(v) : `${v.toLocaleString('ru')} шт`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyJournal({ onPick, onAdd, onDemo, busy }: {
  onPick: () => void; onAdd: () => void; onDemo: () => void; busy: boolean;
}) {
  return (
    <div className="h-full flex items-center justify-center py-12">
      <div className="max-w-md text-center flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center">
          <Wrench size={22} className="text-[var(--accent)]" />
        </div>
        <h3 className="text-base font-semibold text-[var(--text)]">Журнал пока пуст</h3>
        <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">
          Загрузите рабочий файл СНП — читаются листы «Все СНП заказа», «DATA»,
          «DATA ПОДВЕС» и «ГНБ Журнал». Координаты переходов разбираются в точки на карте,
          даже когда широта и долгота записаны в разном порядке.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary text-[12px]" onClick={onPick} disabled={busy}>
            <Upload size={15} />Выбрать файл журнала
          </button>
          <button type="button" className="btn btn-ghost text-[12px]" onClick={onAdd}>
            <Plus size={15} />Внести день вручную
          </button>
        </div>
        {/* Пустая система ничего о себе не рассказывает: человек видит
            «записей нет» и закрывает её. */}
        <button type="button" className="btn btn-ghost text-[11.5px]" onClick={onDemo}>
          Посмотреть на показательных данных
        </button>
        <p className="text-[10.5px] text-[var(--text-muted)]">
          Это выдуманный объект: Зерендинский район, три села, месяц смен.
          Настоящий журнал при этом не трогается, выйти можно в любой момент.
        </p>
      </div>
    </div>
  );
}

/**
 * Что брать из точек KML.
 *
 * Раньше спрашивали одним вопросом на тысячу точек: «это всё столбы или
 * всё муфты?» — и отвечать на него было нечем, поэтому точки не грузили
 * вовсе. Теперь они разобраны по подписи: конец пути и ККС предложены
 * сразу, пересечения и проколы — нет, потому что это разметка
 * обследования, а трасса с тех пор менялась не раз.
 */
function PointImport({ points, source, onImport, onCancel }: {
  points: import('./planImport').RawPoint[];
  source: string;
  onImport: (chosen: {
    point: import('./planImport').RawPoint;
    kind: import('@/types/construction').SiteObjectKind;
    endpointKind?: string;
  }[]) => void;
  onCancel: () => void;
}) {
  const buckets = useMemo(() => groupPoints(points), [points]);
  const [picked, setPicked] = useState<Set<PointGroup>>(
    () => new Set(buckets.filter((b) => POINT_GROUPS[b.group].byDefault).map((b) => b.group)),
  );

  const usable = buckets.filter((b) => POINT_GROUPS[b.group].objectKind);
  const total = buckets
    .filter((b) => picked.has(b.group))
    .reduce((s, b) => s + b.points.length, 0);

  return (
    <div className="mb-3 p-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)] flex flex-col gap-2">
      <div className="text-[12px] text-[var(--text)]">
        В файле <b>{points.length}</b> {plural(points.length, 'точка', 'точки', 'точек')}.
        Разобраны по подписи — отметьте, что взять.
      </div>

      <div className="flex flex-col gap-1">
        {buckets.map((b) => {
          const spec = POINT_GROUPS[b.group];
          const can = !!spec.objectKind;
          return (
            <label key={b.group}
                   className={`flex items-start gap-2 px-2 py-1.5 rounded ${
                     can ? 'cursor-pointer hover:bg-[var(--bg-canvas)]' : 'opacity-60'}`}>
              <input type="checkbox" disabled={!can} checked={picked.has(b.group)}
                     onChange={() => setPicked((prev) => {
                       const next = new Set(prev);
                       if (next.has(b.group)) next.delete(b.group); else next.add(b.group);
                       return next;
                     })}
                     className="mt-0.5 accent-[var(--accent)]" />
              <span className="min-w-0 flex-1">
                <span className="text-[12px] text-[var(--text)]">
                  <Glyph name={spec.icon} /> {spec.label}
                  <b className="ml-1.5 font-mono">{b.points.length}</b>
                </span>
                <span className="block text-[10.5px] text-[var(--text-muted)]">
                  {spec.hint}
                  {!can && ' — на карту не идут'}
                </span>
                <span className="block text-[10px] text-[var(--text-muted)] truncate">
                  {b.points.slice(0, 3).map((p) => p.name).filter(Boolean).join(' · ')}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary text-[11px]" disabled={total === 0}
                onClick={() => onImport(
                  buckets
                    .filter((b) => picked.has(b.group) && POINT_GROUPS[b.group].objectKind)
                    .flatMap((b) => b.points.map((point) => ({
                      point,
                      kind: POINT_GROUPS[b.group].objectKind!,
                      endpointKind: b.group === 'endpoint' ? endpointKindOf(point.name) : undefined,
                    }))),
                )}>
          Взять {total} {plural(total, 'точку', 'точки', 'точек')}
        </button>
        <button type="button" className="btn btn-ghost text-[11px] text-[var(--text-muted)]"
                onClick={onCancel}>
          Не загружать
        </button>
        <span className="text-[10.5px] text-[var(--text-muted)] truncate">
          из «{source}»
        </span>
      </div>
      {usable.length === 0 && (
        <p className="text-[11px] text-[var(--text-muted)]">
          Ни одна подпись не похожа на конечную точку или ККС — брать нечего.
        </p>
      )}
    </div>
  );
}
