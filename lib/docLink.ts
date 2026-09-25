/**
 * Ссылка вместо файла.
 *
 * Акт уходит в почту вложением, потом в нём находят ошибку, отправляют
 * второй — и у заказчика их два, а какой верный, видно только по дате
 * письма. Ссылка решает это: она одна, и открывается по ней всегда то,
 * что лежит сейчас.
 *
 * Поэтому путь в складе — не «имя файла и время», а постоянный адрес
 * документа: тот же участок и тот же вид документа ложатся туда же и
 * заменяют прежнее. Иначе получится та же пачка файлов, только в облаке.
 *
 * Срок у ссылки нужен потому, что письма пересылают, а папки «Загрузки»
 * живут годами: ссылка, действующая вечно, однажды утечёт вместе с
 * перепиской. Неделя — обычный срок «посмотрите и подпишите»; месяц для
 * тех, кто смотрит не сразу.
 */

export const DOC_BUCKET = 'documents';

export interface LinkLife {
  key: string;
  label: string;
  /** Сколько секунд живёт ссылка. */
  seconds: number;
  hint: string;
}

export const LINK_LIVES: LinkLife[] = [
  { key: 'week', label: 'Неделя', seconds: 7 * 24 * 3600, hint: 'обычный срок «посмотрите и подпишите»' },
  { key: 'month', label: 'Месяц', seconds: 30 * 24 * 3600, hint: 'если смотрят не сразу' },
  { key: 'day', label: 'Сутки', seconds: 24 * 3600, hint: 'когда документ спорный' },
];

export const DEFAULT_LINK_LIFE = LINK_LIVES[0];

export function lifeByKey(key: string): LinkLife {
  return LINK_LIVES.find((l) => l.key === key) ?? DEFAULT_LINK_LIFE;
}

/**
 * Кусок пути из человеческого названия.
 *
 * В складе имя файла — это ключ, а не подпись: пробелы, кавычки и
 * кириллица в нём ломают часть распаковщиков и половину почтовых
 * программ. Оставляем буквы, цифры и дефис, кириллицу переводим
 * побуквенно — участок «Зеренда — Серафимовка» должен остаться узнаваем
 * и в адресе.
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

export function slug(text: string): string {
  const lower = (text ?? '').toLowerCase();
  let out = '';
  for (const ch of lower) {
    if (ch in TRANSLIT) out += TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/**
 * Постоянный адрес документа в складе.
 *
 * Первый кусок — организация: по нему же построены права доступа, и
 * чужую папку не открыть даже зная адрес.
 */
export function docPath(
  orgId: string,
  kind: string,
  subject: string,
  ext: string,
): string {
  const safeOrg = (orgId ?? '').trim() || 'default';
  const name = slug(subject) || 'dokument';
  const e = ext.replace(/^\./, '').toLowerCase() || 'doc';
  return `${safeOrg}/${slug(kind) || 'doc'}/${name}.${e}`;
}

/** Когда ссылка перестанет открываться. */
export function expiresAt(life: LinkLife, from: Date): string {
  return new Date(from.getTime() + life.seconds * 1000).toISOString();
}

/**
 * Текст, который уходит заказчику вместе со ссылкой.
 *
 * Срок называем прямо: ссылка, переставшая открываться без объяснения,
 * читается как «документ отозвали».
 */
export function linkMessage(
  title: string,
  url: string,
  life: LinkLife,
  until: string,
): string {
  const day = new Date(until);
  const shown = Number.isNaN(day.getTime()) ? '' : day.toLocaleDateString('ru');
  return [
    title,
    url,
    '',
    shown
      ? `Ссылка открывается до ${shown}. Всё это время по ней лежит текущая версия: если документ поправят, перезапрашивать ссылку не нужно.`
      : 'По ссылке всегда лежит текущая версия документа.',
  ].join('\n');
}

/** Осталось ли время у ссылки — чтобы не отдавать протухшую. */
export function stillValid(until: string, now: Date): boolean {
  const end = new Date(until).getTime();
  if (!Number.isFinite(end)) return false;
  return end > now.getTime();
}

/** «действует ещё 5 дней» — так это и читают. */
export function validFor(until: string, now: Date): string {
  const ms = new Date(until).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 'срок вышел';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `действует ещё ${days} дн`;
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `действует ещё ${hours} ч`;
}
