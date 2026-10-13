import { describe, it, expect, beforeEach } from 'vitest';
import {
  SNP_PROJECT, SNP_PROJECT_ID, scopedKey, cloudRowKey, projectFromRowKey,
  projectNameProblem, addProject, seedContractors, newerProject, pickProjectRow,
  loadProjects, saveProjects, currentProjectId, openProject, forgetOpenProject,
  mergeProjectLists, projectsFromRows, duplicateNames, adoptionState, adoptionDue,
  markAdoptionSeen, renameProject, projectLabels,
  type BuildProject,
} from './projects';
import { saveDraft, loadDraft } from './drafts';
import { loadLastContext, saveLastContext, type LastContext } from './journalStore';
import { loadImports, saveImports } from './backup';
import { loadLastSyncAt, saveLastSyncAt } from './journalRemote';
import {
  loadJournal, saveJournal, journalKey, newProjectJournal, emptyJournal, mergeJournal,
  DEFAULT_CONTRACTORS,
} from './journalStore';
import { mergeJournalStates } from './journalSync';
import type { DailyWorkEntry } from '@/types/construction';

/**
 * Тесты идут без браузера, поэтому хранилище подставляем своё: проверяем
 * поведение кода, а не наличие window.
 */
function fakeWindow() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  (globalThis as { window?: unknown }).window = { localStorage };
  // Отметка обмена читается без window — подставляем и так.
  (globalThis as { localStorage?: unknown }).localStorage = localStorage;
  return store;
}

let store: Map<string, string>;
beforeEach(() => {
  store = fakeWindow();
  forgetOpenProject();
});

const HYPER: BuildProject = {
  id: 'p-hyper', name: 'Гипертрасса', createdAt: '2026-10-01T05:00:00.000Z', updatedAt: '2026-10-01T05:00:00.000Z',
};

function shift(id: string, meters: number): DailyWorkEntry {
  return {
    kind: 'ground', id, date: '2026-10-05', smu: '', contractor: 'TERRA TECH',
    oblast: 'Акмолинская область', uchastok: 'Исаковка', kato: '191',
    byMethod: { 'кабелеукладчик': meters }, materials: {},
    createdAt: '2026-10-05T10:00:00.000Z', updatedAt: '2026-10-05T10:00:00.000Z',
  };
}

describe('ключи проекта', () => {
  it('журнал «СНП» лежит под прежним ключом — переносить сезон некуда и незачем', () => {
    expect(scopedKey('optiq-journal-v1', SNP_PROJECT_ID)).toBe('optiq-journal-v1');
    expect(journalKey(SNP_PROJECT_ID)).toBe('optiq-journal-v1');
  });

  it('другой проект лежит рядом, а не поверх', () => {
    expect(journalKey('p-hyper')).toBe('optiq-journal-v1@p-hyper');
  });

  it('в облаке «СНП» — строка организации, как у необновлённых устройств', () => {
    expect(cloudRowKey('org-1', SNP_PROJECT_ID)).toBe('org-1');
    expect(cloudRowKey('org-1', 'p-hyper')).toBe('org-1:p-hyper');
  });

  it('строку облака узнаёт по ключу, чужую организацию не берёт', () => {
    expect(projectFromRowKey('org-1', 'org-1')).toBe(SNP_PROJECT_ID);
    expect(projectFromRowKey('org-1', 'org-1:p-hyper')).toBe('p-hyper');
    expect(projectFromRowKey('org-1', 'org-2:p-hyper')).toBeNull();
    expect(projectFromRowKey('org-1', 'org-1:')).toBeNull();
  });
});

describe('название проекта', () => {
  it('пустое не принимает', () => {
    expect(projectNameProblem([SNP_PROJECT], '   ')).toBe('Название пустое');
  });

  it('второй «СНП» не заводит, как его ни напиши', () => {
    expect(projectNameProblem([SNP_PROJECT], ' снп ')).toContain('уже есть');
    expect(projectNameProblem([SNP_PROJECT, HYPER], 'ГИПЕРТРАССА')).toContain('«Гипертрасса»');
  });

  it('«ё» и «е» — одно название', () => {
    const list = [SNP_PROJECT, { ...HYPER, name: 'Подвёс Бурабай' }];
    expect(projectNameProblem(list, 'Подвес Бурабай')).toContain('уже есть');
  });

  it('своё же название при переименовании не мешает', () => {
    expect(projectNameProblem([SNP_PROJECT, HYPER], 'Гипертрасса', HYPER.id)).toBeNull();
  });

  it('слишком длинное не принимает', () => {
    expect(projectNameProblem([SNP_PROJECT], 'Г'.repeat(61))).toContain('длинное');
  });
});

