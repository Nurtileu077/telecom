import { describe, it, expect, beforeEach } from 'vitest';
import { runJournalSync, importBookInto, type SyncSteps, type FilesSent } from './journalFlows';
import { loadJournal, saveJournal, type JournalState } from './journalStore';
import { loadLastSyncAt, saveLastSyncAt, type SyncOutcome } from './journalRemote';
import {
  SNP_PROJECT, SNP_PROJECT_ID, saveProjects, openProject, forgetOpenProject, currentProjectId,
  type BuildProject,
} from './projects';
import type { JournalImportResult } from './JournalImport';
import type { DailyWorkEntry, FieldPhoto } from '@/types/construction';

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

const HYPER: BuildProject = {
  id: 'p-hyper', name: 'Гипертрасса', createdAt: '2026-10-01T05:00:00.000Z', updatedAt: '2026-10-01T05:00:00.000Z',
};
const AT = '2026-10-12T04:40:00.000Z';

function shift(id: string, meters: number): DailyWorkEntry {
  return {
    kind: 'ground', id, date: '2026-10-05', smu: '', contractor: 'TERRA TECH',
    oblast: 'Акмолинская область', uchastok: 'Исаковка', kato: '191',
    byMethod: { 'кабелеукладчик': meters }, materials: {},
    createdAt: '2026-10-05T10:00:00.000Z', updatedAt: '2026-10-05T10:00:00.000Z',
  };
}

const nothingSent = (state: JournalState): FilesSent =>
  ({ state, sent: 0, failed: 0, changed: false, keys: [] });

/** Обмен, который ничего не меняет и отвечает «записано в облако». */
function steps(over: Partial<SyncSteps> = {}): SyncSteps {
  return {
    load: loadJournal,
    save: saveJournal,
    photos: async (base) => nothingSent(base),
    otdr: async (base) => nothingSent(base),
    dropLocal: async () => undefined,
    exchange: async (local): Promise<SyncOutcome> => ({
      ok: true, merged: local, stats: { pulled: 0, pushed: 0, conflicts: 0, removed: 0 }, at: AT, firstPush: false,
    }),
    markSynced: saveLastSyncAt,
    ...over,
  };
}

beforeEach(() => {
  fakeWindow();
  forgetOpenProject();
  saveProjects([SNP_PROJECT, HYPER]);
  saveJournal({ ...loadJournal(SNP_PROJECT_ID), ground: [shift('snp-1', 480)] });
  saveJournal({ ...loadJournal(HYPER.id), ground: [shift('gt-1', 2000)] });
  openProject(SNP_PROJECT_ID);
});

