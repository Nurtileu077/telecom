import { LayMethod, SITE_OBJECT_SPECS } from '@/types/construction';
import { routeLengthM, segMeters } from './routeProgress';
import { sliceByDistance, METHOD_COLOR } from './routeSegments';
import { ConstructionLayers, RouteColorMode } from './mapLayers';
import { STAGE_LINE_COLOR, PLAN_LINE_COLOR } from './routeStyle';

/**
 * Разметка карты: то, что линия должна сказать сама.
 *
 * Трасса на спутнике — это цветная нитка. Куда она идёт, какой длины
 * кусок между поворотами, сколько по ней уже прошли, что значит её цвет —
 * всё это сейчас узнаётся наведением мыши по очереди на каждую. А глазами
 * такие вопросы задают сразу и ко всей карте.
 *
 * Здесь считается только геометрия и подписи. Рисует их карта.
 */

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

// Длины звеньев — той же меркой, что и вся трасса (эллипсоид WGS-84):
// своя копия формулы шара здесь подписывала перегон на 0,3 % короче, чем
// его же длина в схеме.

/** Куда смотрит отрезок: 0 — на север, 90 — на восток. */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const dLon = rad(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0]))
    - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface PointOnRoute {
  lat: number;
  lon: number;
  /** Направление движения по трассе в этой точке. */
  deg: number;
  /** Метры от начала. */
  atM: number;
}

/** Точка на ломаной с направлением — в отличие от pointAtDistanceM, знает куда. */
export function locateOnRoute(
  coords: [number, number][],
  meters: number,
): PointOnRoute | null {
  if (coords.length < 2) return null;
  const target = Math.max(0, meters);
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = segMeters(coords[i - 1], coords[i]);
    if (seg <= 0) continue;
    if (target <= acc + seg) {
      const t = (target - acc) / seg;
      return {
        lat: coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        lon: coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
        deg: bearingDeg(coords[i - 1], coords[i]),
        atM: target,
      };
    }
    acc += seg;
  }
  const last = coords.length - 1;
  return {
    lat: coords[last][0],
    lon: coords[last][1],
    deg: bearingDeg(coords[last - 1], coords[last]),
    atM: acc,
  };
}

export interface ArrowOptions {
  /** Шаг между стрелками, метры. */
  everyM: number;
  /** Больше этого числа стрелок не ставим: длинная трасса иначе пестрит. */
  max?: number;
}

/**
 * Стрелки направления вдоль трассы.
 *
 * Их ставят не у концов, а по всей длине: на карте видна не вся линия
 * сразу, а тот кусок, который сейчас на экране, и направление должно
 * читаться именно там. Первая — на половине шага, чтобы не совпасть с
 * подписью конца.
 */
export function arrowsAlong(
  coords: [number, number][],
  opts: ArrowOptions,
): PointOnRoute[] {
  const step = Math.max(1, opts.everyM);
  const total = routeLengthM(coords);
  if (coords.length < 2 || total < step) return [];

  const max = opts.max ?? 24;
  const out: PointOnRoute[] = [];
  for (let d = step / 2; d < total && out.length < max; d += step) {
    const p = locateOnRoute(coords, d);
    if (p) out.push(p);
  }
  return out;
}

/** «430 м», «1,24 км» — как это называют вслух. */
export function formatMeters(m: number): string {
  const v = Math.max(0, m);
  if (v < 1000) return `${Math.round(v)} м`;
  return `${(v / 1000).toFixed(v < 10000 ? 2 : 1).replace('.', ',')} км`;
}

export interface LengthLabel {
  lat: number;
  lon: number;
  meters: number;
  text: string;
  /** Угол отрезка — подпись ложится вдоль линии. */
  deg: number;
}

export interface LengthLabelOptions {
  /** Короче этого не подписываем: подпись будет длиннее самого отрезка. */
  minMeters: number;
  /** Сколько подписей на трассу максимум. */
  max?: number;
}

/**
 * Длины прямых кусков прямо на линии.
 *
 * В KML трасса — ломаная из сотен точек, и подписать каждое звено значит
 * залить карту цифрами. Подписываем самые длинные: короткие звенья — это
 * повороты, а человек спрашивает про перегоны.
 */
