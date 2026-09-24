/**
 * Как выглядит приложение у этого человека.
 *
 * Журнал открывают и в офисе, и в поле. На солнце тёмная тема не
 * читается вовсе — это не вкус, а невозможность работать. Планшет держат
 * на вытянутой руке, и мелкий шрифт на нём не разобрать. А тому, кто
 * весь день смотрит в таблицу, наоборот, нужно, чтобы строк влезало
 * больше.
 *
 * Всё это — настройки устройства, а не данные: они живут здесь и не
 * уезжают в общий журнал.
 */

export type ThemeMode = 'dark' | 'light' | 'auto';
export type Density = 'comfortable' | 'compact';

export interface UiPrefs {
  theme: ThemeMode;
  density: Density;
  /** Масштаб интерфейса, 0.9–1.4. */
  scale: number;
  /**
   * Тёмная тема вечером, светлая днём.
   *
   * Отдельно от 'auto': системная тема на планшете в поле обычно стоит
   * тёмной круглые сутки, а солнце садится в своё время.
   */
  byClock: boolean;
  /**
   * Режим одной руки.
   *
   * Планшет в поле держат одной рукой, второй — рейку, телефон или
   * лопату. Верх экрана большим пальцем не достать, а именно там
   * вкладки и главная кнопка. В этом режиме они уезжают вниз.
   *
   * Только на узком экране: на компьютере это лишнее.
   */
  oneHand: boolean;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  theme: 'dark',
  density: 'comfortable',
  scale: 1,
  byClock: false,
  oneHand: false,
};

export const THEME_LABEL: Record<ThemeMode, string> = {
  dark: 'Тёмная',
  light: 'Светлая',
  auto: 'Как в системе',
};

export const DENSITY_LABEL: Record<Density, string> = {
  comfortable: 'Просторно',
  compact: 'Плотно',
};

export const MIN_SCALE = 0.9;
export const MAX_SCALE = 1.4;

const KEY = 'optiq-ui-prefs-v1';

export function loadUiPrefs(): UiPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_UI_PREFS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_UI_PREFS };
    const saved = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      theme: saved.theme === 'light' || saved.theme === 'auto' ? saved.theme : 'dark',
      density: saved.density === 'compact' ? 'compact' : 'comfortable',
      scale: clampScale(Number(saved.scale)),
      byClock: !!saved.byClock,
      oneHand: !!saved.oneHand,
    };
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

export function saveUiPrefs(v: UiPrefs): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* приватный режим */ }
}

export function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(v * 20) / 20));
}

/**
 * Светло ли сейчас.
 *
 * Считаем по часам, а не по восходу: широта у стройки от Мангистау до
 * Костаная, и точный восход тут погоды не делает, а вот «включилась
 * тёмная в полдень» заметят сразу.
 */
export function isDaylight(now = new Date()): boolean {
  const h = now.getHours();
  return h >= 7 && h < 19;
}

/** Какая тема должна быть прямо сейчас. */
export function effectiveTheme(
  prefs: UiPrefs,
  opts: { systemDark?: boolean; now?: Date } = {},
): 'dark' | 'light' {
  if (prefs.byClock) return isDaylight(opts.now) ? 'light' : 'dark';
  if (prefs.theme === 'auto') return opts.systemDark === false ? 'light' : 'dark';
  return prefs.theme === 'light' ? 'light' : 'dark';
}

/**
 * Разложить настройки по атрибутам документа.
 *
 * Всё остальное делает CSS: так тема меняется мгновенно и не требует
 * перерисовки приложения.
 */
export function applyUiPrefs(prefs: UiPrefs, opts: { systemDark?: boolean; now?: Date } = {}): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', effectiveTheme(prefs, opts));
  root.setAttribute('data-density', prefs.density);
  // Не атрибут-значение, а наличие: правила режима одной руки и так
  // включаются только на узком экране, через медиазапрос в CSS.
  if (prefs.oneHand) root.setAttribute('data-hand', 'one');
  else root.removeAttribute('data-hand');
  root.style.setProperty('--ui-scale', String(prefs.scale));
}