describe('обмен остаётся в проекте, где его начали', () => {
  it('переключились на Гипертрассу, пока ждали облако, — время обмена всё равно у «СНП»', async () => {
    const run = await runJournalSync(SNP_PROJECT_ID, steps({
      exchange: async (local) => {
        openProject(HYPER.id);
        return { ok: true, merged: local, stats: { pulled: 0, pushed: 1, conflicts: 0, removed: 0 }, at: AT, firstPush: false };
      },
    }));
    expect(run.ok).toBe(true);
    expect(currentProjectId()).toBe(HYPER.id);
    // Гипертрассу не отправляли — и «синхронизировано» у неё быть не должно.
    expect(loadLastSyncAt()).toBeNull();
    expect(loadLastSyncAt(SNP_PROJECT_ID)).toBe(AT);
  });

  it('переключились во время отправки фото — в облако уходит «СНП», а не Гипертрасса', async () => {
    const sent: string[] = [];
    await runJournalSync(SNP_PROJECT_ID, steps({
      photos: async (base) => { openProject(HYPER.id); return nothingSent(base); },
      otdr: async (base) => { sent.push(`рефлектограммы:${base.project?.id}`); return nothingSent(base); },
      exchange: async (local) => {
        sent.push(`журнал:${local.project?.id}`);
        return { ok: true, merged: local, stats: { pulled: 0, pushed: 0, conflicts: 0, removed: 0 }, at: AT, firstPush: false };
      },
    }));
    expect(sent).toEqual([`рефлектограммы:${SNP_PROJECT_ID}`, `журнал:${SNP_PROJECT_ID}`]);
  });

  it('ссылки на отправленные снимки ложатся в журнал «СНП», и обмен уносит уже их', async () => {
    const photo = { id: 'ph-1', pending: true } as FieldPhoto;
    saveJournal({ ...loadJournal(SNP_PROJECT_ID), photos: [photo] });
    let exchanged = null as JournalState | null;
    await runJournalSync(SNP_PROJECT_ID, steps({
      photos: async (base) => {
        openProject(HYPER.id);
        const photos = base.photos.map((p) => ({ ...p, pending: false, url: 'https://x/ph-1.jpg' }));
        return { state: { ...base, photos }, sent: 1, failed: 0, changed: true, keys: ['ph-1'] };
      },
      exchange: async (local) => {
        exchanged = local;
        return { ok: true, merged: local, stats: { pulled: 0, pushed: 0, conflicts: 0, removed: 0 }, at: AT, firstPush: false };
      },
    }));
    expect(exchanged!.photos.map((p) => p.url)).toEqual(['https://x/ph-1.jpg']);
    expect(loadJournal(SNP_PROJECT_ID).photos.map((p) => p.url)).toEqual(['https://x/ph-1.jpg']);
    expect(loadJournal(HYPER.id).photos).toEqual([]);
  });

  it('слитое из облака ложится в «СНП», а журнал Гипертрассы не трогает', async () => {
    await runJournalSync(SNP_PROJECT_ID, steps({
      exchange: async (local) => {
        openProject(HYPER.id);
        const merged = { ...local, ground: [...local.ground, shift('snp-remote', 300)] };
        return { ok: true, merged, stats: { pulled: 1, pushed: 0, conflicts: 0, removed: 0 }, at: AT, firstPush: false };
      },
    }));
    expect(loadJournal(SNP_PROJECT_ID).ground.map((e) => e.id)).toEqual(['snp-1', 'snp-remote']);
    expect(loadJournal(HYPER.id).ground.map((e) => e.id)).toEqual(['gt-1']);
  });

  it('слитое не записалось — «синхронизировано» не ставит', async () => {
    const run = await runJournalSync(SNP_PROJECT_ID, steps({ save: () => false }));
    expect(run.ok).toBe(false);
    expect(!run.ok && run.shown?.project?.id).toBe(SNP_PROJECT_ID);
    expect(loadLastSyncAt(SNP_PROJECT_ID)).toBeNull();
  });

  it('облако отказало — говорит его словами и время не ставит', async () => {
    const run = await runJournalSync(SNP_PROJECT_ID, steps({
      exchange: async () => ({ ok: false, reason: 'network', message: 'Не удалось синхронизировать: нет сети' }),
    }));
    expect(run).toEqual({ ok: false, text: 'Не удалось синхронизировать: нет сети' });
    expect(loadLastSyncAt(SNP_PROJECT_ID)).toBeNull();
  });
});

describe('книга Excel ложится в проект, где её выбрали', () => {
  const book = (ground: DailyWorkEntry[]): JournalImportResult => ({
    orders: [], ground, aerial: [], drills: [], warnings: [],
    stats: {
      sheets: ['DATA'], orderRows: 0, groundRows: ground.length, aerialRows: 0, drillRows: 0,
      drillPoints: 0, drillAmbiguous: 0, drillUnparsed: 0,
    },
  });

  it('сёльские строки, разобранные после переключения на Гипертрассу, уходят в «СНП»', async () => {
    const got = await importBookInto(SNP_PROJECT_ID, async () => {
      openProject(HYPER.id);
      return book([shift('xl-1', 120), shift('xl-2', 340)]);
    });
    expect(got).not.toBeNull();
    expect(got!.next.project?.id).toBe(SNP_PROJECT_ID);
    expect(saveJournal(got!.next)).toBe(true);
    expect(loadJournal(SNP_PROJECT_ID).ground.map((e) => e.id)).toEqual(['snp-1', 'xl-1', 'xl-2']);
    expect(loadJournal(HYPER.id).ground.map((e) => e.id)).toEqual(['gt-1']);
  });

  it('смену, записанную в «СНП», пока книга читалась, не затирает', async () => {
    const got = await importBookInto(SNP_PROJECT_ID, async () => {
      saveJournal({ ...loadJournal(SNP_PROJECT_ID), ground: [shift('snp-1', 480), shift('snp-new', 90)] });
      return book([shift('xl-1', 120)]);
    });
    expect(got!.next.ground.map((e) => e.id)).toEqual(['snp-1', 'snp-new', 'xl-1']);
  });

  it('считает, чего сколько пришло, — для истории загрузок', async () => {
    const got = await importBookInto(SNP_PROJECT_ID, async () => book([shift('xl-1', 120)]));
    expect(got!.counts).toEqual({ смены: 1, подвес: 0, проколы: 0, заказ: 0 });
  });

  it('книгу без наших листов отдаёт на разбор по колонкам', async () => {
    expect(await importBookInto(SNP_PROJECT_ID, async () => book([]))).toBeNull();
  });
});
