import { DailyWorkEntry } from '@/types/construction';

/**
 * План на завтра и причины простоя — то, что уже пишут, но никто не читает.
 *
 * В дневном отчёте инженера оба поля есть, и оба заполняются. Дальше они
 * ложились в запись и там оставались: план на завтра не попадался на глаза
 * назавтра, причины простоя не складывались ни во что.
 *
 * Здесь они возвращаются в работу. План вчерашнего дня — это первое, что
 * нужно утром: не «что сделали», а «что собирались». Причины простоя,
 * сложенные вместе, отвечают на вопрос, ради которого их и пишут: почему
 * отстаём — техника, согласования или грунт.
 */

export interface DayPlan {
  entryId: string;
  date: string;
  /** Кто планировал: колонна, подрядчик или СМУ. */
  crew: string;
  uchastok: string;
  kato: string;
  oblast?: string;
  rayon?: string;
  text: string;
}

function crewOf(e: DailyWorkEntry): string {
  return (e.column || e.contractor || e.smu || '').trim();
}

/**
 * Планы с последнего рабочего дня.
 *
 * Берём именно последний день с записями, а не «вчера» по календарю:
 * после выходных вчера пустое, а план с пятницы никуда не делся.
 */
export function lastPlans(entries: DailyWorkEntry[], before?: string): DayPlan[] {
  const withPlan = entries.filter((e) => e.tomorrow?.trim() && e.date);
  if (withPlan.length === 0) return [];

  const limit = before ?? '9999-12-31';
  const last = withPlan.reduce(
    (m, e) => (e.date <= limit && e.date > m ? e.date : m),
    '',
  );
  if (!last) return [];

  return withPlan
    .filter((e) => e.date === last)
    .map((e) => ({
      entryId: e.id,
      date: e.date,
      crew: crewOf(e),
      uchastok: e.uchastok,
      kato: e.kato,
      oblast: e.oblast,
      rayon: e.rayon,
      text: e.tomorrow!.trim(),
    }))
    .sort((a, b) => a.crew.localeCompare(b.crew, 'ru'));
}

export interface DowntimeReason {
  /** Текст как написали — он и есть причина. */
  text: string;
  count: number;
  lastDate: string;
  /** Где это было — чтобы не искать по журналу. */
  places: string[];
}

/** Нормализуем только для сравнения: показываем то, что написал человек. */
function reasonKey(s: string): string {
  // Точка в конце и разный регистр — не разные причины.
  return s.toLowerCase().replace(/[\s.,;!]+/g, ' ').trim();
}

/**
 * Причины простоя, сложенные по повторяемости.
 *
 * Одинаковые формулировки объединяются, разные остаются разными: сводить
 * «скальный грунт» и «ждали согласование» к общей категории значит
 * потерять именно ту разницу, ради которой это и пишут.
 */
export function downtimeReasons(entries: DailyWorkEntry[]): DowntimeReason[] {
  const acc = new Map<string, DowntimeReason>();
  for (const e of entries) {
    const text = e.downtime?.trim();
    if (!text) continue;
    const k = reasonKey(text);
    const prev = acc.get(k);
    const place = e.uchastok || e.rayon || e.oblast || '';
    if (prev) {
      prev.count += 1;
      if (e.date > prev.lastDate) {
        prev.lastDate = e.date;
        prev.text = text;
      }
      if (place && !prev.places.includes(place)) prev.places.push(place);
      continue;
    }
    acc.set(k, {
      text, count: 1, lastDate: e.date || '',
      places: place ? [place] : [],
    });
  }
  return [...acc.values()]
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
}

/**
 * Техника, которая была на смене в последний рабочий день.
 * Нужна тому же утреннему вопросу: чем сегодня работать.
 */
export function lastEquipment(entries: DailyWorkEntry[]): { name: string; count: number }[] {
  const dates = entries.filter((e) => e.equipment && e.date).map((e) => e.date);
  if (dates.length === 0) return [];
  const last = dates.reduce((m, d) => (d > m ? d : m), '');
  const acc = new Map<string, number>();
  for (const e of entries) {
    if (e.date !== last) continue;
    for (const [k, v] of Object.entries(e.equipment ?? {})) {
      if (v > 0) acc.set(k, (acc.get(k) ?? 0) + v);
    }
  }
  return [...acc.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
}
