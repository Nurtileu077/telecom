/**
 * «Где я» на карте — вместе с тем, насколько телефон в этом уверен.
 *
 * Раньше карта всегда приближала до 18-го зума и ставила яркую точку, а
 * круг погрешности рисовала только при точности лучше 200 м. В итоге
 * плохой сигнал выглядел точнее хорошего: при ±800 м (телефон в вагончике
 * берёт место по вышке) на экране была уверенная точка посреди чужого
 * двора и ни намёка на то, что настоящее место — где угодно в пределах
 * километра. По такой точке потом ищут муфту.
 *
 * Теперь круг есть всегда, когда телефон назвал погрешность; приближение
 * выбирается так, чтобы круг целиком влез в экран; а точка и подпись
 * прямо говорят, насколько им можно верить.
 */

export type FixQuality = 'good' | 'fair' | 'poor' | 'unknown';

/**
 * До 15 м — это спутники под открытым небом: точку можно ставить на
 * трассу. До 100 м — спутники в застройке или Wi-Fi: улица верная, место
 * на ней — нет. Дальше — вышка сотовой связи: верно только село.
 */
export const GOOD_M = 15;
export const FAIR_M = 100;

/** Самое крупное приближение, до которого вообще имеет смысл лететь. */
export const MAX_ZOOM = 18;
/** Мельче этого круг уже ничего не говорит: место — «где-то в области». */
export const MIN_ZOOM = 5;
/**
 * Когда погрешности нет, не летим на 18-й: точка без погрешности — та же
 * неизвестность, и показывать её крупно значит обещать точность, которой
 * никто не давал. 16-й — несколько кварталов, село видно целиком.
 */
export const UNKNOWN_ZOOM = 16;

/** Какую долю меньшей стороны экрана может занять круг. */
const CIRCLE_SHARE = 0.6;

function known(accuracyM: number | undefined | null): accuracyM is number {
  return typeof accuracyM === 'number' && Number.isFinite(accuracyM) && accuracyM > 0;
}

export function fixQuality(accuracyM: number | undefined | null): FixQuality {
  if (!known(accuracyM)) return 'unknown';
  if (accuracyM <= GOOD_M) return 'good';
  if (accuracyM <= FAIR_M) return 'fair';
  return 'poor';
}

/** «±8 м», «±800 м», «±1,5 км» — погрешность так, как её говорят вслух. */
export function formatAccuracy(accuracyM: number): string {
  if (accuracyM < 1000) return `±${Math.max(1, Math.round(accuracyM))} м`;
  const km = Math.round(accuracyM / 100) / 10;
  return `±${String(km).replace('.', ',')} км`;
}

/**
 * Приближение, при котором весь круг погрешности на экране.
 *
 * Считаем по метрам в пикселе на этой широте: у Казахстана с севера на юг
 * десять градусов, и один и тот же зум в Петропавловске и в Шымкенте —
 * разный масштаб. Берём ближайший целый зум вниз, чтобы круг влез, а не
 * обрезался краем экрана.
 */
export function zoomForAccuracy(
  accuracyM: number | undefined | null,
  lat: number,
  viewportPx: number,
): number {
  if (!known(accuracyM)) return UNKNOWN_ZOOM;
  const px = Number.isFinite(viewportPx) && viewportPx > 0 ? viewportPx : 400;
  const metersPerPx = (2 * accuracyM) / (px * CIRCLE_SHARE);
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const z = Math.floor(Math.log2((156543.03392 * cos) / metersPerPx));
  if (!Number.isFinite(z)) return UNKNOWN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export interface FixLabel {
  /** Короткая строка — у кнопки и в заголовке подсказки. */
  short: string;
  /** Пояснение: что значит эта точность для работы. Пусто, если всё хорошо. */
  note: string;
}

export function fixLabel(accuracyM: number | undefined | null): FixLabel {
  const q = fixQuality(accuracyM);
  if (q === 'unknown') {
    return {
      short: 'Вы здесь · точность неизвестна',
      note: 'Телефон не сообщил погрешность — на точку как на место работ не опирайтесь.',
    };
  }
  const acc = formatAccuracy(accuracyM as number);
  if (q === 'good') return { short: `Вы здесь · ${acc}`, note: '' };
  if (q === 'fair') {
    return {
      short: `Вы где-то в круге ${acc}`,
      note: 'Улица верная, место на ней — нет. Для точки на трассе выйдите на открытое место и повторите.',
    };
  }
  return {
    short: `Вы где-то в круге ${acc}`,
    note: 'Сигнала спутников нет — место определено по вышке или Wi-Fi. '
      + 'Середина круга — не ваше место. Выйдите на открытое место и повторите.',
  };
}

export interface FixStyle {
  color: string;
  /** Пунктир у плохого круга — чтобы его не приняли за границу чего-то. */
  dashArray?: string;
  /** Точка внутри: сплошная — когда ей можно верить, полая — когда нет. */
  solidDot: boolean;
}

export function fixStyle(q: FixQuality): FixStyle {
  switch (q) {
    case 'good': return { color: '#38bdf8', solidDot: true };
    case 'fair': return { color: '#f59e0b', solidDot: true };
    case 'poor': return { color: '#f87171', dashArray: '6 6', solidDot: false };
    default: return { color: '#94a3b8', solidDot: false };
  }
}
