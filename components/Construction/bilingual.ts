/**
 * Двуязычный бланк.
 *
 * Документы в Казахстане оформляют на государственном языке и на
 * русском. На практике бланк делают в две строки или в две колонки:
 * казахская сверху, русская под ней. Сейчас наши документы только
 * русские, и в акимате их разворачивают.
 *
 * Важная оговорка. Термины ниже — те, что стоят в типовых бланках, но
 * проверить их подписью я не могу: ошибка в шапке документа, который
 * подписывают, обходится дороже, чем его отсутствие. Поэтому
 * двуязычный режим по умолчанию выключен, словарь открыт для правки, а
 * на экране рядом с переключателем стоит просьба сверить термины один
 * раз — до того, как первый документ уйдёт заказчику.
 */

export interface TermPair {
  /** Как сейчас в документе. */
  ru: string;
  /** Как на государственном языке. */
  kk: string;
}

/**
 * Словарь бланка.
 *
 * Только то, что стоит в шапках и подписях: заголовки, названия сторон,
 * заголовки колонок. Текст самих актов не переводим — его пишут по
 * своей форме, и машинный перевод там хуже, чем его отсутствие.
 */
export const DOC_TERMS: Record<string, TermPair> = {
  act: { ru: 'АКТ', kk: 'АКТ' },
  statement: { ru: 'ВЕДОМОСТЬ', kk: 'ТІЗІМДЕМЕ' },
  report: { ru: 'ОТЧЁТ', kk: 'ЕСЕП' },
  scheme: { ru: 'ИСПОЛНИТЕЛЬНАЯ СХЕМА', kk: 'ОРЫНДАУШЫ СҰЛБА' },
  protocol: { ru: 'ПРОТОКОЛ', kk: 'ХАТТАМА' },
  attachment: { ru: 'Приложение', kk: 'Қосымша' },

  customer: { ru: 'Заказчик', kk: 'Тапсырыс беруші' },
  contractor: { ru: 'Подрядчик', kk: 'Мердігер' },
  contract: { ru: 'Договор', kk: 'Шарт' },
  object: { ru: 'Объект', kk: 'Нысан' },

  oblast: { ru: 'Область', kk: 'Облысы' },
  rayon: { ru: 'Район', kk: 'Ауданы' },
  uchastok: { ru: 'Участок', kk: 'Учаске' },
  settlement: { ru: 'Населённый пункт', kk: 'Елді мекен' },

  workName: { ru: 'Наименование работ', kk: 'Жұмыстардың атауы' },
  unit: { ru: 'Единица измерения', kk: 'Өлшем бірлігі' },
  quantity: { ru: 'Количество', kk: 'Саны' },
  length: { ru: 'Длина, м', kk: 'Ұзындығы, м' },
  total: { ru: 'Итого', kk: 'Барлығы' },
  period: { ru: 'Период', kk: 'Кезең' },
  date: { ru: 'Дата', kk: 'Күні' },
  number: { ru: 'Номер', kk: 'Нөмірі' },

  composed: { ru: 'Составил', kk: 'Жасаған' },
  checked: { ru: 'Проверил', kk: 'Тексерген' },
  accepted: { ru: 'Принял', kk: 'Қабылдаған' },
  position: { ru: 'Должность', kk: 'Лауазымы' },
  signature: { ru: 'Подпись', kk: 'Қолы' },
  fullName: { ru: 'Ф. И. О.', kk: 'Т. А. Ә.' },
};

export type TermKey = keyof typeof DOC_TERMS;

export const TERM_KEYS = Object.keys(DOC_TERMS) as TermKey[];

/** Как показывать двуязычный бланк. */
export type Bilingual = 'off' | 'kk-ru' | 'ru-kk';

export const BILINGUAL_LABEL: Record<Bilingual, string> = {
  off: 'Только русский',
  'kk-ru': 'Қазақша / русский',
  'ru-kk': 'Русский / қазақша',
};

/**
 * Термин так, как он встанет в бланк.
 *
 * Разделяем косой чертой, а не переводом строки: в ячейке таблицы
 * вторая строка ломает вёрстку шапки, а в заголовке — читается.
 */
export function term(
  key: TermKey,
  mode: Bilingual,
  overrides: Partial<Record<string, TermPair>> = {},
  separator = ' / ',
): string {
  const pair = overrides[key] ?? DOC_TERMS[key];
  if (!pair) return String(key);
  if (mode === 'off') return pair.ru;
  // Когда перевод совпадает с русским — «АКТ» и есть «АКТ», — второй раз
  // его не пишем: «АКТ / АКТ» выглядит опечаткой.
  if (pair.kk.trim().toLowerCase() === pair.ru.trim().toLowerCase()) return pair.ru;
  if (!pair.kk.trim()) return pair.ru;
  return mode === 'kk-ru' ? `${pair.kk}${separator}${pair.ru}` : `${pair.ru}${separator}${pair.kk}`;
}

/** Для заголовка листа — в две строки: там место есть. */
export function heading(
  key: TermKey,
  mode: Bilingual,
  overrides: Partial<Record<string, TermPair>> = {},
): string {
  return term(key, mode, overrides, '<br/>');
}

/**
 * Чего не хватает в словаре.
 *
 * Пустой перевод — не ошибка: значит, термин ещё не сверили. Но знать,
 * сколько их, нужно до того, как документ уйдёт.
 */
export function untranslated(overrides: Partial<Record<string, TermPair>> = {}): string[] {
  return TERM_KEYS.filter((k) => {
    const pair = overrides[k] ?? DOC_TERMS[k];
    return !pair.kk.trim();
  });
}

/**
 * Термины, которые стоит сверить глазами.
 *
 * Те, где перевод совпадает с русским, — либо так и есть («АКТ»), либо
 * их не переводили. Различить это может только человек.
 */
export function needsReview(overrides: Partial<Record<string, TermPair>> = {}): string[] {
  return TERM_KEYS.filter((k) => {
    const pair = overrides[k] ?? DOC_TERMS[k];
    return pair.kk.trim().toLowerCase() === pair.ru.trim().toLowerCase();
  });
}

const KEY = 'optiq-bilingual';
const TERMS_KEY = 'optiq-doc-terms';

/**
 * По умолчанию выключено.
 *
 * Двуязычный бланк нужен не всем и не всегда, а ошибка в шапке
 * документа, который подписывают, обходится дороже, чем его отсутствие.
 * Пусть включит тот, кто сверил термины.
 */
export function loadBilingual(): Bilingual {
  if (typeof window === 'undefined') return 'off';
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'kk-ru' || v === 'ru-kk' ? v : 'off';
  } catch {
    return 'off';
  }
}

export function saveBilingual(v: Bilingual): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, v); } catch { /* приватный режим */ }
}

/** Свои переводы: что поправили руками, то и стоит в документе. */
export function loadTerms(): Partial<Record<string, TermPair>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(TERMS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveTerms(v: Partial<Record<string, TermPair>>): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(TERMS_KEY, JSON.stringify(v)); } catch { /* приватный режим */ }
}
