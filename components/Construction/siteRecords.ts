/**
 * Что вокруг стройки: разрешения, допуски, контакты, претензии, задачи.
 *
 * Всё это живёт в телефоне у одного человека и в папке у другого.
 * Согласование с дорожниками истекает — узнают об этом, когда приезжает
 * инспектор. Допуск сварщика кончился — узнают на сдаче. Телефон акима
 * ищут в переписке. Мелкое поручение теряется через день.
 *
 * Разные по смыслу, они одинаковы по устройству: у каждого есть что,
 * кто, срок и состояние. Поэтому одна запись на все пять, а не пять
 * похожих справочников.
 */

export type RecordKind = 'permit' | 'clearance' | 'contact' | 'claim' | 'task';

export interface RecordKindSpec {
  label: string;
  plural: string;
  icon: string;
  /** Есть ли у записи срок — у контакта его нет. */
  dated: boolean;
  /** Подпись поля «кто»: у каждого вида он свой. */
  whoLabel: string;
  hint: string;
}

export const RECORD_KINDS: Record<RecordKind, RecordKindSpec> = {
  permit: {
    label: 'Разрешение',
    plural: 'Разрешения и согласования',
    icon: '📄',
    dated: true,
    whoLabel: 'Кто выдал',
    hint: 'дорожники, электросети, аким, земельный отдел',
  },
  clearance: {
    label: 'Допуск',
    plural: 'Допуски и инструктажи',
    icon: '🎓',
    dated: true,
    whoLabel: 'Кому',
    hint: 'сварщик, машинист, работы на высоте',
  },
  contact: {
    label: 'Контакт',
    plural: 'Контакты на объекте',
    icon: '📞',
    dated: false,
    whoLabel: 'Кто',
    hint: 'аким, электросети, дорожники, участковый',
  },
  claim: {
    label: 'Претензия',
    plural: 'Претензии',
    icon: '⚖',
    dated: true,
    whoLabel: 'Кому предъявлена',
    hint: 'что предъявили подрядчику и чем закрыли',
  },
  task: {
    label: 'Задача',
    plural: 'Доска задач',
    icon: '✔',
    dated: true,
    whoLabel: 'Кому поручено',
    hint: 'мелкие поручения по объекту',
  },
};

export const RECORD_KIND_LIST = Object.keys(RECORD_KINDS) as RecordKind[];

export type RecordStatus = 'открыто' | 'в работе' | 'закрыто' | 'просрочено';

export interface SiteRecord {
  id: string;
  kind: RecordKind;
  /** Что это: «Согласование с КазАвтоЖол», «Допуск на высоту». */
  title: string;
  /** Кто: выдал, кому, чей телефон. */
  who?: string;
  /** Телефон — у контактов главное поле. */
  phone?: string;
  /** Номер документа. */
  number?: string;
  /** Когда выдано или поставлено. */
  from?: string;
  /** До какого числа действует или к какому сроку сделать. */
  until?: string;
  uchastok?: string;
  oblast?: string;
  /** Сумма — у претензии. */
  amount?: number;
  status: RecordStatus;
  note?: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  sync?: 'local' | 'synced';
}

/**
 * Состояние с учётом срока.
 *
 * Просроченным запись становится сама: помечать это руками означает не
 * пометить никогда. Закрытое не протухает — у него уже есть исход.
 */
export function effectiveStatus(r: SiteRecord, today = new Date().toISOString().slice(0, 10)): RecordStatus {
  if (r.status === 'закрыто') return 'закрыто';
  if (!r.until) return r.status;
  return r.until < today ? 'просрочено' : r.status;
}

/** Сколько дней осталось. Отрицательное — уже просрочено. */
export function daysLeft(r: SiteRecord, today = new Date().toISOString().slice(0, 10)): number | null {
  if (!r.until) return null;
  const a = new Date(`${today}T00:00:00Z`).getTime();
  const b = new Date(`${r.until}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export interface Reminder {
  record: SiteRecord;
  days: number;
  /** Просрочено или вот-вот истечёт. */
  level: 'overdue' | 'soon';
}

/**
 * О чём пора напомнить.
 *
 * За неделю — потому что столько идёт продление согласования, и
 * напоминать в день окончания значит напоминать поздно.
 */
export function reminders(
  list: SiteRecord[],
  aheadDays = 7,
  today = new Date().toISOString().slice(0, 10),
): Reminder[] {
  const out: Reminder[] = [];
  for (const r of list) {
    if (r.status === 'закрыто') continue;
    const days = daysLeft(r, today);
    if (days === null) continue;
    if (days < 0) out.push({ record: r, days, level: 'overdue' });
    else if (days <= aheadDays) out.push({ record: r, days, level: 'soon' });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Записи одного вида — свежие или ближайшие по сроку сверху. */
export function ofKind(list: SiteRecord[], kind: RecordKind): SiteRecord[] {
  const spec = RECORD_KINDS[kind];
  return list
    .filter((r) => r.kind === kind)
    .sort((a, b) => {
      if (!spec.dated) return (a.title || '').localeCompare(b.title || '', 'ru');
      // Сначала то, у чего срок ближе; без срока — в конец.
      const av = a.until || '9999';
      const bv = b.until || '9999';
      return av.localeCompare(bv);
    });
}

export interface KindCount {
  kind: RecordKind;
  total: number;
  /** Сколько требует внимания: просрочено или скоро истечёт. */
  attention: number;
}

export function countByKind(list: SiteRecord[], today?: string): KindCount[] {
  const soon = new Set(reminders(list, 7, today).map((r) => r.record.id));
  return RECORD_KIND_LIST.map((kind) => {
    const mine = list.filter((r) => r.kind === kind);
    return {
      kind,
      total: mine.length,
      attention: mine.filter((r) => soon.has(r.id)).length,
    };
  });
}

/** Контакты текстом — их пересылают целиком, а не по одному. */
export function contactsText(list: SiteRecord[]): string {
  return ofKind(list, 'contact')
    .map((c) => [c.title, c.who, c.phone, c.uchastok].filter(Boolean).join(' · '))
    .join('\n');
}
