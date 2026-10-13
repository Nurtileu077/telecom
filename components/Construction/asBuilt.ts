import { localDay } from '@/lib/localDay';
import type { SiteObject, PlanRoute, Deviation } from '@/types/construction';
import { SITE_OBJECT_SPECS } from '@/types/construction';
import { esc, ACT_DOC_CSS, fmtDate } from './actDocument';
import { nearestOnRoute } from './measureTool';
import { routeLengthM } from './routeProgress';
import { formatMeters } from './mapDecor';
import { term, type Bilingual, type TermPair } from './bilingual';
import { routeEnds, placeTokens } from './routeStyle';
import { sectionMatchesRoute } from './routeSection';
import {
  placeDeviations, factLine, projectLine, lengthWithDeviations, deviationProtocol,
  deviationTitle, type SchemeMode, type PlacedDeviation,
} from './schemeDeviations';
import { ellipsoidM } from '@/lib/geodesy';

/**
 * Исполнительная схема.
 *
 * Её рисуют в AutoCAD по фотографиям и записям — неделю на участок. А
 * всё, что на ней должно быть, уже записано: трасса из KML, муфты и ККС
 * с координатами, длины между ними считаются.
 *
 * Схема не карта: на ней важен не масштаб местности, а порядок и
 * расстояния. Поэтому рисуем линейку — трассу, вытянутую в прямую, с
 * отметками на своих местах. Так её и читают: «от АТС 420 метров до
 * первой муфты, дальше 1 240 до ККС».
 */

export interface SchemeMark {
  /** Метры от начала трассы. */
  atM: number;
  label: string;
  /**
   * `devFrom` / `devTo` — где обход ушёл с проекта и где вернулся: с них
   * отклонение и читают на листе.
   */
  kind: 'endpoint' | 'mufta' | 'kks' | 'stolb' | 'start' | 'end' | 'devFrom' | 'devTo';
  /** Номер отклонения — у отметок его концов. */
  dev?: number;
  /**
   * Насколько отметка отстоит от линии — её сняли не на самой трассе.
   * Есть только тогда, когда смещение больше погрешности телефона и его
   * надо показать на листе.
   */
  offsetM?: number;
  /**
   * Метры по схеме: сумма пролётов до этой отметки.
   *
   * Совпадает с `atM`, пока пролёты считаются по координатам. Где пролёт
   * померили на объекте, отметка встаёт по замеру: иначе под муфтой
   * стояло бы «1,66 км», а под пролётом к ней — «2 000 м», и лист спорил
   * бы сам с собой.
   */
  chainM: number;
  /**
   * Пролёт по замеру на объекте — из карточки: от предыдущей муфты, ККС,
   * столба или начала трассы. Концы отклонения в счёт не идут: их ставит
   * схема, а на земле от них никто не мерил.
   */
  spanM?: number;
  /** Чем мерили этот пролёт. */
  spanBy?: string;
}

/**
 * Насколько замер может разойтись с координатами без вопросов.
 *
 * Две точки телефона дают до 50 м, а кабель по метке длиннее линии на
 * изгибы и запасы — на несколько процентов. Сверх этого расхождение
 * значит, что неверна запись или точка, и это надо увидеть до подписи.
 */
export function spanTolerance(measuredM: number): number {
  return Math.max(50, measuredM * 0.05);
}

/**
 * С какого смещения объект называем «в стороне».
 *
 * Телефон в поле даёт точку с погрешностью до 25 м: ближе — это шум
 * приёмника, и подписывать каждую муфту «в 12 м от оси» значит залить
 * схему оговорками, которые ничего не говорят. Дальше — это уже место:
 * муфту поставили у дороги, а не на трассе, или точку сняли не там.
 */
export const OFFSET_NOTE_M = 25;

export interface Scheme {
  route: string;
  totalM: number;
  marks: SchemeMark[];
  /**
   * Расстояния между соседними отметками.
   *
   * Номера отметок хранятся рядом с длиной нарочно. Пролёты короче
   * метра мы пропускаем — две отметки в одной точке пролётом не
   * считаются, — и после первого же пропуска порядковый номер пролёта
   * перестаёт совпадать с номером отметки. Рисунок, который считал бы
   * их равными, подписал бы длины на пролёт левее.
   */
  spans: {
    from: string; to: string; meters: number; fromIndex: number; toIndex: number;
    /**
     * Один из концов снят в стороне от линии: длина посчитана по его
     * проекции на трассу и верна не точнее этого смещения. В ведомости
     * такой пролёт идёт со знаком «≈», а не с точностью до метра. Так
     * же идёт и часть замера (`partOf`): где на нём ушли с проекта,
     * известно только по координатам.
     */
    approx?: boolean;
    /**
     * Пролёт померили на объекте: длина взята из карточки, а не из
     * координат. Координатная длина остаётся рядом для сверки.
     */
    measured?: { by?: string; mapM: number };
    /**
     * Часть замера, через который прошёл конец отклонения.
     *
     * Пролёт «Муфта №4 — Муфта №5» меряли на земле целиком, а отметку
     * начала отклонения посреди него ставит схема. Весь замер на кусок
     * «Начало отклонения — Муфта №5» не повесишь: лист назвал бы его
     * длиной 1 000 м там, где 500, и сумма пролётов выросла бы на
     * столько же. Замер делится между кусками по координатам — вместе
     * они дают замер; обход целиком, если он внутри, идёт длиной из
     * протокола. Расхождение замера с координатами — на последнем куске.
     */
    partOf?: { from: string; to: string; meters: number; by?: string; mapM: number };
    /** Замер и координаты расходятся больше, чем объясняет погрешность. */
    mismatch?: boolean;
    /** Пролёт лежит внутри отклонения с этим номером. */
    dev?: number;
  }[];
  /**
   * Вид схемы: по факту или по проекту с отмеченными отклонениями.
   * Без отклонений они совпадают.
   */
  mode: SchemeMode;
  /** Длина проектной линии. */
  projectM: number;
  /** Длина с отклонениями: проект, где обход заменил кусок, — длиной обхода. */
  factM: number;
  /** Отклонения, легшие на линию, — для таблицы под схемой. */
  deviations: SchemeDeviation[];
  /** Отклонения участка, которые на линию не легли, — с причиной. */
  deviationsUnplaced: string[];
  /**
   * Отклонения других участков на самой линии. Как и чужие объекты, в
   * лист не идут, но и пропадать молча не должны.
   */
  deviationsForeign: string[];
  /** Сумма пролётов: с замерами она может отличаться от длины линии. */
  chainTotalM: number;
  /** Объекты, которые к трассе не отнеслись: слишком далеко. */
  skipped: string[];
  /**
   * Объекты без участка, стоящие у самой линии.
   *
   * Чьи они — не знаем: могут быть наши, могут быть соседей. Молча
   * взять их — значит однажды подписать чужую муфту, молча выбросить —
   * потерять свою. Называем и просим указать участок.
   */
  unassigned: string[];
  /** Какой участок им указать — тот, с которым они попадут в эту схему. */
  section?: string;
  /**
   * Объекты других участков, стоящие на самой линии: «Муфта 7 (участок
   * «Акбейт»)». В схему не идут — это может быть стык с соседом, — но и
   * пропадать молча не должны: опечатка в участке иначе выглядит как
   * «объектов нет». Только для экрана, в лист заказчику не пишутся.
   */
  foreign: string[];
}