export function lengthLabels(
  coords: [number, number][],
  opts: LengthLabelOptions,
): LengthLabel[] {
  if (coords.length < 2) return [];
  const max = opts.max ?? 8;

  const all: (LengthLabel & { order: number })[] = [];
  for (let i = 1; i < coords.length; i++) {
    const meters = segMeters(coords[i - 1], coords[i]);
    if (meters < opts.minMeters) continue;
    all.push({
      order: i,
      meters,
      lat: (coords[i - 1][0] + coords[i][0]) / 2,
      lon: (coords[i - 1][1] + coords[i][1]) / 2,
      deg: bearingDeg(coords[i - 1], coords[i]),
      text: formatMeters(meters),
    });
  }

  return all
    .sort((a, b) => b.meters - a.meters)
    .slice(0, max)
    .sort((a, b) => a.order - b.order)
    .map(({ order, ...rest }) => rest);
}

export interface RoutePaint {
  /** Куски, где копали, — уже склеенные и нарезанные по линии. */
  done: [number, number][][];
  /** Сколько метров линии закрашено. */
  doneM: number;
  /** Пройдено, а где — не названо; не больше, чем осталось незакрашенным. */
  unplacedM: number;
  totalM: number;
  /** Пройдено всё — тогда место уже неважно, линия красится целиком. */
  full: boolean;
  /** Штрих доли «место не указано» для dashArray; null — штриховать нечего. */
  hatch: string | null;
}

/** Период штриха в пикселях: короче — сливается, длиннее — читается пунктиром проекта. */
const HATCH_PERIOD = 14;

/**
 * Доля штрихом: чем больше пройдено неизвестно где, тем гуще штрих.
 *
 * Края не даём ни пустыми, ни сплошными: два пикселя из четырнадцати ещё
 * видно, а сплошной штрих уже не отличить от закраски, которая говорит
 * «здесь».
 */
export function hatchDash(share: number): string {
  const dash = Math.min(HATCH_PERIOD - 2, Math.max(2, Math.round(share * HATCH_PERIOD)));
  return `${dash},${HATCH_PERIOD - dash}`;
}

/**
 * Что красить на линии: куски, где копали, и долю, место которой не
 * названо.
 *
 * Куски приходят по сменам и способам и часто стоят встык — склеиваем,
 * чтобы линия не рисовалась сотней отрезков. Метры без места не кладём ни
 * в начало, ни куда-либо ещё: показываем штрихом по всей линии, и густота
 * штриха — доля от того, что ещё не закрашено.
 */
export function routePaint(
  coords: [number, number][],
  pieces: { fromM: number; toM: number }[],
  unplacedM: number,
): RoutePaint {
  const totalM = routeLengthM(coords);
  const clamp = (v: number) => Math.min(Math.max(0, v), totalM);
  const spans = pieces
    .map((p) => [clamp(p.fromM), clamp(p.toM)] as [number, number])
    .filter(([a, b]) => b - a > 0.5)
    .sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }

  const doneM = merged.reduce((s, [a, b]) => s + (b - a), 0);
  const freeM = Math.max(0, totalM - doneM);
  const un = Math.min(Math.max(0, unplacedM), freeM);
  const full = totalM > 0 && doneM + un >= totalM * 0.99;
  return {
    done: merged.map(([a, b]) => sliceByDistance(coords, a, b)).filter((c) => c.length >= 2),
    doneM,
    unplacedM: un,
    totalM,
    full,
    hatch: un > 0 && !full && freeM > 0 ? hatchDash(un / freeM) : null,
  };
}

/** Цвет штриха «место не указано», когда трасса красится способами: способ у такой доли не один. */
export const UNPLACED_COLOR = '#cbd5e1';

/**
 * Способ прокладки — ещё и рисунком линии, не только цветом.
 *
 * На спутнике цвета спорят с подложкой, а распечатанную карту вообще
 * возят чёрно-белой. Штрих читается в обоих случаях.
 */
export const METHOD_DASH: Record<LayMethod, string | undefined> = {
  'кабелеукладчик': undefined,      // сплошная: основной ход
  'экскаватор': '12,5',             // длинный штрих
  'сущ_канализация': '2,6',         // точки — идём по чужому колодцу
  'бар': '16,4,3,4',                // штрих-пунктир
  'вручную': '5,5',                 // мелкий штрих
};

export interface LegendItem {
  kind: 'line' | 'dot' | 'square' | 'diamond' | 'pin';
  color: string;
  dash?: string;
  /** Значок — рамка этого цвета на тёмном, а не заливка: так рисуются снимки. */
  outline?: 'solid' | 'dashed';
  label: string;
  note?: string;
}

