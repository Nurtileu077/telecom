import type { FieldPhoto } from '@/types/construction';
import { formatAccuracy } from '@/components/Map/gpsFix';

/**
 * Откуда у снимка координаты — словами, которые можно отдать заказчику.
 *
 * В фотоотчёте под снимком стояли голые «52.10000, 71.20000». Заказчик
 * читает их как место работ, а это могла быть точка телефона вечером в
 * вагончике: в снимке координат не было, и при добавлении их взяли у
 * телефона. Источник в карточке хранился, но до документа не доходил.
 *
 * Теперь под снимком написано, откуда точка, с какой погрешностью и —
 * главное — когда она получена относительно кадра. Разница в десять
 * часов значит, что это не место съёмки, и так и написано.
 *
 * Допущение: какие телефоны бригад пишут в снимок погрешность и время
 * спутниковой точки, на живых телефонах не проверено. Читаем стандартные
 * теги EXIF (GPSHPositioningError, GPSDateStamp/GPSTimeStamp); нет их —
 * погрешность и время точки «неизвестны», и мы их не придумываем.
 */

/** Точка в снимке старше кадра больше чем на столько — могла остаться с прошлого места. */
export const STALE_FIX_MIN = 10;
/** Телефон спросили позже кадра больше чем на столько — это уже не место съёмки. */
export const LATE_ATTACH_MIN = 15;
/** Грубее этого точка — «где-то на этой улице», а не место на трассе. */
export const ROUGH_ACCURACY_M = 100;

const MIN = 60_000;
const HOUR = 60 * MIN;

