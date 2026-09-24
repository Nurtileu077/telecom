'use client';
import { useEffect, useState } from 'react';
import { Sun, Moon, Laptop, Clock, Hand } from 'lucide-react';
import {
  loadUiPrefs, saveUiPrefs, applyUiPrefs, clampScale,
  THEME_LABEL, DENSITY_LABEL, MIN_SCALE, MAX_SCALE,
  type UiPrefs, type ThemeMode, type Density,
} from '@/lib/uiPrefs';

/**
 * Настройки вида.
 *
 * На солнце тёмная тема не читается вовсе — это не вкус, а
 * невозможность работать. Планшет держат на вытянутой руке, и мелкий
 * шрифт на нём не разобрать. А тому, кто весь день смотрит в таблицу,
 * нужно, чтобы строк влезало больше.
 */

interface Props {
  className?: string;
  /** Компактный вид: только переключатель темы. */
  compact?: boolean;
}

const THEME_ICON: Record<ThemeMode, typeof Sun> = {
  dark: Moon,
  light: Sun,
  auto: Laptop,
};

export default function ViewPrefs({ className, compact }: Props) {
  const [prefs, setPrefs] = useState<UiPrefs | null>(null);

  // Читаем после монтирования: на сервере localStorage нет, а
  // разъехавшаяся разметка при гидрации хуже, чем поздний переключатель.
  useEffect(() => {
    const loaded = loadUiPrefs();
    setPrefs(loaded);
    applyUiPrefs(loaded, { systemDark: systemDark() });
  }, []);

  // По часам тема меняется сама — но только пока страница открыта.
  useEffect(() => {
    if (!prefs?.byClock) return undefined;
    const id = window.setInterval(
      () => applyUiPrefs(prefs, { systemDark: systemDark() }),
      5 * 60 * 1000,
    );
    return () => window.clearInterval(id);
  }, [prefs]);

  function update(patch: Partial<UiPrefs>) {
    setPrefs((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveUiPrefs(next);
      applyUiPrefs(next, { systemDark: systemDark() });
      return next;
    });
  }

  if (!prefs) return null;

  if (compact) {
    const Icon = THEME_ICON[prefs.theme];
    return (
      <button
        type="button"
        className={`btn btn-ghost btn-icon ${className ?? ''}`}
        title={`Тема: ${THEME_LABEL[prefs.theme]}. Нажмите, чтобы сменить`}
        aria-label="Сменить тему"
        onClick={() => {
          const order: ThemeMode[] = ['dark', 'light', 'auto'];
          const next = order[(order.indexOf(prefs.theme) + 1) % order.length];
          update({ theme: next, byClock: false });
        }}
      >
        <Icon size={15} />
      </button>
    );
  }

  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
          Тема
        </div>
        <div className="flex gap-1">
          {(['dark', 'light', 'auto'] as ThemeMode[]).map((t) => {
            const Icon = THEME_ICON[t];
            const on = prefs.theme === t && !prefs.byClock;
            return (
              <button
                key={t}
                type="button"
                onClick={() => update({ theme: t, byClock: false })}
                aria-pressed={on}
                className={`flex-1 px-2 py-1.5 rounded text-[11px] border inline-flex items-center
                            justify-center gap-1 ${
                  on ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                    : 'border-[var(--border)] text-[var(--text-muted)]'}`}
              >
                <Icon size={13} />{THEME_LABEL[t]}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => update({ byClock: !prefs.byClock })}
          aria-pressed={prefs.byClock}
          className={`mt-1 w-full px-2 py-1.5 rounded text-[11px] border inline-flex items-center
                      justify-center gap-1 ${
            prefs.byClock ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
              : 'border-[var(--border)] text-[var(--text-muted)]'}`}
        >
          <Clock size={13} />Светлая днём, тёмная вечером
        </button>
        <p className="text-[10px] text-[var(--text-muted)] mt-1 leading-snug">
          Системная тема на планшете обычно стоит тёмной круглые сутки, а солнце
          садится в своё время.
        </p>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
          Одной рукой
        </div>
        <button
          type="button"
          onClick={() => update({ oneHand: !prefs.oneHand })}
          aria-pressed={prefs.oneHand}
          className={`w-full px-2 py-1.5 rounded text-[11px] border inline-flex items-center
                      justify-center gap-1 ${
            prefs.oneHand ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
              : 'border-[var(--border)] text-[var(--text-muted)]'}`}
        >
          <Hand size={13} />Вкладки и кнопка внизу
        </button>
        <p className="text-[10px] text-[var(--text-muted)] mt-1 leading-snug">
          Планшет в поле держат одной рукой, второй — рейку или лопату. Верх
          экрана большим пальцем не достать. На широком экране ничего не меняет.
        </p>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
          Плотность
        </div>
        <div className="flex gap-1">
          {(['comfortable', 'compact'] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => update({ density: d })}
              aria-pressed={prefs.density === d}
              className={`flex-1 px-2 py-1.5 rounded text-[11px] border ${
                prefs.density === d
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'border-[var(--border)] text-[var(--text-muted)]'}`}
            >
              {DENSITY_LABEL[d]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="ui-scale"
               className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1
                          flex items-baseline gap-2">
          Размер
          <span className="ml-auto font-mono text-[var(--text-2)]">
            {Math.round(prefs.scale * 100)}%
          </span>
        </label>
        <input
          id="ui-scale"
          type="range"
          min={MIN_SCALE * 100}
          max={MAX_SCALE * 100}
          step={5}
          value={Math.round(prefs.scale * 100)}
          onChange={(e) => update({ scale: clampScale(Number(e.target.value) / 100) })}
          className="w-full accent-[var(--accent)]"
        />
      </div>
    </div>
  );
}

function systemDark(): boolean | undefined {
  if (typeof window === 'undefined' || !window.matchMedia) return undefined;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
