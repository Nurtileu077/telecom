'use client';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  X, Upload, Loader2, AlertTriangle, MapPin, Wrench, Boxes,
  Plus, Download, Trash2, CloudOff, Pencil, Check, Ban, Building2, Clock,
  Ruler, FileWarning, RefreshCw, CloudCheck, Route, FileDown, HardHat,
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
  upsertObject, removeObject, setSectionProgress, scopeJournal, smuList,
  restoreRoute,
} from './journalStore';
import { crewsFromJournal, type DerivedCrew } from './crewDerive';
import { routeViews } from './routeStyle';
import ChangeLogView from './ChangeLogView';
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
  LAY_METHOD_LABEL, MATERIAL_UNIT, JOURNAL_ROLE_LABEL, DEVIATION_KIND_LABEL,
  CREW_KINDS, CREW_STATUS, SITE_OBJECT_KINDS, SITE_OBJECT_SPECS,
  type LayMethod, type MaterialKind, type DailyWorkEntry,
  type CorrectionRequest, type JournalRole, type Deviation, type Crew,
  type DrillLogEntry,
} from '@/types/construction';

type Period = 'day' | 'week' | 'month' | 'all';
type View = 'today' | 'summary' | 'management' | 'entries' | 'corrections' | 'deviations' | 'crews' | 'closing' | 'materials' | 'stages' | 'drills' | 'objects' | 'log';

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
}

