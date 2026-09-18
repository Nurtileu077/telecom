import { describe, it, expect } from 'vitest';
import {
  isStageReady, pendingTasks, tasksForCrewKind, blockedStages,
  snpCompletion, stageSummary, seedProgress, stageStatus, handoffTasks,
} from './stageTasks';
import type { SnpProgress, SnpStage, DailyWorkEntry, DrillLogEntry } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function snp(over: Partial<SnpProgress> = {}): SnpProgress {
  return {
    kato: '191', snp: 'Еленовка', oblast: 'Акмолинская область',
    rayon: 'Аршалынский', stages: {}, updatedAt: now, ...over,
  };
}

const done = (at = now) => ({ status: 'done' as const, doneAt: at });

describe('готовность этапа', () => {
  it('первый этап готов сразу — иначе стройка не начнётся', () => {
    expect(isStageReady(snp(), 'mkt')).toBe(true);
  });

  it('следующий этап ждёт закрытия предыдущего', () => {
    const p = snp();
    expect(isStageReady(p, 'gnb')).toBe(false);
    const after = snp({ stages: { mkt: done() } });
    expect(isStageReady(after, 'gnb')).toBe(true);
  });

  it('этап в работе больше не наряд', () => {
    const p = snp({ stages: { mkt: done(), gnb: { status: 'in_progress' } } });
    expect(isStageReady(p, 'gnb')).toBe(false);
  });

  it('остановленный этап тоже не наряд — сначала разберитесь с причиной', () => {
    const p = snp({ stages: { mkt: done(), gnb: { status: 'blocked', blockReason: 'Нет техники' } } });
    expect(isStageReady(p, 'gnb')).toBe(false);
  });
});

describe('наряды между бригадами', () => {
  it('закрыли МКТ — у ГНБ появился наряд на этот СНП', () => {
    const tasks = pendingTasks([snp({ stages: { mkt: done('2026-09-10T08:00:00Z') } })]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].stage).toBe('gnb');
    expect(tasks[0].after).toBe('mkt');
    expect(tasks[0].crewKind).toBe('gnb');
    expect(tasks[0].snp).toBe('Еленовка');
    expect(tasks[0].readySince).toBe('2026-09-10T08:00:00Z');
  });

  it('по СНП выдаётся один наряд — следующий откроется после закрытия', () => {
    const p = snp({ stages: { mkt: done(), gnb: done(), zaduvka: done() } });
    const tasks = pendingTasks([p]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].stage).toBe('podves');
  });

  it('нетронутый СНП даёт наряд на первый этап', () => {
    const tasks = pendingTasks([snp()]);
    expect(tasks[0].stage).toBe('mkt');
    expect(tasks[0].crewKind).toBe('mkt');
  });

  it('пока этап в работе, нарядов по СНП нет', () => {
    const tasks = pendingTasks([snp({ stages: { mkt: { status: 'in_progress' } } })]);
    expect(tasks).toHaveLength(0);
  });

  it('полностью закрытый СНП нарядов не даёт', () => {
    const p = snp({
      stages: {
        mkt: done(), gnb: done(), zaduvka: done(),
        podves: done(), svarka: done(), sdacha: done(),
      },
    });
    expect(pendingTasks([p])).toHaveLength(0);
  });

  it('наряды сортируются: кто дольше ждёт, тот выше', () => {
    const tasks = pendingTasks([
      snp({ kato: 'b', snp: 'Второй', stages: { mkt: done('2026-09-12T00:00:00Z') } }),
      snp({ kato: 'a', snp: 'Первый', stages: { mkt: done('2026-09-10T00:00:00Z') } }),
    ]);
    expect(tasks.map((t) => t.snp)).toEqual(['Первый', 'Второй']);
  });

  it('подтягивает плановый объём и число проколов', () => {
    const drills: DrillLogEntry[] = [{
      kind: 'drill', id: 'd1', date: '2026-09-11', smu: '', oblast: '', uchastok: '',
      kato: '191', drillKind: 'ГНБ', meters: 72, count: 3, points: [],
      createdAt: now, updatedAt: now,
    }];
    const tasks = pendingTasks([snp({ stages: { mkt: done() } })], {
      orders: [{ kato: '191', oblast: 'А', snp: 'Еленовка', planVolsM: 12500 }],
      drills,
    });
    expect(tasks[0].planM).toBe(12500);
    expect(tasks[0].drillCount).toBe(3);
  });

  it('рабочий стол бригады отбирает только свои наряды', () => {
    const tasks = pendingTasks([
      snp({ kato: 'a', stages: { mkt: done() } }),                 // → ГНБ
      snp({ kato: 'b', stages: { mkt: done(), gnb: done() } }),    // → задувка
    ]);
    expect(tasksForCrewKind(tasks, 'gnb')).toHaveLength(1);
    expect(tasksForCrewKind(tasks, 'zaduvka')).toHaveLength(1);
    expect(tasksForCrewKind(tasks, 'svarka')).toHaveLength(0);
  });
});

