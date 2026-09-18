'use client';
import { useMemo, useState } from 'react';
import { History, RotateCcw, Search } from 'lucide-react';
import { JournalState } from './journalStore';
import {
  changeFeed, filterFeed, FEED_KIND_LABEL, FEED_KIND_ICON, type FeedKind,
} from './changeLog';

/**
 * Единый журнал изменений.
 *
 * Вопрос «кто это поменял» задают не из подозрительности, а потому что
 * нужно понять, откуда взялась цифра. Раньше ответ приходилось собирать
 * по четырём разделам; здесь всё в одной ленте по времени, с фильтром по
 * виду и поиском по селу и человеку.
 */

interface Props {
  journal: JournalState;
  /** Область из общего фильтра — лента живёт в тех же границах. */
  oblast?: string;
  /** Вернуть трассу как было. */
  onRestore?: (changeId: string) => void;
}

const KINDS: FeedKind[] = ['route', 'correction', 'deviation', 'stage', 'delivery', 'object'];

export default function ChangeLogView({ journal, oblast, onRestore }: Props) {
  const [kinds, setKinds] = useState<Set<FeedKind>>(new Set());
  const [q, setQ] = useState('');

  const all = useMemo(() => changeFeed(journal), [journal]);
  const rows = useMemo(
    () => filterFeed(all, { kinds, q, oblast }),
    [all, kinds, q, oblast],
  );

  const toggle = (k: FeedKind) => setKinds((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const counts = useMemo(() => {
    const m = new Map<FeedKind, number>();
    for (const i of all) m.set(i.kind, (m.get(i.kind) ?? 0) + 1);
    return m;
  }, [all]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex gap-0.5 bg-[var(--bg-canvas)] p-0.5 rounded-md flex-wrap">
          <button type="button" onClick={() => setKinds(new Set())}
                  className={`px-2 py-1 text-[11px] rounded ${
                    kinds.size === 0 ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
            Все
          </button>
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => toggle(k)}
                    title={FEED_KIND_LABEL[k]}
                    className={`px-2 py-1 text-[11px] rounded ${
                      kinds.has(k) ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {FEED_KIND_ICON[k]} {FEED_KIND_LABEL[k]}
              <span className="ml-1 text-[9.5px] font-mono opacity-70">{counts.get(k) ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 flex-1 min-w-[160px] bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2">
          <Search size={13} className="text-[var(--text-muted)] shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="село, участок, человек"
                 className="flex-1 bg-transparent py-1.5 text-[11.5px] text-[var(--text)] outline-none" />
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 flex flex-col items-center gap-2">
          <History size={22} className="text-[var(--text-muted)]" />
          <p className="text-[12.5px] text-[var(--text-muted)]">
            {all.length === 0
              ? 'Изменений пока нет: журнал только начали вести'
              : 'Под этот фильтр ничего не попало'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.slice(0, 300).map((i) => (
            <div key={i.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 flex items-start gap-2">
              <span className="text-[13px] leading-5 shrink-0" title={FEED_KIND_LABEL[i.kind]}>
                {FEED_KIND_ICON[i.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[12px] text-[var(--text)] truncate">{i.target}</span>
                  <span className="text-[10.5px] text-[var(--text-muted)] truncate">
                    {[i.oblast, i.rayon].filter(Boolean).join(', ')}
                  </span>
                  <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)] shrink-0">
                    {new Date(i.at).toLocaleString('ru', {
                      day: '2-digit', month: '2-digit', year: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {i.text} · <span className="text-[var(--text)]">{i.author}</span>
                </div>
              </div>
              {i.restorable && onRestore && (
                <button type="button" className="btn btn-ghost btn-icon shrink-0 text-[var(--text-muted)] hover:text-[var(--warn)]"
                        title="Вернуть как было"
                        onClick={() => {
                          if (!confirm(`Вернуть «${i.target}» как было на ${new Date(i.at).toLocaleString('ru')}?`)) return;
                          onRestore(i.changeId!);
                        }}>
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
          ))}
          {rows.length > 300 && (
            <p className="text-[11px] text-[var(--text-muted)] text-center py-2">
              Показаны первые 300 из {rows.length}.
            </p>
          )}
        </div>
      )}

      <p className="text-[10.5px] text-[var(--text-muted)]">
        Правку трассы никто не согласовывает — линия на карте и есть форма.
        Но она остаётся здесь: кто, когда и как было. Вернуть можно кнопкой.
      </p>
    </div>
  );
}