describe('новый проект', () => {
  it('ложится после «СНП» и со временем заведения', () => {
    const res = addProject([SNP_PROJECT], ' Гипертрасса ', new Date('2026-10-01T05:00:00Z'), 'p-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.project).toEqual({
      id: 'p-1', name: 'Гипертрасса',
      createdAt: '2026-10-01T05:00:00.000Z', updatedAt: '2026-10-01T05:00:00.000Z',
    });
    expect(res.list.map((p) => p.id)).toEqual([SNP_PROJECT_ID, 'p-1']);
  });

  it('номер годится в ключ хранилища и строки облака', () => {
    const res = addProject([SNP_PROJECT], 'Гипертрасса');
    expect(res.ok && /^[a-z0-9]+$/.test(res.project.id)).toBe(true);
  });

  it('из справочника берёт компании, но не «под кем» и не районы', () => {
    const seeded = seedContractors(DEFAULT_CONTRACTORS);
    const terra = seeded.find((c) => c.name === 'TERRA TECH');
    expect(terra).toEqual({ id: 'terra-tech', name: 'TERRA TECH' });
    expect(seeded.find((c) => c.name === 'СК Фаворит')?.fullName).toBe('ТОО «СК Фаворит Инжиниринг»');
    expect(seeded.some((c) => c.worksUnder || c.areas || c.note)).toBe(false);
  });

  it('пустой журнал нового проекта не начинается с Транстелекома генподрядчиком', () => {
    const j = newProjectJournal(HYPER, []);
    expect(j.contractors).toEqual([]);
    expect(j.project).toEqual(HYPER);
    expect(j.ground).toEqual([]);
  });
});

describe('журнал по проектам', () => {
  it('прежний журнал без отметки открывается как «СНП»', () => {
    store.set('optiq-journal-v1', JSON.stringify({ ground: [shift('a', 480)] }));
    const j = loadJournal();
    expect(j.project?.id).toBe(SNP_PROJECT_ID);
    expect(j.project?.name).toBe('СНП');
    expect(j.ground.map((e) => e.id)).toEqual(['a']);
    // Пустой справочник «СНП» по-прежнему заменяется стартовым.
    expect(j.contractors.length).toBe(DEFAULT_CONTRACTORS.length);
  });

  it('смены Гипертрассы не видны в «СНП» и наоборот', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    saveJournal({ ...loadJournal(SNP_PROJECT_ID), ground: [shift('snp-1', 480)] });
    saveJournal({ ...loadJournal(HYPER.id), ground: [shift('gt-1', 2000)] });
    expect(loadJournal(SNP_PROJECT_ID).ground.map((e) => e.id)).toEqual(['snp-1']);
    expect(loadJournal(HYPER.id).ground.map((e) => e.id)).toEqual(['gt-1']);
  });

  it('открытый проект определяет, куда пишет loadJournal без номера', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    openProject(HYPER.id);
    saveJournal({ ...loadJournal(), ground: [shift('gt-1', 2000)] });
    expect(store.has('optiq-journal-v1@p-hyper')).toBe(true);
    expect(store.has('optiq-journal-v1')).toBe(false);
  });

  it('журнал, взятый до переключения, ложится в свой проект, а не в открытый', () => {
    // Обмен с облаком шёл, пока человек переключался на Гипертрассу:
    // слитый журнал сёл должен вернуться в «СНП».
    saveProjects([SNP_PROJECT, HYPER]);
    const snp = loadJournal(SNP_PROJECT_ID);
    openProject(HYPER.id);
    saveJournal({ ...snp, ground: [shift('snp-1', 480)] });
    expect(loadJournal(SNP_PROJECT_ID).ground.map((e) => e.id)).toEqual(['snp-1']);
    expect(loadJournal(HYPER.id).ground).toEqual([]);
  });

  it('у пустого нового проекта справочник пуст, а не стартовый сельский', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    expect(loadJournal(HYPER.id).contractors).toEqual([]);
    store.set('optiq-journal-v1@p-hyper', JSON.stringify({ ground: [] }));
    expect(loadJournal(HYPER.id).contractors).toEqual([]);
  });

  it('открытый проект свой у вкладки: соседняя вкладка его не переключает', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    openProject(HYPER.id);
    // Вторая вкладка открыла «СНП» и записала это в хранилище.
    store.set('optiq-build-project-open-v1', SNP_PROJECT_ID);
    expect(currentProjectId()).toBe(HYPER.id);
  });

  it('при новом запуске открывается проект, где закончили', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    openProject(HYPER.id);
    forgetOpenProject();
    expect(currentProjectId()).toBe(HYPER.id);
  });

  it('проект, которого в списке нет, не открывается — открывается «СНП»', () => {
    store.set('optiq-build-project-open-v1', 'p-gone');
    expect(currentProjectId()).toBe(SNP_PROJECT_ID);
  });

  it('битый список проектов не роняет журнал', () => {
    store.set('optiq-build-projects-v1', '{не json');
    expect(loadProjects()).toEqual([SNP_PROJECT]);
  });

  it('загрузка Excel кладёт смены в открытый проект и не снимает отметку', () => {
    const base = newProjectJournal(HYPER, []);
    const next = mergeJournal(base, { ground: [shift('x', 100)] });
    expect(next.project).toEqual(HYPER);
  });
});

