import { SiteObjectKind } from '@/types/construction';
import type { RawPoint } from './planImport';

/**
 * Что за точка пришла из KML.
 *
 * В файле их больше тысячи, и они разные по смыслу. Пересечения и проколы
 * — разметка обследования: трасса с тех пор менялась не раз, и показывать
 * их как факт значит показывать вчерашний день сегодняшним. А вот куда
 * ведёт трасса — АТС, ФАП, школа, аким аппарат — и где стоят ККС, нужно:
 * это конец пути и отметка, докуда идут по колодцам.
 *
 * Поэтому не спрашиваем «что это всё такое» одним вопросом на тысячу
 * точек, а разбираем по названию: человек подписал их сам, и подпись —
 * единственное, что о них известно.
 */

export type PointGroup =
  /** Конец пути: АТС, ФАП, школа, аким аппарат. */
  | 'endpoint'
  /** ККС — докуда тянут по колодцам. */
  | 'kks'
  | 'mufta'
  | 'stolb'
  /** Пересечения и проколы — разметка обследования. */
  | 'crossing'
  /** Подпись ни о чём не говорит. */
  | 'other';

export interface PointGroupSpec {
  label: string;
  icon: string;
  /** Чем это станет в журнале. Пересечения и прочее не становятся ничем. */
  objectKind?: SiteObjectKind;
  /** Брать по умолчанию. */
  byDefault: boolean;
  hint: string;
}

export const POINT_GROUPS: Record<PointGroup, PointGroupSpec> = {
  endpoint: {
    label: 'Конечные точки', icon: '🏫', objectKind: 'endpoint', byDefault: true,
    hint: 'АТС, ФАП, школа, аким аппарат — куда ведёт трасса',
  },
  kks: {
    label: 'ККС', icon: '⬛', objectKind: 'kks', byDefault: true,
    hint: 'докуда идут по существующим колодцам',
  },
  mufta: {
    label: 'Муфты', icon: '🔗', objectKind: 'mufta', byDefault: false,
    hint: 'если в файле размечены муфты',
  },
  stolb: {
    label: 'Столбы', icon: '🪵', objectKind: 'stolb', byDefault: false,
    hint: 'опоры подвеса',
  },
  crossing: {
    label: 'Пересечения и проколы', icon: '✖', byDefault: false,
    hint: 'разметка обследования: трасса с тех пор менялась не раз',
  },
  other: {
    label: 'Без понятной подписи', icon: '•', byDefault: false,
    hint: 'по названию не разобрать, что это',
  },
};

export const POINT_GROUP_LIST = Object.keys(POINT_GROUPS) as PointGroup[];

/**
 * Разбор подписи.
 *
 * Границы слова (\b) здесь не работают: в JavaScript они считаются
 * только по латинице, и «\bатс\b» не найдёт «АТС» никогда. Поэтому
 * короткие слова ищем среди слов подписи, а длинные — куском текста.
 */
function words(s: string): string[] {
  return (s ?? '').toLowerCase().replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter(Boolean);
}

/** Короткие слова — только целиком: «кк» не должно ловиться в «кирковка». */
const ENDPOINT_TOKENS: [string[], string][] = [
  [['атс', 'нрп'], 'АТС'],
  [['фап', 'сва'], 'ФАП'],
  [['дк'], 'Клуб'],
  [['сад', 'садик', 'ясли'], 'Детский сад'],
];

/** Длинные — куском: «школа №2», «ФАП с. Еленовка». */
const ENDPOINT_PARTS: [string, string][] = [
  ['узел связи', 'АТС'],
  ['медпункт', 'ФАП'], ['амбулатор', 'ФАП'], ['больниц', 'ФАП'], ['фельдшер', 'ФАП'],
  ['школ', 'Школа'], ['мектеп', 'Школа'], ['гимназ', 'Школа'], ['лицей', 'Школа'],
  ['аким', 'Аким аппарат'], ['әкім', 'Аким аппарат'],
  ['детс', 'Детский сад'], ['балабак', 'Детский сад'], ['бала бак', 'Детский сад'],
  ['клуб', 'Клуб'], ['дом культур', 'Клуб'],
  ['почт', 'Почта'],
  ['библиотек', 'Прочее'],
];

const KKS_TOKENS = ['ккс', 'кк'];
const KKS_PARTS = ['колодц', 'колодец', 'колодк'];

const CROSSING_TOKENS = ['жд', 'газ', 'ттс', 'лэп', 'а', 'д'];
const CROSSING_PARTS = [
  'прокол', 'гнб', 'гнп', 'переход', 'пересеч',
  'автодорог', 'грейдер', 'асфальт', 'дорог',
  'железн', 'река', 'речк', 'овраг', 'болот', 'арык',
  'водопровод', 'водоканал', 'канализ', 'газопровод',
  'кабель связи',
];

function hasToken(ws: string[], list: string[]): boolean {
  return ws.some((w) => list.includes(w));
}

function hasPart(n: string, list: string[]): boolean {
  return list.some((x) => n.includes(x));
}

export function classifyPoint(name: string): PointGroup {
  const n = (name ?? '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!n) return 'other';
  const ws = words(n);

  // ККС проверяем до пересечений: «ККС у а/дороги» — это всё-таки ККС.
  if (hasToken(ws, KKS_TOKENS) || hasPart(n, KKS_PARTS)) return 'kks';
  if (n.includes('муфт')) return 'mufta';
  if (hasPart(n, ['столб', 'опора', 'опоры'])) return 'stolb';

  for (const [list] of ENDPOINT_TOKENS) if (hasToken(ws, list)) return 'endpoint';
  for (const [part] of ENDPOINT_PARTS) if (n.includes(part)) return 'endpoint';

  // «а/д» распадается на слова «а» и «д» — ловим именно эту пару.
  if (ws.includes('а') && ws.includes('д')) return 'crossing';
  if (hasToken(ws, CROSSING_TOKENS.filter((t) => t !== 'а' && t !== 'д'))) return 'crossing';
  if (hasPart(n, CROSSING_PARTS)) return 'crossing';

  return 'other';
}

export function endpointKindOf(name: string): string | undefined {
  const n = (name ?? '').trim().toLowerCase().replace(/ё/g, 'е');
  const ws = words(n);
  for (const [list, kind] of ENDPOINT_TOKENS) if (hasToken(ws, list)) return kind;
  for (const [part, kind] of ENDPOINT_PARTS) if (n.includes(part)) return kind;
  return undefined;
}

export interface PointBucket {
  group: PointGroup;
  points: RawPoint[];
}

/** Точки, разложенные по смыслу, — в порядке, в котором о них думают. */
export function groupPoints(points: RawPoint[]): PointBucket[] {
  const acc = new Map<PointGroup, RawPoint[]>();
  for (const p of points) {
    const g = classifyPoint(p.name);
    const list = acc.get(g) ?? [];
    list.push(p);
    acc.set(g, list);
  }
  return POINT_GROUP_LIST
    .filter((g) => (acc.get(g)?.length ?? 0) > 0)
    .map((group) => ({ group, points: acc.get(group)! }));
}
