import { describe, it, expect } from 'vitest';
import { changeFeed, filterFeed } from './changeLog';
import {
  emptyJournal, updateRouteCoords, deleteRoute, restoreRoute, logChange,
  type JournalState,
} from './journalStore';
import type { PlanRoute } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'r1', name: 'Еленовка Ивановка',
    coords: [[51.5, 71.5], [51.6, 71.6]],
    lengthM: 12400, source: 'kml', createdAt: now, updatedAt: now, ...over,
  };
}

function base(): JournalState {
  return { ...emptyJournal(), planRoutes: [route()] };
}

describe('правка трассы без одобрения, но с записью', () => {
  it('правка применяется сразу и оставляет след', () => {
    const next = updateRouteCoords(base(), 'r1', [[51.5, 71.5], [51.7, 71.7]], {
      author: 'Ербол', lengthM: 12900,
    });
    expect(next.planRoutes[0].lengthM).toBe(12900);
    expect(next.changes).toHaveLength(1);
    expect(next.changes[0].author).toBe('Ербол');
    expect(next.changes[0].kind).toBe('route_edit');
    expect(next.changes[0].detail).toBe('было 12,400 км, стало 12,900 км');
    // «Как было» — это координаты, а не слова.
    expect(next.changes[0].before).toEqual([[51.5, 71.5], [51.6, 71.6]]);
  });

  it('удаление тоже записывается — иначе возвращать неоткуда', () => {
    const next = deleteRoute(base(), 'r1', 'Ербол');
    expect(next.planRoutes).toHaveLength(0);
    expect(next.changes[0].kind).toBe('route_delete');
    expect(next.changes[0].before).toHaveLength(2);
  });

  it('вернуть как было — возвращает геометрию', () => {
    const edited = updateRouteCoords(base(), 'r1', [[51.5, 71.5], [51.9, 71.9]], {
      author: 'Ербол', lengthM: 40000,
    });
    const back = restoreRoute(edited, edited.changes[0].id, 'Асет');
    expect(back.planRoutes[0].coords).toEqual([[51.5, 71.5], [51.6, 71.6]]);
    // История не переписывается, она продолжается.
    expect(back.changes).toHaveLength(2);
    expect(back.changes[0].author).toBe('Асет');
  });

  it('удалённая трасса возвращается целиком', () => {
    const gone = deleteRoute(base(), 'r1', 'Ербол');
    const back = restoreRoute(gone, gone.changes[0].id, 'Асет');
    expect(back.planRoutes).toHaveLength(1);
    expect(back.planRoutes[0].coords).toHaveLength(2);
  });

  it('правка несуществующей трассы ничего не ломает', () => {
    const b = base();
    expect(updateRouteCoords(b, 'нет-такой', [], { author: 'Х', lengthM: 0 })).toBe(b);
    expect(deleteRoute(b, 'нет-такой', 'Х')).toBe(b);
  });
});

describe('единая лента изменений', () => {
  const j: JournalState = {
    ...emptyJournal(),
    deviations: [{
      id: 'd1', kind: 'depth', date: '2026-09-11',
      oblast: 'Акмолинская область', rayon: 'Аршалынский',
      uchastok: 'Еленовка', kato: '191',
      lengthM: 50, designDepthM: 1.2, actualDepthM: 0.5,
      reason: 'Скальный грунт', author: 'Ербол',
      createdAt: '2026-09-11T10:00:00.000Z', updatedAt: now,
    }],
    progress: [{
      kato: '191', snp: 'Еленовка', oblast: 'Акмолинская область',
      stages: { mkt: { status: 'done', doneAt: '2026-09-12T08:00:00.000Z', by: 'Асет' } },
      updatedAt: now,
    }],
  };

  it('собирает отклонения и отметки этапов в одну ленту по времени', () => {
    const feed = changeFeed(j);
    expect(feed.map((i) => i.kind)).toEqual(['stage', 'deviation']);
    expect(feed[0].author).toBe('Асет');
  });

  it('выведенные этапы в ленту не попадают — их никто не отмечал', () => {
    const derived: JournalState = {
      ...j,
      progress: [{
        ...j.progress[0],
        stages: { mkt: { status: 'done', doneAt: '2026-09-12T08:00:00.000Z', derived: true } },
      }],
    };
    expect(changeFeed(derived).some((i) => i.kind === 'stage')).toBe(false);
  });

  it('правка трассы попадает в ленту и помечена возвратной', () => {
    const withRoute = updateRouteCoords(
      { ...j, planRoutes: [route()] }, 'r1', [[51.5, 71.5], [51.7, 71.7]],
      { author: 'Ербол', lengthM: 12900 },
    );
    const item = changeFeed(withRoute).find((i) => i.kind === 'route')!;
    expect(item.restorable).toBe(true);
    expect(item.target).toBe('Еленовка Ивановка');
  });

  it('фильтр по виду и поиску отбирает, а не прячет всё', () => {
    const feed = changeFeed(j);
    expect(filterFeed(feed, { kinds: new Set(['stage']) })).toHaveLength(1);
    expect(filterFeed(feed, { q: 'скальный' })).toHaveLength(1);
    expect(filterFeed(feed, { q: 'мангистау' })).toHaveLength(0);
    expect(filterFeed(feed, { kinds: new Set() })).toHaveLength(2);
  });

  it('чужая область не показывается, запись без области — показывается', () => {
    const mixed = logChange(j, {
      author: 'Х', kind: 'route_edit', target: 'без области',
    });
    const feed = changeFeed(mixed);
    const only = filterFeed(feed, { oblast: 'Акмолинская область' });
    expect(only.some((i) => i.target === 'без области')).toBe(true);

    const foreign = logChange(j, {
      author: 'Х', kind: 'route_edit', target: 'чужая', oblast: 'Мангистауская область',
    });
    expect(filterFeed(changeFeed(foreign), { oblast: 'Акмолинская область' })
      .some((i) => i.target === 'чужая')).toBe(false);
  });
});
