/**
 * Ошибка, сказанная по-человечески.
 *
 * «QuotaExceededError», «NetworkError when attempting to fetch resource»,
 * «Unexpected token < in JSON» — всё это настоящие сообщения, которые
 * видел прораб. По ним нельзя понять ни что случилось, ни что теперь
 * делать, и единственное, что остаётся, — звонить тому, кто сделал
 * программу.
 *
 * Поэтому у каждой ошибки здесь две части: что случилось и что с этим
 * делать. Вторая важнее первой. А исходный текст оставляем отдельно —
 * он нужен ровно один раз, когда доходит до разбора.
 */

export interface PlainError {
  /** Что случилось — одной фразой, без терминов. */
  what: string;
  /** Что сделать. Пусто — значит сделать нечего, и это тоже ответ. */
  how?: string;
  /** Исходный текст: показываем под спойлером, для разбора. */
  raw?: string;
  /** Стоит ли предлагать повтор: сеть отвалилась — стоит, места нет — нет. */
  retry?: boolean;
}

function textOf(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e ?? '');
}

/** Память браузера кончилась. */
function isQuota(e: unknown, text: string): boolean {
  if (e instanceof Error && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
    return true;
  }
  return /quota|storage.*full|exceeded the quota/i.test(text);
}

function isOffline(text: string): boolean {
  return /networkerror|failed to fetch|network request failed|err_internet|offline|econnrefused|timeout/i
    .test(text);
}

function isBadJson(text: string): boolean {
  return /unexpected token|json\.parse|is not valid json|unexpected end of (json|input)/i.test(text);
}

function isDenied(text: string): boolean {
  return /permission|notallowed|denied|forbidden|401|403/i.test(text);
}

function isAborted(text: string): boolean {
  return /abort/i.test(text);
}

/**
 * Разобрать ошибку.
 *
 * Список короткий нарочно: сюда попадает только то, что действительно
 * случается на объекте. Выдумывать красивые формулировки для ошибок,
 * которых не бывает, — тратить внимание на то, чего никто не прочтёт.
 */
export function plainError(e: unknown, context?: string): PlainError {
  const raw = textOf(e);

  if (isQuota(e, raw)) {
    return {
      what: 'В браузере кончилось место',
      how: 'Снимите копию журнала и очистите старые фотографии — они занимают больше всего.',
      raw,
    };
  }
  if (isOffline(raw)) {
    return {
      what: 'Нет связи с сервером',
      how: 'Записи сохраняются в устройстве и уйдут сами, когда связь появится.',
      raw,
      retry: true,
    };
  }
  if (isDenied(raw)) {
    return {
      what: 'Нет доступа',
      how: 'Войдите заново. Если не пускает — доступ выдаёт тот, кто ведёт журнал в конторе.',
      raw,
    };
  }
  if (isBadJson(raw)) {
    return {
      what: 'Файл не похож на то, что ожидали',
      how: 'Проверьте, тот ли это файл: копия журнала — это .json, выгрузка из Земли — .kmz или .kml.',
      raw,
    };
  }
  if (isAborted(raw)) {
    return { what: 'Отменено', raw };
  }

  return {
    what: context ? `Не получилось: ${context}` : 'Что-то пошло не так',
    how: 'Попробуйте ещё раз. Если повторится — снимите копию журнала, чтобы не потерять работу.',
    raw,
    retry: true,
  };
}

/** Ошибка одной строкой — для короткого сообщения внизу экрана. */
export function errorLine(e: unknown, context?: string): string {
  const p = plainError(e, context);
  return p.how ? `${p.what}. ${p.how}` : p.what;
}
