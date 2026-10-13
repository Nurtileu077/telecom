/**
 * Ссылка вместо файла.
 *
 * Акт уходит в почту вложением, потом в нём находят ошибку, отправляют
 * второй — и у заказчика их два, а какой верный, видно только по дате
 * письма. Ссылка решает это: она одна, и открывается по ней всегда то,
 * что лежит сейчас.
 *
 * Поэтому путь в складе — не «имя файла и время», а постоянный адрес
 * документа: тот же документ ложится туда же и заменяет прежнее. Иначе
 * получится та же пачка файлов, только в облаке. Но «тот же» — это тот
 * же проект, вид, период, область, подрядчик и участок (см. DocAddress):
 * совпавший по одному заголовку отчёт другой области заменять нельзя.
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
 * Чем один документ отличается от другого.
 *
 * Раньше адрес строился из заголовка письма — «Отчёт за период 01.09 —
 * 30.09», — а в нём не было ни области, ни подрядчика, ни проекта. Ссылку
 * на сентябрьский отчёт по Акмолинской отправили заказчику, потом собрали
 * за те же даты Костанайскую — и она легла в тот же файл: по старой
 * ссылке заказчик открыл чужую область. После деления на проекты туда же
 * легла бы и Гипертрасса — чужой договор.
 *
 * Поэтому адрес собирается не из подписи, а из всего, чем сужена выборка.
 */
export interface DocAddress {
  /**
   * Номер проекта стройки, а не название: проект переименовали — ссылки,
   * уже отправленные заказчику, должны открываться по-прежнему.
   */
  project: string;
  /** Вид документа: «отчёт за период», «акт скрытых работ». */
  kind: string;
  /**
   * Всё, что выбирает содержимое: период, область, подрядчик, участок.
   * Порядок важен, пустые места тоже: «вся область, один подрядчик» и
   * «одна область, все подрядчики» — разные отчёты.
   */
  parts: string[];
}

/**
 * Одно и то же, написанное чуть по-разному.
 *
 * Список участков берёт первое встреченное написание: сегодня «Аксу»,
 * а после правки старой смены — «аксу». Ссылка, уже отданная заказчику,
 * от этого прыгать не должна.
 */
function sameKey(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'„“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Короткий отпечаток строки (cyrb53).
 *
 * Читаемая часть адреса теряет различия: «е», «ё» и «э» в ней одна
 * буква, кавычки и знаки пропадают, длинные названия обрезаются, и два
 * участка с общим началом после обрезки совпадают. Отпечаток полного набора различает
 * их, и при этом один и тот же документ всегда даёт один и тот же адрес.
 */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36).padStart(11, '0');
}

/** Сколько читаемых знаков оставлять в имени: дальше его никто не читает. */
const READABLE_MAX = 80;

/**
 * Постоянный адрес документа в складе.
 *
 * Первый кусок — организация: по нему же построены права доступа, и
 * чужую папку не открыть даже зная адрес. Второй — проект: у каждого
 * договора свои документы, и отчёт Гипертрассы не ляжет поверх отчёта
 * сёл. Имя — читаемая часть, чтобы в панели облака было видно, что это,
 * и отпечаток всего набора, чтобы разные документы не совпали.
 */
export function docPath(orgId: string, address: DocAddress, ext: string): string {
  const safeOrg = (orgId ?? '').trim() || 'default';
  // Без проекта адрес не придумываем «СНП»-ом: документ чужого договора,
  // молча положенный к сёлам, и есть та ошибка, которую здесь закрываем.
  const project = slug(address.project) || 'bez-proekta';
  const kind = slug(address.kind) || 'doc';
  const parts = address.parts ?? [];
  const readable = parts.map(slug).filter(Boolean).join('_')
    .slice(0, READABLE_MAX).replace(/[-_]+$/, '');
  const identity = [address.project, address.kind, ...parts].map(sameKey).join('\u0001');
  const name = `${readable || 'dokument'}_${fingerprint(identity)}`;
  const e = ext.replace(/^\./, '').toLowerCase() || 'doc';
  return `${safeOrg}/${project}/${kind}/${name}.${e}`;
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
