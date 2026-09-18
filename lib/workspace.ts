/**
 * Рабочее место: проектирование или стройка.
 *
 * Это разные работы с разными вопросами. Проектировщик считает трассы,
 * муфты и смету; прораб смотрит, где стоят колонны и что сдавать сегодня.
 * Одна карта на двоих означает, что каждый видит половину чужого и ищет
 * своё среди него.
 *
 * Данные при этом остаются общими: проект сети и журнал стройки — разные
 * хранилища, и переключение ничего не копирует и не прячет насовсем.
 */

export type Workspace = 'design' | 'construction';

export const WORKSPACE_SPECS: Record<Workspace, {
  label: string;
  short: string;
  tagline: string;
  icon: string;
}> = {
  design: {
    label: 'Проектирование',
    short: 'Проект',
    tagline: 'Трассы, узлы, муфты, смета и выгрузка KMZ',
    icon: '📐',
  },
  construction: {
    label: 'Стройка',
    short: 'Стройка',
    tagline: 'Дневные отчёты, этапы по сёлам, колонны, материалы и акты',
    icon: '🦺',
  },
};

const KEY = 'optiq-workspace-v1';

export function loadWorkspace(): Workspace | null {
  if (typeof window === 'undefined') return null;
  try {
    // Ссылка сильнее сохранённого выбора: по ней открывают конкретное
    // рабочее место, а не то, где человек был в прошлый раз.
    const fromUrl = new URLSearchParams(window.location.search).get('ws');
    if (fromUrl === 'design' || fromUrl === 'construction') return fromUrl;
    const v = window.localStorage.getItem(KEY);
    return v === 'design' || v === 'construction' ? v : null;
  } catch {
    return null;
  }
}

export function saveWorkspace(w: Workspace): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, w);
  } catch {
    // Выбор рабочего места — не та вещь, ради которой стоит падать.
  }
}
