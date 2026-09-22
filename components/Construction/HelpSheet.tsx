'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, Search } from 'lucide-react';
import { searchGlossary } from './glossary';

/**
 * Справка: горячие клавиши и словарь.
 *
 * Клавиши, о которых никто не знает, не экономят ни секунды. А ККС, МКТ
 * и бар для нового инженера — набор букв, и спрашивать неловко, поэтому
 * не спрашивают и понимают по-своему.
 *
 * Открывается по «?» — тем же знаком, что и везде.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

const KEYS: { keys: string; what: string }[] = [
  { keys: '?', what: 'эта справка' },
  { keys: '/', what: 'поиск по карте' },
  { keys: 'Ctrl + K', what: 'поиск по карте' },
  { keys: 'N', what: 'новая запись в журнале' },
  { keys: 'Ctrl + Z', what: 'отменить последнее действие' },
  { keys: 'Esc', what: 'закрыть окно, снять фокус, отменить рисование' },
  { keys: 'Enter', what: 'закончить линию при рисовании' },
  { keys: 'Backspace', what: 'убрать последнюю вершину линии' },
  { keys: 'Двойной клик', what: 'закончить линию' },
  { keys: 'Правая кнопка', what: 'меню на карте: координаты, ККС, препятствие' },
];

export default function HelpSheet({ open, onClose }: Props) {
  const [q, setQ] = useState('');
  const terms = useMemo(() => searchGlossary(q), [q]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-stretch
                    sm:items-center sm:justify-center sm:p-4"
         onClick={onClose}>
      <div
        className="bg-[var(--bg-surface)] w-full sm:max-w-[620px] sm:rounded-xl
                   border border-[var(--border)] flex flex-col max-h-full sm:max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0"
             style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
          <h3 className="text-sm font-semibold text-[var(--text)]">Справка</h3>
          <button type="button" className="btn btn-ghost btn-icon ml-auto" onClick={onClose}
                  aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
              Горячие клавиши
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
              {KEYS.map((k) => (
                <div key={k.keys} className="flex items-baseline gap-2 text-[12px]">
                  <kbd className="px-1.5 py-0.5 rounded border border-[var(--border)]
                                  text-[10.5px] text-[var(--text)] font-mono shrink-0">
                    {k.keys}
                  </kbd>
                  <span className="text-[var(--text-muted)]">{k.what}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-1.5">
              <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Словарь
              </h4>
              <div className="ml-auto flex items-center gap-1 rounded border border-[var(--border)]
                              bg-[var(--bg-canvas)] px-1.5 py-0.5">
                <Search size={11} className="text-[var(--text-muted)]" />
                <input
                  id="glossary-search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="ККС, бар, задувка…"
                  aria-label="Поиск по словарю"
                  className="bg-transparent text-[11.5px] text-[var(--text)] w-[130px]
                             placeholder:text-[var(--text-muted)] focus:outline-none"
                />
              </div>
            </div>
            {terms.length === 0 ? (
              <p className="text-[12px] text-[var(--text-muted)]">
                Такого слова в словаре нет. Сюда идут только те, что встречаются
                в системе и которые действительно переспрашивают.
              </p>
            ) : (
              <dl className="space-y-1.5">
                {terms.map((t) => (
                  <div key={t.term}>
                    <dt className="text-[12.5px] font-semibold text-[var(--text)]">
                      {t.term}
                      {t.aka?.length ? (
                        <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">
                          он же {t.aka.join(', ')}
                        </span>
                      ) : null}
                    </dt>
                    <dd className="text-[11.5px] text-[var(--text-muted)]">
                      {t.short}
                      {t.long && <span className="block mt-0.5">{t.long}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