describe('обмен и проект', () => {
  it('обмен оставляет журнал своим и берёт свежее название', () => {
    const mine = { ...emptyJournal(), project: HYPER };
    const theirs = { ...emptyJournal(), project: { ...HYPER, name: 'Гипертрасса Астана — Алматы', updatedAt: '2026-10-03T00:00:00.000Z' } };
    expect(mergeJournalStates(mine, theirs).merged.project?.name).toBe('Гипертрасса Астана — Алматы');
  });

  it('чужой проект своего не подменяет', () => {
    const later = { ...SNP_PROJECT, updatedAt: '2026-12-01T00:00:00.000Z' };
    expect(newerProject(HYPER, later)).toBe(HYPER);
  });

  it('журнал без отметки (с необновлённого устройства) не стирает отметку', () => {
    const mine = { ...emptyJournal(), project: SNP_PROJECT };
    expect(mergeJournalStates(mine, emptyJournal()).merged.project).toEqual(SNP_PROJECT);
  });
});

describe('срез субподрядчика по проекту', () => {
  const row = (project?: { id: string }) => ({ data: project ? { project } : {}, updated_at: '' });

  it('одна строка без отметки — это «СНП», как до деления', () => {
    const r = row();
    expect(pickProjectRow([r], SNP_PROJECT_ID)).toBe(r);
    expect(pickProjectRow([r], HYPER.id)).toBeNull();
  });

  it('строку магистрали в журнал сёл не берёт', () => {
    const snp = row();
    const gt = row({ id: HYPER.id });
    expect(pickProjectRow([gt, snp], SNP_PROJECT_ID)).toBe(snp);
    expect(pickProjectRow([gt], SNP_PROJECT_ID)).toBeNull();
  });

  it('две строки без отметки не угадывает', () => {
    expect(pickProjectRow([row(), row()], SNP_PROJECT_ID)).toBe('ambiguous');
  });
});

