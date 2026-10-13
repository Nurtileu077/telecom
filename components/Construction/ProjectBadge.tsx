'use client';
import { useState } from 'react';
import { currentProject } from './projects';

/**
 * В какой проект ляжет запись — прямо в шапке формы.
 *
 * Форма смены на телефоне закрывает весь экран вместе с переключателем
 * проектов, а метры, вписанные не в тот проект, уходят в чужую ведомость
 * и чужой расчёт с подрядчиком. Поэтому название стоит там, куда смотрят,
 * нажимая «Сохранить».
 *
 * Читаем один раз при открытии: при переходе в другой проект журнал со
 * всеми формами пересоздаётся, и открытая форма к другому проекту не
 * переезжает.
 */
export default function ProjectBadge({ className = '' }: { className?: string }) {
  const [name] = useState(() => currentProject().name);
  return (
    <span title="Запись ляжет в этот проект стройки"
          className={`inline-block align-middle ml-1.5 px-1.5 py-px rounded border border-[var(--accent)]/40
                      text-[10.5px] font-semibold text-[var(--accent)] max-w-[140px] truncate ${className}`}>
      {name}
    </span>
  );
}
