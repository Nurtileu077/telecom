import { JournalState, DeletedMark, emptyJournal } from './journalStore';
import {
  DailyWorkEntry, AerialWorkEntry, DrillLogEntry, Deviation, Crew,
  CorrectionRequest, SettlementOrder, Contractor, MaterialDelivery, PlanRoute,
  SnpProgress, MapArea, SiteObject, ChangeLogEntry, CableDrum, FieldPhoto,
} from '@/types/construction';

/**
 * Слияние двух версий журнала — своей и серверной.
 *
 * Правила простые и объяснимые бригадиру:
 *  1. Записи сравниваются по id; выигрывает та, которую правили позже.
 *  2. Удаление тоже событие со временем: если удалили позже последней
 *     правки — запись остаётся удалённой, даже когда у соседа она ещё есть.
 *     Если запись правили ПОСЛЕ удаления, правка воскрешает её — иначе
 *     чужое давнее удаление молча съедало бы свежую работу.
 *  3. Ничего не выбрасывается «в пользу сервера»: запись, которой на сервере
 *     нет и которую никто не удалял, доезжает наверх.
 *
 * Это не CRDT и не пытается им быть: для дневных отчётов, где один участок
 * ведёт одна бригада, правило «позже правил — тот и прав» даёт предсказуемый
 * результат, а конфликты видно по счётчику.
 */

export interface MergeStats {
  /** Пришло с сервера того, чего не было локально. */
  pulled: number;
  /** Локального, чего нет на сервере. */
  pushed: number;
  /** Записи, изменённые с обеих сторон — победила более поздняя. */
  conflicts: number;
  /** Записей убрано надгробиями. */
  removed: number;
}

export interface MergeResult {
  merged: JournalState;
  stats: MergeStats;
}

interface Identified { id: string; updatedAt: string }

/** Самое позднее время удаления по id из обеих сторон. */
function tombstoneMap(a: DeletedMark[], b: DeletedMark[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of [...a, ...b]) {
    const prev = m.get(d.id);
    if (!prev || d.at > prev) m.set(d.id, d.at);
  }
  return m;
}

/**
 * Журнал изменений дописывается, а не правится: объединяем по id и
 * держим в хронологии. Ограничение сверху — чтобы файл не рос вечно:
 * старые записи о правках трассы никто не читает, а место занимают.
 */
const CHANGES_KEPT = 2000;

function mergeChanges(a: ChangeLogEntry[] = [], b: ChangeLogEntry[] = []): ChangeLogEntry[] {
  const byId = new Map<string, ChangeLogEntry>();
  for (const c of [...a, ...b]) byId.set(c.id, c);
  return [...byId.values()]
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, CHANGES_KEPT);
}

function mergeCollection<T extends Identified>(
  local: T[],
  remote: T[],
  tombs: Map<string, string>,
  stats: MergeStats,
): T[] {
  const byId = new Map<string, T>();
  const localIds = new Set(local.map((x) => x.id));
  const remoteIds = new Set(remote.map((x) => x.id));

  for (const item of local) byId.set(item.id, item);

  for (const item of remote) {
    const mine = byId.get(item.id);
    if (!mine) { byId.set(item.id, item); stats.pulled++; continue; }
    if (mine.updatedAt === item.updatedAt) continue;
    // Правили с обеих сторон — берём более позднюю правку.
    stats.conflicts++;
    if (item.updatedAt > mine.updatedAt) byId.set(item.id, item);
  }

  for (const id of localIds) if (!remoteIds.has(id)) stats.pushed++;

  const out: T[] = [];
  for (const item of byId.values()) {
    const deletedAt = tombs.get(item.id);
    // Правка позже удаления воскрешает запись: иначе чужое давнее удаление
    // съело бы работу, сделанную сегодня.
    if (deletedAt && deletedAt >= item.updatedAt) { stats.removed++; continue; }
    out.push(item);
  }
  return out;
}

/** Реестр СНП ключуется по КАТО, а не по id. */
function mergeOrders(local: SettlementOrder[], remote: SettlementOrder[]): SettlementOrder[] {
  const byKey = new Map<string, SettlementOrder>();
  for (const o of local) byKey.set(o.kato || o.snp, o);
  for (const o of remote) if (!byKey.has(o.kato || o.snp)) byKey.set(o.kato || o.snp, o);
  return [...byKey.values()];
}

/** Справочник подрядчиков: объединяем по имени, локальное описание в приоритете. */
function mergeContractors(local: Contractor[], remote: Contractor[]): Contractor[] {
  const byName = new Map<string, Contractor>();
  for (const c of remote) byName.set(c.name.trim().toLowerCase(), c);
  for (const c of local) byName.set(c.name.trim().toLowerCase(), c);
  return [...byName.values()];
}

/** Надгробия старше срока давности выбрасываем, чтобы список не рос вечно. */
const TOMBSTONE_TTL_DAYS = 180;

function pruneTombstones(marks: DeletedMark[], now: Date): DeletedMark[] {
  const cutoff = new Date(now.getTime() - TOMBSTONE_TTL_DAYS * 86400_000).toISOString();
  return marks.filter((d) => d.at >= cutoff);
}

