import {
  Crew, CrewKind, DailyWorkEntry, AerialWorkEntry, DrillLogEntry,
} from '@/types/construction';

/**
 * Колонны заводятся по журналу, а не руками.
 *
 * Заполнять список бригад отдельным справочником никто не станет: их
 * десятки, они меняются, и вводить их второй раз после дневного отчёта
 * — работа ради работы. Но в отчётах они уже названы: колонка «колонна»,
 * подрядчик, вид работ. Этого достаточно, чтобы понять, сколько бригад
 * примерно работает и где.
 *
 * Выведенная колонна — не выдумка, а сводка по журналу: состав и техника
 * у неё пустые, потому что их в дневной записи нет, а место берётся из
 * последнего отчёта тем же расчётом, что и у заведённых руками.
 *
 * Ручная карточка сильнее выведенной: если бригаду завели, её данные не
 * перезаписываются — выведенная просто не появляется.
 */

/** Сколько дней молчания превращают колонну из работающей в стоящую. */
const IDLE_DAYS = 3;

export interface DerivedCrew extends Crew {
  /** Заведена по журналу, а не руками. */
  derived: true;
  /** Сколько дней подряд эта бригада отчитывалась. */
  days: number;
  /** Дата последнего отчёта. */
  lastDate: string;
}

export interface CrewDeriveContext {
  ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[];
  drills: DrillLogEntry[];
  crews: Crew[];
}

function norm(v?: string): string {
  return (v ?? '').trim().toLowerCase();
}

/** Ключ бригады: номер колонны, иначе подрядчик. Иначе её просто нет. */
function crewKey(e: { column?: string; contractor?: string }): string {
  return norm(e.column) || norm(e.contractor);
}

/** Как называть выведенную колонну — так же, как её называют в отчётах. */
function crewName(e: { column?: string; contractor?: string }): string {
  return (e.column ?? '').trim() || (e.contractor ?? '').trim();
}

interface Seen {
  key: string;
  kind: CrewKind;
  name: string;
  contractor?: string;
  oblast?: string;
  rayon?: string;
  uchastok?: string;
  dates: Set<string>;
  lastDate: string;
}

/**
 * Вид работ по записи. Подвес и проколы — свои бригады, у подземки вид
 * определяется тем, что она делала: задувала кабель или клала трубу.
 */
function kindOf(
  e: DailyWorkEntry | AerialWorkEntry | DrillLogEntry,
): CrewKind {
  if (e.kind === 'drill') return 'gnb';
  if (e.kind === 'aerial') return 'podves';
  const ground = e as DailyWorkEntry;
  const laid = Object.values(ground.byMethod).reduce((s, v) => s + (v ?? 0), 0);
  // Задували и не клали — это бригада задувки, а не МКТ.
  if ((ground.blowingM ?? 0) > 0 && laid === 0) return 'zaduvka';
  return 'mkt';
}

/**
 * Колонны, которых нет в справочнике, но которые видно по журналу.
 *
 * Считаются по всем видам записей: подземка, подвес, проколы. Одна и та
 * же бригада, если она и кладёт, и колет, попадёт дважды — это не ошибка,
 * а правда: на месте это две разные машины и два разных наряда.
 */
export function crewsFromJournal(ctx: CrewDeriveContext, today?: string): DerivedCrew[] {
  const seen = new Map<string, Seen>();

  const push = (e: DailyWorkEntry | AerialWorkEntry | DrillLogEntry) => {
    const key = crewKey(e);
    if (!key || !e.date) return;
    const kind = kindOf(e);
    const id = `${kind}|${key}`;
    const prev = seen.get(id);
    if (prev) {
      prev.dates.add(e.date);
      if (e.date > prev.lastDate) {
        prev.lastDate = e.date;
        prev.oblast = e.oblast || prev.oblast;
        prev.rayon = e.rayon || prev.rayon;
        prev.uchastok = e.uchastok || prev.uchastok;
      }
      return;
    }
    seen.set(id, {
      key, kind, name: crewName(e), contractor: e.contractor,
      oblast: e.oblast, rayon: e.rayon, uchastok: e.uchastok,
      dates: new Set([e.date]), lastDate: e.date,
    });
  };

  for (const e of ctx.ground) push(e);
  for (const e of ctx.aerial) push(e);
  for (const e of ctx.drills) push(e);

  // Заведённые руками в вывод не попадают: справочник сильнее расчёта.
  const known = new Set(
    ctx.crews.map((c) => `${c.kind}|${norm(c.name) || norm(c.contractor)}`),
  );

  const now = today ?? new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString();

  return [...seen.values()]
    .filter((s) => !known.has(`${s.kind}|${s.key}`))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name, 'ru'))
    .map((s) => ({
      id: `crew-auto-${s.kind}-${s.key.replace(/[^a-zа-я0-9]+/gi, '-')}`,
      kind: s.kind,
      name: s.name,
      contractor: s.contractor,
      status: daysBetween(s.lastDate, now) <= IDLE_DAYS ? 'working' as const : 'idle' as const,
      oblast: s.oblast,
      rayon: s.rayon,
      uchastok: s.uchastok,
      members: [],
      equipment: {},
      note: `Заведена по журналу: ${s.dates.size} смен, последняя ${fmtDay(s.lastDate)}`,
      updatedAt: stamp,
      derived: true as const,
      days: s.dates.size,
      lastDate: s.lastDate,
    }));
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru');
}

/**
 * Сколько бригад примерно в поле — по видам работ.
 * Считает и заведённые руками, и выведенные: вопрос «сколько их всего»
 * не различает, кто как попал в список.
 */
export function crewCountByKind(
  crews: Crew[],
  derived: DerivedCrew[],
): { kind: CrewKind; total: number; derived: number }[] {
  const acc = new Map<CrewKind, { total: number; derived: number }>();
  for (const c of crews) {
    const v = acc.get(c.kind) ?? { total: 0, derived: 0 };
    v.total += 1;
    acc.set(c.kind, v);
  }
  for (const c of derived) {
    const v = acc.get(c.kind) ?? { total: 0, derived: 0 };
    v.total += 1;
    v.derived += 1;
    acc.set(c.kind, v);
  }
  return [...acc.entries()]
    .map(([kind, v]) => ({ kind, ...v }))
    .sort((a, b) => b.total - a.total);
}
