'use client';
import type { BuildProject } from './projects';

/**
 * Какой проект открыт — и переход в другой.
 *
 * Выпадающий список, а не отдельный экран: открыть Гипертрассу и
 * вернуться в «СНП» прораб делает между сменами, с телефона, и каждый
 * лишний шаг здесь — повод записать смену туда, где уже стоишь.
 */

const NEW = '__new';

interface Props {
  project: BuildProject;
  projects: BuildProject[];
  onSwitch: (id: string) => void;
  onCreate: () => void;
  className?: string;
}

export default function ProjectSwitcher({ project, projects, onSwitch, onCreate, className = '' }: Props) {
  return (
    <select
      value={project.id}
      onChange={(e) => {
        const v = e.target.value;
        // Список управляемый: после «нового проекта» он сам вернётся на
        // открытый, если человек передумал.
        if (v === NEW) onCreate();
        else if (v !== project.id) onSwitch(v);
      }}
      title="Проект стройки — отдельный договор: смены, акты, расценки и платежи у каждого свои"
      aria-label="Проект стройки"
      className={`bg-[var(--bg-canvas)] border border-[var(--accent)]/40 rounded-md px-2 py-1 text-[11.5px]
                  font-semibold text-[var(--accent)] min-w-0 max-w-[150px] truncate ${className}`}
    >
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value={NEW}>＋ Новый проект…</option>
    </select>
  );
}