/** Отклонение в таблице под схемой. */
export interface SchemeDeviation {
  n: number;
  from: string;
  to: string;
  /** Сколько проекта заменил обход. */
  projectM: number;
  /** Длина обхода — по карточке и протоколу. */
  factM: number;
  reason: string;
  /** «протокол МГ №14 от 12.09.2026» или «протокол МГ не оформлен». */
  protocol: string;
  /** Протокол оформлен: без него отклонение не согласовано. */
  closed: boolean;
}

export interface SchemeOptions {
  /** Дальше этого от линии объект к ней не относится. */
  maxOffsetM?: number;
  from?: string;
  to?: string;
  /** Объекты без участка: в схему не берём, но называем те, что у линии. */
  unassigned?: SiteObject[];
  /** Участок, который подсказать объектам без участка (`sectionForRoute`). */
  section?: string;
  /** Объекты других участков: называем те, что стоят на самой линии. */
  others?: SiteObject[];
  /**
   * Сёла журнала (`placeNames`): по ним узнаём концы в названии трассы.
   * Те же, что у карты, — иначе одно название разберётся по-разному.
   */
  places?: Set<string>;
  /** Отклонения по трассе этого участка (`schemeDeviationsFor(...).own`). */
  deviations?: Deviation[];
  /** Отклонения по трассе других участков: называем те, что лежат на линии. */
  otherDeviations?: Deviation[];
  /** По факту (по умолчанию) или по проекту с отмеченными отклонениями. */
  mode?: SchemeMode;
}

/**
 * Какие объекты идут в схему трассы.
 *
 * Только своего участка, и узнаём его тем же правилом, по которому смены
 * участка находят свою трассу: участок объекта сверяется с участком,
 * папкой и именем трассы (`sectionMatchesRoute`). Раньше сверяли точным
 * совпадением с участком или именем, и муфта «Акбеит» на трассе «ОМ —
 * Акбеит» без папки не попадала ни в свои, ни в «без участка» — молча
 * пропадала из схемы, а лист писал «Объектов участка в журнале нет».
 *
 * Чужие по-прежнему не берём: участок без своих объектов когда-то
 * получал в схему все объекты журнала, и заказчик подписывал отметки
 * соседнего села.
 */
export function schemeObjectsFor(
  objects: SiteObject[],
  route: Pick<PlanRoute, 'name' | 'uchastok' | 'folder'> | null | undefined,
): { own: SiteObject[]; unassigned: SiteObject[]; others: SiteObject[] } {
  const own: SiteObject[] = [];
  const unassigned: SiteObject[] = [];
  const others: SiteObject[] = [];
  for (const o of objects) {
    if (placeTokens(o.uchastok).length === 0) unassigned.push(o);
    else if (route && sectionMatchesRoute(o.uchastok, route)) own.push(o);
    else others.push(o);
  }
  return { own, unassigned, others };
}

/**
 * Собрать схему из трассы и объектов.
 *
 * Объект, снятый в стороне от линии, — это либо не наш объект, либо
 * ошибка координат. Молча притягивать его к трассе нельзя: в схеме
 * появится отметка там, где её нет. Называем такие отдельно.
 */
