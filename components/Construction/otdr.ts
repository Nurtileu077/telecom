import type { SiteObject, SpliceRecord } from '@/types/construction';
import { normName } from './areaImport';
import type { MeasureProtocolInput, OtdrLine } from './fieldDocs';

/**
 * Рефлектограммы и протоколы измерений по муфтам.
 *
 * До сих пор у протокола сварки было только поле «имя файла»: сам файл
 * никуда не ложился, в протокол измерений не попадал, а протокол
 * собирался всегда по первой муфте журнала. Заказчик получал протокол
 * не той муфты и без рефлектограммы — то есть без того, чем измерение
 * подтверждается.
 *
 * Файл рефлектограммы лежит там же, где снимки: локально, пока не ушёл в
 * облако, потом — ссылкой. Ключ свой, чтобы не путаться со снимками.
 */

/** Ключ файла в локальном хранилище. */
export const otdrKey = (spliceId: string) => `otdr-${spliceId}`;

/** Файл рефлектограммы есть — локально или в облаке. */
export function otdrAttached(r: SpliceRecord): boolean {
  return !!r.otdrUrl || !!r.otdrPending;
}

/** Имя файла в архиве: исходное, если оно было, иначе по муфте и дате. */
export function otdrFileName(r: SpliceRecord, objectName?: string): string {
  const raw = (r.otdrName ?? '').trim();
  const base = raw || `Рефлектограмма ${objectName || 'муфта'} ${r.date}`;
  return base.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'рефлектограмма';
}

/**
 * Строки приложения к протоколу.
 *
 * `packed` — файлы, которые действительно легли в архив рядом с
 * протоколом, с тем именем, под которым легли. Без него протокол уходит
 * отдельным файлом, и честнее сказать, что рефлектограмма лежит в
 * журнале, чем «прилагается».
 * Запись без файла не прячем: «записано только имя» — тоже ответ.
 */
export function otdrLines(
  records: SpliceRecord[],
  objectName?: string,
  packed?: Map<string, string>,
): OtdrLine[] {
  return records
    .filter((r) => otdrAttached(r) || (r.otdrName ?? '').trim())
    .map((r) => {
      const inZip = packed?.get(r.id);
      if (inZip) return { name: inZip, status: 'прилагается — папка «Рефлектограммы»' };
      const name = otdrFileName(r, objectName);
      if (otdrAttached(r)) {
        return {
          name,
          status: packed
            ? 'есть в журнале, в архив не попала — не было связи'
            : 'файл в журнале, выдаётся по запросу',
        };
      }
      return { name, status: 'файл не загружен — записано только имя' };
    });
}

/** Муфта с протоколами сварки — то, по чему можно собрать протокол измерений. */
export interface MeasuredObject {
  objectId: string;
  name: string;
  uchastok?: string;
  object?: SiteObject;
  records: SpliceRecord[];
}

/**
 * Муфты, по которым есть что сдавать.
 *
 * Сортируем по участку и названию: в списке на экране ищут «Муфта №3 у
 * Еленовки», и порядок записи в журнал тут ничего не говорит. Протокол
 * без муфты в справочнике не теряем — муфту могли удалить с карты, а
 * измерения остались.
 */
export function measuredObjects(
  objects: SiteObject[],
  splices: SpliceRecord[],
  uchastok?: string,
): MeasuredObject[] {
  const byObject = new Map<string, SpliceRecord[]>();
  for (const r of splices) {
    const list = byObject.get(r.objectId);
    if (list) list.push(r); else byObject.set(r.objectId, [r]);
  }
  const want = uchastok ? normName(uchastok) : '';
  return [...byObject.entries()]
    .map(([objectId, records]) => {
      const object = objects.find((o) => o.id === objectId);
      return {
        objectId,
        name: object?.name || 'Муфта без названия',
        uchastok: object?.uchastok,
        object,
        records: [...records].sort((a, b) => (a.date || '').localeCompare(b.date || '')),
      };
    })
    .filter((m) => !want || normName(m.uchastok ?? '') === want)
    .sort((a, b) => (a.uchastok ?? '').localeCompare(b.uchastok ?? '', 'ru')
      || a.name.localeCompare(b.name, 'ru', { numeric: true }));
}

/** Вход протокола измерений по одной муфте. */
export function measureInput(
  m: MeasuredObject,
  extra: Pick<MeasureProtocolInput, 'contractor' | 'customer' | 'date'> & {
    packed?: Map<string, string>;
  },
): MeasureProtocolInput {
  return {
    objectName: m.name,
    uchastok: m.uchastok,
    records: m.records,
    // Подписывает измерения тот, кто варил и мерил, — он записан в
    // протоколе сварки. Подрядчик из фильтра — только если там пусто.
    contractor: m.records.map((r) => r.contractor?.trim()).find(Boolean) ?? extra.contractor,
    customer: extra.customer,
    date: extra.date,
    otdr: otdrLines(m.records, m.name, extra.packed),
  };
}

/** Были ли по муфте измерения за период — по этому она идёт в пакет. */
export function measuredInPeriod(m: MeasuredObject, from?: string, to?: string): boolean {
  return m.records.some((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

export interface OtdrUploadDeps {
  get: (key: string) => Promise<Blob | null>;
  del: (key: string) => Promise<void>;
  upload: (spliceId: string, name: string, blob: Blob) => Promise<{ url: string; storagePath: string }>;
}

/**
 * Отправить рефлектограммы, лежащие локально.
 *
 * Как со снимками: по одной и без «всё или ничего» — связь в поле рвётся
 * на середине. Локальную копию удаляем только после того, как получили
 * ссылку, иначе файл пропадёт между телефоном и облаком.
 */
export async function uploadPendingOtdr(
  splices: SpliceRecord[],
  deps: OtdrUploadDeps,
  now = () => new Date().toISOString(),
): Promise<{ splices: SpliceRecord[]; sent: number; failed: number; elsewhere: number }> {
  let sent = 0;
  let failed = 0;
  let elsewhere = 0;
  const out: SpliceRecord[] = [];
  for (const r of splices) {
    if (!r.otdrPending) { out.push(r); continue; }
    const blob = await deps.get(otdrKey(r.id));
    if (!blob) {
      // Файла на этом устройстве нет — значит, его прикладывали на другом.
      // Отметку «ждёт отправки» не снимаем и в ошибку не пишем: то
      // устройство отправит само, а здесь предупреждение было бы ложным.
      out.push(r);
      elsewhere += 1;
      continue;
    }
    try {
      const { url, storagePath } = await deps.upload(r.id, otdrFileName(r), blob);
      out.push({
        ...r, otdrUrl: url, otdrStoragePath: storagePath, otdrPending: false,
        updatedAt: now(),
      });
      await deps.del(otdrKey(r.id));
      sent += 1;
    } catch {
      out.push(r);
      failed += 1;
    }
  }
  return { splices: out, sent, failed, elsewhere };
}
