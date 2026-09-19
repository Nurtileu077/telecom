import {
  SNP_STAGE_SPECS, STAGE_STATUS_SPECS, SNP_STAGES, MATERIAL_UNIT,
} from '@/types/construction';
import type { JournalState } from './journalStore';

/**
 * Единый журнал изменений.
 *
 * Сейчас правки разбросаны: заявки на исправление в одном разделе,
 * отклонения в другом, правки трассы вообще нигде, отметки этапов — в
 * подсказке на кнопке. Когда спрашивают «кто это поменял и когда», нужно
 * обойти четыре экрана и всё равно не найти.
 *
 * Здесь всё это собрано в одну ленту по времени. Ничего нового не
 * хранится: лента собирается из того, что уже записано, — у каждой
 * правки и так есть автор и время. Новая запись заводится только для
 * трассы, потому что её правку раньше действительно негде было увидеть.
 */

/** Что именно сделали — одним словом на каждый вид записи. */
const CHANGE_TEXT: Record<string, string> = {
  route_edit: 'трасса изменена',
  route_add: 'трасса добавлена',
  route_delete: 'трасса удалена',
  area_edit: 'обводка изменена',
  area_rename: 'обводка переименована',
  area_delete: 'обводка удалена',
};

export type FeedKind =
  | 'route' | 'correction' | 'deviation' | 'stage' | 'delivery' | 'object';

export const FEED_KIND_LABEL: Record<FeedKind, string> = {
  route: 'Трасса',
  correction: 'Заявки',
  deviation: 'Отклонения',
  stage: 'Этапы',
  delivery: 'Поставки',
  object: 'Объекты',
};

export const FEED_KIND_ICON: Record<FeedKind, string> = {
  route: '〰', correction: '✎', deviation: '⚠',
  stage: '☑', delivery: '📦', object: '🔗',
};

export interface FeedItem {
  id: string;
  kind: FeedKind;
  /** ISO — по нему лента и упорядочена. */
  at: string;
  author: string;
  /** Что именно: село, участок, трасса. */
  target: string;
  /** Что сделали — одной строкой. */
  text: string;
  oblast?: string;
  rayon?: string;
  kato?: string;
  /** id записи журнала изменений — по ней можно вернуть как было. */
  changeId?: string;
  /** Есть что возвращать. */
  restorable?: boolean;
}

function km(m: number): string {
  return `${(m / 1000).toFixed(3).replace('.', ',')} км`;
}

/** Лента изменений, новое сверху. */
export function changeFeed(j: JournalState): FeedItem[] {
  const out: FeedItem[] = [];

  // Трасса — единственный источник, который пришлось завести отдельно.
  for (const c of j.changes ?? []) {
    out.push({
      id: c.id,
      kind: 'route',
      at: c.at,
      author: c.author,
      target: c.target,
      text: `${CHANGE_TEXT[c.kind] ?? 'изменено'}${c.detail ? ` — ${c.detail}` : ''}`,
      oblast: c.oblast,
      rayon: c.rayon,
      kato: c.kato,
      changeId: c.id,
      restorable: !!c.before?.length,
    });
  }

  // Заявки на исправление: подача и решение — два разных события.
  for (const r of j.corrections) {
    out.push({
      id: `cr-${r.id}`,
      kind: 'correction',
      at: r.createdAt,
      author: r.author,
      target: r.before.uchastok || r.before.kato || 'запись',
      text: `заявка на исправление отчёта за ${r.before.date}: ${r.reason}`,
      oblast: r.before.oblast,
      rayon: r.before.rayon,
      kato: r.before.kato,
    });
    if (r.decidedAt) {
      out.push({
        id: `cr-${r.id}-d`,
        kind: 'correction',
        at: r.decidedAt,
        author: r.decidedBy || '—',
        target: r.before.uchastok || r.before.kato || 'запись',
        text: r.status === 'approved'
          ? `исправление подтверждено${r.decisionNote ? ` — ${r.decisionNote}` : ''}`
          : `в исправлении отказано${r.decisionNote ? ` — ${r.decisionNote}` : ''}`,
        oblast: r.before.oblast,
        rayon: r.before.rayon,
        kato: r.before.kato,
      });
    }
  }

  for (const d of j.deviations) {
    out.push({
      id: `dv-${d.id}`,
      kind: 'deviation',
      at: d.createdAt || `${d.date}T12:00:00.000Z`,
      author: d.author || '—',
      target: d.uchastok || d.kato || 'участок',
      text: d.kind === 'depth'
        ? `отклонение по глубине: ${d.actualDepthM ?? '—'} м вместо ${d.designDepthM ?? 1.2} м, ${d.lengthM} м — ${d.reason}`
        : `изменение трассы на ${d.lengthM} м — ${d.reason}`,
      oblast: d.oblast,
      rayon: d.rayon,
      kato: d.kato,
    });
  }

  // Этапы: отметку ставит человек, и у неё есть автор и время.
  // Выведенные из журнала не берём — их никто не отмечал.
  for (const p of j.progress) {
    for (const s of SNP_STAGES) {
      const st = p.stages[s];
      if (!st || st.derived) continue;
      const at = st.doneAt || st.startedAt;
      if (!at) continue;
      out.push({
        id: `st-${p.kato}-${s}`,
        kind: 'stage',
        at,
        author: st.by || '—',
        target: p.snp,
        text: `${SNP_STAGE_SPECS[s].label}: ${STAGE_STATUS_SPECS[st.status].label.toLowerCase()}`
          + (st.blockReason ? ` — ${st.blockReason}` : '')
          + (st.crew ? ` · ${st.crew}` : ''),
        oblast: p.oblast,
        rayon: p.rayon,
        kato: p.kato,
      });
    }
  }

  for (const d of j.deliveries) {
    const unit = MATERIAL_UNIT[d.material];
    out.push({
      id: `dl-${d.id}`,
      kind: 'delivery',
      at: d.createdAt || `${d.date}T12:00:00.000Z`,
      author: d.author || '—',
      target: [d.oblast, d.rayon].filter(Boolean).join(', ') || 'область',
      text: `приход ${d.material}: ${unit === 'м' ? km(d.qty) : `${d.qty} шт`}`
        + (d.note ? ` — ${d.note}` : ''),
      oblast: d.oblast,
      rayon: d.rayon,
    });
  }

  for (const o of j.objects) {
    out.push({
      id: `ob-${o.id}`,
      kind: 'object',
      at: o.updatedAt || o.createdAt,
      author: o.author || '—',
      target: o.name || o.uchastok || o.kind,
      text: `${o.kind}${o.state ? ` · ${o.state}` : ''}`,
      oblast: o.oblast,
      rayon: o.rayon,
      kato: o.kato,
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export interface FeedFilter {
  kinds?: Set<FeedKind>;
  oblast?: string;
  /** Поиск по селу, участку, автору и тексту. */
  q?: string;
  from?: string;
  to?: string;
}

export function filterFeed(items: FeedItem[], f: FeedFilter): FeedItem[] {
  const q = f.q?.trim().toLowerCase();
  return items.filter((i) => {
    if (f.kinds && f.kinds.size > 0 && !f.kinds.has(i.kind)) return false;
    // Записи без области не прячем — прячем только заведомо чужие.
    if (f.oblast && i.oblast && i.oblast !== f.oblast) return false;
    if (f.from && i.at.slice(0, 10) < f.from) return false;
    if (f.to && i.at.slice(0, 10) > f.to) return false;
    if (q) {
      const hay = `${i.target} ${i.text} ${i.author} ${i.rayon ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
