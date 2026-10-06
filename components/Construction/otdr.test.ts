import { describe, it, expect } from 'vitest';
import {
  otdrKey, otdrAttached, otdrFileName, otdrLines, measuredObjects, measureInput,
  measuredInPeriod, uploadPendingOtdr, objectLabel, uniqueFileName, measuredForPack,
} from './otdr';
import type { SiteObject, SpliceRecord } from '@/types/construction';

function rec(over: Partial<SpliceRecord> = {}): SpliceRecord {
  return {
    id: 's1', objectId: 'm1', date: '2026-09-10',
    fibers: [{ fiber: 1, lossDb: 0.05 }],
    createdAt: '', updatedAt: '', ...over,
  };
}

function mufta(over: Partial<SiteObject> = {}): SiteObject {
  return {
    id: 'm1', kind: 'mufta', name: 'Муфта №1', lat: 51, lon: 71,
    uchastok: 'Еленовка', ...over,
  } as SiteObject;
}

describe('рефлектограмма протокола сварки', () => {
  it('файл есть, если он лежит на устройстве или уже в облаке', () => {
    expect(otdrAttached(rec({ otdrPending: true }))).toBe(true);
    expect(otdrAttached(rec({ otdrUrl: 'https://x/otdr.sor' }))).toBe(true);
    expect(otdrAttached(rec({ otdrName: 'OTDR.sor' }))).toBe(false);
  });

  it('ключ файла не путается с ключом снимка', () => {
    expect(otdrKey('s1')).toBe('otdr-s1');
  });

  it('имя файла — исходное, а без него — по муфте и дате', () => {
    expect(otdrFileName(rec({ otdrName: 'trace/1550.sor' }))).toBe('trace 1550.sor');
    expect(otdrFileName(rec(), 'Муфта №1')).toBe('Рефлектограмма Муфта №1 2026-09-10');
  });

  it('в протоколе без архива файл «в журнале», а не «прилагается»', () => {
    const lines = otdrLines([rec({ otdrName: 'a.sor', otdrPending: true })]);
    expect(lines[0].status).toBe('файл в журнале, выдаётся по запросу');
  });

  it('в пакете легшая в архив рефлектограмма прилагается, а не легшая — так и названа', () => {
    const records = [
      rec({ id: 's1', otdrName: 'a.sor', otdrPending: true }),
      rec({ id: 's2', otdrName: 'b.sor', otdrUrl: 'https://x/b.sor' }),
    ];
    const lines = otdrLines(records, 'Муфта №1', new Map([['s1', 'Муфта №1 a.sor']]));
    expect(lines[0].name).toBe('Муфта №1 a.sor');
    expect(lines[0].status).toContain('прилагается');
    expect(lines[1].status).toContain('в архив не попала');
  });

  it('записанное только имя не выдаётся за приложенный файл', () => {
    const lines = otdrLines([rec({ otdrName: 'OTDR_m3.sor' })]);
    expect(lines).toEqual([{ name: 'OTDR_m3.sor', status: 'файл не загружен — записано только имя' }]);
  });

  it('протокол без всякой рефлектограммы не получает пустых строк приложения', () => {
    expect(otdrLines([rec()])).toEqual([]);
  });
});