export default function ConstructionPanel({
  onClose, onRequestPick, editObjectId, onDoneEditObject, onPlayDay, onShowRoute,
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
  const [role, setRole] = useState<JournalRole>('field');
  const fileRef = useRef<HTMLInputElement>(null);
  const planRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setJournal(loadJournal());
    setRole(loadJournalRole());
    setSyncedAt(loadLastSyncAt());
  }, []);

  // Нажали «Изменить» в попапе объекта — открываем его раздел, иначе
  // карточка появилась бы за другим экраном.
  useEffect(() => {
    if (editObjectId) setView('objects');
  }, [editObjectId]);

  const actor = useMemo(() => getActorName() || 'Без имени', []);

  /** Общая точка записи: сохраняем и честно сообщаем о переполнении. */
  const persist = useCallback((next: JournalState) => {
    setJournal(next);
    if (!saveJournal(next)) {
      setError('Данные показаны, но не сохранены: переполнено хранилище браузера. Выгрузите журнал в Excel и очистите старые проекты.');
    } else {
      setError('');
    }
  }, []);

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
    if (!confirm('Удалить запись?')) return;
    persist(removeEntry(loadJournal(), id));
  }, [persist]);

  /**
   * Обмен с облаком. Слитое состояние обязательно сохраняем локально —
   * иначе при следующем обмене чужие правки придут заново.
   */
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
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
      setSyncNote({
        tone: 'ok',
        text: res.firstPush
          ? 'Журнал впервые выгружен в облако.'
          : parts.length ? `Синхронизировано: ${parts.join(', ')}.` : 'Всё уже совпадало.',
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
      const res = await importPlanFile(file, base.orders);
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
      setError(e instanceof Error ? e.message : 'Не удалось прочитать файл');
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
      setError(e instanceof Error ? e.message : 'Не удалось собрать файл');
    } finally { setBusy(false); }
  }, [journal]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true); setError(''); setReport(null);
    try {
      const res = await importJournal(file);
      persist(mergeJournal(loadJournal(), res));
      setReport(res.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось прочитать файл');
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
  const scoped = useMemo(() => scopeJournal(journal, oblast), [journal, oblast]);

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

  // У каких сёл трасса вообще есть: кнопка «посмотреть трассу», которая
  // ничего не показывает, хуже отсутствующей.
  const routeKatos = useMemo(() => {
    const views = routeViews(scoped.planRoutes, { progress: live.progress });
    return new Set(views.map((v) => v.kato).filter((k): k is string => !!k));
  }, [scoped.planRoutes, live.progress]);

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

  return (
    <div className="fixed inset-0 z-[9998] bg-[var(--bg-canvas)] flex flex-col">
      {/* Шапка */}
      <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0"
           style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top, 0px))' }}>
        <Wrench size={17} className="text-[var(--accent)] shrink-0" />
        <h2 className="text-sm font-semibold text-[var(--text)] shrink-0">Журнал стройки</h2>
        {anchor && (
          <span className="text-[11px] font-mono text-[var(--text-muted)] hidden sm:inline">
            данные по {new Date(`${anchor}T00:00:00Z`).toLocaleDateString('ru')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
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
          <button type="button" className="btn btn-primary text-[11px]" onClick={() => setFormOpen(true)}>
            <Plus size={15} /><span className="hidden sm:inline">Закрыть день</span>
          </button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Закрыть"><X size={16} /></button>
        </div>
      </div>

      {/* Фильтры */}
      {!empty && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 md:px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
          <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md mr-1">
            {([['today', 'Сегодня'], ['summary', 'Сводка'], ['management', 'Руководству'], ['entries', 'Записи'], ['crews', 'Колонны'], ['stages', 'Этапы'], ['drills', 'Проколы'], ['objects', 'Объекты'], ['deviations', 'Отклонения'], ['materials', 'Материалы'], ['closing', 'Закрытие'], ['corrections', 'Заявки'], ['log', 'Изменения']] as [View, string][]).map(([v, label]) => {
              const badge = v === 'corrections' ? pending.length
                : v === 'deviations' ? openDevs.length
                : v === 'materials' ? lowMaterials.length
                : v === 'stages' ? handoffs.length : 0;
              return (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={`px-2.5 py-1 text-[11px] rounded transition-colors inline-flex items-center gap-1 ${
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
          </div>
          <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md" title="Кто вы в журнале">
            {(['field', 'office'] as JournalRole[]).map((r) => (
              <button key={r} type="button"
                onClick={() => { setRole(r); saveJournalRole(r); }}
                className={`px-2 py-1 text-[11px] rounded transition-colors ${
                  role === r ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                {JOURNAL_ROLE_LABEL[r]}
              </button>
            ))}
          </div>
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
        </div>
      )}

      {/* Содержимое */}
      <div className="flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4">
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
          <div className="mb-3 p-3 rounded-lg border border-[var(--warn)]/50 bg-[var(--warn)]/10 flex flex-col gap-2">
            <div className="text-[12px] text-[var(--text)]">
              В файле <b>{pendingPoints.points.length}</b>{' '}
              {plural(pendingPoints.points.length, 'точка', 'точки', 'точек')}.
              Что это? Система сама не решает: в одном файле это столбы, в другом —
              разметка обследования, по которой трасса давно изменилась.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SITE_OBJECT_KINDS.map((k) => (
                <button key={k} type="button" className="btn btn-ghost text-[11px]"
                        onClick={() => {
                          const now = new Date().toISOString();
                          let next = loadJournal();
                          pendingPoints.points.forEach((pt, i) => {
                            next = upsertObject(next, {
                              id: `obj-${pendingPoints.source}-${i}`,
                              kind: k,
                              name: pt.name || undefined,
                              lat: pt.lat, lon: pt.lon,
                              uchastok: pt.folder,
                              state: k === 'mufta' ? 'planned' : undefined,
                              author: actor,
                              createdAt: now, updatedAt: now,
                              sync: 'local',
                            });
                          });
                          persist(next);
                          setPendingPoints(null);
                          setView('objects');
                        }}>
                  {SITE_OBJECT_SPECS[k].icon} Как {SITE_OBJECT_SPECS[k].plural.toLowerCase()}
                </button>
              ))}
              <button type="button" className="btn btn-ghost text-[11px] text-[var(--text-muted)]"
                      onClick={() => setPendingPoints(null)}>
                Не загружать
              </button>
            </div>
          </div>
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
          <EmptyJournal onPick={() => fileRef.current?.click()} onAdd={() => setFormOpen(true)} busy={busy} />
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
        ) : view === 'log' ? (
          <ChangeLogView
            journal={journal}
            oblast={oblast || undefined}
            onRestore={(id) => persist(restoreRoute(loadJournal(), id, actor))}
          />
        ) : view === 'crews' ? (
          <CrewsList
            rows={scoped.crews}
            derived={autoCrews}
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
            canDecide={role === 'office'}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ) : view === 'entries' ? (
          <EntriesList
            rows={ground}
            journal={journal}
            onDelete={handleDelete}
            onEdit={(e) => { setEditing(e); setFormOpen(true); }}
          />
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

      {formOpen && (
        <DailyEntryForm
          journal={journal}
          initial={editing}
          onRequestPick={onRequestPick}
          onSave={handleFormSave}
          onClose={() => { setFormOpen(false); setEditing(null); }}
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
                    {kind.icon}
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

function EntriesList({ rows, journal, onDelete, onEdit }: {
  rows: DailyWorkEntry[];
  journal: JournalState;
  onDelete: (id: string) => void;
  onEdit: (e: DailyWorkEntry) => void;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [rows],
  );
  if (sorted.length === 0) {
    return <p className="text-[12px] text-[var(--text-muted)] text-center py-10">За выбранный период записей нет</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.slice(0, 300).map((e) => {
        const meters = Object.values(e.byMethod).reduce((s, v) => s + (v ?? 0), 0);
        return (
          <div key={e.id} className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                  {e.date ? new Date(`${e.date}T00:00:00Z`).toLocaleDateString('ru') : '—'}
                </span>
                <span className="text-[12.5px] text-[var(--text)] font-medium truncate">{e.uchastok || '—'}</span>
                {e.tech && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)]">{e.tech}</span>}
                {e.sync === 'local' && (
                  <span className="text-[10px] text-[var(--text-muted)] inline-flex items-center gap-1" title="Сохранено локально">
                    <CloudOff size={11} />локально
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-muted)] truncate">
                {[e.contractor, e.column, e.smu, e.oblast].filter(Boolean).join(' · ')}
                {e.note ? ` — ${e.note}` : ''}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono tabular-nums text-[13px] text-[var(--text)]">{meters.toLocaleString('ru')} м</div>
              {!!e.drillM && <div className="text-[10px] text-[var(--text-muted)]">ГНБ {e.drillM} м</div>}
            </div>
            {hasPendingCorrection(journal, e.id) ? (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[var(--warn)] text-[var(--warn)] self-center"
                    title="По записи уже есть заявка на исправление">
                на согласовании
              </span>
            ) : (
              <button type="button" onClick={() => onEdit(e)} title="Исправить отчёт"
                      className="btn btn-ghost btn-icon shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)]">
                <Pencil size={14} />
              </button>
            )}
            <button type="button" onClick={() => onDelete(e.id)} title="Удалить"
                    className="btn btn-ghost btn-icon shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)]">
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      {sorted.length > 300 && (
        <p className="text-[11px] text-[var(--text-muted)] text-center py-2">
          Показаны последние 300 из {sorted.length}. Сузьте период или фильтры.
        </p>
      )}
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

function EmptyJournal({ onPick, onAdd, busy }: { onPick: () => void; onAdd: () => void; busy: boolean }) {
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
      </div>
    </div>
  );
}
