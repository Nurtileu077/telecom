/**
 * Период для денег и документов.
 *
 * Сводка смотрит «последние 30 дней» — это вопрос прораба: как идём. А
 * расчёт с Дозером, табель и пакет документов закрывают месяцем, с 1-го
 * по 31-е, и до сих пор они молча брали те же 30 дней от последней смены:
 * в расчёт за сентябрь попадал хвост августа, а 1 сентября выпадало, если
 * последняя смена была 30-го. Переключателя на этих экранах не было вовсе
 * — период нельзя было ни увидеть, ни поменять.
 *
 * Здесь у них свой период, который видно и который выбирают: отчётный
 * месяц, свои даты или всё время.
 *
 * Отчётный месяц бывает и не календарным: у кого-то акты и расчёты
 * закрывают с 26-го по 25-е. Такой месяц называем по тому, в котором он
 * кончается: «сентябрь» — с 26 августа по 25 сентября, так его и
 * подписывают («за сентябрь»), и так его ждёт бухгалтер.
 */

export type MoneyPeriod =
  | { kind: 'month'; month: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'all' };

/** Даты «ГГГГ-ММ-ДД»; пустая строка — без границы с этой стороны. */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * Позже 28-го месяц начинать нельзя.
 *
 * «С 30-го по 29-е» в феврале не существует: 30 февраля нет, и такой
 * месяц то съедал бы, то терял день. Отчётные периоды, которые
 * встречаются на деле, начинаются раньше — 21-го, 25-го, 26-го.
 */
export const MAX_START_DAY = 28;

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/** С какого числа отчётный месяц; всё непонятное — календарный, с 1-го. */
export function startDayOf(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n)) return 1;
  return n >= 1 && n <= MAX_START_DAY ? n : 1;
}

const pad = (n: number) => String(n).padStart(2, '0');

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseMonth(month: string): { y: number; m: number } | null {
  const hit = /^(\d{4})-(\d{2})$/.exec(month);
  if (!hit) return null;
  const y = +hit[1];
  const m = +hit[2];
  return m >= 1 && m <= 12 ? { y, m } : null;
}

function parseDay(date: string): { y: number; m: number; d: number } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!hit) return null;
  const y = +hit[1];
  const m = +hit[2];
  const d = +hit[3];
  if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  return { y, m, d };
}

