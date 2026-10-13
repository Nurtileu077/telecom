import type { DailyWorkEntry, LayMethod } from '@/types/construction';
import { LAY_METHOD_LABEL } from '@/types/construction';
import { normName } from './areaImport';
import { entryMeters, entryHasWork } from './entriesTable';
import { marksMismatch } from './stopCheck';
import { crewLabel } from './shiftPlace';

/**
 * Проверки перед сохранением смены.
 *
 * Две ошибки повторяются чаще всех: одну и ту же смену вносят дважды —
 * утром бригадир, вечером инженер, — и в метры попадает лишний ноль.
 * Обе всплывают через месяц, при сверке актов, когда вспомнить уже
 * нечего.
 *
 * Поэтому спрашиваем сразу и по-человечески: не «ошибка валидации», а
 * «за 25 июля по этому участку уже есть запись на 480 м».
 */

export interface EntryWarning {
  /** 'stop' — почти наверняка ошибка, 'check' — стоит посмотреть. */
  level: 'stop' | 'check';
  text: string;
  /** Чем это вызвано — для подсказки, что делать. */
  hint?: string;
}

/**
 * Такая же смена уже есть.
 *
 * Совпадением считаем дату, участок и бригаду: один участок могут вести
 * две колонны в один день, и это не дубль.
 */
export function findDuplicate(
  rows: DailyWorkEntry[],
  entry: Pick<DailyWorkEntry, 'id' | 'date' | 'uchastok' | 'contractor' | 'column'>,
): DailyWorkEntry | null {
  const sameName = (a?: string, b?: string) => normName(a ?? '') === normName(b ?? '');
  return rows.find((e) => e.id !== entry.id
    && e.date === entry.date
    && sameName(e.uchastok, entry.uchastok)
    && sameName(e.contractor, entry.contractor)
    && sameName(e.column, entry.column)) ?? null;
}

/**
 * Сколько обычно дают за смену этим способом.
 *
 * Норм на это нет и быть не может: грунт, техника и люди у всех разные.
 * Поэтому «обычно» берём из того же журнала — из того, что эта стройка
 * уже показала.
 */
