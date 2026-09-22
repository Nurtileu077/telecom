'use client';
import { useMemo } from 'react';
import { AlertTriangle, MapPin, Trash2, Check, Undo2 } from 'lucide-react';
import type { JournalState } from './journalStore';
import { findOverlaps } from './overlaps';
import { formatMeters } from './mapDecor';

/**
 * Проверки по тому, что загружено.
 *
 * Файлов с трассами несколько: проект, правки после обследования,
 * альтернативный вариант, чья-то выгрузка. Куски в них повторяются, и
 * на карте этого не видно — линии лежат одна под другой. Зато видно в
 * метрах: один и тот же кусок посчитан дважды и в объёмах, и в
 * потребности кабеля.
 *
 * Сами ничего не удаляем: какая из двух линий правильная, знает только
 * человек. Наше дело — показать, что их две.
 */

interface Props {
  journal: JournalState;
  onShow: (coords: [number, number][]) => void;
  onDeleteRoute: (id: string) => void;
  /** Вернуть удалённую смену из корзины. */
  onRestore: (id: string) => void;
  /** Где факт разошёлся с проектом. */
  planFactRows: import('./entriesTable').PlanFactRow[];
}

export default function ChecksView({
  journal, onShow, onDeleteRoute, onRestore, planFactRows,
}: Props) {
  const pairs = useMemo(
    () => findOverlaps(journal.planRoutes.map((r) => ({
      id: r.id, name: r.name || r.uchastok || 'Трасса', coords: r.coords,
    }))),
    [journal.planRoutes],
  );

  const byId = useMemo(
    () => new Map(journal.planRoutes.map((r) => [r.id, r])),
    [journal.planRoutes],
  );

  const doubleCountedM = pairs.reduce((s, p) => s + p.sharedM, 0);

  const trash = [...journal.trash].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="p-3 space-y-3">
      {/* Корзина: удалённая по ошибке смена — это пропавшие метры в акте. */}
      {trash.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
          <div className="text-[13px] font-semibold text-[var(--text)]">
            Корзина: {trash.length}
          </div>
          <div className="text-[11.5px] text-[var(--text-muted)]">
            Удалённое лежит месяц и возвращается одним нажатием.
          </div>
          {trash.slice(0, 20).map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-[var(--text)] truncate">
                  {'uchastok' in t.entry ? t.entry.uchastok : t.id}
                </span>
                <span className="block text-[10.5px] text-[var(--text-muted)]">
                  {t.entry.date ? new Date(`${t.entry.date}T00:00:00Z`).toLocaleDateString('ru') : '—'}
                  {' · удалил '}
                  {t.author || 'неизвестно'}
                  {', '}
                  {new Date(t.at).toLocaleDateString('ru')}
                </span>
              </span>
              <button type="button" className="btn btn-ghost btn-icon"
                      title="Вернуть запись" onClick={() => onRestore(t.id)}>
                <Undo2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Где факт разошёлся с проектом. */}
      {planFactRows.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-[var(--warn)]" />
            <div className="text-[13px] font-semibold text-[var(--text)]">
              Факт разошёлся с проектом: {planFactRows.length}
            </div>
          </div>
          <div className="text-[11.5px] text-[var(--text-muted)]">
            Само по себе это не ошибка — трассу переносят. Но узнать об этом
            лучше на стройке, а не при сдаче.
          </div>
          {planFactRows.slice(0, 15).map((r) => (
            <div key={r.uchastok} className="flex items-baseline gap-2">
              <span className="text-[12.5px] text-[var(--text)] truncate min-w-0 flex-1">
                {r.uchastok}
              </span>
              <span className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums shrink-0">
                проект {formatMeters(r.planM)} · факт {formatMeters(r.factM)}
              </span>
              <span className={`text-[12px] font-mono tabular-nums shrink-0 ${
                r.diffM > 0 ? 'text-[var(--warn)]' : 'text-[var(--danger)]'}`}>
                {r.diffM > 0 ? '+' : '−'}{formatMeters(Math.abs(r.diffM))}
              </span>
            </div>
          ))}
        </div>
      )}

      {journal.planRoutes.length === 0 && (
        <div className="p-6 text-center text-[13px] text-[var(--text-muted)]">
          Трасс пока нет. Загрузите KML — и проверка наложений заработает.
        </div>
      )}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
        <div className="flex items-center gap-2">
          {pairs.length === 0
            ? <Check size={16} className="text-[var(--accent)]" />
            : <AlertTriangle size={16} className="text-[var(--warn)]" />}
          <div className="text-[13px] font-semibold text-[var(--text)]">
            {pairs.length === 0
              ? 'Наложений не нашлось'
              : `Наложений: ${pairs.length}`}
          </div>
        </div>
        <div className="mt-1 text-[11.5px] text-[var(--text-muted)]">
          {pairs.length === 0
            ? `Проверено трасс: ${journal.planRoutes.length}. Ни одна не дублирует другую.`
            : `Примерно ${formatMeters(doubleCountedM)} посчитано дважды — `
              + 'и в объёмах, и в потребности кабеля.'}
        </div>
      </div>

      {pairs.map((p) => {
        const a = byId.get(p.aId);
        const b = byId.get(p.bId);
        return (
          <div
            key={`${p.aId}|${p.bId}`}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold text-[var(--warn)]">
                {formatMeters(p.sharedM)} общего хода
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {Math.round(p.share * 100)}% от более короткой
              </span>
            </div>

            {[{ side: p.aId, name: p.aName, route: a }, { side: p.bId, name: p.bName, route: b }]
              .map(({ side, name, route }) => (
                <div key={side} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] text-[var(--text)] truncate">{name}</span>
                    <span className="block text-[10.5px] text-[var(--text-muted)] truncate">
                      {route ? `${(route.lengthM / 1000).toFixed(2)} км · ${route.source}` : '—'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    title="Показать на карте"
                    onClick={() => route && onShow(route.coords)}
                  >
                    <MapPin size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon text-[var(--danger)]"
                    title="Удалить эту трассу"
                    onClick={() => onDeleteRoute(side)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

            <div className="text-[10.5px] text-[var(--text-muted)]">
              Какая из двух верная — видно только тому, кто там был.
              Посмотрите обе на карте и уберите лишнюю.
            </div>
          </div>
        );
      })}
    </div>
  );
}
