'use client';
import { useEffect, useState } from 'react';
import { X, ArrowRight, Map, NotebookPen, FileText } from 'lucide-react';
import {
  STEPS, markIntroSeen, shouldShowIntro, nextStep, stepLabel,
  loadStep, saveStep, type Step,
} from '@/lib/firstRun';

/**
 * Три шага при первом входе.
 *
 * Новый прораб открывает журнал и видит карту без трасс и пустые
 * вкладки. Что делать первым — неочевидно, и обычно он звонит тому, кто
 * уже работает.
 *
 * Показываем один раз и только пустому журналу. Тому, у кого уже есть
 * трассы и смены, рассказывать, как загрузить трассу, — значит сказать,
 * что его работу не видно.
 */

interface Props {
  /** Сколько всего в журнале: подсказка — только для пустого. */
  counts: { routes: number; entries: number };
  /** Открыть то, о чём шаг: карту или вкладку журнала. */
  onGo?: (where: string) => void;
}

const ICON: Record<string, typeof Map> = {
  map: Map,
  today: NotebookPen,
  docs: FileText,
};

export default function FirstRun({ counts, onGo }: Props) {
  const [step, setStep] = useState<number | null>(null);

  // Решаем после первой отрисовки: на сервере localStorage нет, и
  // угаданный ответ дал бы мигание подсказки у тех, кто её уже закрыл.
  useEffect(() => {
    // Продолжаем с того шага, на котором остановились: второй открывает
    // журнал, и подсказка уходит с экрана вместе с картой.
    if (shouldShowIntro(counts)) setStep(loadStep());
    // Смотрим один раз за заход: подсказка, появляющаяся в середине
    // работы, — это помеха, а не помощь.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (step === null) return null;
  const s: Step = STEPS[step];
  const Icon = ICON[s.goto ?? ''] ?? Map;

  function close() {
    markIntroSeen();
    setStep(null);
  }

  function go() {
    const next = nextStep(step ?? 0);
    // Шаг запоминаем ДО перехода: переход может увести с экрана вместе с
    // подсказкой, и записать его после уже не получится.
    if (next === null) close();
    else { saveStep(next); setStep(next); }
    if (s.goto) onGo?.(s.goto);
  }

  return (
    <div
      className="fixed inset-x-3 z-[10000] mx-auto max-w-sm rounded-xl border
                 border-[var(--accent)]/40 bg-[var(--bg-surface)] p-4 shadow-2xl"
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      role="dialog"
      aria-label="Подсказка при первом входе"
    >
      <div className="flex items-start gap-2">
        <Icon size={18} className="text-[var(--accent)] shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            {stepLabel(step)}
          </div>
          <div className="text-[14px] font-semibold text-[var(--text)]">{s.title}</div>
        </div>
        <button type="button" onClick={close} className="btn btn-ghost btn-icon"
                aria-label="Больше не показывать">
          <X size={15} />
        </button>
      </div>

      <p className="mt-2 text-[12.5px] leading-snug text-[var(--text-2)]">{s.body}</p>

      <div className="mt-3 flex items-center gap-2">
        {/* Точки шагов: видно, сколько осталось, без чтения. */}
        <span className="flex gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${
                i === step ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'}`}
            />
          ))}
        </span>
        <button type="button" onClick={close}
                className="btn btn-ghost text-[11px] ml-auto">
          Не показывать
        </button>
        <button type="button" onClick={go} className="btn btn-primary text-[11.5px]">
          {s.action}<ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
