import { describe, it, expect } from 'vitest';
import { mergeFieldDataIntoDistricts, applyMergeStrategy } from './projectMerge';
import type { Project, District } from '@/types/network';

/**
 * Слияние проекта с сервером.
 *
 * Сеть рисуют в конторе, а поле заполняют на объекте: чеклист осмотра и
 * фотографии, которыми потом доказывают, что шкаф проверен. Слияние
 * должно поженить одно с другим, ничего не перепутав: фотография не того
 * шкафа хуже отсутствующей.
 */

const ork = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, lat: 52, lon: 69, subscribers: [], ...over }) as never;

const tb = (id: string, orks: unknown[], over: Record<string, unknown> = {}) =>
  ({ id, lat: 52, lon: 69, muftaType: 'МТОК-96', orks, ...over }) as never;

const district = (name: string, boxes: unknown[]): District =>
  ({ name, color: '#fff', subscribers: [], olt: { id: `OLT-${name}`, lat: 52, lon: 69, transitBoxes: boxes } }) as never;

describe('поле с сервера ложится на свою сеть', () => {
  it('чеклист и фото приходят к своему шкафу', () => {
    const local = [district('А', [tb('МТОК-1', [ork('ОРК-1')])])];
    const server = [district('А', [
      tb('МТОК-1', [ork('ОРК-1', { fieldChecklist: { ok: true }, fieldPhotos: ['p1'] })]),
    ])];
    const merged = mergeFieldDataIntoDistricts(local, server);
    const got = merged[0].olt.transitBoxes[0].orks[0] as never as Record<string, unknown>;
    expect(got.fieldPhotos).toEqual(['p1']);
  });

  it('своё поле не затирается, когда на сервере его нет', () => {
    const local = [district('А', [
      tb('МТОК-1', [ork('ОРК-1', { fieldPhotos: ['моё'] })]),
    ])];
    const server = [district('А', [tb('МТОК-1', [ork('ОРК-1')])])];
    const merged = mergeFieldDataIntoDistricts(local, server);
    const got = merged[0].olt.transitBoxes[0].orks[0] as never as Record<string, unknown>;
    expect(got.fieldPhotos).toEqual(['моё']);
  });

  it('топология остаётся локальной: сеть рисуют в конторе', () => {
    const local = [district('А', [tb('МТОК-1', [ork('ОРК-1'), ork('ОРК-2')])])];
    const server = [district('А', [tb('МТОК-1', [ork('ОРК-1')])])];
    const merged = mergeFieldDataIntoDistricts(local, server);
    expect(merged[0].olt.transitBoxes[0].orks).toHaveLength(2);
  });

  it('исходные данные не портятся: слияние возвращает копию', () => {
    const local = [district('А', [tb('МТОК-1', [ork('ОРК-1')])])];
    const server = [district('А', [
      tb('МТОК-1', [ork('ОРК-1', { fieldPhotos: ['p1'] })]),
    ])];
    mergeFieldDataIntoDistricts(local, server);
    const untouched = local[0].olt.transitBoxes[0].orks[0] as never as Record<string, unknown>;
    expect(untouched.fieldPhotos).toBeUndefined();
  });

  /**
   * Номера шкафов повторяются: «ОРК-1» есть почти у каждой транзитной
   * муфты. Фотография осмотра, попавшая к чужому шкафу, — это
   * доказательство проверки того, чего не проверяли.
   */
  it('одинаковые номера в разных муфтах не путаются', () => {
    const local = [district('А', [
      tb('МТОК-1', [ork('ОРК-1')]),
      tb('МТОК-2', [ork('ОРК-1')]),
    ])];
    const server = [district('А', [
      tb('МТОК-1', [ork('ОРК-1', { fieldPhotos: ['первый'] })]),
      tb('МТОК-2', [ork('ОРК-1', { fieldPhotos: ['второй'] })]),
    ])];
    const merged = mergeFieldDataIntoDistricts(local, server);
    const boxes = merged[0].olt.transitBoxes;
    expect((boxes[0].orks[0] as never as Record<string, unknown>).fieldPhotos).toEqual(['первый']);
    expect((boxes[1].orks[0] as never as Record<string, unknown>).fieldPhotos).toEqual(['второй']);
  });

  it('и в разных районах тоже', () => {
    const local = [
      district('А', [tb('МТОК-1', [ork('ОРК-1')])]),
      district('Б', [tb('МТОК-1', [ork('ОРК-1')])]),
    ];
    const server = [
      district('А', [tb('МТОК-1', [ork('ОРК-1', { fieldPhotos: ['А'] })])]),
      district('Б', [tb('МТОК-1', [ork('ОРК-1', { fieldPhotos: ['Б'] })])]),
    ];
    const merged = mergeFieldDataIntoDistricts(local, server);
    expect((merged[0].olt.transitBoxes[0].orks[0] as never as Record<string, unknown>).fieldPhotos)
      .toEqual(['А']);
    expect((merged[1].olt.transitBoxes[0].orks[0] as never as Record<string, unknown>).fieldPhotos)
      .toEqual(['Б']);
  });
});

describe('стратегии слияния', () => {
  const project = (over: Partial<Project> = {}): Project => ({
    id: 'p-local', name: 'Мой проект', districts: [], cables: [],
    updatedAt: '2026-07-01T00:00:00.000Z', ...over,
  } as Project);

  it('«всё с сервера» оставляет своё имя проекта', () => {
    const out = applyMergeStrategy(
      project(), project({ id: 'p-server', name: 'Чужой' }), 'server_all',
    );
    expect(out.id).toBe('p-local');
    expect(out.name).toBe('Мой проект');
  });

  it('«всё своё» не тянет ничего с сервера', () => {
    const server = project({ districts: [district('Чужой', [])] });
    expect(applyMergeStrategy(project(), server, 'local_all').districts).toHaveLength(0);
  });

  it('каждое слияние оставляет след в журнале', () => {
    for (const s of ['local_network_server_field', 'server_network_local_field'] as const) {
      const out = applyMergeStrategy(project(), project(), s);
      expect(out.auditLog?.length).toBe(1);
      expect(out.auditLog?.[0].action).toBe('Слияние');
    }
  });

  it('время правки обновляется — по нему решают, чья версия свежее', () => {
    for (const s of ['local_all', 'local_network_server_field', 'server_network_local_field'] as const) {
      const out = applyMergeStrategy(project(), project(), s);
      expect(out.updatedAt > '2026-07-01T00:00:00.000Z').toBe(true);
    }
  });
});