describe('один «СНП» на всех устройствах', () => {
  it('Гипертрасса, заведённая в конторе, появляется на телефоне', () => {
    const res = mergeProjectLists([SNP_PROJECT], [SNP_PROJECT, HYPER]);
    expect(res.list.map((p) => p.id)).toEqual([SNP_PROJECT_ID, HYPER.id]);
    expect(res.added).toEqual([HYPER]);
  });

  it('проект, которого в облаке ещё нет, со списка не пропадает', () => {
    const res = mergeProjectLists([SNP_PROJECT, HYPER], [SNP_PROJECT]);
    expect(res.list.map((p) => p.id)).toEqual([SNP_PROJECT_ID, HYPER.id]);
    expect(res.added).toEqual([]);
  });

  it('переименованный на другом устройстве — тот же проект с новым названием', () => {
    const renamed = { ...HYPER, name: 'Гипертрасса Астана — Алматы', updatedAt: '2026-10-04T00:00:00.000Z' };
    const res = mergeProjectLists([SNP_PROJECT, HYPER], [renamed]);
    expect(res.list).toHaveLength(2);
    expect(res.list[1].name).toBe('Гипертрасса Астана — Алматы');
    expect(res.renamed).toEqual([renamed]);
  });

  it('старое название из облака свежее не перебивает', () => {
    const fresh = { ...HYPER, name: 'Магистраль Freedom', updatedAt: '2026-10-09T00:00:00.000Z' };
    const res = mergeProjectLists([SNP_PROJECT, fresh], [HYPER]);
    expect(res.list[1].name).toBe('Магистраль Freedom');
    expect(res.renamed).toEqual([]);
  });

  it('«СНП» из облака с другим временем не становится вторым «СНП»', () => {
    const res = mergeProjectLists([SNP_PROJECT], [{ ...SNP_PROJECT, name: 'СНП 2026', updatedAt: '2026-10-02T00:00:00.000Z' }]);
    expect(res.list).toHaveLength(1);
    expect(res.list[0].name).toBe('СНП 2026');
  });

  it('строка организации без отметки — это «СНП» с необновлённого устройства', () => {
    expect(projectsFromRows('org-1', [{ org_key: 'org-1', project: null }])).toEqual([SNP_PROJECT]);
  });

  it('строку проекта узнаёт по ключу и берёт название из отметки', () => {
    const rows = [
      { org_key: 'org-1', project: { id: 'snp', name: 'СНП', createdAt: '', updatedAt: '' } },
      { org_key: 'org-1:p-hyper', project: { ...HYPER } },
      { org_key: 'org-2:p-other', project: { id: 'p-other', name: 'Чужой' } },
    ];
    expect(projectsFromRows('org-1', rows).map((p) => p.name)).toEqual(['СНП', 'Гипертрасса']);
  });

  it('проекту без отметки название не выдумывает', () => {
    expect(projectsFromRows('org-1', [{ org_key: 'org-1:p-x' }])[0].name).toBe('без названия (p-x)');
  });

  it('два проекта с одним названием с разных устройств называет вслух', () => {
    const twin = { ...HYPER, id: 'p-twin', name: 'гипертрасса' };
    expect(duplicateNames([SNP_PROJECT, HYPER, twin])).toEqual(['Гипертрасса']);
    expect(duplicateNames([SNP_PROJECT, HYPER])).toEqual([]);
  });
});

describe('прежний журнал стал «СНП» — сказать один раз', () => {
  it('там, где журнал вели до деления, — сказать', () => {
    expect(adoptionState(null, true)).toBe('due');
  });

  it('на чистом устройстве объяснять нечего', () => {
    expect(adoptionState(null, false)).toBe('done');
  });

  it('журнал, пришедший потом обменом, прежним не считается', () => {
    expect(adoptionDue(false)).toBe(false);
    expect(adoptionDue(true)).toBe(false);
  });

  it('после «понятно» больше не показывается', () => {
    expect(adoptionDue(true)).toBe(true);
    expect(adoptionDue(true)).toBe(true);
    markAdoptionSeen();
    expect(adoptionDue(true)).toBe(false);
  });
});