describe('простои', () => {
  it('собирает остановленные этапы с причиной', () => {
    const p = snp({
      stages: { mkt: { status: 'blocked', blockReason: 'Ждём согласование', startedAt: now } },
    });
    const rows = blockedStages([p]);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('Ждём согласование');
    expect(rows[0].stage).toBe('mkt');
  });

  it('без причины подставляет честную заглушку, а не пустоту', () => {
    const p = snp({ stages: { mkt: { status: 'blocked' } } });
    expect(blockedStages([p])[0].reason).toBe('причина не указана');
  });
});

describe('сводка по этапам', () => {
  it('доля закрытых этапов', () => {
    expect(snpCompletion(snp())).toBe(0);
    expect(snpCompletion(snp({ stages: { mkt: done(), gnb: done(), zaduvka: done() } }))).toBe(0.5);
  });

  it('СНП считается на этапе, который в работе', () => {
    const s = stageSummary([snp({ stages: { mkt: done(), gnb: { status: 'in_progress' } } })]);
    expect(s.gnb).toBe(1);
    expect(s.mkt).toBe(0);
  });

  it('без активного этапа СНП стоит на первом незакрытом', () => {
    const s = stageSummary([snp({ stages: { mkt: done() } })]);
    expect(s.gnb).toBe(1);
  });

  it('полностью закрытый СНП никуда не попадает', () => {
    const p = snp({
      stages: {
        mkt: done(), gnb: done(), zaduvka: done(),
        podves: done(), svarka: done(), sdacha: done(),
      },
    });
    const s = stageSummary([p]);
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('заведение карточек СНП', () => {
  const entry: DailyWorkEntry = {
    kind: 'ground', id: 'g1', date: '2026-09-10', smu: '',
    oblast: 'Костанайская область', rayon: 'Алтынсаринский',
    uchastok: 'Убаган', kato: '391', byMethod: {}, materials: {},
    createdAt: now, updatedAt: now,
  };

  it('берёт населённые пункты из реестра и из дневных записей', () => {
    const rows = seedProgress(
      [{ kato: '191', oblast: 'А', snp: 'Еленовка' }],
      [entry],
    );
    expect(rows.map((r) => r.kato).sort()).toEqual(['191', '391']);
  });

  it('не затирает уже заведённые этапы', () => {
    const existing = [snp({ kato: '191', stages: { mkt: done() } })];
    const rows = seedProgress([{ kato: '191', oblast: 'А', snp: 'Еленовка' }], [], existing);
    expect(rows).toHaveLength(1);
    expect(stageStatus(rows[0], 'mkt')).toBe('done');
  });

  it('записи без КАТО пропускаются, а не плодят пустые карточки', () => {
    const rows = seedProgress([], [{ ...entry, kato: '' }]);
    expect(rows).toHaveLength(0);
  });
});

describe('переданный фронт против бэклога', () => {
  it('непочатый СНП — это бэклог, а не переданный фронт', () => {
    const tasks = pendingTasks([snp()]);
    expect(tasks).toHaveLength(1);
    expect(handoffTasks(tasks)).toHaveLength(0);
  });

  it('закрытый предыдущий этап делает наряд переданным фронтом', () => {
    const tasks = pendingTasks([snp({ stages: { mkt: done() } })]);
    expect(handoffTasks(tasks)).toHaveLength(1);
    expect(handoffTasks(tasks)[0].stage).toBe('gnb');
  });

  it('сотня непочатых СНП не раздувает счётчик ожидания', () => {
    const many = Array.from({ length: 100 }, (_, i) => snp({ kato: `k${i}` }));
    const waiting = snp({ kato: 'w', stages: { mkt: done() } });
    const tasks = pendingTasks([...many, waiting]);
    expect(tasks).toHaveLength(101);
    expect(handoffTasks(tasks).map((t) => t.kato)).toEqual(['w']);
  });
});
