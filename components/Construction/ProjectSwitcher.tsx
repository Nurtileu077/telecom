'use client';
import { projectLabels, type BuildProject } from './projects';

/**
 * Какой проект открыт — и переход в другой.
 *
 * Выпадающий список, а не отдельный экран: открыть Гипертрассу и
 * вернуться в «СНП» прораб делает между сменами, с телефона, и каждый
 * лишний шаг здесь — повод записать смену туда, где уже стоишь. Стоит он
 * и в шапке карты, и в шапке журнала: смена, записанная не в тот проект,
 * уходит в чужую ведомость и чужой расчёт с подрядчиком, поэтому
 * название проекта должно быть видно на каждом экране.
 */

const NEW = '__new';
const RENAME = '__rename';

interface Props {
  project: BuildProject;
  projects: BuildProject[];
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename?: () => void;
  className?: string;
}

export default function ProjectSwitcher({
  project, projects, onSwitch, onCreate, onRename, className = '',
}: Props) {
  const labels = projectLabels(projects);
  return (
    <select
      value={project.id}
      onChange={(e) => {
        const v = e.target.value;
        // Список управляемый: после «нового проекта» или «переименовать»
        // он сам вернётся на открытый проект.
        if (v === NEW) onCreate();
        else if (v === RENAME) onRename?.();
        else if (v !== project.id) onSwitch(v);
      }}
      title={`Проект стройки: ${project.name}. Отдельный договор — смены, акты, расценки и платежи у каждого проекта свои`}
      aria-label="Проект стройки"
      className={`bg-[var(--bg-canvas)] border border-[var(--accent)]/40 rounded-md px-2 py-1 text-[11.5px]
                  font-semibold text-[var(--accent)] min-w-0 max-w-[150px] truncate ${className}`}
    >
      {projects.map((p) => <option key={p.id} value={p.id}>{labels[p.id] ?? p.name}</option>)}
      <option value={NEW}>＋ Новый проект…</option>
      {onRename && <option value={RENAME}>✎ Переименовать «{project.name}»…</option>}
    </select>
  );
}
