'use client';
import { useState, useMemo, useEffect } from 'react';
import { X, Check, AlertTriangle, MapPin } from 'lucide-react';
import {
  WorkTech, WORK_TECHS, LayMethod, LAY_METHODS, LAY_METHOD_LABEL,
  MaterialKind, MATERIAL_KINDS, MATERIAL_UNIT, DailyWorkEntry,
  OperationKind, OPERATIONS, OPERATION_KINDS, OPERATION_GROUPS,
  EQUIPMENT_KINDS, DuctMark,
} from '@/types/construction';
import {
  JournalState, loadLastContext, saveLastContext, MATERIAL_LABEL,
  suggestContractor, smuList,
} from './journalStore';
import { advanceAlong, routeForSection } from './routeProgress';
import { normName } from './areaImport';

/**
 * Закрытие рабочего дня.
 *
 * Метры, а не километры: в поле считают метрами, а перевод в километры для
 * отчётности система делает сама. Контекст (СМУ, область, участок) подставляется
 * из прошлой записи — назавтра бригаде остаётся вписать только цифры.
 */

interface Props {
  /** Спрятать форму и дать указать точку на карте. */
  onRequestPick?: (label: string) => Promise<{ lat: number; lon: number } | null>;
  journal: JournalState;
  /** Запись, которую исправляют. Пусто — вносим новый день. */
  initial?: DailyWorkEntry | null;
  /** В режиме исправления причина обязательна и уходит на согласование. */
  onSave: (
    entry: DailyWorkEntry,
    reason?: string,
    /** Где остановились: подтверждённая или поправленная точка. */
    stop?: { lat: number; lon: number; routeId: string; doneM: number; manual: boolean },
  ) => void;
  onClose: () => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const numToStr = (v?: number): string => (v ? String(v) : '');

export default function DailyEntryForm({
  journal, initial, onSave, onClose, onRequestPick,
}: Props) {
  const correcting = !!initial;
  const last = useMemo(() => (correcting ? null : loadLastContext()), [correcting]);

  const [date, setDate] = useState(initial?.date ?? todayIso);
  const [smu, setSmu] = useState(initial?.smu ?? last?.smu ?? '');
  const [contractor, setContractor] = useState(initial?.contractor ?? last?.contractor ?? '');
  const [column, setColumn] = useState(initial?.column ?? last?.column ?? '');
  const [oblast, setOblast] = useState(initial?.oblast ?? last?.oblast ?? '');
  const [rayon, setRayon] = useState(initial?.rayon ?? last?.rayon ?? '');
  const [uchastok, setUchastok] = useState(initial?.uchastok ?? last?.uchastok ?? '');
  const [kato, setKato] = useState(initial?.kato ?? last?.kato ?? '');
  const [tech, setTech] = useState<WorkTech>(initial?.tech ?? last?.tech ?? 'МКТ');
  const [byMethod, setByMethod] = useState<Partial<Record<LayMethod, string>>>(() => {
    const init: Partial<Record<LayMethod, string>> = {};
    if (initial) for (const m of LAY_METHODS) init[m] = numToStr(initial.byMethod[m]);
    return init;
  });
  const [drillM, setDrillM] = useState(numToStr(initial?.drillM));
  const [drillCount, setDrillCount] = useState(numToStr(initial?.drillCount));
  const [openCrossings, setOpenCrossings] = useState(numToStr(initial?.openCrossings));
  const [blowingM, setBlowingM] = useState(numToStr(initial?.blowingM));
  const [materials, setMaterials] = useState<Partial<Record<MaterialKind, string>>>(() => {
    const init: Partial<Record<MaterialKind, string>> = {};
    if (initial) for (const m of MATERIAL_KINDS) init[m] = numToStr(initial.materials[m]);
    return init;
  });
  const [note, setNote] = useState(initial?.note ?? '');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  // Подробная часть — отчёт инженера. По умолчанию свёрнута, чтобы быстрый
  // путь бригадира оставался коротким.
  const [detailed, setDetailed] = useState(
    !!(initial?.operations || initial?.equipment
      || initial?.ductMarks?.length || initial?.drumMarks?.length),
  );
  const [operations, setOperations] = useState<Partial<Record<OperationKind, string>>>(() => {
    const init: Partial<Record<OperationKind, string>> = {};
    if (initial?.operations) for (const k of OPERATION_KINDS) init[k] = numToStr(initial.operations[k]);
    return init;
  });
  const [equipment, setEquipment] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (initial?.equipment) {
      for (const [k, v] of Object.entries(initial.equipment)) init[k] = String(v);
    } else if (last?.equipment) {
      // Техника вчерашней смены переносится: колонна не меняет
      // кабелеукладчик на манипулятор каждое утро.
      for (const [k, v] of Object.entries(last.equipment)) init[k] = String(v);
    }
    return init;
  });
  /** Что сегодня не вышло и почему — спрашиваем, когда убирают вчерашнее. */
  const [equipmentOff, setEquipmentOff] = useState<Record<string, string>>(
    () => ({ ...(initial?.equipmentOff ?? {}) }),
  );
  /** Продолжаем вчерашний участок или начали новый. */
  const [continued, setContinued] = useState<boolean | null>(
    correcting || !last?.uchastok ? true : null,
  );
  /** Куда сдвинулись за день: считаем, человек подтверждает или правит. */
  const [stopPoint, setStopPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const [ductMarks, setDuctMarks] = useState<{ coil: string; meters: string }[]>(
    () => (initial?.ductMarks ?? []).map((m) => ({ coil: m.coil, meters: String(m.meters) })),
  );
  const [drumMarks, setDrumMarks] = useState<{ coil: string; meters: string }[]>(
    () => (initial?.drumMarks ?? []).map((m) => ({ coil: m.coil, meters: String(m.meters) })),
  );
  const [totalMkt, setTotalMkt] = useState(numToStr(initial?.totalMktM));
  const [totalUchastok, setTotalUchastok] = useState(numToStr(initial?.totalUchastokM));
  const [reserveMkt, setReserveMkt] = useState(numToStr(initial?.reserveMktM));
  const [downtime, setDowntime] = useState(initial?.downtime ?? '');
  const [tomorrow, setTomorrow] = useState(initial?.tomorrow ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Подсказки из уже накопленных данных
  const uchastki = useMemo(() => {
    const s = new Set<string>();
    for (const g of journal.ground) if (g.uchastok) s.add(g.uchastok);
    for (const o of journal.orders) if (o.snp) s.add(o.snp);
    return [...s].sort((a, b) => a.localeCompare(b, 'ru')).slice(0, 400);
  }, [journal]);

  const oblasti = useMemo(() => {
    const s = new Set<string>();
    for (const g of journal.ground) if (g.oblast) s.add(g.oblast);
    for (const o of journal.orders) if (o.oblast) s.add(o.oblast);
    return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [journal]);

  // СМУ снова ставят: список начинается с семи постоянных, а не с пустоты.
  const smus = useMemo(() => smuList(journal), [journal]);

  // Участок знаем — подставим КАТО, область и район из журнала или реестра
  useEffect(() => {
    if (!uchastok) return;
    const prev = journal.ground.find((g) => g.uchastok === uchastok);
    if (prev) {
      if (!kato) setKato(prev.kato);
      if (!oblast) setOblast(prev.oblast);
      if (!rayon && prev.rayon) setRayon(prev.rayon);
      return;
    }
    const order = journal.orders.find((o) => o.snp === uchastok);
    if (order) {
      if (!kato) setKato(order.kato);
      if (!oblast) setOblast(order.oblast);
      if (!rayon && order.rayon) setRayon(order.rayon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uchastok]);

  const numOf = (v?: string): number => {
    if (!v) return 0;
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const totalMeters = useMemo(
    () => LAY_METHODS.reduce((s, m) => s + numOf(byMethod[m]), 0),
    [byMethod],
  );

  /**
   * Трасса участка и предполагаемая точка остановки.
   *
   * Положение колонны — следствие метража: прошли за день столько-то —
   * сдвинулись по линии на столько-то. Система считает и спрашивает,
   * человек подтверждает или поправляет.
   */
  const sectionRoute = useMemo(() => {
    const key = normName(uchastok);
    if (!key) return null;
    return routeForSection(journal.planRoutes, (r) => {
      const fields = [r.uchastok, r.folder, r.name].filter(Boolean) as string[];
      return fields.some((f) => normName(f) === key || normName(f).includes(key));
    });
  }, [journal.planRoutes, uchastok]);

  const doneBefore = kato ? (journal.sectionProgress?.[kato]?.doneM ?? 0) : 0;

  const proposedStop = useMemo(() => {
    if (correcting || !sectionRoute || totalMeters <= 0) return null;
    return advanceAlong(sectionRoute, doneBefore, totalMeters);
  }, [correcting, sectionRoute, doneBefore, totalMeters]);

  const stop = stopPoint ?? (proposedStop ? { lat: proposedStop.lat, lon: proposedStop.lon } : null);

  // Подрядчик по району — подсказка, а не автозаполнение: район может вести
  // субподрядчик, и решать должен человек.
  const suggested = useMemo(
    () => suggestContractor(journal.contractors, oblast, rayon),
    [journal.contractors, oblast, rayon],
  );

  const anyOperation = useMemo(
    () => OPERATION_KINDS.some((k) => numOf(operations[k]) > 0),
    [operations],
  );
  const hasWork = totalMeters > 0 || numOf(drillM) > 0 || numOf(blowingM) > 0
    || numOf(totalMkt) > 0 || anyOperation;
  // Исправление без причины не уходит: проверяющему нужно понимать, что чинят.
  const canSave = !!date && !!uchastok.trim() && hasWork && (!correcting || !!reason.trim());

  const submit = () => {
    setTouched(true);
    if (!canSave) return;
    const now = new Date().toISOString();

    const methods: Partial<Record<LayMethod, number>> = {};
    for (const m of LAY_METHODS) {
      const v = Math.round(numOf(byMethod[m]));
      if (v > 0) methods[m] = v;
    }
    const mats: Partial<Record<MaterialKind, number>> = {};
    for (const m of MATERIAL_KINDS) {
      const v = numOf(materials[m]);
      if (v > 0) mats[m] = MATERIAL_UNIT[m] === 'м' ? Math.round(v) : v;
    }

    onSave({
      kind: 'ground',
      id: initial?.id ?? `g-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date, smu: smu.trim(),
      contractor: contractor.trim() || undefined,
      column: column.trim() || undefined,
      oblast: oblast.trim(),
      rayon: rayon.trim() || undefined,
      uchastok: uchastok.trim(), kato: kato.trim(), tech,
      byMethod: methods,
      drillM: Math.round(numOf(drillM)) || undefined,
      drillCount: numOf(drillCount) || undefined,
      openCrossings: numOf(openCrossings) || undefined,
      blowingM: Math.round(numOf(blowingM)) || undefined,
      materials: mats,
      note: note.trim() || undefined,
      operations: (() => {
        const o: Partial<Record<OperationKind, number>> = {};
        for (const k of OPERATION_KINDS) {
          const v = numOf(operations[k]);
          if (v > 0) o[k] = OPERATIONS[k].unit === 'м' ? Math.round(v) : v;
        }
        return Object.keys(o).length ? o : undefined;
      })(),
      equipmentOff: Object.keys(equipmentOff).length ? equipmentOff : undefined,
      equipment: (() => {
        const e: Record<string, number> = {};
        for (const [k, v] of Object.entries(equipment)) {
          const n = numOf(v);
          if (n > 0) e[k] = n;
        }
        return Object.keys(e).length ? e : undefined;
      })(),
      ductMarks: (() => {
        const list: DuctMark[] = ductMarks
          .filter((m) => m.coil.trim())
          .map((m) => ({ coil: m.coil.trim(), meters: Math.round(numOf(m.meters)) }));
        return list.length ? list : undefined;
      })(),
      drumMarks: (() => {
        const list: DuctMark[] = drumMarks
          .filter((m) => m.coil.trim())
          .map((m) => ({ coil: m.coil.trim(), meters: Math.round(numOf(m.meters)) }));
        return list.length ? list : undefined;
      })(),
      totalMktM: Math.round(numOf(totalMkt)) || undefined,
      totalUchastokM: Math.round(numOf(totalUchastok)) || undefined,
      reserveMktM: Math.round(numOf(reserveMkt)) || undefined,
      downtime: downtime.trim() || undefined,
      tomorrow: tomorrow.trim() || undefined,
      createdAt: initial?.createdAt ?? now, updatedAt: now, sync: 'local',
    },
    correcting ? reason.trim() : undefined,
    // Точку сохраняем только подтверждённую: молча двигать метку колонны
    // по расчёту — значит однажды показать её там, где никого нет.
    stop && stopConfirmed && sectionRoute
      ? {
          lat: stop.lat, lon: stop.lon,
          routeId: sectionRoute.id,
          doneM: Math.round(doneBefore + totalMeters),
          manual: !!stopPoint,
        }
      : undefined);

    if (!correcting) {
      saveLastContext({
        smu, contractor, column, oblast, rayon, uchastok, kato, tech, date,
        equipment: (() => {
          const out: Record<string, number> = {};
          for (const [k, v] of Object.entries(equipment)) {
            const n = parseFloat(String(v).replace(',', '.'));
            if (Number.isFinite(n) && n > 0) out[k] = n;
          }
          return out;
        })(),
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-stretch sm:items-center sm:justify-center sm:p-4">
      <div className="bg-[var(--bg-surface)] w-full sm:max-w-[560px] sm:rounded-xl border border-[var(--border)]
                      flex flex-col max-h-full sm:max-h-[90vh] overflow-hidden">
        {/* Шапка */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0"
             style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {correcting ? 'Исправить отчёт' : 'Закрыть день'}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] truncate">
              {correcting
                ? 'Правка вступит в силу после подтверждения отчётностью'
                : (uchastok || 'Выберите участок')}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon ml-auto" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {/* Продолжаем вчерашнее или начали новое.
              Вопрос заранее избавляет от половины ввода: участок, колонна,
              подрядчик и техника подставлены — остаётся вписать цифры. */}
          {continued === null && last && (
            <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)] p-3 flex flex-col gap-2">
              <div className="text-[12.5px] text-[var(--text)]">
                {last.date
                  ? `${new Date(`${last.date}T00:00:00Z`).toLocaleDateString('ru')} работали на «${last.uchastok}»`
                  : `В прошлый раз работали на «${last.uchastok}»`}
                {last.column ? ` · ${last.column}` : ''}
                {Object.keys(last.equipment ?? {}).length
                  ? ` · техника: ${Object.entries(last.equipment ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}`
                  : ''}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary text-[11.5px]"
                        onClick={() => setContinued(true)}>
                  Продолжаем здесь
                </button>
                <button type="button" className="btn btn-ghost text-[11.5px]"
                        onClick={() => {
                          // Новый участок: чистим место и технику, остальное
                          // (СМУ, подрядчик, колонна) обычно то же самое.
                          setContinued(false);
                          setUchastok(''); setKato(''); setOblast(''); setRayon('');
                          setEquipment({});
                        }}>
                  Новый участок
                </button>
              </div>
            </div>
          )}

          {/* Где */}
          <Group title="Где">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Дата">
                <input id="ce-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="inp" />
              </Field>
              <Field label="СМУ">
                <input id="ce-smu" list="ce-smus" value={smu} onChange={(e) => setSmu(e.target.value)}
                       placeholder="СМУ-2" className="inp" />
                <datalist id="ce-smus">{smus.map((s) => <option key={s} value={s} />)}</datalist>
              </Field>
            </div>
            <Field label="Участок" required error={touched && !uchastok.trim() ? 'Укажите участок' : ''}>
              <input id="ce-uchastok" list="ce-uchastki" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                     placeholder="сущ. ОМ - Акбеит" className="inp" />
              <datalist id="ce-uchastki">{uchastki.map((u) => <option key={u} value={u} />)}</datalist>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Область">
                <input id="ce-oblast" list="ce-oblasti" value={oblast} onChange={(e) => setOblast(e.target.value)} className="inp" />
                <datalist id="ce-oblasti">{oblasti.map((o) => <option key={o} value={o} />)}</datalist>
              </Field>
              <Field label="Район">
                <input id="ce-rayon" value={rayon} onChange={(e) => setRayon(e.target.value)}
                       placeholder="Зерендинский" className="inp" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Подрядчик">
                <input id="ce-contractor" list="ce-contractors" value={contractor}
                       onChange={(e) => setContractor(e.target.value)}
                       placeholder={suggested ? `напр. ${suggested.name}` : 'TERRA TECH'} className="inp" />
                <datalist id="ce-contractors">
                  {journal.contractors.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </Field>
              <Field label="Колонна">
                <input id="ce-column" value={column} onChange={(e) => setColumn(e.target.value)}
                       placeholder="1-колонна" className="inp" />
              </Field>
            </div>
            <Field label="КАТО">
              <input id="ce-kato" value={kato} onChange={(e) => setKato(e.target.value)}
                     inputMode="numeric" placeholder="подставится сам" className="inp font-mono" />
            </Field>
            {suggested && !contractor.trim() && (
              <button type="button" onClick={() => setContractor(suggested.name)}
                      className="self-start text-[11px] text-[var(--accent)] hover:underline">
                Подставить «{suggested.name}» — работает в этом районе
              </button>
            )}
          </Group>

          {/* Что делали */}
          <Group title="Что делали">
            <div className="flex gap-1 bg-[var(--bg-canvas)] p-0.5 rounded-md">
              {WORK_TECHS.map((t) => (
                <button key={t} type="button" onClick={() => setTech(t)}
                  className={`flex-1 py-1.5 text-[12px] rounded transition-colors ${
                    tech === t ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-medium' : 'text-[var(--text-muted)]'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {LAY_METHODS.map((m) => (
                <NumField key={m} id={`ce-m-${m}`} label={LAY_METHOD_LABEL[m]} unit="м"
                          value={byMethod[m] ?? ''}
                          onChange={(v) => setByMethod((p) => ({ ...p, [m]: v }))} />
              ))}
            </div>
            <div className="flex items-baseline justify-between px-1 pt-1 border-t border-[var(--border)]">
              <span className="text-[11px] text-[var(--text-muted)]">Итого за день</span>
              <span className="font-mono tabular-nums text-sm text-[var(--accent)]">
                {totalMeters.toLocaleString('ru')} м
                {totalMeters >= 1000 && <span className="text-[var(--text-muted)] text-[11px] ml-1.5">
                  ≈ {(totalMeters / 1000).toFixed(2)} км</span>}
              </span>
            </div>

            {/* Где остановились. Считаем по метражу вдоль трассы и
                спрашиваем: угадать точнее человека система не может, но
                предложить точку и сэкономить ему вечер — вполне. */}
            {stop && (
              <div className="rounded-lg border p-2.5 flex flex-col gap-1.5"
                   style={{
                     borderColor: stopConfirmed ? 'var(--accent)' : 'var(--border)',
                     background: stopConfirmed ? 'var(--accent-dim)' : 'var(--bg-canvas)',
                   }}>
                <div className="text-[11.5px] text-[var(--text)]">
                  {stopConfirmed ? 'Остановились здесь' : 'Вы примерно тут?'}
                  <span className="font-mono text-[10.5px] text-[var(--text-muted)] ml-1.5">
                    {stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}
                  </span>
                </div>
                <div className="text-[10.5px] text-[var(--text-muted)]">
                  По трассе «{sectionRoute?.name}»: было {Math.round(doneBefore).toLocaleString('ru')} м,
                  за день {Math.round(totalMeters).toLocaleString('ru')} м
                  {proposedStop?.atEnd ? ' — трасса пройдена до конца' : ''}
                </div>
                <div className="flex gap-1.5">
                  {!stopConfirmed && (
                    <button type="button" className="btn btn-primary text-[10.5px]"
                            onClick={() => setStopConfirmed(true)}>
                      Верно
                    </button>
                  )}
                  {onRequestPick && (
                    <button type="button" className="btn btn-ghost text-[10.5px]"
                            onClick={async () => {
                              const p = await onRequestPick('где остановились');
                              if (p) { setStopPoint(p); setStopConfirmed(true); }
                            }}>
                      <MapPin size={12} />Указать на карте
                    </button>
                  )}
                </div>
              </div>
            )}
          </Group>

          {/* Переходы */}
          <Group title="Переходы и задувка">
            <div className="grid grid-cols-2 gap-2">
              <NumField id="ce-drill-m" label="ГНБ/ГНП" unit="м" value={drillM} onChange={setDrillM} />
              <NumField id="ce-drill-n" label="Проколов" unit="шт" value={drillCount} onChange={setDrillCount} />
              <NumField id="ce-open" label="Открытый переход" unit="шт" value={openCrossings} onChange={setOpenCrossings} />
              <NumField id="ce-blow" label="Задувка ОК" unit="м" value={blowingM} onChange={setBlowingM} />
            </div>
          </Group>

          {/* Материалы */}
          <Group title="Материалы за день">
            <div className="grid grid-cols-3 gap-2">
              {MATERIAL_KINDS.map((m) => (
                <NumField key={m} id={`ce-mat-${m}`} label={MATERIAL_LABEL[m]} unit={MATERIAL_UNIT[m]}
                          value={materials[m] ?? ''}
                          onChange={(v) => setMaterials((p) => ({ ...p, [m]: v }))} />
              ))}
            </div>
          </Group>

          {/* Подробная часть — отчёт инженера по контролю строительства */}
          <div className="border-t border-[var(--border)] pt-3">
            <button type="button" onClick={() => setDetailed((v) => !v)}
                    className="flex items-center gap-2 text-[11.5px] text-[var(--accent)] hover:underline">
              {detailed ? '▾' : '▸'} Подробный отчёт инженера
              <span className="text-[var(--text-muted)]">
                операции, техника, метки трубы, тоталы
              </span>
            </button>
          </div>

          {detailed && (
            <>
              <Group title="Операции за смену">
                <p className="text-[10.5px] text-[var(--text-muted)] leading-snug -mt-1">
                  Операции не складываются в дневной прогресс: прокладка МКТ и ленты — это один участок.
                  Итог ведите в поле «Тотал МКТ за день».
                </p>
                {OPERATION_GROUPS.map((grp) => {
                  const keys = OPERATION_KINDS.filter((k) => OPERATIONS[k].group === grp);
                  return (
                    <div key={grp} className="flex flex-col gap-1.5">
                      <span className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">{grp}</span>
                      <div className="grid grid-cols-2 gap-2">
                        {keys.map((k) => (
                          <NumField key={k} id={`ce-op-${k}`} label={OPERATIONS[k].label}
                                    unit={OPERATIONS[k].unit} value={operations[k] ?? ''}
                                    onChange={(v) => setOperations((p) => ({ ...p, [k]: v }))} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </Group>

              <Group title="Итоги по МКТ">
                <div className="grid grid-cols-3 gap-2">
                  <NumField id="ce-total-day" label="Тотал за день" unit="м" value={totalMkt} onChange={setTotalMkt} />
                  <NumField id="ce-total-uch" label="Тотал по участку" unit="м" value={totalUchastok} onChange={setTotalUchastok} />
                  <NumField id="ce-reserve" label="Запас МКТ ГНБ" unit="м" value={reserveMkt} onChange={setReserveMkt} />
                </div>
              </Group>

              <Group title="Состав техники">
                {last?.equipment && Object.keys(last.equipment).length > 0 && !correcting && (
                  <p className="text-[10.5px] text-[var(--text-muted)] leading-snug -mt-1">
                    Перенесена со вчерашней смены. Убираете — скажите почему,
                    и причина сама попадёт в отчёт.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {EQUIPMENT_KINDS.map((k) => (
                    <NumField key={k} id={`ce-eq-${k}`} label={k} unit="шт"
                              value={equipment[k] ?? ''}
                              onChange={(v) => {
                                const had = parseFloat(String(equipment[k] ?? '0').replace(',', '.')) > 0;
                                const now = parseFloat(String(v).replace(',', '.')) > 0;
                                setEquipment((p) => ({ ...p, [k]: v }));
                                // Вчера была, сегодня убрали — спрашиваем причину.
                                if (had && !now && (last?.equipment?.[k] ?? 0) > 0) {
                                  const why = window.prompt(`Почему сегодня без «${k}»?`);
                                  if (why && why.trim()) {
                                    setEquipmentOff((p) => ({ ...p, [k]: why.trim() }));
                                  }
                                } else if (now) {
                                  setEquipmentOff((p) => {
                                    if (!(k in p)) return p;
                                    const next = { ...p };
                                    delete next[k];
                                    return next;
                                  });
                                }
                              }} />
                  ))}
                </div>
                {Object.keys(equipmentOff).length > 0 && (
                  <div className="flex flex-col gap-1 mt-1">
                    {Object.entries(equipmentOff).map(([k, why]) => (
                      <div key={k} className="text-[11px] text-[var(--warn)]">
                        Без «{k}»: {why}
                      </div>
                    ))}
                  </div>
                )}
              </Group>

              <Group title="Метки трубы">
                <p className="text-[10.5px] text-[var(--text-muted)] leading-snug -mt-1">
                  С какой отметки на какую ушла бухта — этим подтверждается метраж.
                </p>
                {ductMarks.map((m, i) => (
                  <div key={i} className="flex gap-2 items-end">
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-[10.5px] text-[var(--text-muted)]">Бухта / метка</span>
                      <input value={m.coil} placeholder="4003"
                             onChange={(e) => setDuctMarks((p) => p.map((x, j) => j === i ? { ...x, coil: e.target.value } : x))}
                             className="inp font-mono" />
                    </label>
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-[10.5px] text-[var(--text-muted)]">Метраж</span>
                      <div className="relative">
                        <input value={m.meters} inputMode="decimal" placeholder="0000"
                               onChange={(e) => setDuctMarks((p) => p.map((x, j) => j === i ? { ...x, meters: e.target.value.replace(/[^\d.,]/g, '') } : x))}
                               className="inp pr-7 font-mono tabular-nums" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">м</span>
                      </div>
                    </label>
                    <button type="button" title="Убрать"
                            onClick={() => setDuctMarks((p) => p.filter((_, j) => j !== i))}
                            className="btn btn-ghost btn-icon mb-0.5 text-[var(--text-muted)] hover:text-[var(--danger)]">
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setDuctMarks((p) => [...p, { coil: '', meters: '' }])}
                        className="self-start text-[11px] text-[var(--accent)] hover:underline">
                  + Добавить метку
                </button>
              </Group>

              <Group title="Барабаны кабеля">
                <p className="text-[10.5px] text-[var(--text-muted)] leading-snug -mt-1">
                  С какого барабана сколько задули. Из этого считается остаток —
                  вводить его отдельно не нужно.
                </p>
                {drumMarks.map((m, i) => (
                  <div key={i} className="flex gap-2 items-end">
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-[10.5px] text-[var(--text-muted)]">Барабан №</span>
                      <input value={m.coil} placeholder="4003" list="ce-drums"
                             onChange={(e) => setDrumMarks((p) => p.map((x, j) => j === i ? { ...x, coil: e.target.value } : x))}
                             className="inp font-mono" />
                    </label>
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-[10.5px] text-[var(--text-muted)]">Задуто</span>
                      <div className="relative">
                        <input value={m.meters} inputMode="decimal" placeholder="0"
                               onChange={(e) => setDrumMarks((p) => p.map((x, j) => j === i ? { ...x, meters: e.target.value.replace(/[^\d.,]/g, '') } : x))}
                               className="inp pr-7 font-mono tabular-nums" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">м</span>
                      </div>
                    </label>
                    <button type="button" title="Убрать"
                            onClick={() => setDrumMarks((p) => p.filter((_, j) => j !== i))}
                            className="btn btn-ghost btn-icon mb-0.5 text-[var(--text-muted)] hover:text-[var(--danger)]">
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <datalist id="ce-drums">
                  {journal.drums.map((d) => (
                    <option key={d.id} value={d.number}>
                      {[d.cable, `${d.lengthM} м`].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </datalist>
                <button type="button" onClick={() => setDrumMarks((p) => [...p, { coil: '', meters: '' }])}
                        className="self-start text-[11px] text-[var(--accent)] hover:underline">
                  + Добавить барабан
                </button>
              </Group>

              <Field label="Причины простоя / невыполнения">
                <textarea id="ce-downtime" value={downtime} onChange={(e) => setDowntime(e.target.value)} rows={2}
                          placeholder="Ждали согласование, скальный грунт, поломка техники" className="inp resize-none" />
              </Field>

              <Field label="План работы на завтра">
                <textarea id="ce-tomorrow" value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} rows={2}
                          placeholder="Продолжение протяжки МКТ в сторону п. Кызылегис" className="inp resize-none" />
              </Field>
            </>
          )}

          <Field label="Примечание">
            <textarea id="ce-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                      placeholder="Что мешало, что перешли, особенности" className="inp resize-none" />
          </Field>

          {correcting && (
            <Field label="Причина исправления" required
                   error={touched && !reason.trim() ? 'Без причины заявка не уйдёт' : ''}>
              <textarea id="ce-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                        placeholder="Ошиблись в метраже, перепутали участок…" className="inp resize-none" />
            </Field>
          )}

          {touched && !canSave && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[11.5px] text-[var(--warn)]">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                {!uchastok.trim()
                  ? 'Укажите участок.'
                  : !hasWork
                    ? 'Впишите хотя бы одну цифру выработки — метры, ГНБ или задувку.'
                    : 'Укажите причину исправления.'}
              </span>
            </div>
          )}
        </div>

        {/* Кнопки */}
        <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)] shrink-0"
             style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary flex-1" onClick={submit} disabled={!canSave}>
            <Check size={15} />{correcting ? 'Отправить на согласование' : 'Сохранить день'}
          </button>
        </div>
      </div>

      <style jsx global>{`
        .inp {
          width: 100%;
          background: var(--bg-canvas);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 7px 9px;
          font-size: 13px;
          color: var(--text);
        }
        .inp:focus { outline: none; border-color: var(--accent); }
        .inp::placeholder { color: var(--text-muted); }
      `}</style>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, children, required, error }: {
  label: string; children: React.ReactNode; required?: boolean; error?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--text-muted)]">
        {label}{required && <span className="text-[var(--danger)] ml-0.5">*</span>}
      </span>
      {children}
      {error && <span className="text-[10.5px] text-[var(--danger)]">{error}</span>}
    </label>
  );
}

function NumField({ id, label, unit, value, onChange }: {
  id: string; label: string; unit: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-[var(--text-muted)] leading-tight truncate" title={label}>{label}</span>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="0"
          className="inp pr-7 font-mono tabular-nums"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] pointer-events-none">
          {unit}
        </span>
      </div>
    </label>
  );
}
