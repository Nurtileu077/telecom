/**
 * Первый вход.
 *
 * Новый прораб открывает журнал и видит карту без трасс и пустые
 * вкладки. Что делать первым — неочевидно, и обычно он звонит тому, кто
 * уже работает, и спрашивает «а как тут».
 *
 * Показываем три шага. Три, а не десять: длинную инструкцию пролистывают
 * не читая, и она не помогает никому. И только один раз — подсказка,
 * которая возвращается, превращается в помеху, которую учатся закрывать
 * не глядя.
 *
 * Шаги не выдуманы: это ровно тот порядок, в котором систему и заводят —
 * сначала трасса из KML, потом первая смена, потом документ из неё.
 */

export interface Step {
  title: string;
  body: string;
  /** Куда ведёт кнопка шага: вкладка журнала или карта. */
  goto?: string;
  action?: string;
}

export const STEPS: Step[] = [
  {
    title: 'Загрузите трассу',
    body: 'Файл KML или KMZ из Google Земли — тот же, что прислал проектировщик. '
      + 'Линии лягут на карту, участки разберутся по районам.',
    goto: 'map',
    action: 'Показать карту',
  },
  {
    title: 'Запишите смену',
    body: 'Одной строкой: «25.07 Дозер 480 м кабелеукладчик». Или через форму, '
      + 'если полей больше. Метры сами лягут на трассу и сдвинут колонну.',
    goto: 'today',
    action: 'Открыть журнал',
  },
  {
    title: 'Соберите документ',
    body: 'Акт, ведомость объёмов, отчёт за неделю — из того, что уже записано. '
      + 'Переписывать цифры руками больше не нужно.',
    goto: 'docs',
    action: 'Открыть документы',
  },
];

const KEY = 'optiq-first-run-v1';

/**
 * Показывали ли уже.
 *
 * В приватном окне и при заблокированных данных считаем, что показывали:
 * подсказка при каждом заходе раздражает сильнее, чем её отсутствие.
 */
export function introSeen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) === 'done';
  } catch {
    return true;
  }
}

export function markIntroSeen(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, 'done'); } catch { /* приватный режим */ }
}

/** Снова показать — на случай «а покажи, как это было». */
export function resetIntro(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch { /* приватный режим */ }
}

/**
 * Стоит ли показывать.
 *
 * Только пустому журналу. Тому, у кого уже есть трассы и смены,
 * рассказывать, как загрузить трассу, — значит сказать, что его работу
 * не видно.
 */
export function shouldShowIntro(
  counts: { routes: number; entries: number },
  seen = introSeen(),
): boolean {
  if (seen) return false;
  return counts.routes === 0 && counts.entries === 0;
}

/** Номер следующего шага, или null — значит, дошли до конца. */
export function nextStep(current: number, total = STEPS.length): number | null {
  const next = current + 1;
  return next < total ? next : null;
}

/** «Шаг 2 из 3» — человеку видно, сколько осталось. */
export function stepLabel(index: number, total = STEPS.length): string {
  return `Шаг ${index + 1} из ${total}`;
}
