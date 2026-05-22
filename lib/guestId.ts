const KEY = 'optiq-guest-presence-id';

/** Стабильный id гостя для presence (одна вкладка / сессия). */
export function getGuestPresenceKey(): string {
  if (typeof window === 'undefined') return 'guest-ssr';
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `guest-${Date.now()}`;
  }
}