/** Цвет рамки метки снимка — общий для карты и легенды. */
export const PHOTO_MARK_COLOR = '#fbbf24';

/**
 * Рамка метки снимка: сплошная — точка и есть место съёмки, пунктир — нет.
 *
 * Одна функция на карту и легенду: если карта начнёт рисовать иначе, а
 * легенда останется прежней, она будет объяснять не то, что на экране.
 */
export function photoMarkOutline(atShot: boolean): 'solid' | 'dashed' {
  return atShot ? 'solid' : 'dashed';
}

export interface LegendGroup {
  title: string;
  items: LegendItem[];
}

/**
 * Легенда — только про то, что сейчас включено.
 *
 * Полная таблица условных обозначений на экране не нужна никому: она
 * объясняет в том числе и то, чего на карте нет. Выключил слой — ушла и
 * его строка.
 */
export function mapLegend(
  layers: ConstructionLayers,
  colorMode: RouteColorMode,
): LegendGroup[] {
  const out: LegendGroup[] = [];

  if (layers.plan) {
    const items: LegendItem[] = [
      { kind: 'line', color: PLAN_LINE_COLOR, label: 'Проект', note: 'работ ещё не было' },
      // Штрих — не способ и не этап, а «где — не знаем»: без строки в
      // легенде его прочтут как ещё один способ прокладки.
      {
        kind: 'line',
        color: colorMode === 'stage' ? STAGE_LINE_COLOR.mkt : UNPLACED_COLOR,
        dash: hatchDash(0.3),
        label: 'Пройдено, место не указано',
        note: 'в сменах нет «остановились здесь»',
      },
    ];
    if (colorMode === 'stage') {
      items.push(
        { kind: 'line', color: STAGE_LINE_COLOR.mkt, label: 'Труба проложена' },
        { kind: 'line', color: STAGE_LINE_COLOR.zaduvka, label: 'Кабель задут' },
        { kind: 'line', color: STAGE_LINE_COLOR.podves, label: 'Подвес' },
        { kind: 'line', color: STAGE_LINE_COLOR.svarka, label: 'Сварено' },
        { kind: 'line', color: STAGE_LINE_COLOR.sdacha, label: 'Сдано' },
      );
    } else {
      items.push(
        { kind: 'line', color: METHOD_COLOR['кабелеукладчик'], dash: METHOD_DASH['кабелеукладчик'], label: 'Кабелеукладчиком' },
        { kind: 'line', color: METHOD_COLOR['экскаватор'], dash: METHOD_DASH['экскаватор'], label: 'Экскаватором' },
        { kind: 'line', color: METHOD_COLOR['сущ_канализация'], dash: METHOD_DASH['сущ_канализация'], label: 'По сущ. канализации' },
        { kind: 'line', color: METHOD_COLOR['бар'], dash: METHOD_DASH['бар'], label: 'Баром' },
        { kind: 'line', color: METHOD_COLOR['вручную'], dash: METHOD_DASH['вручную'], label: 'Вручную' },
      );
    }
    out.push({ title: colorMode === 'stage' ? 'Трасса по этапу' : 'Трасса по способу', items });
  }

  const marks: LegendItem[] = [];
  if (layers.objects) {
    marks.push(
      // ККС — только отмеченные человеком: с объекта или в файле проекта.
      // Расчётный квадрат «досюда по колодцам» убран: он ставился по
      // дневным метрам и мог стоять за километр от колодца.
      { kind: 'dot', color: SITE_OBJECT_SPECS.kks.color, label: 'ККС', note: 'отмечен человеком, не расчётом' },
      { kind: 'dot', color: '#facc15', label: 'Муфта' },
      { kind: 'pin', color: '#e2e8f0', label: 'Конечная точка', note: 'АТС, ФАП, школа' },
    );
  }
  if (layers.drills) marks.push({ kind: 'diamond', color: '#fbbf24', label: 'Прокол ГНБ / ГНП' });
  if (layers.crews) marks.push({ kind: 'dot', color: '#2dd4bf', label: 'Колонна' });
  if (layers.deviations) marks.push({ kind: 'dot', color: '#f97316', label: 'Отклонение' });
  if (layers.incidents) marks.push({ kind: 'dot', color: '#f87171', label: 'Авария' });
  if (layers.photos) {
    // Раньше тут стояло «координаты из EXIF» про все снимки. Но у снимка с
    // телефона, который вырезает место из файла, координаты берутся у
    // телефона при добавлении — а это может быть вагончик вечером. Такие
    // метки карта рисует пунктиром, и легенда обязана сказать, что пунктир
    // места съёмки не подтверждает. На распечатке приписок нет, поэтому
    // смысл несёт сама подпись, а не только примечание.
    marks.push(
      {
        kind: 'square', color: PHOTO_MARK_COLOR, outline: photoMarkOutline(true),
        label: 'Снимок, место съёмки', note: 'сплошная рамка',
      },
      {
        kind: 'square', color: PHOTO_MARK_COLOR, outline: photoMarkOutline(false),
        label: 'Снимок, место не подтверждено',
        // Причин несколько (телефон спросили через полдня, точка в снимке
        // старая, погрешность в сотни метров) — перечислять их здесь
        // значит пропустить какую-то; каждая названа в карточке снимка.
        note: 'пунктир; почему — в карточке снимка',
      },
    );
  }
  if (marks.length) out.push({ title: 'Отметки', items: marks });

  if (layers.areas || layers.snp) {
    const items: LegendItem[] = [];
    if (layers.areas) {
      items.push({ kind: 'line', color: '#94a3b8', dash: '6,4', label: 'Граница района или села' });
    }
    if (layers.snp) {
      items.push({ kind: 'dot', color: STAGE_LINE_COLOR.sdacha, label: 'Село сдано' });
      items.push({ kind: 'dot', color: '#94a3b8', label: 'Село ждёт фронт' });
    }
    out.push({ title: 'Площади', items });
  }

  return out;
}