export function buildScheme(
  route: PlanRoute,
  objects: SiteObject[],
  opts: SchemeOptions = {},
): Scheme {
  const maxOffset = opts.maxOffsetM ?? 120;
  const mode: SchemeMode = opts.mode ?? 'fact';
  // Одна мерка на весь лист: длина линии, места отметок и обходы. Смешай
  // их — и сумма пролётов разойдётся с протяжённостью на те же 0,3 %.
  //
  // Мерка — эллипсоид WGS-84 у любого листа, какой бы датой он ни был.
  // Шар «листам до перехода» решали по дате, а дата в руках — это день
  // последней записи журнала или дата акта, а не день выдачи листа: лист
  // к сентябрьскому акту, собранный впервые в октябре, навсегда уходил
  // на шар, и «Протяжённость» оставалась на 38 м из 12 км короче.
  // Беречь же было нечего: заказчик ответил, что системой ещё не
  // работают, — подписанных ею листов нет.
  const metric = ellipsoidM;
  const projectM = routeLengthM(route.coords, metric);

  // Отклонения кладём на проект, а потом решаем, вдоль какой линии
  // ставить отметки: по факту — вдоль обхода, по проекту — вдоль проекта.
  const layout = placeDeviations(route.coords, opts.deviations ?? [], maxOffset, metric);
  const line = mode === 'fact' && layout.placed.length > 0
    ? factLine(route.coords, layout.placed, metric)
    : projectLine(route.coords, layout.placed, metric);
  const totalM = line.totalM;

  const marks: SchemeMark[] = [];
  const skipped: string[] = [];

  for (const o of objects) {
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
    const hit = nearestOnRoute({ lat: o.lat, lon: o.lon }, line.coords, metric);
    if (!hit) continue;
    if (hit.deviationM > maxOffset) {
      skipped.push(`${o.name || SITE_OBJECT_SPECS[o.kind].label} (${Math.round(hit.deviationM)} м в стороне)`);
      continue;
    }
    const atM = line.toScheme(hit.atM);
    marks.push({
      atM,
      chainM: atM,
      label: o.name || SITE_OBJECT_SPECS[o.kind].label,
      kind: o.kind,
      offsetM: hit.deviationM > OFFSET_NOTE_M ? hit.deviationM : undefined,
      spanM: o.spanM !== undefined && Number.isFinite(o.spanM) && o.spanM > 0 ? o.spanM : undefined,
      spanBy: o.spanM ? o.spanBy?.trim() || undefined : undefined,
    });
  }

  const unassigned: string[] = [];
  for (const o of opts.unassigned ?? []) {
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
    const hit = nearestOnRoute({ lat: o.lat, lon: o.lon }, line.coords, metric);
    if (!hit || hit.deviationM > maxOffset) continue;
    unassigned.push(o.name || SITE_OBJECT_SPECS[o.kind].label);
  }

  // Чужие — только те, что на самой линии, в пределах погрешности
  // телефона: дальше это соседняя трасса, и перечислять её муфты — шум.
  const foreign: string[] = [];
  for (const o of opts.others ?? []) {
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
    const hit = nearestOnRoute({ lat: o.lat, lon: o.lon }, line.coords, metric);
    if (!hit || hit.deviationM > OFFSET_NOTE_M) continue;
    foreign.push(`${o.name || SITE_OBJECT_SPECS[o.kind].label} (участок «${(o.uchastok ?? '').trim()}»)`);
  }

  // Отклонение чужого участка на самой линии: оба конца на трассе. Так
  // выглядит обход, записанный с опечаткой в участке, — без строки на
  // экране он молча не попал бы ни в факт, ни в таблицу.
  const deviationsForeign: string[] = [];
  for (const d of opts.otherDeviations ?? []) {
    const pts = (d.coords ?? []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
    if (pts.length < 2) continue;
    const ends = [pts[0], pts[pts.length - 1]].map((p) => nearestOnRoute(p, route.coords, metric));
    if (ends.some((h) => !h || h.deviationM > OFFSET_NOTE_M)) continue;
    deviationsForeign.push(`${deviationTitle(d)} (участок «${(d.uchastok ?? '').trim()}»)`);
  }

  // Концы трассы — всегда отметки: с них схему и читают. Подписи — те
  // же, что у концов линии на карте. Раньше схема резала название по
  // тире сама: карта и лист называли концы «ОМ — Акбеит» по-разному, а
  // «Кызыл-Жар» превращался в конец «Жар».
  const ends = routeEnds(route, opts.places ?? new Set());
  const startLabel = opts.from || ends.from || 'Начало';
  const endLabel = opts.to || ends.to || 'Конец';
  marks.push({ atM: 0, chainM: 0, label: startLabel, kind: 'start' });
  marks.push({ atM: totalM, chainM: totalM, label: endLabel, kind: 'end' });

  // Концы отклонения — тоже отметки: где ушли с проекта и где вернулись.
  // Подпись — ориентир из карточки отклонения («ПК 12+40», «у моста»),
  // если его вписали; номер — чтобы найти строку в таблице под схемой.
  const many = layout.placed.length > 1;
  const byN = new Map(layout.placed.map((p) => [p.n, p]));
  for (const span of line.deviations) {
    const p = byN.get(span.n);
    if (!p) continue;
    const suffix = many ? ` ${p.n}` : '';
    marks.push({
      atM: span.fromM, chainM: span.fromM, kind: 'devFrom', dev: p.n,
      label: p.dev.fromPoint?.trim() || `Начало отклонения${suffix}`,
    });
    marks.push({
      atM: span.toM, chainM: span.toM, kind: 'devTo', dev: p.n,
      label: p.dev.toPoint?.trim() || `Конец отклонения${suffix}`,
    });
  }

  // Порядок при равных метрах: начало трассы — первым, конец — последним,
  // а начало отклонения раньше объектов в той же точке, конец — позже:
  // иначе пролёт обхода начался бы не с той отметки.
  const tie: Record<SchemeMark['kind'], number> = {
    start: 0, devFrom: 1, endpoint: 2, mufta: 2, kks: 2, stolb: 2, devTo: 3, end: 4,
  };
  marks.sort((a, b) => a.atM - b.atM || tie[a.kind] - tie[b.kind]);

  /**
   * Пролёты.
   *
   * Записанный в карточке пролёт — это «от предыдущей отметки схемы до
   * этого объекта»: от соседней муфты, ККС или начала трассы, считая в
   * ту сторону, куда идёт трасса. Такой пролёт меряли на земле — метками
   * трубы или кабеля, — и он точнее разницы двух точек телефона, каждая
   * из которых ±25 м. Поэтому в ведомость идёт он, а координатная длина
   * остаётся рядом — для сверки.
   */
  // Внутри какого отклонения лежит пролёт: в ведомости это видно сразу,
  // а не только по рисунку, которого в Word-версии нет.
  const devOf = (a: SchemeMark, b: SchemeMark): number | undefined => line.deviations
    .find((d) => a.atM >= d.fromM - 0.01 && b.atM <= d.toM + 0.01)?.n;

  const split = splitMeasuredSpans(marks, new Map(layout.placed.map((p) => [p.n, p.factM])));

  const spans: Scheme['spans'] = [];
  for (let i = 1; i < marks.length; i += 1) {
    const mapM = marks[i].atM - marks[i - 1].atM;
    const measuredM = marks[i].spanM;
    const dev = devOf(marks[i - 1], marks[i]);
    const piece = split.get(i);
    if (piece) {
      // Кусок замера: пустяковый в ведомость не идёт, но последний —
      // всегда, на нём расхождение замера с координатами.
      if (piece.part ? piece.meters >= 1 || piece.last : piece.meters >= 1) {
        spans.push({
          from: marks[i - 1].label,
          to: marks[i].label,
          meters: piece.meters,
          fromIndex: i - 1,
          toIndex: i,
          approx: piece.part ? true : undefined,
          partOf: piece.part,
          mismatch: piece.last && piece.mismatch ? true : undefined,
          dev,
        });
      }
    } else if (measuredM !== undefined) {
      spans.push({
        from: marks[i - 1].label,
        to: marks[i].label,
        meters: measuredM,
        fromIndex: i - 1,
        toIndex: i,
        measured: { by: marks[i].spanBy, mapM },
        mismatch: Math.abs(measuredM - mapM) > spanTolerance(measuredM) ? true : undefined,
        dev,
      });
    } else if (mapM >= 1) {
      spans.push({
        from: marks[i - 1].label,
        to: marks[i].label,
        meters: mapM,
        fromIndex: i - 1,
        toIndex: i,
        approx: marks[i - 1].offsetM !== undefined || marks[i].offsetM !== undefined
          ? true : undefined,
        dev,
      });
    }
    // Отметка встаёт по сумме пролётов до неё: с замером — по замеру.
    const span = spans[spans.length - 1];
    marks[i].chainM = marks[i - 1].chainM
      + (piece ? piece.meters : span && span.toIndex === i ? span.meters : Math.max(0, mapM));
  }

  const chainTotalM = marks.length ? marks[marks.length - 1].chainM : 0;
  const labels = new Map<number, { from: string; to: string }>();
  for (const m of marks) {
    if (m.dev === undefined) continue;
    const cur = labels.get(m.dev) ?? { from: '', to: '' };
    if (m.kind === 'devFrom') cur.from = m.label;
    if (m.kind === 'devTo') cur.to = m.label;
    labels.set(m.dev, cur);
  }
  return {
    route: route.name, totalM, marks, spans, chainTotalM, skipped, unassigned, foreign,
    section: opts.section?.trim() || undefined,
    mode,
    projectM,
    factM: lengthWithDeviations(projectM, layout.placed),
    deviations: layout.placed.map((p) => schemeDeviation(p, labels.get(p.n))),
    deviationsUnplaced: layout.unplaced,
    deviationsForeign,
  };
}

interface MeasuredPiece {
  meters: number;
  /** Нет — это обход целиком: его длина своя, не из замера. */
  part?: NonNullable<Scheme['spans'][number]['partOf']>;
  last?: boolean;
  mismatch?: boolean;
}

const isDevEnd = (m: SchemeMark) => m.kind === 'devFrom' || m.kind === 'devTo';

/**
 * Замеры, через которые прошёл конец отклонения, — по кускам.
 *
 * Ключ — номер отметки, которой кусок кончается. Замер отсчитывается от
 * предыдущей настоящей отметки (объекта или начала трассы). Обход,
 * лежащий внутри замера целиком, берёт свою длину из протокола — это
 * тоже замер, мобильной группы, — а остаток делится между прочими
 * кусками по их длине по координатам. По проекту обход на листе
 * проектный, но с земли из замера вычитается всё равно фактический.
 */
function splitMeasuredSpans(marks: SchemeMark[], devGroundM: Map<number, number>): Map<number, MeasuredPiece> {
  const out = new Map<number, MeasuredPiece>();
  for (let i = 1; i < marks.length; i += 1) {
    const q = marks[i];
    if (q.spanM === undefined || isDevEnd(q)) continue;
    let j = i - 1;
    while (j > 0 && isDevEnd(marks[j])) j -= 1;
    if (j === i - 1) continue;

    const pieces: { k: number; mapM: number; groundM?: number }[] = [];
    for (let k = j + 1; k <= i; k += 1) {
      const a = marks[k - 1];
      const b = marks[k];
      const whole = a.kind === 'devFrom' && b.kind === 'devTo' && a.dev === b.dev
        && a.dev !== undefined && devGroundM.has(a.dev);
      pieces.push({
        k,
        mapM: Math.max(0, b.atM - a.atM),
        groundM: whole ? devGroundM.get(a.dev!) : undefined,
      });
    }
    const meters = splitMeasured(q.spanM, pieces);
    const groundMapM = pieces.reduce((sum, p) => sum + (p.groundM ?? p.mapM), 0);
    const part = { from: marks[j].label, to: q.label, meters: q.spanM, by: q.spanBy, mapM: groundMapM };
    const mismatch = Math.abs(q.spanM - groundMapM) > spanTolerance(q.spanM);
    pieces.forEach((p, n) => out.set(p.k, p.groundM !== undefined
      ? { meters: meters[n] }
      : { meters: meters[n], part, last: p.k === i, mismatch }));
  }
  return out;
}

/**
 * Разделить замер между кусками.
 *
 * Куски с `groundM` (обход целиком) остаются своей длиной на листе и
 * забирают из замера `groundM`; остаток — прочим кускам по доле их
 * длины по координатам. Последний кусок всегда без `groundM`: он
 * кончается объектом, а не концом обхода.
 */
export function splitMeasured(
  measuredM: number,
  pieces: { mapM: number; groundM?: number }[],
): number[] {
  const fixed = pieces.reduce((s, p) => s + (p.groundM ?? 0), 0);
  const free = pieces.filter((p) => p.groundM === undefined);
  const rest = Math.max(0, measuredM - fixed);
  const weight = free.reduce((s, p) => s + p.mapM, 0);
  return pieces.map((p) => {
    if (p.groundM !== undefined) return p.mapM;
    return weight > 0 ? (rest * p.mapM) / weight : rest / free.length;
  });
}

function schemeDeviation(
  p: PlacedDeviation,
  label: { from: string; to: string } | undefined,
): SchemeDeviation {
  return {
    n: p.n,
    from: label?.from || p.dev.fromPoint?.trim() || 'начало',
    to: label?.to || p.dev.toPoint?.trim() || 'конец',
    projectM: p.projectM,
    factM: p.factM,
    reason: p.dev.reason?.trim() || '',
    protocol: deviationProtocol(p.dev),
    closed: !!p.dev.protocol?.number?.trim(),
  };
}

/**
 * Оговорка про объекты без участка — с тем участком, который им указать.
 *
 * «Укажите у них участок» без названия отправляло человека гадать, и
 * угаданное («Акбеит» вместо имени трассы) объект в схему не возвращало.
 */
export function unassignedNote(s: Pick<Scheme, 'unassigned' | 'section'>): string {
  return `У линии есть объекты без участка: ${s.unassigned.join('; ')}. В схему не взяты — `
    + `укажите у них участок${s.section ? ` «${s.section}»` : ''}.`;
}

/**
 * Пролёты по замеру, которые спорят с координатами.
 *
 * Разделённый концом отклонения замер называется целиком — от муфты до
 * муфты, как его меряли: сверять человеку запись в карточке, а не кусок,
 * которого на земле нет.
 */
export function spanMismatches(s: Scheme): string[] {
  const out: string[] = [];
  for (const sp of s.spans) {
    if (!sp.mismatch) continue;
    const whole = sp.partOf
      ?? (sp.measured ? { from: sp.from, to: sp.to, meters: sp.meters, mapM: sp.measured.mapM } : null);
    if (!whole) continue;
    out.push(`${whole.from} — ${whole.to}: замер ${Math.round(whole.meters).toLocaleString('ru')} м, `
      + `по координатам ${Math.round(whole.mapM).toLocaleString('ru')} м`);
  }
  return out;
}

/** Сколько пролётов из карточек объектов пошло в схему — целых или по кускам. */
export function measuredCount(s: Pick<Scheme, 'marks'>): number {
  return objectMarks(s).filter((m) => m.spanM !== undefined).length;
}

/**
 * Подпись строки ведомости: откуда и куда, чем мерили, если мерили, и
 * в каком отклонении лежит пролёт.
 */
function spanLabel(sp: Scheme['spans'][number], s: Pick<Scheme, 'mode'>): string {
  const base = `${esc(sp.from)} — ${esc(sp.to)}`;
  const notes: string[] = [];
  if (sp.measured) notes.push(`замер${sp.measured.by ? `: ${esc(sp.measured.by)}` : ''}`);
  if (sp.partOf) {
    notes.push(`часть замера ${esc(sp.partOf.from)} — ${esc(sp.partOf.to)}, `
      + `${Math.round(sp.partOf.meters).toLocaleString('ru')} м${sp.partOf.by ? `: ${esc(sp.partOf.by)}` : ''}`);
  }
  if (sp.dev !== undefined) {
    // По проекту пролёт внутри отклонения — проектный: так и подписываем,
    // иначе его длину примут за фактическую.
    notes.push(s.mode === 'fact' ? `обход, отклонение №${sp.dev}` : `по проекту, отклонение №${sp.dev}`);
  }
  return notes.length ? `${base} <span class="cap">(${notes.join('; ')})</span>` : base;
}

/** Есть ли у схемы своё про отклонения — иначе вид схемы и не упоминаем. */
function hasDeviations(s: Pick<Scheme, 'deviations' | 'deviationsUnplaced'>): boolean {
  return s.deviations.length + s.deviationsUnplaced.length > 0;
}

/** Отметки объектов — без концов трассы и концов отклонений. */
export function objectMarks(s: Pick<Scheme, 'marks'>): SchemeMark[] {
  return s.marks.filter((m) => m.kind !== 'start' && m.kind !== 'end'
    && m.kind !== 'devFrom' && m.kind !== 'devTo');
}

/**
 * «Протяжённость» листа.
 *
 * Длина линии и сумма пролётов с замерами — разные числа, и оба верны
 * по-своему. Пишем оба с подписью, откуда каждое, а не выбираем молча.
 * С отклонениями чисел три: по проекту, по факту и по замерам, — и
 * каждое подписано, чтобы ни одно не приняли за другое.
 */
function lengthLine(s: Scheme): string {
  const devs = s.deviations.length > 0;
  const head = !devs ? 'Протяжённость' : s.mode === 'fact' ? 'Протяжённость по факту' : 'Протяжённость по проекту';
  const base = `${head}: <span class="b">${esc(formatMeters(s.totalM))}</span>`;
  const byChain = Math.abs(s.chainTotalM - s.totalM) >= 1
    ? ` по трассе, <span class="b">${esc(formatMeters(s.chainTotalM))}</span> по пролётам с замерами`
    : '';
  const other = !devs ? ''
    : s.mode === 'fact'
      ? `; по проекту — <span class="b">${esc(formatMeters(s.projectM))}</span>`
      : `; по факту, с отклонениями, — <span class="b">${esc(formatMeters(s.factM))}</span>`;
  // Чем мерили — одной строкой: заказчик проверяет длины в своей ГИС, а
  // она считает на эллипсоиде.
  const how = '<p class="cap">Длины по координатам — на эллипсоиде WGS-84.</p>';
  return `<p>${base}${byChain}${other}, отметок на схеме: <span class="b">${s.marks.length}</span>.</p>${how}`;
}

/** «+230 м», «−40 м»: насколько обход длиннее проекта. */
function signedMeters(m: number): string {
  const v = Math.round(m);
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toLocaleString('ru')}`;
}

/**
 * Таблица отклонений.
 *
 * В обоих видах схемы одна и та же: заказчик сверяет схему с
 * протоколами мобильной группы, и каждая строка называет свой протокол
 * или прямо говорит, что его нет. Шапка — только по-русски: казахские
 * названия этих граф не сверены, а машинный перевод в подписываемый
 * документ не ставим.
 */
function deviationsTable(s: Scheme): string {
  if (s.deviations.length === 0) return '';
  const rows = s.deviations.map((d) => '<tr>'
    + `<td class="val">${d.n}</td>`
    + `<td class="lbl">${esc(d.from)} — ${esc(d.to)}${d.reason ? `<br/><span class="cap">${esc(d.reason)}</span>` : ''}</td>`
    + `<td class="val">${Math.round(d.projectM).toLocaleString('ru')}</td>`
    + `<td class="val">${Math.round(d.factM).toLocaleString('ru')}</td>`
    + `<td class="val">${signedMeters(d.factM - d.projectM)}</td>`
    + `<td class="lbl">${esc(d.protocol)}</td>`
    + '</tr>').join('');
  return '<p class="b">Отклонения от проекта</p>'
    + '<table class="act"><tr>'
    + '<td class="val b">№</td><td class="lbl b">Где</td>'
    + '<td class="val b">По проекту, м</td><td class="val b">По факту, м</td>'
    + '<td class="val b">Разница, м</td><td class="lbl b">Протокол</td>'
    + '</tr>' + rows + '</table>';
}

/** Что сказать о виде схемы — одной строкой под названием трассы. */
function modeLine(s: Scheme): string {
  if (!hasDeviations(s)) return '';
  return s.mode === 'fact'
    ? '<p class="cap">Схема по факту: отклонения от проекта — в линии и в длинах.</p>'
    : '<p class="cap">Схема по проекту: длины проектные, отклонения отмечены и сведены в таблицу.</p>';
}

/** Отметки, снятые в стороне от линии: «Муфта №3 — 90 м». */
export function displacedMarks(s: Scheme): string[] {
  return s.marks
    .filter((m) => m.offsetM !== undefined)
    .map((m) => `${m.label} — ${Math.round(m.offsetM!)} м`);
}

/** Длина пролёта в ведомость: приблизительная — со знаком, а не до метра. */
function spanCell(sp: Scheme['spans'][number]): string {
  const v = Math.round(sp.meters).toLocaleString('ru');
  return sp.approx ? `≈ ${v}` : v;
}

/**
 * Оговорки под схемой.
 *
 * Всё, чего на рисунке не видно, а заказчик должен знать до подписи:
 * что стоит не на линии, что не попало, чьё неизвестно.
 */
function schemeNotes(s: Scheme, full: boolean): string {
  const out: string[] = [];
  const open = s.deviations.filter((d) => !d.closed).map((d) => `№${d.n}`);
  if (open.length) {
    out.push(`<p class="warn">Протокол мобильной группы не оформлен: отклонение ${esc(open.join(', '))}. `
      + 'Без протокола отклонение от проекта не согласовано.</p>');
  }
  if (s.deviationsUnplaced.length) {
    out.push(`<p class="warn">Отклонения по трассе, которых нет на схеме: ${esc(s.deviationsUnplaced.join('; '))}. `
      + (s.mode === 'fact'
        ? 'Протяжённость по факту их не учитывает.'
        : 'Длина по факту их не учитывает.')
      + (full ? ' Укажите в карточке отклонения начало и конец на карте.' : '') + '</p>');
  }
  const displaced = displacedMarks(s);
  if (displaced.length) {
    out.push(`<p class="warn">Сняты в стороне от линии: ${esc(displaced.join('; '))}. `
      + 'На схеме они стоят на трассе по проекции, и пролёты к ним (≈) верны не точнее '
      + 'этого смещения. Проверьте координаты или переснимите точку.</p>');
  }
  if (s.skipped.length) {
    out.push(`<p class="warn">Не отнесены к трассе: ${esc(s.skipped.join('; '))}.`
      + (full ? ' Проверьте координаты — на схему они не попали.' : '') + '</p>');
  }
  if (s.unassigned.length) {
    out.push(`<p class="warn">${esc(unassignedNote(s))}</p>`);
  }
  const mismatched = spanMismatches(s);
  if (mismatched.length) {
    out.push(`<p class="warn">Замер и координаты расходятся: ${esc(mismatched.join('; '))}. `
      + 'Проверьте запись в карточке объекта или его точку.</p>');
  }
  if (s.spans.some((sp) => sp.measured || sp.partOf)) {
    out.push('<p class="cap">«Замер» — пролёт по записи в карточке объекта; '
      + 'остальные длины — по координатам вдоль трассы.'
      + (s.spans.some((sp) => sp.partOf)
        ? ' «Часть замера» — замер, через который прошёл конец отклонения: '
          + 'он поделён между кусками по координатам и целиком равен записи в карточке.'
        : '')
      + '</p>');
  }
  if (objectMarks(s).length === 0 && s.skipped.length === 0) {
    out.push('<p>Объектов участка в журнале нет: на схеме только концы трассы.</p>');
  }
  return out.join('');
}

const MARK_STYLE: Record<
  SchemeMark['kind'],
  { fill: string; shape: 'circle' | 'square' | 'house' | 'bar' }
> = {
  start: { fill: '#0f172a', shape: 'house' },
  end: { fill: '#0f172a', shape: 'house' },
  endpoint: { fill: '#0f172a', shape: 'house' },
  mufta: { fill: '#b45309', shape: 'circle' },
  kks: { fill: '#0369a1', shape: 'square' },
  stolb: { fill: '#475569', shape: 'square' },
  // Конец отклонения — поперечная черта через линию: на чёрно-белой
  // распечатке её не спутать ни с муфтой, ни с колодцем.
  devFrom: { fill: '#b91c1c', shape: 'bar' },
  devTo: { fill: '#b91c1c', shape: 'bar' },
};

/**
 * Схема рисунком.
 *
 * Чёрно-белая по сути: её печатают и возят в папке, а цветной принтер
 * на объекте есть не всегда. Цвет здесь — подсказка, а не смысл: форма
 * отметки говорит то же самое.
 */
export function schemeSvg(s: Scheme, width = 1000): string {
  const pad = 70;
  const line = width - pad * 2;
  const y = 130;
  // Округляем: доли пикселя на бумаге не видны, а «672.0000000000001»
  // в разметке — мусор, который читают глазами при разборе.
  // Отметки стоят по метрам схемы, а не по координатам: где пролёт
  // померили, рисунок должен сходиться с подписью под ним.
  const scale = s.chainTotalM;
  const x = (m: number) => Math.round(
    (pad + (scale > 0 ? (m / scale) * line : 0)) * 100,
  ) / 100;

  // Подписи чередуем сверху и снизу: на плотном участке они иначе
  // наезжают друг на друга и не читаются.
  const marks = s.marks.map((m, i) => {
    const style = MARK_STYLE[m.kind];
    const cx = x(m.chainM);
    const up = i % 2 === 0;
    const labelY = up ? y - 26 : y + 38;
    const tickY1 = up ? y - 10 : y + 10;
    const tickY2 = up ? y - 18 : y + 18;

    // Снятая в стороне отметка рисуется пустой: на оси её нет, она
    // лишь спроецирована туда, и на бумаге это должно быть видно без
    // цвета. Рядом — на сколько она в стороне.
    const off = m.offsetM !== undefined;
    const fill = off ? '#ffffff' : style.fill;
    const stroke = off ? style.fill : '#fff';
    const glyph = style.shape === 'circle'
      ? `<circle cx="${cx}" cy="${y}" r="7" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
      : style.shape === 'square'
        ? `<rect x="${cx - 6}" y="${y - 6}" width="12" height="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
        : style.shape === 'bar'
          ? `<rect x="${cx - 2}" y="${y - 10}" width="4" height="20" fill="${fill}"/>`
          : `<path d="M ${cx - 8} ${y + 7} L ${cx - 8} ${y - 2} L ${cx} ${y - 10} L ${cx + 8} ${y - 2} L ${cx + 8} ${y + 7} Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    const offNote = off
      ? `<text x="${cx}" y="${labelY + (up ? -26 : 26)}" text-anchor="middle" font-size="10" fill="#b91c1c">`
        + `в стороне ${Math.round(m.offsetM!)} м</text>`
      : '';

    return `<g>
      <line x1="${cx}" y1="${tickY1}" x2="${cx}" y2="${tickY2}" stroke="#94a3b8" stroke-width="1"/>
      ${glyph}
      <text x="${cx}" y="${labelY}" text-anchor="middle" font-size="12" fill="#0f172a">${esc(m.label)}</text>
      <text x="${cx}" y="${labelY + (up ? -13 : 13)}" text-anchor="middle" font-size="10" fill="#64748b">${esc(formatMeters(m.chainM))}</text>
      ${offNote}
    </g>`;
  }).join('');

  // Длины пролётов — под линией, по центру каждого. Отметки берём по
  // номеру из самого пролёта, а не по его порядку: пропущенные пролёты
  // сдвинули бы все подписи левее.
  const spans = s.spans.map((sp) => {
    const a = s.marks[sp.fromIndex];
    const b = s.marks[sp.toIndex];
    if (!a || !b) return '';
    const cx = (x(a.chainM) + x(b.chainM)) / 2;
    return `<text x="${cx}" y="${y + 20}" text-anchor="middle" font-size="10" fill="#334155">`
      + `${sp.approx ? '≈ ' : ''}${esc(formatMeters(sp.meters))}${
        sp.measured ? ' (замер)' : sp.partOf ? ' (часть замера)' : ''}</text>`;
  }).join('');

  // Отклонения: скобка под линией через весь кусок, с длинами. По факту
  // кусок линии ещё и прерывистый — это обход, а не проект; по проекту
  // линия сплошная, и скобка говорит, что на земле здесь иначе.
  const devX = new Map<number, { a?: number; b?: number }>();
  for (const m of s.marks) {
    if (m.dev === undefined) continue;
    const cur = devX.get(m.dev) ?? {};
    if (m.kind === 'devFrom') cur.a = x(m.chainM);
    if (m.kind === 'devTo') cur.b = x(m.chainM);
    devX.set(m.dev, cur);
  }
  const height = s.deviations.length ? 270 : 230;
  const yb = 205;
  const devs = s.deviations.map((d) => {
    const at = devX.get(d.n);
    if (at?.a === undefined || at.b === undefined) return '';
    const { a, b } = at;
    const text = s.mode === 'fact'
      ? `отклонение №${d.n}: обход ${Math.round(d.factM).toLocaleString('ru')} м вместо ${Math.round(d.projectM).toLocaleString('ru')} м по проекту`
      : `отклонение №${d.n}: по факту ${Math.round(d.factM).toLocaleString('ru')} м, по проекту ${Math.round(d.projectM).toLocaleString('ru')} м`;
    const dashed = s.mode === 'fact'
      ? `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="6,4"/>`
      : '';
    return `<g>${dashed}
      <path d="M ${a} ${yb - 6} L ${a} ${yb} L ${b} ${yb} L ${b} ${yb - 6}" fill="none" stroke="#b91c1c" stroke-width="1"/>
      <text x="${Math.round(((a + b) / 2) * 100) / 100}" y="${yb + 13}" text-anchor="middle" font-size="10" fill="#b91c1c">${esc(text)}</text>
    </g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
    <line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="#0f172a" stroke-width="3"/>
    ${devs}
    ${spans}
    ${marks}
    <text x="${pad}" y="${height - 20}" font-size="11" fill="#64748b">${esc(s.route)} · ${esc(formatMeters(s.totalM))}${
  s.deviations.length ? (s.mode === 'fact' ? ' по факту' : ' по проекту') : ''}${
  Math.abs(s.chainTotalM - s.totalM) >= 1
    ? ` по трассе · ${esc(formatMeters(s.chainTotalM))} по пролётам с замерами` : ''}</text>
  </svg>`;
}

export interface SchemeDocInput {
  scheme: Scheme;
  /** Двуязычный бланк: государственный язык рядом с русским. */
  lang?: Bilingual;
  /** Свои переводы терминов, если словарные поправили. */
  terms?: Partial<Record<string, TermPair>>;
  oblast?: string;
  rayon?: string;
  contractor?: string;
  customer?: string;
  number?: string;
  date?: string;
}

export function schemeDocHtml(i: SchemeDocInput): string {
  const s = i.scheme;
  const t = (key: string) => term(key as never, i.lang ?? 'off', i.terms ?? {});
  const rows = s.spans.map((sp, n) => '<tr>'
    + `<td class="val">${n + 1}</td>`
    + `<td class="lbl">${spanLabel(sp, s)}</td>`
    + `<td class="val">${spanCell(sp)}</td>`
    + '</tr>').join('');

  return `<h1>${esc(t('scheme'))}</h1>`
    + (i.number ? `<p class="center">№ ${esc(i.number)}</p>` : '')
    + `<p class="obj">${esc(s.route)}</p>`
    + modeLine(s)
    + (i.oblast || i.rayon
      ? `<p class="cap">${esc([i.rayon, i.oblast].filter(Boolean).join(', '))}</p>` : '')
    + (i.date ? `<p class="center">${esc(fmtDate(i.date))}</p>` : '')
    + `<div style="margin:10pt 0">${schemeSvg(s)}</div>`
    + lengthLine(s)
    + '<table class="act"><tr>'
    + `<td class="val b">№</td><td class="lbl b">${esc(t('uchastok'))}</td>`
    + `<td class="val b">${esc(t('length'))}</td>`
    + '</tr>' + rows + '</table>'
    + deviationsTable(s)
    + schemeNotes(s, true)
    + '<table class="sign"><tr>'
    + `<td class="s">${esc(t('composed'))}<br/>_______________ / ${esc(i.contractor || '')}</td>`
    + `<td class="s">${esc(t('checked'))}<br/>_______________ / ${esc(i.customer || '')}</td>`
    + '</tr></table>';
}

export function schemeDocPage(i: SchemeDocInput): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><title>Исполнительная схема — ${esc(i.scheme.route)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>@page { size: A4 landscape; margin: 1.2cm; } body { margin: 0; }
${ACT_DOC_CSS}</style></head>
<body class="act-doc">${schemeDocHtml(i)}</body></html>`;
}

/**
 * Схема приложением к акту.
 *
 * Её всё равно прикладывают — просто отдельным файлом, который по
 * дороге теряется: акт дошёл, схема осталась в папке «Загрузки». Кладём
 * её тем же листом, с новой страницы и с надписью, к чему это
 * приложение.
 *
 * Лист остаётся книжным: акт печатают книжным, и разворачивать одну
 * страницу посреди документа значит получить её вверх ногами в
 * скоросшивателе. Схема по ширине листа читается и так.
 */
export function schemeAttachmentHtml(
  i: SchemeDocInput,
  actNumber?: string,
  width = 640,
): string {
  const s = i.scheme;
  const rows = s.spans.map((sp, n) => '<tr>'
    + `<td class="val">${n + 1}</td>`
    + `<td class="lbl">${spanLabel(sp, s)}</td>`
    + `<td class="val">${spanCell(sp)}</td>`
    + '</tr>').join('');

  const t = (key: string) => term(key as never, i.lang ?? 'off', i.terms ?? {});
  return '<div style="page-break-before:always">'
    // «к акту» — падеж, а не слово из словаря: собирать фразу из
    // терминов значит получить «Приложение акт № 14».
    + `<p class="right">${esc(t('attachment'))}`
    + `${actNumber ? ` к акту № ${esc(actNumber)}` : ''}</p>`
    + `<h1>${esc(t('scheme'))}</h1>`
    + `<p class="obj">${esc(s.route)}</p>`
    + modeLine(s)
    + `<div style="margin:8pt 0">${schemeSvg(s, width)}</div>`
    + lengthLine(s)
    + '<table class="act"><tr>'
    + '<td class="val b">№</td><td class="lbl b">Участок</td><td class="val b">Длина, м</td>'
    + '</tr>' + rows + '</table>'
    + deviationsTable(s)
    + schemeNotes(s, false)
    + '</div>';
}

/**
 * Вложить схему в готовый документ.
 *
 * Врезаемся перед закрытием тела: так приложение оказывается внутри
 * того же файла, с теми же стилями и той же нумерацией страниц.
 */
export function withSchemeAttached(
  documentHtml: string,
  i: SchemeDocInput,
  actNumber?: string,
): string {
  const attachment = schemeAttachmentHtml(i, actNumber);
  const close = documentHtml.lastIndexOf('</body>');
  if (close < 0) return documentHtml + attachment;
  return documentHtml.slice(0, close) + attachment + documentHtml.slice(close);
}

export function schemeFileName(route: string, date?: string): string {
  const safe = route.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'трасса';
  return `Исполнительная схема ${safe} ${date || localDay()}.doc`;
}
