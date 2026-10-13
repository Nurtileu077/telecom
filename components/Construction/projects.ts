import type { Contractor } from '@/types/construction';

/**
 * Проекты стройки.
 *
 * СНП и Гипертрасса — разные договоры с разными заказчиками: сёла идут
 * под Транстелекомом, магистраль вдоль трассы — под Freedom. Пока журнал
 * был один, метры магистрали ложились в ту же ведомость и ту же КС-2,
 * что и сёла, а расценка TERRA TECH на всех объектах была та, что
 * началась последней, — то есть расчёт с подрядчиком по одному договору
 * шёл по цене другого.
 *
 * Поэтому проект — это отдельный журнал целиком: смены, акты, расценки,
 * платежи, трассы, колонны, реквизиты сторон и склад. Склад тоже свой:
 * кабель и МКТ, выданные заказчиком под сёла, на магистраль другого
 * заказчика не спишешь, а закупает ли организация что-то сама на все
 * объекты сразу — пока не сказано. Общего между проектами — только их
 * список. Подрядчики переходят с объекта на объект, но «под кем» и в
 * каком районе они работают — у каждого договора своё, поэтому новый
 * проект получает из справочника только сами компании (seedContractors).
 */

export interface BuildProject {
  id: string;
  /** Как зовут на объекте: «СНП», «Гипертрасса». */
  name: string;
  /** Когда завели — ISO. Пусто у «СНП»: он был всегда. */
  createdAt: string;
  /**
   * Когда правили название — ISO. По нему обмен решает, чьё название
   * свежее, если проект переименовали на одном устройстве.
   */
  updatedAt: string;
}

/**
 * «СНП» — проект, которым стал прежний единый журнал.
 *
 * Номер постоянный, а не случайный: телефон прораба и компьютер в
 * конторе должны прийти в один и тот же «СНП», а не завести каждый свой.
 * Время правки пустое — любое название, данное ему где-то ещё, свежее.
 */
export const SNP_PROJECT_ID = 'snp';
export const SNP_PROJECT: BuildProject = {
  id: SNP_PROJECT_ID, name: 'СНП', createdAt: '', updatedAt: '',
};

/**
 * Ключ хранилища для проекта.
 *
 * У «СНП» ключ прежний, без приписки: сезон смен, внесённый до деления,
 * так и лежит под ним, и переносить его никуда не надо — перенос в
 * браузере, где память кончается молча, и есть способ его потерять.
 */
export function scopedKey(base: string, projectId: string): string {
  return projectId === SNP_PROJECT_ID ? base : `${base}@${projectId}`;
}

/**
 * Ключ строки журнала в облаке.
 *
 * «СНП» остаётся строкой организации, как было: в неё же пишут
 * устройства, ещё не обновлённые до проектов, и все они сходятся в одном
 * журнале. Остальные проекты — строкой «организация:проект».
 */
export function cloudRowKey(org: string, projectId: string): string {
  return projectId === SNP_PROJECT_ID ? org : `${org}:${projectId}`;
}

/** Проект по ключу строки; null — строка чужой организации. */
export function projectFromRowKey(org: string, key: string): string | null {
  if (key === org) return SNP_PROJECT_ID;
  const prefix = `${org}:`;
  if (key.startsWith(prefix) && key.length > prefix.length) return key.slice(prefix.length);
  return null;
}

/** Название для сравнения: «Гипертрасса» и «гипертрасса » — один проект. */
export function normProjectName(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ');
}

/** Длиннее не читается ни в шапке телефона, ни в имени файла. */
export const PROJECT_NAME_MAX = 60;

/**
 * Что не так с названием — словами, или null.
 *
 * Два проекта с одним названием — это две ведомости «Гипертрасса», и в
 * какую ушла смена, по шапке уже не понять.
 */
export function projectNameProblem(
  list: BuildProject[], name: string, exceptId?: string,
): string | null {
  const n = normProjectName(name);
  if (!n) return 'Название пустое';
  if (name.trim().length > PROJECT_NAME_MAX) {
    return `Слишком длинное название — не больше ${PROJECT_NAME_MAX} знаков`;
  }
  const same = list.find((p) => p.id !== exceptId && normProjectName(p.name) === n);
  if (same) return `Проект «${same.name}» уже есть — откройте его, а не заводите второй`;
  return null;
}

