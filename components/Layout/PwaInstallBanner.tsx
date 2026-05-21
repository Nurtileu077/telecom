'use client';
import { useEffect, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

const DISMISS_KEY = 'optiq-pwa-dismiss';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export default function PwaInstallBanner() {
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch { /* ignore */ }
    const narrow = window.innerWidth < 768;
    if (!narrow) return;

    if (isIOS()) setIosHint(true);
    const t = window.setTimeout(() => setShow(true), 1500);

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBip);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener('beforeinstallprompt', onBip);
    };
  }, []);

  const dismiss = () => {
    setShow(false);
    setIosHint(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  const installAndroid = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    dismiss();
  };

  if (!show) return null;

  return (
    <div className="pwa-install-banner md:hidden">
      <div className="flex items-start gap-2">
        <Download size={18} className="text-[var(--accent)] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[var(--text)]">Установить как приложение</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 leading-snug">
            Иконка OPTIQ на главном экране — как обычное приложение
          </p>
          {iosHint ? (
            <p className="text-[10px] text-[var(--accent)] mt-2 leading-snug">
              Safari: кнопка <Share2 size={10} className="inline" /> «Поделиться» → «На экран Домой»
            </p>
          ) : (
            <div className="flex gap-2 mt-2">
              {deferred ? (
                <button type="button" className="btn btn-primary text-[10px] py-1 px-2" onClick={installAndroid}>
                  Установить
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary text-[10px] py-1 px-2"
                  onClick={() => setIosHint(true)}
                >
                  Как добавить?
                </button>
              )}
            </div>
          )}
        </div>
        <button type="button" onClick={dismiss} className="text-[var(--text-muted)] p-1" aria-label="Скрыть">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export { isStandalone, isIOS };