/** «40 мин», «10 ч 28 мин», «3 сут.» — промежуток так, как его говорят. */
export function fmtGap(ms: number): string {
  const v = Math.abs(ms);
  if (v < MIN) return 'меньше минуты';
  if (v < HOUR) return `${Math.round(v / MIN)} мин`;
  if (v < 48 * HOUR) {
    const h = Math.floor(v / HOUR);
    const m = Math.round((v - h * HOUR) / MIN);
    return m === 60 ? `${h + 1} ч` : m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  return `${Math.round(v / (24 * HOUR))} сут.`;
}

const ms = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Разница почти ровно в целые часы без пометки пояса в снимке больше
 * похожа на часовой пояс телефона, чем на старую точку: обвинять бригаду
 * в «точке с прошлого места» по такой разнице нельзя.
 */
function looksLikeTimezone(gapMs: number): boolean {
  const v = Math.abs(gapMs);
  if (v < HOUR - 2 * MIN || v > 14 * HOUR + 2 * MIN) return false;
  const rest = v % HOUR;
  return rest <= 2 * MIN || rest >= HOUR - 2 * MIN;
}

export interface PhotoGeoNote {
  /** Откуда точка и насколько точна: «координаты из снимка, ±8 м». */
  source: string;
  /** Почему эту точку нельзя читать как место работ; пусто — можно. */
  warning: string;
  /** Точку можно читать как место, где нажали затвор. */
  atShot: boolean;
  /** Коротко — под миниатюрой: «из снимка ±8 м», «с телефона · не место съёмки». */
  short: string;
}

const SHORT: Record<FieldPhoto['geoSource'], string> = {
  exif: 'из снимка',
  device: 'с телефона',
  manual: 'вручную',
  none: 'источник не записан',
};

const SOURCE: Record<FieldPhoto['geoSource'], string> = {
  exif: 'координаты из снимка',
  device: 'координаты с телефона при добавлении, не из снимка',
  manual: 'координаты поставлены вручную',
  none: 'происхождение координат не записано',
};

export function hasPhotoCoords(p: Pick<FieldPhoto, 'lat' | 'lon'>): boolean {
  return typeof p.lat === 'number' && typeof p.lon === 'number'
    && Number.isFinite(p.lat) && Number.isFinite(p.lon);
}

export function photoGeoNote(p: FieldPhoto): PhotoGeoNote {
  if (!hasPhotoCoords(p)) return { source: 'без координат', warning: '', atShot: false, short: 'без координат' };

  const acc = typeof p.geoAccuracyM === 'number' && Number.isFinite(p.geoAccuracyM) && p.geoAccuracyM > 0
    ? p.geoAccuracyM : undefined;
  const sourceParts = [SOURCE[p.geoSource] ?? SOURCE.none];
  if (acc !== undefined) sourceParts.push(formatAccuracy(acc));
  const warnings: string[] = [];
  let atShot = p.geoSource === 'exif' || p.geoSource === 'manual';
  // Не место съёмки по времени — это хуже грубой точки, и под миниатюрой
  // говорится именно это.
  let notThere = false;

  // Время кадра знаем только из самого снимка: без него «когда снято» —
  // это время, когда фото приложили.
  const shot = ms(p.exifAt);

  if (p.geoSource === 'exif') {
    const fix = ms(p.geoAt);
    if (shot !== null && fix !== null) {
      const gap = shot - fix;
      if (Math.abs(gap) >= STALE_FIX_MIN * MIN) {
        if (looksLikeTimezone(gap)) {
          warnings.push(`время точки в снимке расходится со временем кадра ровно на ${fmtGap(gap)} — `
            + 'похоже на часовой пояс телефона, но место стоит проверить');
        } else if (gap > 0) {
          atShot = false;
          notThere = true;
          warnings.push(`точка в снимке определена за ${fmtGap(gap)} до кадра — могла остаться с прошлого места`);
        } else {
          atShot = false;
          notThere = true;
          warnings.push(`время точки в снимке расходится со временем кадра на ${fmtGap(gap)} — место не подтверждено`);
        }
      }
    }
  }

  if (p.geoSource === 'device') {
    // Старые карточки без времени точки: телефон спрашивали в момент
    // добавления, то есть тогда, когда завели карточку.
    const fix = ms(p.geoAt) ?? ms(p.createdAt);
    if (shot === null) {
      atShot = false;
      notThere = true;
      warnings.push('время съёмки в снимке не записано — это место, где фото приложили; где снимали, неизвестно');
    } else if (fix !== null && Math.abs(fix - shot) >= LATE_ATTACH_MIN * MIN) {
      atShot = false;
      notThere = true;
      warnings.push(fix > shot
        ? `взяты через ${fmtGap(fix - shot)} после съёмки — это место, где фото приложили, а не где снимали`
        : `взяты за ${fmtGap(fix - shot)} до времени съёмки — часы телефона или снимок не те, место не подтверждено`);
    } else {
      // Сфотографировали и тут же приложили — телефон стоит там же,
      // где снимали: такой точке верить можно.
      atShot = true;
      if (fix !== null) {
        const gap = fix - shot;
        sourceParts.push(Math.abs(gap) < 2 * MIN ? 'сразу после съёмки'
          : gap > 0 ? `через ${fmtGap(gap)} после съёмки` : `за ${fmtGap(gap)} до времени съёмки`);
      }
    }
  }

  const rough = acc !== undefined && acc > ROUGH_ACCURACY_M;
  if (rough) {
    atShot = false;
    warnings.push(`погрешность ${formatAccuracy(acc as number)} — место примерное`);
  }

  const short = [SHORT[p.geoSource] ?? SHORT.none, acc !== undefined ? formatAccuracy(acc) : '']
    .filter(Boolean).join(' ')
    + (notThere ? ' · не место съёмки' : rough ? ' · примерно' : '');

  return { source: sourceParts.join(', '), warning: warnings.join('; '), atShot, short };
}

/** «снято …» — если время из снимка, иначе «приложено …» с оговоркой. */
export function photoTimeNote(p: FieldPhoto): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru');
  };
  if (p.exifAt) {
    const t = fmt(p.exifAt);
    if (t) return `снято ${t}`;
  }
  const t = fmt(p.takenAt || p.createdAt);
  return t ? `приложено ${t} (время съёмки в снимке не записано)` : 'время неизвестно';
}

/**
 * Сводка по отчёту: сколько точек из снимков, сколько с телефона и
 * сколько из них не место съёмки. Заказчик видит это на первой странице,
 * а не выискивает под каждой фотографией.
 */
export function photoGeoSummary(photos: FieldPhoto[]): string {
  let exif = 0;
  let device = 0;
  let manual = 0;
  let unknown = 0;
  let none = 0;
  let notAtShot = 0;
  for (const p of photos) {
    if (!hasPhotoCoords(p)) { none += 1; continue; }
    if (p.geoSource === 'exif') exif += 1;
    else if (p.geoSource === 'device') device += 1;
    else if (p.geoSource === 'manual') manual += 1;
    else unknown += 1;
    if (!photoGeoNote(p).atShot) notAtShot += 1;
  }
  const parts = [`из снимка — ${exif}`];
  if (device) parts.push(`с телефона при добавлении — ${device}`);
  if (manual) parts.push(`вручную — ${manual}`);
  if (unknown) parts.push(`происхождение не записано — ${unknown}`);
  if (none) parts.push(`без координат — ${none}`);
  const head = `Координаты: ${parts.join(', ')}.`;
  return notAtShot
    ? `${head} Не подтверждают место съёмки: ${notAtShot} — причина указана под снимком.`
    : head;
}