describe('муфты для протокола измерений', () => {
  const objects = [
    mufta(),
    mufta({ id: 'm2', name: 'Муфта №2' }),
    mufta({ id: 'm3', name: 'Муфта №10', uchastok: 'Обалы' }),
  ];
  const splices = [
    rec({ id: 'a', objectId: 'm3' }),
    rec({ id: 'b', objectId: 'm2', date: '2026-09-12' }),
    rec({ id: 'c', objectId: 'm1' }),
    rec({ id: 'd', objectId: 'm2', date: '2026-09-01' }),
    rec({ id: 'e', objectId: 'gone' }),
  ];

  it('выбирается любая муфта, а не всегда первая записанная', () => {
    const list = measuredObjects(objects, splices);
    expect(list.map((m) => m.name)).toEqual([
      'Муфта, удалённая с карты', 'Муфта №1', 'Муфта №2', 'Муфта №10',
    ]);
  });

  it('безымянные муфты различаются по номеру, как в списке объектов', () => {
    expect(objectLabel({ name: '', number: '3' })).toBe('Муфта №3');
    expect(objectLabel({ name: 'МТОК', number: '7' })).toBe('МТОК №7');
    expect(objectLabel({ name: '', number: '' })).toBe('Муфта без названия');
    const list = measuredObjects(
      [mufta({ id: 'x', name: '', number: '3' }), mufta({ id: 'y', name: '', number: '4' })],
      [rec({ id: 'r1', objectId: 'x' }), rec({ id: 'r2', objectId: 'y' })],
    );
    expect(list.map((m) => m.name)).toEqual(['Муфта №3', 'Муфта №4']);
  });

  it('смены без участка («—») не тянут за собой протоколы всех муфт журнала', () => {
    expect(measuredObjects(objects, splices, '—')).toEqual([]);
  });

  it('в пакет идут муфты по замерам за период, а не по участкам со сменами', () => {
    // Сварили и померили, когда смен на участке уже не было: отбор по
    // сменам эту муфту терял, а муфту без участка — всегда.
    const list = measuredForPack(
      [mufta({ id: 'm9', uchastok: undefined, name: '', number: '9' })],
      [rec({ id: 'late', objectId: 'm9', date: '2026-09-25' })],
      '2026-09-20', '2026-09-30',
    );
    expect(list.map((m) => m.name)).toEqual(['Муфта №9']);
  });

  it('муфты участка отбираются по участку, нестрого к написанию', () => {
    const list = measuredObjects(objects, splices, 'с. Еленовка');
    expect(list.map((m) => m.objectId)).toEqual(['m1', 'm2']);
  });

  it('протоколы сварки муфты идут по дате', () => {
    const m2 = measuredObjects(objects, splices).find((m) => m.objectId === 'm2')!;
    expect(m2.records.map((r) => r.id)).toEqual(['d', 'b']);
  });

  it('в пакет идёт муфта, по которой мерили в периоде', () => {
    const m2 = measuredObjects(objects, splices).find((m) => m.objectId === 'm2')!;
    expect(measuredInPeriod(m2, '2026-09-10', '2026-09-30')).toBe(true);
    expect(measuredInPeriod(m2, '2026-09-13', '2026-09-30')).toBe(false);
  });

  it('измерения подписывает тот, кто варил, а не пустой фильтр', () => {
    const m = measuredObjects(objects, [rec({ contractor: 'TERRA TECH' })])[0];
    expect(measureInput(m, {}).contractor).toBe('TERRA TECH');
    expect(measureInput(measuredObjects(objects, [rec()])[0], { contractor: 'Фаворит' }).contractor)
      .toBe('Фаворит');
  });
});

describe('отправка рефлектограмм', () => {
  it('отправленная получает ссылку, а копию на телефоне стирают только после записи журнала', async () => {
    const res = await uploadPendingOtdr([rec({ otdrPending: true, otdrName: 'a.sor' })], {
      get: async () => new Blob(['x']),
      upload: async (id, name) => ({ url: `https://x/${id}/${name}`, storagePath: `p/${id}` }),
    }, () => 'T');
    expect(res.sent).toBe(1);
    expect(res.splices[0]).toMatchObject({
      otdrUrl: 'https://x/s1/a.sor', otdrStoragePath: 'p/s1', otdrPending: false, updatedAt: 'T',
    });
    // Сама отправка ничего не стирает: если журнал потом не запишется
    // (память браузера кончилась), файл должен остаться на телефоне.
    expect(res.sentKeys).toEqual(['otdr-s1']);
  });

  it('при обрыве связи файл остаётся ждать и не теряется', async () => {
    const res = await uploadPendingOtdr([rec({ otdrPending: true })], {
      get: async () => new Blob(['x']),
      upload: async () => { throw new Error('нет сети'); },
    });
    expect(res.failed).toBe(1);
    expect(res.splices[0].otdrPending).toBe(true);
    expect(res.sentKeys).toEqual([]);
  });

  it('файл, приложенный на другом телефоне, не считается ошибкой здесь', async () => {
    const res = await uploadPendingOtdr([rec({ otdrPending: true })], {
      get: async () => null,
      upload: async () => ({ url: '', storagePath: '' }),
    });
    expect(res).toMatchObject({ sent: 0, failed: 0, elsewhere: 1 });
    expect(res.splices[0].otdrPending).toBe(true);
  });
});

describe('имена файлов в архиве', () => {
  it('три «1550.sor» одного дня не затирают друг друга', () => {
    const taken = new Set<string>();
    expect(['1550.sor', '1550.sor', '1550.sor'].map((n) => uniqueFileName(n, taken)))
      .toEqual(['1550.sor', '1550 (2).sor', '1550 (3).sor']);
  });

  it('две безымянные муфты участка дают два протокола, а не один', () => {
    const taken = new Set<string>();
    const a = uniqueFileName('Протокол измерений Муфта без названия 2026-09-30.doc', taken);
    const b = uniqueFileName('Протокол измерений Муфта без названия 2026-09-30.doc', taken);
    expect(a).not.toBe(b);
    expect(b.endsWith('.doc')).toBe(true);
  });

  it('имя без расширения тоже получает номер', () => {
    const taken = new Set(['Схема']);
    expect(uniqueFileName('Схема', taken)).toBe('Схема (2)');
  });
});