export function typicalPerShift(rows: DailyWorkEntry[], method: LayMethod): number | null {
  const values = rows
    .map((e) => e.byMethod[method] ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (values.length < 5) return null;
  // Медиана, а не среднее: одна смена на 4 800 м не должна поднимать
  // планку для всех остальных.
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Предел, выше которого метры почти наверняка написаны с лишним нулём. */
export const HARD_METERS_LIMIT = 20_000;

export function checkEntry(
  entry: DailyWorkEntry,
  history: DailyWorkEntry[],
): EntryWarning[] {
  const out: EntryWarning[] = [];

  const dup = findDuplicate(history, entry);
  if (dup) {
    out.push({
      level: 'stop',
      text: `За ${new Date(`${dup.date}T00:00:00Z`).toLocaleDateString('ru')}`
        + ` по участку «${dup.uchastok}» уже есть запись на ${Math.round(entryMeters(dup)).toLocaleString('ru')} м.`,
      hint: 'Если это вторая смена того же дня, укажите колонну — тогда это не дубль.',
    });
  }

  const total = entryMeters(entry);
  if (total > HARD_METERS_LIMIT) {
    out.push({
      level: 'stop',
      text: `${Math.round(total).toLocaleString('ru')} м за смену — это больше, чем бывает.`,
      hint: 'Проверьте, не попал ли лишний ноль.',
    });
  }

  for (const method of Object.keys(entry.byMethod) as LayMethod[]) {
    const v = entry.byMethod[method] ?? 0;
    if (v <= 0) continue;
    const usual = typicalPerShift(history, method);
    if (usual === null) continue;
    if (v > usual * 4) {
      out.push({
        level: 'check',
        text: `${LAY_METHOD_LABEL[method]}: ${Math.round(v).toLocaleString('ru')} м`
          + ` — вчетверо больше обычного (${Math.round(usual).toLocaleString('ru')} м за смену).`,
        hint: 'Так бывает, но чаще это опечатка.',
      });
    }
  }

  // Метки трубы подтверждают метраж — или нет. Расхождение больше 3 %
  // видно сразу, а не через месяц при сверке с расходом бухт.
  const marks = marksWarning(entry);
  if (marks) out.push(marks);

  // Глубину и материалы проверяют свои правила; здесь — только то, что
  // видно прямо в смене.
  if (entry.drillM && entry.drillCount && entry.drillM / entry.drillCount > 300) {
    out.push({
      level: 'check',
      text: `Прокол длиннее 300 м — такие делают редко.`,
      hint: 'Если проколов было несколько, укажите их количество.',
    });
  }

  if (!entryHasWork(entry) && !entry.downtime?.trim()) {
    out.push({
      level: 'check',
      text: 'В смене нет ни метров, ни причины простоя.',
      hint: 'Не работали — напишите почему в «Причине простоя»: день попадёт в отчёт простоем, а не пропадёт.',
    });
  }

  return out;
}

const MARKS_HINT = 'Метки считаем с метки на метку: «4000 — 2490» — это 1 510 м. Если в траншее '
  + 'не одна труба, по меткам выйдет кратно больше — тогда это не ошибка.';

/** Метки трубы разошлись с метрами смены — одной фразой для формы и «Проверок». */
export function marksWarning(entry: DailyWorkEntry): EntryWarning | null {
  const total = entryMeters(entry);
  const marks = marksMismatch(total, entry.ductMarks);
  if (!marks) return null;
  return {
    level: 'check',
    text: `По меткам трубы ушло ${Math.round(marks.marksM).toLocaleString('ru')} м,`
      + ` а в смене ${Math.round(total).toLocaleString('ru')} м — расходится больше чем на 3 %.`,
    hint: MARKS_HINT,
  };
}

/** Сохранённая смена, у которой метки трубы разошлись с метрами. */
export interface MarksIssue {
  entryId: string;
  date: string;
  uchastok: string;
  /** «1-колонна (Дозер)» — чья смена; пусто — не названо. */
  crew: string;
  text: string;
  hint: string;
}

/**
 * Смены журнала, у которых метки трубы не сходятся с метрами.
 *
 * Метки проверялись только в форме, до сохранения. А основной путь меток —
 * отчёт таблицей: смены из Excel приходят с метками и мимо формы, и
 * расхождение не видел никто. Сверяем и сохранённые — тем же правилом и
 * той же фразой, что в форме.
 */
export function journalMarksIssues(ground: DailyWorkEntry[]): MarksIssue[] {
  const out: MarksIssue[] = [];
  for (const e of ground) {
    const w = marksWarning(e);
    if (!w) continue;
    out.push({
      entryId: e.id,
      date: e.date,
      uchastok: e.uchastok,
      crew: crewLabel(e),
      text: w.text,
      hint: w.hint ?? MARKS_HINT,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Есть ли то, из-за чего сохранять не стоит. */
export function hasBlocking(list: EntryWarning[]): boolean {
  return list.some((w) => w.level === 'stop');
}

/**
 * Чего не хватает, чтобы сохранить смену; null — сохранять можно.
 *
 * Смена без работ сохраняется, если названа причина простоя. Дождь или
 * ждём разрешения — это тоже день стройки: пока такую смену нельзя было
 * сохранить, день пропадал из отчёта за период, хотя проверка сама
 * просила указать причину. Пустую смену без причины не берём: через
 * месяц никто не скажет, что в тот день было.
 */
export function saveBlocker(
  entry: DailyWorkEntry,
  opts: { correcting?: boolean; reason?: string } = {},
): string | null {
  if (!entry.date) return 'Укажите дату.';
  if (!entry.uchastok?.trim()) return 'Укажите участок.';
  if (!entryHasWork(entry) && !entry.downtime?.trim()) {
    return 'Впишите выработку — метры, ГНБ или задувку, — а если не работали, причину простоя.';
  }
  if (opts.correcting && !opts.reason?.trim()) return 'Укажите причину исправления.';
  return null;
}
