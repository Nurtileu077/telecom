/**
 * Отправить туда, где люди и так сидят.
 *
 * Наряд бригаде, отчёт руководителю, координаты дорожникам — всё это
 * уходит в WhatsApp и Telegram, потому что там их читают. Пока
 * приложение умеет только «скопировать», текст сначала копируют, потом
 * переключают приложение, потом ищут чат, и половина по дороге теряется.
 *
 * Своего сервера для этого не нужно: у обоих есть адрес, который
 * открывает окно отправки с готовым текстом.
 */

export type Messenger = 'whatsapp' | 'telegram';

export const MESSENGER_LABEL: Record<Messenger, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
};

/**
 * Адрес окна отправки.
 *
 * Телефон необязателен: без него откроется выбор чата, и это обычный
 * случай — бригадиров в списке контактов и так помнят.
 */
export function shareLink(to: Messenger, text: string, phone?: string): string {
  const body = encodeURIComponent(text);
  if (to === 'whatsapp') {
    const digits = (phone ?? '').replace(/[^0-9]/g, '');
    return digits
      ? `https://wa.me/${digits}?text=${body}`
      : `https://wa.me/?text=${body}`;
  }
  // У Telegram в share-адресе текст идёт отдельным полем от ссылки.
  return `https://t.me/share/url?url=&text=${body}`;
}

/**
 * Открыть окно отправки.
 *
 * Возвращает false, когда браузер не дал открыть окно: тогда вызывающий
 * код показывает текст, а не делает вид, что отправил.
 */
export function openShare(to: Messenger, text: string, phone?: string): boolean {
  if (typeof window === 'undefined') return false;
  const w = window.open(shareLink(to, text, phone), '_blank', 'noopener,noreferrer');
  return !!w;
}

/**
 * Системное «Поделиться», если оно есть.
 *
 * На телефоне оно лучше любых ссылок: показывает все приложения сразу,
 * включая те, о которых мы не знаем. На компьютере его обычно нет.
 */
export async function systemShare(title: string, text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch {
    // Отмена пользователем — это не ошибка, но и не отправка.
    return false;
  }
}