describe('переключатель проектов', () => {
  it('переименование оставляет тот же проект и ставит время правки', () => {
    const res = renameProject([SNP_PROJECT, HYPER], HYPER.id, 'Гипертрасса Астана — Алматы',
      new Date('2026-10-12T04:00:00Z'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.project.id).toBe(HYPER.id);
    expect(res.project.createdAt).toBe(HYPER.createdAt);
    expect(res.project.updatedAt).toBe('2026-10-12T04:00:00.000Z');
    expect(res.list.map((p) => p.name)).toEqual(['СНП', 'Гипертрасса Астана — Алматы']);
  });

  it('«СНП» тоже можно переименовать, номер у него остаётся', () => {
    const res = renameProject([SNP_PROJECT], SNP_PROJECT_ID, 'СНП 2026 — Транстелеком');
    expect(res.ok && res.project.id).toBe(SNP_PROJECT_ID);
  });

  it('в название другого проекта не переименовывает', () => {
    const res = renameProject([SNP_PROJECT, HYPER], HYPER.id, 'снп');
    expect(res.ok).toBe(false);
  });

  it('подписи — просто названия, пока они разные', () => {
    expect(projectLabels([SNP_PROJECT, HYPER])).toEqual({ snp: 'СНП', 'p-hyper': 'Гипертрасса' });
  });

  it('две «Гипертрассы» с разных устройств различает по дню заведения', () => {
    const twin = { ...HYPER, id: 'p-twin', createdAt: '2026-10-06T04:00:00.000Z' };
    const labels = projectLabels([SNP_PROJECT, HYPER, twin]);
    expect(labels['p-hyper']).toBe('Гипертрасса · заведён 01.10.2026');
    expect(labels['p-twin']).toBe('Гипертрасса · заведён 06.10.2026');
  });

  it('заведённые в один день различает по номеру', () => {
    const twin = { ...HYPER, id: 'p-twin' };
    const labels = projectLabels([HYPER, twin]);
    expect(labels['p-hyper']).not.toBe(labels['p-twin']);
    expect(labels['p-twin']).toContain('p-twin');
  });
});

describe('черновики и подсказки прошлой смены — у своего проекта', () => {
  const ctx: LastContext = {
    smu: '', contractor: 'TERRA TECH', oblast: 'Акмолинская область', rayon: 'Зерендинский',
    uchastok: 'Исаковка', kato: '191', tech: 'МКТ', equipment: { 'кабелеукладчик': 1 },
  };

  it('недописанная смена сёл не предлагается в Гипертрассе', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    saveDraft('day', { uchastok: 'Исаковка', meters: 480 });
    openProject(HYPER.id);
    expect(loadDraft('day')).toBeNull();
    openProject(SNP_PROJECT_ID);
    expect(loadDraft<{ meters: number }>('day')?.data.meters).toBe(480);
  });

  it('черновик, начатый до обновления, в «СНП» не теряется', () => {
    saveDraft('day', { meters: 120 });
    expect(store.has('optiq-draft-day')).toBe(true);
  });

  it('вчерашний участок и подрядчик сёл не подставляются в смену магистрали', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    saveLastContext(ctx);
    openProject(HYPER.id);
    expect(loadLastContext()).toBeNull();
    saveLastContext({ ...ctx, uchastok: 'Астана — Косшы', contractor: 'Модуль Строй' });
    openProject(SNP_PROJECT_ID);
    expect(loadLastContext()?.uchastok).toBe('Исаковка');
    expect(store.has('optiq-journal-last-v1')).toBe(true);
  });

  it('время обмена — у проекта, который обменивался', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    saveLastSyncAt('2026-10-12T04:40:00.000Z', SNP_PROJECT_ID);
    openProject(HYPER.id);
    expect(loadLastSyncAt()).toBeNull();
  });

  it('время обмена «СНП», пришедшее после переключения, Гипертрассе не достаётся', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    openProject(HYPER.id);
    saveLastSyncAt('2026-10-12T04:40:00.000Z', SNP_PROJECT_ID);
    expect(loadLastSyncAt()).toBeNull();
    expect(loadLastSyncAt(SNP_PROJECT_ID)).toBe('2026-10-12T04:40:00.000Z');
  });

  it('история загрузок — у своего проекта', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    saveImports([{ id: 'i1', at: '2026-10-01T00:00:00.000Z', file: 'сёла.xlsx', counts: {} }], SNP_PROJECT_ID);
    openProject(HYPER.id);
    expect(loadImports()).toEqual([]);
  });

  it('загрузку из книги, выбранной в «СНП», записывает в историю «СНП», даже если открыта Гипертрасса', () => {
    saveProjects([SNP_PROJECT, HYPER]);
    openProject(HYPER.id);
    saveImports([{ id: 'i1', at: '2026-10-01T00:00:00.000Z', file: 'сёла.xlsx', counts: {} }], SNP_PROJECT_ID);
    expect(loadImports()).toEqual([]);
    expect(loadImports(SNP_PROJECT_ID).map((r) => r.file)).toEqual(['сёла.xlsx']);
  });
});
