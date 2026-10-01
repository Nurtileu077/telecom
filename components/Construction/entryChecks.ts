import type { DailyWorkEntry, LayMethod } from '@/types/construction';
import { LAY_METHOD_LABEL } from '@/types/construction';
import { normName } from './areaImport';
import { entryMeters, entryHasWork } from './entriesTable';

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