export function mergeJournalStates(
  local: JournalState,
  remote: JournalState,
  now: Date = new Date(),
): MergeResult {
  const stats: MergeStats = { pulled: 0, pushed: 0, conflicts: 0, removed: 0 };
  const tombs = tombstoneMap(local.deleted ?? [], remote.deleted ?? []);

  const merged: JournalState = {
    orders: mergeOrders(local.orders, remote.orders),
    ground: mergeCollection<DailyWorkEntry>(local.ground, remote.ground, tombs, stats),
    aerial: mergeCollection<AerialWorkEntry>(local.aerial, remote.aerial, tombs, stats),
    drills: mergeCollection<DrillLogEntry>(local.drills, remote.drills, tombs, stats),
    deviations: mergeCollection<Deviation>(local.deviations, remote.deviations, tombs, stats),
    crews: mergeCollection<Crew>(local.crews, remote.crews, tombs, stats),
    deliveries: mergeCollection<MaterialDelivery>(local.deliveries, remote.deliveries, tombs, stats),
    drums: mergeCollection<CableDrum>(local.drums ?? [], remote.drums ?? [], tombs, stats),
    photos: mergeCollection<FieldPhoto>(local.photos ?? [], remote.photos ?? [], tombs, stats),
    planRoutes: mergeCollection<PlanRoute>(local.planRoutes, remote.planRoutes, tombs, stats),
    areas: mergeCollection<MapArea>(local.areas, remote.areas, tombs, stats),
    objects: mergeCollection<SiteObject>(local.objects, remote.objects, tombs, stats),
    // Продвижение по участку — позже записанное вернее: это накопленный
    // метраж, и свежая запись включает в себя прежнюю.
    sectionProgress: mergeSectionProgress(local.sectionProgress, remote.sectionProgress),
    // Цены — справочник: чужие позиции добираем, свои не отдаём.
    prices: { ...remote.prices, ...local.prices },
    progress: mergeProgress(local.progress, remote.progress, stats),
    corrections: mergeCorrections(local.corrections, remote.corrections, stats),
    // Журнал изменений только растёт: записи в нём не правят, их дописывают.
    // Поэтому объединение по id, без «кто новее»: новее тут не бывает.
    changes: mergeChanges(local.changes, remote.changes),
    contractors: mergeContractors(local.contractors, remote.contractors),
    // Поля актов: своё заполнение в приоритете, чужие участки добираем.
    actFields: { ...(remote.actFields ?? {}), ...(local.actFields ?? {}) },
    deleted: pruneTombstones(
      [...tombs.entries()].map(([id, at]) => ({ id, at })),
      now,
    ),
    updatedAt: now.toISOString(),
  };

  return { merged, stats };
}

/**
 * Заявки на исправление живут своей жизнью: у них нет updatedAt, зато есть
 * статус. Решённая заявка всегда сильнее ожидающей — иначе подтверждение,
 * сделанное в офисе, откатилось бы при синхронизации с полем.
 */
function mergeCorrections(
  local: CorrectionRequest[],
  remote: CorrectionRequest[],
  stats: MergeStats,
): CorrectionRequest[] {
  const byId = new Map<string, CorrectionRequest>();
  for (const c of local) byId.set(c.id, c);
  for (const c of remote) {
    const mine = byId.get(c.id);
    if (!mine) { byId.set(c.id, c); stats.pulled++; continue; }
    if (mine.status === c.status) continue;
    stats.conflicts++;
    const decided = (x: CorrectionRequest) => x.status !== 'pending';
    if (decided(c) && !decided(mine)) byId.set(c.id, c);
    // Обе решены по-разному — оставляем ту, что решили позже.
    else if (decided(c) && decided(mine) && (c.decidedAt ?? '') > (mine.decidedAt ?? '')) {
      byId.set(c.id, c);
    }
  }
  return [...byId.values()];
}

/**
 * Этапы ключуются по КАТО, а не по id. Сливаем по этапам, а не целиком
 * карточкой: бригады закрывают разные этапы одного СНП, и карточка целиком
 * затирала бы чужую отметку.
 */
function mergeProgress(local: SnpProgress[], remote: SnpProgress[], stats: MergeStats): SnpProgress[] {
  const byKato = new Map<string, SnpProgress>();
  for (const p of local) byKato.set(p.kato, p);
  for (const r of remote) {
    const mine = byKato.get(r.kato);
    if (!mine) { byKato.set(r.kato, r); stats.pulled++; continue; }
    const stages = { ...mine.stages };
    for (const [stage, st] of Object.entries(r.stages)) {
      const own = stages[stage as keyof typeof stages];
      if (!own) { stages[stage as keyof typeof stages] = st; continue; }
      // Позже отмеченный этап сильнее: doneAt и startedAt дают порядок.
      const t = (x: typeof st) => x.doneAt ?? x.startedAt ?? '';
      if (t(st) > t(own)) { stages[stage as keyof typeof stages] = st; stats.conflicts++; }
    }
    byKato.set(r.kato, { ...mine, stages, updatedAt: new Date().toISOString() });
  }
  return [...byKato.values()];
}

function mergeSectionProgress(
  local: JournalState['sectionProgress'],
  remote: JournalState['sectionProgress'],
): JournalState['sectionProgress'] {
  const out = { ...remote };
  for (const [kato, mine] of Object.entries(local ?? {})) {
    const theirs = out[kato];
    if (!theirs || (mine.date ?? '') >= (theirs.date ?? '')) out[kato] = mine;
  }
  return out;
}

/** Пустой журнал как «серверная сторона», когда на сервере ещё ничего нет. */
export function emptyRemote(): JournalState {
  return emptyJournal();
}
