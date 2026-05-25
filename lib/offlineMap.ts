const SW_PATH = '/optiq-sw.js';
const PREF_KEY = 'optiq-offline-tiles';

export function isOfflineTilesEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(PREF_KEY) === '1';
}

export function setOfflineTilesEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch { /* ignore */ }
}

export async function syncOfflineTileWorker(): Promise<'registered' | 'unregistered' | 'unsupported'> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  if (!isOfflineTilesEnabled()) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) {
      if (r.active?.scriptURL.includes('optiq-sw')) await r.unregister();
    }
    return 'unregistered';
  }
  await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  return 'registered';
}
