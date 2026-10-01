import type { Contractor, DailyWorkEntry, Deviation } from '@/types/construction';
import { documentContractor } from './journalStore';
import {
  computeSectionAct, entriesOfSection, deviationsOfSection, DEFAULT_ACT_MANUAL,
  type SectionActManual, type SectionActTotals,
} from './sectionAct';
import type { ActDocInput, ActKind } from './actDocument';

/**
 * Что входит в акт по участку — одно на все места, где акт собирают.
 *
 * Акт по участку рождался в двух местах: в «Закрытии» и в «Пакете одним
 * архивом», и каждое собирало его по-своему. Пакет брал отклонения всего
 * журнала, и АСР по Еленовке выходил с листами про скалу в соседнем
 * селе, а метры этих отклонений вычитались из основного акта. Исполнитель
 * в пакете оставался прочерком, потому что подрядчика туда никто не
 * передавал. Заказчик получал два разных акта на один участок — и
 * спрашивал, какой подписывать.
 *
 * Теперь участок, его смены, его отклонения, поля бланка и исполнитель
 * определяются здесь, и оба экрана берут их отсюда.
 */

export interface SectionActSource {
  ground: DailyWorkEntry[];
  deviations: Deviation[];
  actFields?: Record<string, SectionActManual>;
  contractors: Contractor[];
}

export interface SectionActPrep {
  uchastok: string;
  entries: DailyWorkEntry[];
  /** Только отклонения этого участка — чужие в акт не идут. */
  deviations: Deviation[];
  totals: SectionActTotals;
  /** Поля бланка: постоянные строки плюс то, что заполнили при закрытии. */
  fields: SectionActManual;
  /** Кто фактически вёл работы. */
  performer: string;
  /** От чьего имени сдаются работы — по цепочке субподряда. */
  contractor?: string;
  oblast?: string;
  rayon?: string;
}

/**
 * Поля бланка участка.
 *
 * Ключ участка в журнале и в полях акта может отличаться регистром или
 * пробелом: «Еленовка» и «еленовка » — один участок. Ищем нестрого,
 * иначе пакет решит, что полей нет, и пропустит готовый акт.
 */
export function actFieldsOf(
  all: Record<string, SectionActManual> | undefined,
  uchastok: string,
): SectionActManual | undefined {
  if (!all) return undefined;
  if (all[uchastok]) return all[uchastok];
  const key = uchastok.trim().toLowerCase();
  const found = Object.keys(all).find((k) => k.trim().toLowerCase() === key);
  return found ? all[found] : undefined;
}

export function prepareSectionAct(src: SectionActSource, uchastok: string): SectionActPrep {
  const entries = entriesOfSection(src.ground, uchastok);
  const deviations = deviationsOfSection(src.deviations, uchastok);
  const totals = computeSectionAct(entries, deviations);
  const fields: SectionActManual = {
    ...DEFAULT_ACT_MANUAL,
    ...(actFieldsOf(src.actFields, uchastok) ?? {}),
  };
  const first = entries[0];
  const performer = totals.performers[0] ?? first?.contractor ?? '';
  const doc = performer ? documentContractor(src.contractors, performer) : undefined;
  return {
    uchastok,
    entries,
    deviations,
    totals,
    fields,
    performer,
    contractor: doc?.fullName ?? doc?.name,
    oblast: first?.oblast,
    rayon: first?.rayon,
  };
}

/** Вход бланка АСР/ОСР — один и тот же для экрана, файла и пакета. */
export function sectionActDocInput(p: SectionActPrep, kind: ActKind): ActDocInput {
  return {
    kind,
    uchastok: p.uchastok,
    oblast: p.oblast,
    rayon: p.rayon,
    contractor: p.contractor,
    performer: p.performer,
    dateFrom: p.totals.dateFrom,
    dateTo: p.totals.dateTo,
    totals: p.totals,
    variants: p.totals.variants,
    fields: p.fields,
  };
}
