'use client';

/**
 * Заглушка на время загрузки.
 *
 * Пустой экран читается как «сломалось» или «данных нет», и человек
 * закрывает его раньше, чем всё успевает прийти. Серые полосы на местах
 * будущих строк говорят другое: идёт, подожди секунду.
 *
 * Поэтому заглушка повторяет форму того, что придёт, а не крутится
 * посреди экрана: по ней уже видно, будет там таблица или карточки.
 */

interface Props {
  /** Сколько строк нарисовать. */
  rows?: number;
  /** Форма: строки таблицы или карточки. */
  kind?: 'rows' | 'cards';
  /** Что грузится — для тех, кто слушает экран. */
  label?: string;
}

export default function Skeleton({ rows = 6, kind = 'rows', label = 'Загрузка' }: Props) {
  const items = Array.from({ length: Math.max(1, rows) });

  return (
    <div className="p-3 space-y-2" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {items.map((_, i) => (
        <div
          key={i}
          aria-hidden
          className={
            kind === 'cards'
              ? 'rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2'
              : 'flex items-center gap-3'
          }
          // Полосы гаснут не разом: так видно, что это ожидание, а не
          // застывший экран. Задержка по строке, а не случайная.
          style={{ animationDelay: `${i * 90}ms` }}
        >
          {kind === 'cards' ? (
            <>
              <div className="skeleton-bar h-3 w-1/3" />
              <div className="skeleton-bar h-2.5 w-2/3" />
            </>
          ) : (
            <>
              <div className="skeleton-bar h-3 w-[92px] shrink-0" />
              <div className="skeleton-bar h-3 flex-1" />
              <div className="skeleton-bar h-3 w-[64px] shrink-0" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
