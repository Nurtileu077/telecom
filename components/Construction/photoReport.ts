import {
  SNP_STAGES, SNP_STAGE_SPECS,
  type AerialWorkEntry, type DailyWorkEntry, type Deviation, type DrillLogEntry,
  type FieldPhoto, type SiteObject, type SnpStage,
} from '@/types/construction';
import { normName } from './areaImport';
import { entryMeters } from './entriesTable';

/**
 * Раскладка фотоотчёта.
 *
 * Отчёт выходил одним потоком снимков за период, а сверх шестидесяти
 * снимки молча отбрасывались: в отчёт за месяц со стапятьюдесятью
 * фотографиями попадали первые шестьдесят, и никто об этом не знал.
 * Заказчик листает отчёт, чтобы найти «ГНБ под дорогой у Еленовки», а не
 * разбирать поток.
 *
 * Допущение: фотоотчёт сдают и по участку, и за период целиком — бывает
 * и так, и так, поэтому на экране выбор. Шестьдесят снимков на файл
 * оставлены как предел, но не обрезкой, а делением на части: снимки
 * вкладываются в документ целиком, и файл на триста снимков Word на
 * телефоне куратора уже не откроет.
 */

export const PHOTOS_PER_PART = 60;

export type PhotoStage = SnpStage | 'objects' | 'deviations' | 'other';

export const PHOTO_STAGE_ORDER: PhotoStage[] = [...SNP_STAGES, 'objects', 'deviations', 'other'];

export const PHOTO_STAGE_LABEL: Record<PhotoStage, string> = {
  ...Object.fromEntries(SNP_STAGES.map((s) => [s, SNP_STAGE_SPECS[s].label])) as Record<SnpStage, string>,
  objects: 'Объекты на трассе',
  deviations: 'Отклонения',
  other: 'Без этапа',
};

export interface PhotoContext {
  ground: DailyWorkEntry[];
  aerial?: AerialWorkEntry[];
  drills?: DrillLogEntry[];
  objects?: SiteObject[];
  deviations?: Deviation[];
}

/**
 * Этап, к которому относится снимок.
 *
 * Этап у снимка не записан, но он следует из того, к чему снимок
 * приложен: смена с метрами МКТ — прокладка, смена только с задувкой —
 * задувка, прокол — ГНБ, муфта — сварка. Не нашли, к чему приложен, —
 * так и пишем «без этапа», а не угадываем.
 */
export function photoStage(p: FieldPhoto, ctx: PhotoContext): PhotoStage {
  if (p.kind === 'drill') return 'gnb';
  if (p.kind === 'deviation') return 'deviations';
  if (p.kind === 'object') {
    const o = ctx.objects?.find((x) => x.id === p.refId);
    if (!o) return 'other';
    return o.kind === 'mufta' ? 'svarka' : 'objects';
  }
  const g = ctx.ground.find((e) => e.id === p.refId);
  if (g) {
    if (entryMeters(g) > 0) return 'mkt';
    if ((g.drillM ?? 0) > 0 || (g.drillCount ?? 0) > 0) return 'gnb';
    if ((g.blowingM ?? 0) > 0) return 'zaduvka';
    return 'other';
  }
  if (ctx.aerial?.some((e) => e.id === p.refId)) return 'podves';
  if (ctx.drills?.some((e) => e.id === p.refId)) return 'gnb';
  return 'other';
}

/** Участок снимка: записанный в карточке, иначе — того, к чему приложен. */
export function photoSection(p: FieldPhoto, ctx: PhotoContext): string {
  if (p.uchastok?.trim()) return p.uchastok.trim();
  const from = p.kind === 'object' ? ctx.objects?.find((x) => x.id === p.refId)?.uchastok
    : p.kind === 'deviation' ? ctx.deviations?.find((x) => x.id === p.refId)?.uchastok
      : p.kind === 'drill' ? ctx.drills?.find((x) => x.id === p.refId)?.uchastok
        : (ctx.ground.find((x) => x.id === p.refId)
          ?? ctx.aerial?.find((x) => x.id === p.refId))?.uchastok;
  return (from ?? '').trim();
}

