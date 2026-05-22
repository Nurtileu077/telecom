import type { FieldChecklist, FieldChecklistItem } from '@/types/network';

export const DEFAULT_ORK_CHECKLIST: Omit<FieldChecklistItem, 'done'>[] = [
  { id: 'mount', label: 'Бокс закреплён и маркирован' },
  { id: 'splitter', label: 'Сплиттер установлен, пигтейлы подписаны' },
  { id: 'drops', label: 'Дропы к камерам проложены' },
  { id: 'power', label: 'Уровень на камерах в норме' },
  { id: 'photo', label: 'Фото объекта сделано' },
];

export const DEFAULT_TB_CHECKLIST: Omit<FieldChecklistItem, 'done'>[] = [
  { id: 'access', label: 'Доступ к муфте обеспечен' },
  { id: 'seal', label: 'Герметичность корпуса проверена' },
  { id: 'splice', label: 'Сплайсы по плану выполнены' },
  { id: 'label', label: 'Маркировка волокон на планшете' },
  { id: 'photo', label: 'Фото муфты сделано' },
];

export function ensureFieldChecklist(
  existing: FieldChecklist | undefined,
  defaults: Omit<FieldChecklistItem, 'done'>[],
): FieldChecklist {
  const byId = new Map((existing?.items ?? []).map((i) => [i.id, i]));
  const items: FieldChecklistItem[] = defaults.map((d) => ({
    ...d,
    done: byId.get(d.id)?.done ?? false,
  }));
  for (const extra of existing?.items ?? []) {
    if (!items.some((i) => i.id === extra.id)) items.push(extra);
  }
  return { items, updatedAt: existing?.updatedAt };
}

export function checklistProgress(checklist: FieldChecklist | undefined): { done: number; total: number; pct: number } {
  const total = checklist?.items.length ?? 0;
  const done = checklist?.items.filter((i) => i.done).length ?? 0;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function toggleChecklistItem(
  checklist: FieldChecklist,
  itemId: string,
  done: boolean,
): FieldChecklist {
  return {
    items: checklist.items.map((i) => (i.id === itemId ? { ...i, done } : i)),
    updatedAt: new Date().toISOString(),
  };
}
