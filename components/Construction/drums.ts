import { CableDrum, DailyWorkEntry, AerialWorkEntry } from '@/types/construction';

/**
 * Остаток на барабане.
 *
 * Вопрос у задувщиков всегда один: хватит ли этого барабана до муфты.
 * Отвечает на него остаток, а остаток — это паспортная длина минус то,
 * что с барабана уже задули. Длина написана на щеке, расход пишут в
 * дневном отчёте метками барабана. Значит, вводить остаток не нужно —
 * он считается.
 *
 * Расход больше длины не показываем отрицательным числом: минус означал
 * бы, что кабель ушёл в минус, а на деле либо ошиблись в метке, либо
 * барабан был длиннее паспорта. Это разные вещи, и называть их надо
 * по-разному.
 */

export interface DrumState {
  drum: CableDrum;
  /** Задуто с этого барабана, метры. */
  usedM: number;
  /** Сколько осталось. Не бывает меньше нуля. */
  leftM: number;
  /** Доля израсходованного, 0..1. */
  share: number;
  /** Расход превысил паспортную длину — это повод проверить метки. */
  overrun: number;
  /** Смены, в которые с него задували. */
  days: string[];
}

/** Номер барабана сравниваем без регистра и лишних пробелов. */
function key(v: string): string {
  return v.trim().toLowerCase();
}

export interface DrumContext {
  ground: DailyWorkEntry[];
  aerial: AerialWorkEntry[];
}

/** Расход по номерам барабанов — из меток дневных записей. */
export function drumUsage(ctx: DrumContext): Map<string, { meters: number; days: Set<string> }> {
  const acc = new Map<string, { meters: number; days: Set<string> }>();
  const add = (e: { date?: string; drumMarks?: { coil: string; meters: number }[] }) => {
    for (const m of e.drumMarks ?? []) {
      const k = key(m.coil);
      if (!k || !(m.meters > 0)) continue;
      const rec = acc.get(k) ?? { meters: 0, days: new Set<string>() };
      rec.meters += m.meters;
      if (e.date) rec.days.add(e.date);
      acc.set(k, rec);
    }
  };
  for (const e of ctx.ground) add(e);
  for (const e of ctx.aerial) add(e);
  return acc;
}

export function drumStates(drums: CableDrum[], ctx: DrumContext): DrumState[] {
  const usage = drumUsage(ctx);
  return drums
    .map((drum) => {
      const u = usage.get(key(drum.number));
      const usedM = u?.meters ?? 0;
      const leftM = Math.max(0, drum.lengthM - usedM);
      return {
        drum,
        usedM,
        leftM,
        share: drum.lengthM > 0 ? Math.min(1, usedM / drum.lengthM) : 0,
        overrun: Math.max(0, usedM - drum.lengthM),
        days: [...(u?.days ?? [])].sort(),
      };
    })
    .sort((a, b) => b.leftM - a.leftM || a.drum.number.localeCompare(b.drum.number, 'ru', { numeric: true }));
}

/**
 * Барабаны, которых нет в списке, но метки на них есть.
 *
 * Такое случается: барабан привезли, а завести забыли. Молча считать
 * его несуществующим нельзя — метры с него уже ушли в трассу.
 */
export function unknownDrums(drums: CableDrum[], ctx: DrumContext): { number: string; usedM: number }[] {
  const known = new Set(drums.map((d) => key(d.number)));
  const out: { number: string; usedM: number }[] = [];
  for (const [k, v] of drumUsage(ctx)) {
    if (known.has(k)) continue;
    out.push({ number: k, usedM: v.meters });
  }
  return out.sort((a, b) => b.usedM - a.usedM);
}

/** Сводка по складу кабеля: сколько всего и сколько осталось. */
export function drumTotals(states: DrumState[]): {
  count: number; totalM: number; usedM: number; leftM: number; empty: number;
} {
  let totalM = 0; let usedM = 0; let leftM = 0; let empty = 0;
  for (const s of states) {
    totalM += s.drum.lengthM;
    usedM += s.usedM;
    leftM += s.leftM;
    if (s.leftM === 0) empty += 1;
  }
  return { count: states.length, totalM, usedM, leftM, empty };
}