/**
 * День снимка — по местному времени.
 *
 * Время в карточке хранится в UTC, и снимок, сделанный в два часа ночи
 * по Алматы, по первым десяти знакам строки оказывается вчерашним — и
 * выпадает из отчёта за день.
 */
export function photoDay(p: FieldPhoto): string {
  const raw = p.exifAt || p.takenAt || p.createdAt || '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function photosInRange(photos: FieldPhoto[], from?: string, to?: string): FieldPhoto[] {
  return photos.filter((p) => {
    const day = photoDay(p);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

export interface PhotoGroup {
  uchastok: string;
  stage: PhotoStage;
  photos: FieldPhoto[];
}

const time = (p: FieldPhoto) => p.exifAt || p.takenAt || p.createdAt || '';

/**
 * Снимки по участкам и этапам.
 *
 * Внутри группы — по времени: так их снимали, так и читают. Участки по
 * алфавиту, этапы — в порядке стройки: прокладка, ГНБ, задувка, подвес,
 * сварка. Снимки без участка идут последними, отдельной группой.
 */
export function groupPhotos(
  photos: FieldPhoto[],
  ctx: PhotoContext,
  uchastok?: string,
): PhotoGroup[] {
  const want = uchastok ? normName(uchastok) : '';
  const groups = new Map<string, PhotoGroup>();
  for (const p of photos) {
    const sec = photoSection(p, ctx);
    if (want && normName(sec) !== want) continue;
    const stage = photoStage(p, ctx);
    const key = `${normName(sec)}|${stage}`;
    const g = groups.get(key);
    if (g) g.photos.push(p);
    else groups.set(key, { uchastok: sec, stage, photos: [p] });
  }
  return [...groups.values()]
    .map((g) => ({ ...g, photos: [...g.photos].sort((a, b) => time(a).localeCompare(time(b))) }))
    .sort((a, b) => (Number(!a.uchastok) - Number(!b.uchastok))
      || a.uchastok.localeCompare(b.uchastok, 'ru')
      || PHOTO_STAGE_ORDER.indexOf(a.stage) - PHOTO_STAGE_ORDER.indexOf(b.stage));
}

/** Заголовок группы в документе. */
export function groupTitle(g: PhotoGroup, withSection: boolean, cont = false): string {
  const stage = PHOTO_STAGE_LABEL[g.stage];
  const head = withSection ? `${g.uchastok || 'Участок не указан'} — ${stage}` : stage;
  return cont ? `${head} (продолжение)` : head;
}

export interface PhotoPart {
  index: number;
  of: number;
  total: number;
  groups: { title: string; photos: FieldPhoto[] }[];
}

/**
 * Делим отчёт на части, ничего не теряя.
 *
 * Группа, перешедшая через границу части, продолжается в следующей с
 * пометкой «продолжение» — иначе снимки второй части окажутся без
 * подписи, к какому этапу они относятся.
 */
export function splitPhotoReport(
  groups: PhotoGroup[],
  perPart = PHOTOS_PER_PART,
  withSection = true,
): PhotoPart[] {
  const total = groups.reduce((s, g) => s + g.photos.length, 0);
  const parts: PhotoPart['groups'][] = [];
  let current: PhotoPart['groups'] = [];
  let room = perPart;
  for (const g of groups) {
    let rest = g.photos;
    let cont = false;
    while (rest.length > 0) {
      if (room === 0) { parts.push(current); current = []; room = perPart; }
      const take = rest.slice(0, room);
      current.push({ title: groupTitle(g, withSection, cont), photos: take });
      room -= take.length;
      rest = rest.slice(take.length);
      cont = true;
    }
  }
  if (current.length) parts.push(current);
  return parts.map((groups, i) => ({ index: i + 1, of: parts.length, total, groups }));
}

/** Имя файла: что, по какому участку, за какой период и какая часть. */
export function photoReportFileName(
  opts: { uchastok?: string; from?: string; to?: string; part?: { index: number; of: number } },
): string {
  const safe = (opts.uchastok ?? '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
  const period = [opts.from, opts.to].filter(Boolean).join('—');
  const part = opts.part && opts.part.of > 1 ? ` часть ${opts.part.index} из ${opts.part.of}` : '';
  return `Фотоотчёт${safe ? ` ${safe}` : ''}${period ? ` ${period}` : ''}${part}.doc`;
}