/** Месяц «ГГГГ-ММ», сдвинутый на delta месяцев. */
export function addMonths(month: string, delta: number): string {
  const p = parseMonth(month);
  if (!p) return month;
  const idx = p.y * 12 + (p.m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/**
 * Даты отчётного месяца.
 *
 * С 1-го — календарный. С 26-го — с 26-го прошлого месяца по 25-е этого.
 * Считаем строками, а не через Date: `new Date(2026, 8, 1).toISOString()`
 * в Алма-Ате даёт 31 августа, и месяц съезжал бы на сутки.
 */
export function monthRange(month: string, startDay = 1): DateRange {
  const p = parseMonth(month);
  if (!p) return { from: '', to: '' };
  const s = startDayOf(startDay);
  if (s === 1) return { from: ymd(p.y, p.m, 1), to: ymd(p.y, p.m, daysIn(p.y, p.m)) };
  const prev = parseMonth(addMonths(month, -1))!;
  return { from: ymd(prev.y, prev.m, s), to: ymd(p.y, p.m, s - 1) };
}

/**
 * В какой отчётный месяц попадает день.
 *
 * При периоде с 26-го смена 27 августа — уже сентябрьская: её закроют
 * сентябрьским актом. Нечитаемая дата — пустая строка, а не текущий
 * месяц: смена без даты не должна молча лечь в чей-то расчёт.
 */
export function monthOf(date: string, startDay = 1): string {
  const p = parseDay(date);
  if (!p) return '';
  const own = `${p.y}-${pad(p.m)}`;
  const s = startDayOf(startDay);
  return s > 1 && p.d >= s ? addMonths(own, 1) : own;
}

/** Даты выбранного периода; у «всего времени» границ нет. */
export function periodRange(p: MoneyPeriod, startDay = 1): DateRange {
  if (p.kind === 'month') return monthRange(p.month, startDay);
  if (p.kind === 'range') return { from: p.from, to: p.to };
  return { from: '', to: '' };
}

/**
 * Какой месяц открыть сразу.
 *
 * Тот, где последняя смена: в начале октября по журналу видно, что
 * закрывать — сентябрь, если в октябре ещё не работали. Журнал пуст —
 * текущий месяц.
 */
export function defaultPeriod(anchor: string, today: string, startDay = 1): MoneyPeriod {
  const month = monthOf(anchor, startDay) || monthOf(today, startDay);
  return { kind: 'month', month };
}

/** «сентябрь 2026». */
export function monthName(month: string): string {
  const p = parseMonth(month);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : month;
}

/** «25.09.2026» — так дату пишут в акте. */
export function fmtDay(date: string): string {
  const p = parseDay(date);
  return p ? `${pad(p.d)}.${pad(p.m)}.${p.y}` : date;
}

/** «26.08.2026 — 25.09.2026»; без границы — «с начала работ» и «по сей день». */
export function rangeText(r: DateRange): string {
  if (!r.from && !r.to) return 'всё время';
  return `${r.from ? fmtDay(r.from) : 'с начала работ'} — ${r.to ? fmtDay(r.to) : 'по сей день'}`;
}

/**
 * Месяц ещё идёт — документ за него кончается сегодняшним днём.
 *
 * Пакет за октябрь, собранный 13 октября, иначе вышел бы «по 31.10» и с
 * датой акта 31-м числом: акт будущим числом не подписывают, а заказчик
 * читает такой как «работы до конца месяца уже сделаны». Смена, по ошибке
 * записанная вперёд, границу отодвигает — её не прячем.
 */
export function upToToday(r: DateRange, today: string, lastShift = ''): DateRange {
  const edge = lastShift > today ? lastShift : today;
  if (!r.to || r.to <= edge) return r;
  return { from: r.from, to: r.from && r.from > edge ? r.to : edge };
}

/** Название периода для заголовка и для текста в чат. */
export function periodTitle(p: MoneyPeriod, startDay = 1): string {
  if (p.kind === 'all') return 'всё время';
  const r = periodRange(p, startDay);
  if (p.kind === 'month') return `${monthName(p.month)} (${rangeText(r)})`;
  return rangeText(r);
}

/**
 * Свои даты — с ответом, что не так.
 *
 * «С 30-го по 1-е» не ошибка ввода, которую можно молча перевернуть:
 * человек мог перепутать месяц, и переставленные даты дали бы расчёт за
 * другой месяц.
 */
export function checkRange(from: string, to: string): string | null {
  if (!parseDay(from) || !parseDay(to)) return 'Выберите обе даты в календаре';
  if (from > to) return 'Начало позже конца — проверьте даты';
  return null;
}

/**
 * Месяцы для выбора — от первой смены до сегодняшнего, свежие сверху.
 *
 * Только те, где журнал вообще что-то знает: выбирать «март 2019» в
 * журнале, начатом летом 2026-го, незачем. Список ограничен, чтобы
 * многолетний журнал не превращал выбор в прокрутку.
 */
export function monthChoices(first: string, last: string, startDay = 1, limit = 36): string[] {
  const top = monthOf(last, startDay);
  if (!top) return [];
  const low = monthOf(first, startDay);
  const bottom = low && low <= top ? low : top;
  const out: string[] = [];
  for (let m = top; out.length < limit && m >= bottom; m = addMonths(m, -1)) out.push(m);
  return out;
}

/** «с 26-го по 25-е» — подпись к настройке, чтобы видно было, что выбрано. */
export function startDayLabel(startDay: number): string {
  const s = startDayOf(startDay);
  return s === 1 ? 'календарный месяц' : `с ${s}-го по ${s - 1}-е`;
}
