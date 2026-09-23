/**
 * Напоминания в браузере.
 *
 * Журнал держат открытым во вкладке весь день и смотрят в него
 * несколько раз. Срок согласования при этом подходит молча: чтобы его
 * заметить, надо зайти в раздел, куда как раз и не заходят.
 *
 * Честно о границах: это уведомление работает, только пока страница
 * открыта. Без своего сервера разбудить браузер закрытого приложения
 * нельзя, и делать вид, что можно, — хуже, чем не уведомлять вовсе.
 */

export type NotifyPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function notifyState(): NotifyPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/**
 * Спросить разрешение.
 *
 * Только по явному действию человека: браузеры давно наказывают за
 * запрос при загрузке, а человек — за неожиданное окно.
 */
export async function askNotify(): Promise<NotifyPermission> {
  if (notifyState() === 'unsupported') return 'unsupported';
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return 'denied';
  }
}

const SHOWN_KEY = 'optiq-notified-v1';

interface ShownMap { [id: string]: string }

function loadShown(): ShownMap {
  if (typeof window === 'undefined') return {};
  try {
    const v = JSON.parse(window.localStorage.getItem(SHOWN_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function saveShown(map: ShownMap): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(SHOWN_KEY, JSON.stringify(map)); } catch { /* приватный режим */ }
}

/**
 * Показывали ли уже сегодня.
 *
 * Раз в день на запись — не чаще: то же напоминание каждые пять минут
 * приучает закрывать уведомления не читая.
 */
export function alreadyNotified(id: string, today: string, map = loadShown()): boolean {
  return map[id] === today;
}

export function markNotified(id: string, today: string): void {
  const map = loadShown();
  map[id] = today;
  // Старые отметки чистим: иначе за сезон накопится тысяча ключей.
  for (const [key, day] of Object.entries(map)) {
    if (day < today) delete map[key];
  }
  saveShown(map);
}

export interface NotifyItem {
  id: string;
  title: string;
  body: string;
}

/**
 * Показать то, о чём ещё не говорили сегодня.
 *
 * Возвращает, сколько показали: ноль — нормальный ответ, а не ошибка.
 */
export function notifyOnce(items: NotifyItem[], today: string): number {
  if (notifyState() !== 'granted') return 0;
  const map = loadShown();
  let shown = 0;
  for (const it of items) {
    if (alreadyNotified(it.id, today, map)) continue;
    try {
      // eslint-disable-next-line no-new
      new Notification(it.title, { body: it.body, tag: it.id });
      markNotified(it.id, today);
      shown += 1;
    } catch {
      // Браузер может отказать и при выданном разрешении — тогда просто
      // не уведомляем, а не роняем приложение.
      break;
    }
  }
  return shown;
}