function newProjectId(now: Date): string {
  // Без двоеточия и «@»: номер идёт в ключ хранилища и строки облака.
  return `p${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export type ProjectEdit =
  | { ok: true; list: BuildProject[]; project: BuildProject }
  | { ok: false; problem: string };

export function addProject(
  list: BuildProject[], name: string, now = new Date(), id = newProjectId(now),
): ProjectEdit {
  const problem = projectNameProblem(list, name);
  if (problem) return { ok: false, problem };
  const at = now.toISOString();
  const project: BuildProject = { id, name: name.trim(), createdAt: at, updatedAt: at };
  return { ok: true, list: [...withSnp(list), project], project };
}

/** «СНП» есть всегда и стоит первым: в нём прежний журнал. */
export function withSnp(list: BuildProject[]): BuildProject[] {
  const snp = list.find((p) => p.id === SNP_PROJECT_ID) ?? SNP_PROJECT;
  return [snp, ...list.filter((p) => p.id !== SNP_PROJECT_ID)];
}

/**
 * Чьё название свежее.
 *
 * Разные проекты не сливаются никогда: если под одним ключом оказались
 * два разных, остаётся своё — смешать два договора хуже, чем не
 * получить чужое переименование.
 */
export function newerProject(
  mine: BuildProject | undefined, theirs: BuildProject | undefined,
): BuildProject | undefined {
  if (!mine) return theirs;
  if (!theirs || theirs.id !== mine.id) return mine;
  return (theirs.updatedAt ?? '') > (mine.updatedAt ?? '') ? theirs : mine;
}

/**
 * Справочник подрядчиков для нового проекта.
 *
 * Субподрядчик работает на разных проектах, и заводить TERRA TECH заново
 * незачем — компания та же, с тем же полным наименованием. А вот «под
 * кем» она выходит на объект и в каких районах — это условия договора:
 * на сёлах TERRA TECH работает от имени СК Фаворит под Транстелекомом, а
 * на магистрали Freedom — неизвестно. Перенести это значило бы напечатать
 * в шапке акта чужого генподрядчика, поэтому оставляем пустым: заполнит
 * человек, который знает договор.
 */
export function seedContractors(list: Contractor[]): Contractor[] {
  return list.map((c) => {
    const out: Contractor = { id: c.id, name: c.name };
    if (c.fullName) out.fullName = c.fullName;
    return out;
  });
}

/**
 * Какую из строк, отданных субподрядчику, брать для проекта.
 *
 * Срез субподрядчику режет сервер, и пока он не знает о проектах (п. 222),
 * он может отдать строки нескольких проектов. Строка без отметки проекта
 * — это «СНП»: так пишут устройства, не обновлённые до проектов. Если
 * подходящих строк больше одной, не угадываем: чужой договор, слитый в
 * свой журнал, назад не разделить.
 */
export function pickProjectRow<R extends { data?: unknown }>(
  rows: R[], projectId: string,
): R | null | 'ambiguous' {
  const fits = rows.filter((r) => {
    const p = (r.data as { project?: { id?: unknown } } | null | undefined)?.project;
    const id = typeof p?.id === 'string' && p.id ? p.id : SNP_PROJECT_ID;
    return id === projectId;
  });
  if (fits.length > 1) return 'ambiguous';
  return fits[0] ?? null;
}

// ── Один и тот же проект на всех устройствах ─────────────────────────────────

/**
 * Список проектов с другого устройства.
 *
 * Гипертрассу заводят в конторе, а смены по ней пишет прораб с телефона:
 * без этого его телефон о проекте не узнает и смена ляжет в «СНП».
 * Проекты сравниваются по номеру, а не по названию: переименованный
 * проект — тот же проект. Название берётся то, что правили позже.
 * Ничего не убирается: проект, которого в облаке ещё нет, просто ещё не
 * отправлен.
 */
export function mergeProjectLists(
  local: BuildProject[], remote: BuildProject[],
): { list: BuildProject[]; added: BuildProject[]; renamed: BuildProject[] } {
  const byId = new Map(withSnp(local).map((p) => [p.id, p]));
  const added: BuildProject[] = [];
  const renamed: BuildProject[] = [];
  for (const r of remote) {
    const mine = byId.get(r.id);
    if (!mine) { byId.set(r.id, r); added.push(r); continue; }
    const pick = newerProject(mine, r)!;
    if (pick !== mine && pick.name !== mine.name) renamed.push(pick);
    byId.set(r.id, pick);
  }
  return { list: withSnp([...byId.values()]), added, renamed };
}

/**
 * Проекты по строкам облака.
 *
 * Строка «СНП» могла прийти с устройства, не обновлённого до проектов:
 * отметки в ней нет, но это «СНП» — по ключу. У строки другого проекта
 * без отметки названия взять негде; выдумывать его не будем — так и
 * напишем, что без названия.
 */
export function projectsFromRows(
  org: string, rows: { org_key?: unknown; project?: unknown }[],
): BuildProject[] {
  const out: BuildProject[] = [];
  for (const row of rows) {
    if (typeof row.org_key !== 'string') continue;
    const id = projectFromRowKey(org, row.org_key);
    if (!id) continue;
    const p = row.project as Partial<BuildProject> | null | undefined;
    const name = typeof p?.name === 'string' && p.name.trim() ? p.name.trim() : '';
    if (!name) {
      out.push(id === SNP_PROJECT_ID
        ? SNP_PROJECT
        : { id, name: `без названия (${id})`, createdAt: '', updatedAt: '' });
      continue;
    }
    out.push({
      id, name,
      createdAt: typeof p?.createdAt === 'string' ? p.createdAt : '',
      updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : '',
    });
  }
  return out;
}

/**
 * Названия, под которыми заведено больше одного проекта.
 *
 * Без связи проект могли завести и в конторе, и на телефоне — это два
 * проекта с одним названием, и смены расходятся по ним. Сказать об этом
 * надо сразу, пока по второму не записали сезон.
 */
export function duplicateNames(list: BuildProject[]): string[] {
  const seen = new Map<string, string[]>();
  for (const p of list) {
    const k = normProjectName(p.name);
    seen.set(k, [...(seen.get(k) ?? []), p.name]);
  }
  return [...seen.values()].filter((v) => v.length > 1).map((v) => v[0]);
}

/**
 * Нужно ли сказать, что прежний журнал стал «СНП».
 *
 * Говорим один раз и только там, где журнал вели до деления: на чистом
 * устройстве объяснять нечего. Решение запоминается при первом взгляде —
 * журнал, пришедший потом обменом, уже не «прежний».
 */
export type AdoptionState = 'due' | 'done';

export function adoptionState(stored: string | null, hasData: boolean): AdoptionState {
  if (stored === 'due' || stored === 'done') return stored;
  return hasData ? 'due' : 'done';
}

// ── Хранение на устройстве ───────────────────────────────────────────────────

const LIST_KEY = 'optiq-build-projects-v1';
const OPEN_KEY = 'optiq-build-project-open-v1';

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
}

function isProject(v: unknown): v is BuildProject {
  const p = v as BuildProject;
  return !!p && typeof p === 'object' && typeof p.id === 'string' && !!p.id
    && typeof p.name === 'string';
}

export function loadProjects(): BuildProject[] {
  try {
    const raw = storage()?.getItem(LIST_KEY);
    const v = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(v) ? v.filter(isProject).map((p) => ({
      id: p.id, name: p.name,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : '',
    })) : [];
    return withSnp(list);
  } catch {
    return [SNP_PROJECT];
  }
}

/** Список проектов записан? Не записался — проект заведён только на экране. */
export function saveProjects(list: BuildProject[]): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(LIST_KEY, JSON.stringify(withSnp(list)));
    return true;
  } catch { return false; }
}

/**
 * Открытый проект — свой у каждой вкладки.
 *
 * Держим его в памяти страницы, а не читаем из хранилища при каждой
 * записи: иначе вторая вкладка, переключённая на Гипертрассу, молча
 * перевела бы и первую, где на экране по-прежнему написано «СНП», — и
 * смена ушла бы в чужую ведомость. В хранилище — только какой проект
 * открыть при следующем запуске.
 */
let openId: string | null = null;

export function currentProjectId(): string {
  if (openId) return openId;
  const s = storage();
  // На сервере страницу только рисуют: запоминать там нечего, а память
  // модуля там общая на всех.
  if (!s) return SNP_PROJECT_ID;
  let saved: string | null = null;
  try { saved = s.getItem(OPEN_KEY); } catch { /* приватный режим */ }
  openId = saved && loadProjects().some((p) => p.id === saved) ? saved : SNP_PROJECT_ID;
  return openId;
}

export function openProject(id: string): void {
  openId = id;
  try { storage()?.setItem(OPEN_KEY, id); } catch { /* приватный режим */ }
}

/** Только для тестов: забыть открытый проект, как при новом запуске. */
export function forgetOpenProject(): void {
  openId = null;
}

const ADOPT_KEY = 'optiq-build-projects-adopted-v1';

/** Сказать ли про «СНП» на этом устройстве (и запомнить решение). */
export function adoptionDue(hasData: boolean): boolean {
  const s = storage();
  if (!s) return false;
  let stored: string | null = null;
  try { stored = s.getItem(ADOPT_KEY); } catch { /* приватный режим */ }
  const state = adoptionState(stored, hasData);
  if (stored !== state) {
    try { s.setItem(ADOPT_KEY, state); } catch { /* приватный режим */ }
  }
  return state === 'due';
}

export function markAdoptionSeen(): void {
  try { storage()?.setItem(ADOPT_KEY, 'done'); } catch { /* приватный режим */ }
}

/** Описание проекта по номеру — из списка на устройстве. */
export function projectMeta(id: string): BuildProject {
  return loadProjects().find((p) => p.id === id)
    ?? (id === SNP_PROJECT_ID ? SNP_PROJECT : { id, name: id, createdAt: '', updatedAt: '' });
}

export function currentProject(): BuildProject {
  return projectMeta(currentProjectId());
}