export interface PointCluster<T> {
  lat: number;
  lon: number;
  items: T[];
}

/**
 * Скучивание точек.
 *
 * В рабочем файле объектов больше тысячи. На общем плане области они
 * превращаются в сплошное пятно, по которому нельзя ни попасть мышью,
 * ни что-то понять, — а карта при этом честно рисует тысячу значков и
 * тормозит. Поэтому близкие собираем в один значок с числом.
 *
 * Размер ячейки задаётся в пикселях экрана, а не в метрах: слипаются
 * точки именно на экране, и на разном приближении это разные метры.
 */
export function clusterPoints<T extends { lat: number; lon: number }>(
  items: T[],
  cellPx: number,
  metersPerPixel: number,
): PointCluster<T>[] {
  const cellM = Math.max(1, cellPx * metersPerPixel);
  const dLat = (cellM / R) * (180 / Math.PI);

  const cells = new Map<string, T[]>();
  for (const it of items) {
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lon)) continue;
    const cos = Math.max(0.05, Math.cos(rad(it.lat)));
    const dLon = dLat / cos;
    const key = `${Math.floor(it.lat / dLat)}_${Math.floor(it.lon / dLon)}`;
    const list = cells.get(key);
    if (list) list.push(it); else cells.set(key, [it]);
  }

  const out: PointCluster<T>[] = [];
  for (const list of cells.values()) {
    // Значок ставим в середину группы, а не в угол ячейки: иначе на
    // границе сетки он окажется в стороне от самих точек.
    let lat = 0;
    let lon = 0;
    for (const it of list) { lat += it.lat; lon += it.lon; }
    out.push({ lat: lat / list.length, lon: lon / list.length, items: list });
  }
  return out;
}

export interface ScaleBar {
  /** Круглое число метров, которое показываем. */
  meters: number;
  /** Сколько это пикселей на экране. */
  px: number;
  label: string;
}

/**
 * Масштабная линейка: круглое число, а не «847 м».
 *
 * Берём самое крупное из 1-2-5 на порядок, которое влезает в отведённую
 * ширину. Так линейка одинаково читается и на области, и на селе.
 */
export function scaleBar(metersPerPixel: number, maxPx: number): ScaleBar {
  const maxMeters = Math.max(1, metersPerPixel * maxPx);
  const pow = 10 ** Math.floor(Math.log10(maxMeters));
  const steps = [5, 2, 1];
  let meters = pow;
  for (const s of steps) {
    if (s * pow <= maxMeters) { meters = s * pow; break; }
  }
  if (meters > maxMeters) meters = pow / 2;
  return {
    meters,
    px: Math.round(meters / metersPerPixel),
    label: formatMeters(meters),
  };
}
