import {
  AERIAL_CABLE_TYPES, AERIAL_MATERIAL_KINDS,
  type AerialWorkEntry,
} from '@/types/construction';
import { normName } from './areaImport';

/**
 * Подвес в тех же цифрах, что и подземка.
 *
 * Подвес приходит из Excel прораба (лист «DATA ПОДВЕС») и до сих пор жил
 * только на «Руководству»: там факт — подземка и подвес вместе. Ведомость,
 * отчёт за период и расчёт с подрядчиком считали одну подземку, и у села,
 * которое тянут по опорам, «Руководству» показывало 12 км, а отчёт
 * заказчику — 9. Здесь — то, что нужно всем этим экранам одинаково: сколько
 * подвешено в записи, какие записи входят в выборку и чья запись ничья.
 */

/**
 * Сколько метров подвешено в записи.
 *
 * Итог дня — колонка «Подвес кабеля (км)». Бывает, что прораб заполнил
 * только разбивку по типам кабеля, а итог оставил пустым: тогда итог —
 * сумма разбивки, а не ноль. Когда итог есть, верим ему: его и сверяют с
 * заказчиком.
 */
export function aerialMeters(e: Pick<AerialWorkEntry, 'totalM' | 'byCable'>): number {
  const total = e.totalM ?? 0;
  if (total > 0) return total;
  return cableSum(e);
}

function cableSum(e: Pick<AerialWorkEntry, 'byCable'>): number {
  let s = 0;
  for (const t of AERIAL_CABLE_TYPES) s += e.byCable?.[t] ?? 0;
  return s;
}

export interface AerialFilter {
  from?: string;
  to?: string;
  contractor?: string;
  uchastok?: string;
}

/**
 * Записи подвеса в выборке — тем же правилом, что смены подземки.
 *
 * Запись без даты при заданном периоде не входит: про неё не известно,
 * что она из этого месяца, — так же поступает и ведомость с подземкой.
 */
export function aerialIn(list: AerialWorkEntry[], f: AerialFilter = {}): AerialWorkEntry[] {
  return list.filter((e) => {
    if (f.from && (e.date || '') < f.from) return false;
    if (f.to && (e.date || '') > f.to) return false;
    if (f.contractor && (e.contractor || '') !== f.contractor) return false;
    if (f.uchastok && (e.uchastok || '') !== f.uchastok) return false;
    return true;
  });
}

export interface AerialVolumeRow {
  key: string;
  label: string;
  unit: 'м' | 'шт';
  quantity: number;
}

/**
 * Подвес строками ведомости: метры по типам кабеля и материалы.
 *
 * ОК8 и ОК16 заказчик расценивает по-разному, поэтому тип кабеля — своей
 * строкой, как в листе прораба. Если разбивки нет или она спорит с итогом
 * дня (типы в сумме больше итога), метры дня идут строкой «тип не указан»:
 * разложить их по типам наугад — значит выдумать, сколько какого кабеля
 * повесили. Сумма строк всегда равна подвешенному.
 */
export function aerialVolumeRows(list: AerialWorkEntry[]): {
  cable: AerialVolumeRow[];
  materials: AerialVolumeRow[];
} {
  const byType = new Map<string, number>();
  let untyped = 0;
  let typed = 0;
  const mats = new Map<string, number>();

  for (const e of list) {
    const total = aerialMeters(e);
    const parts = cableSum(e);
    if (parts > 0 && parts <= total) {
      for (const t of AERIAL_CABLE_TYPES) {
        const v = e.byCable?.[t] ?? 0;
        if (v > 0) byType.set(t, (byType.get(t) ?? 0) + v);
      }
      typed += parts;
      untyped += total - parts;
    } else {
      untyped += total;
    }
    for (const m of AERIAL_MATERIAL_KINDS) {
      const v = e.materials?.[m] ?? 0;
      if (v > 0) mats.set(m, (mats.get(m) ?? 0) + v);
    }
  }

  const cable: AerialVolumeRow[] = [];
  for (const t of AERIAL_CABLE_TYPES) {
    const v = byType.get(t) ?? 0;
    if (v > 0) cable.push({ key: `aerial-${t}`, label: `Подвес кабеля ${t}`, unit: 'м', quantity: v });
  }
  if (untyped > 0) {
    cable.push({
      key: 'aerial',
      label: typed > 0 ? 'Подвес кабеля, тип не указан' : 'Подвес кабеля',
      unit: 'м',
      quantity: untyped,
    });
  }

  // Муфта бывает и в подземке, и на опоре — в одной ведомости две строки
  // «Муфта» читаются как задвоение, поэтому у подвесной своё название.
  const materials: AerialVolumeRow[] = [];
  for (const m of AERIAL_MATERIAL_KINDS) {
    const v = mats.get(m) ?? 0;
    if (v > 0) {
      materials.push({
        key: `aerial-mat-${m}`,
        label: m === 'Муфта' ? 'Муфта (подвес)' : m,
        unit: 'шт',
        quantity: v,
      });
    }
  }
  return { cable, materials };
}

/** Подвес без подрядчика на одном участке — что и сколько. */
export interface UnassignedAerial {
  uchastok: string;
  ids: string[];
  meters: number;
  /** Сколько разных дней. */
  days: number;
  from: string;
  to: string;
}

/**
 * Подвес, у которого не записан подрядчик.
 *
 * В листе «DATA ПОДВЕС» колонки подрядчика нет, и всё, что пришло из
 * Excel, ничьё. Ничьё в расчёт с подрядчиком не попадает: решать за
 * человека, чья это бригада, по области или по соседней смене — значит
 * выдумать, кому платить. Поэтому такие записи называем по участкам, а
 * подрядчика им назначает человек.
 */
export function unassignedAerial(
  list: AerialWorkEntry[],
  f: Omit<AerialFilter, 'contractor'> = {},
): UnassignedAerial[] {
  const acc = new Map<string, UnassignedAerial & { dates: Set<string> }>();
  for (const e of aerialIn(list, f)) {
    if (e.contractor?.trim()) continue;
    const shown = e.uchastok?.trim() || 'Участок не указан';
    const key = normName(shown) || shown;
    const g = acc.get(key)
      ?? { uchastok: shown, ids: [], meters: 0, days: 0, from: '', to: '', dates: new Set<string>() };
    g.ids.push(e.id);
    g.meters += aerialMeters(e);
    if (e.date) {
      g.dates.add(e.date);
      if (!g.from || e.date < g.from) g.from = e.date;
      if (!g.to || e.date > g.to) g.to = e.date;
    }
    acc.set(key, g);
  }
  return [...acc.values()]
    .map(({ dates, ...g }) => ({ ...g, days: dates.size }))
    .sort((a, b) => b.meters - a.meters || a.uchastok.localeCompare(b.uchastok, 'ru'));
}
