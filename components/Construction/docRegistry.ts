import type { ActKind } from './actDocument';
import type { SectionActManual } from './sectionAct';

/**
 * Реестр актов и их номера.
 *
 * Номер акта ставят руками, и поэтому в папке лежат два «АСР-14» и ни
 * одного «АСР-13». Когда заказчик спрашивает «а где акт по Серафимовке»,
 * его ищут перебором файлов.
 *
 * Номер — это порядок в году и вид документа, больше ничего. Считать его
 * должна система, а не человек.
 */

export interface ActRecord {
  /** Ключ участка, по которому лежат поля акта. */
  uchastok: string;
  kind: ActKind;
  number: string;
  /** Дата акта, YYYY-MM-DD. */
  date?: string;
  /** Есть ли уже подписанты и реквизиты — по этому видно готовность. */
  filled: boolean;
}

/** Номер в человеческом виде: вид, год, порядок. */
export function formatActNumber(kind: ActKind, year: number, seq: number): string {
  const short = kind === 'ASR' ? 'АСР' : 'ОСР';
  return `${short}-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Разбор номера обратно.
 *
 * Нужен, чтобы понять, какие номера уже заняты. Чужие форматы — «14»,
 * «14/2026», «б/н» — не трогаем: они вписаны руками и имеют право быть
 * какими угодно.
 */
export function parseActNumber(
  value: string | undefined,
): { kind: ActKind; year: number; seq: number } | null {
  const m = /^(АСР|ОСР)-(\d{4})-(\d{1,6})$/i.exec((value ?? '').trim());
  if (!m) return null;
  return {
    kind: m[1].toUpperCase() === 'АСР' ? 'ASR' : 'OSR',
    year: Number(m[2]),
    seq: Number(m[3]),
  };
}

/**
 * Следующий свободный номер.
 *
 * Считаем по уже выданным в этом году: дырки в нумерации не заполняем —
 * пропущенный номер обычно означает не ошибку, а отменённый акт, и
 * переиспользовать его нельзя.
 */
export function nextActNumber(
  fields: Record<string, SectionActManual>,
  kind: ActKind,
  year = new Date().getFullYear(),
): string {
  let max = 0;
  for (const v of Object.values(fields ?? {})) {
    const parsed = parseActNumber(v?.actNumber);
    if (!parsed || parsed.kind !== kind || parsed.year !== year) continue;
    if (parsed.seq > max) max = parsed.seq;
  }
  return formatActNumber(kind, year, max + 1);
}

/** Номера, которые встречаются дважды: их надо развести до сдачи. */
export function duplicateNumbers(fields: Record<string, SectionActManual>): string[] {
  const seen = new Map<string, number>();
  for (const v of Object.values(fields ?? {})) {
    const n = (v?.actNumber ?? '').trim();
    if (!n) continue;
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n).sort();
}

export interface RegistryRow {
  uchastok: string;
  number?: string;
  date?: string;
  /** Чего не хватает, чтобы акт можно было подписывать. */
  missing: string[];
  duplicate: boolean;
}

const REQUIRED: [keyof SectionActManual, string][] = [
  ['actNumber', 'номер'],
  ['actDate', 'дата'],
  ['city', 'город'],
  ['objectName', 'наименование объекта'],
];

/**
 * Реестр: что по какому участку оформлено.
 *
 * Показываем не «всё хорошо», а то, чего не хватает: акт без номера и
 * без даты выглядит готовым ровно до момента, когда его понесли
 * подписывать.
 */
export function actRegistry(fields: Record<string, SectionActManual>): RegistryRow[] {
  const dups = new Set(duplicateNumbers(fields));
  return Object.entries(fields ?? {})
    .map(([uchastok, v]) => ({
      uchastok,
      number: v?.actNumber?.trim() || undefined,
      date: v?.actDate || undefined,
      missing: REQUIRED.filter(([key]) => {
        const val = v?.[key];
        return val === undefined || String(val).trim() === '';
      }).map(([, label]) => label),
      duplicate: !!v?.actNumber && dups.has(v.actNumber.trim()),
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')
      || a.uchastok.localeCompare(b.uchastok, 'ru'));
}
