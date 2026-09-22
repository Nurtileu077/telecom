import { describe, it, expect } from 'vitest';
import {
  effectiveStatus, daysLeft, reminders, ofKind, countByKind, contactsText,
  RECORD_KINDS, RECORD_KIND_LIST, type SiteRecord,
} from './siteRecords';

function r(patch: Partial<SiteRecord> = {}): SiteRecord {
  return {
    id: patch.id ?? 'x', kind: 'permit', title: 'Согласование с дорожниками',
    status: 'открыто', createdAt: '', updatedAt: '', ...patch,
  };
}

describe('effectiveStatus', () => {
  it('просроченным запись становится сама', () => {
    expect(effectiveStatus(r({ until: '2026-07-01' }), '2026-07-25')).toBe('просрочено');
  });

  it('закрытое не протухает — у него уже есть исход', () => {
    expect(effectiveStatus(r({ until: '2026-07-01', status: 'закрыто' }), '2026-07-25'))
      .toBe('закрыто');
  });

  it('без срока состояние остаётся тем, что поставили', () => {
    expect(effectiveStatus(r({ status: 'в работе' }), '2026-07-25')).toBe('в работе');
  });

  it('срок ещё не подошёл — ничего не меняется', () => {
    expect(effectiveStatus(r({ until: '2026-08-01' }), '2026-07-25')).toBe('открыто');
  });
});

describe('daysLeft', () => {
  it('считает дни до срока', () => {
    expect(daysLeft(r({ until: '2026-08-01' }), '2026-07-25')).toBe(7);
  });

  it('просроченное показывает минусом', () => {
    expect(daysLeft(r({ until: '2026-07-20' }), '2026-07-25')).toBe(-5);
  });

  it('без срока считать нечего', () => {
    expect(daysLeft(r(), '2026-07-25')).toBeNull();
  });
});

describe('reminders', () => {
  const list = [
    r({ id: 'a', until: '2026-07-20' }),                    // просрочено
    r({ id: 'b', until: '2026-07-28' }),                    // через 3 дня
    r({ id: 'c', until: '2026-09-01' }),                    // далеко
    r({ id: 'd', until: '2026-07-20', status: 'закрыто' }), // закрыто
    r({ id: 'e' }),                                          // без срока
  ];

  it('напоминает о просроченном и о том, что вот-вот истечёт', () => {
    const rem = reminders(list, 7, '2026-07-25');
    expect(rem.map((x) => x.record.id)).toEqual(['a', 'b']);
    expect(rem[0].level).toBe('overdue');
    expect(rem[1].level).toBe('soon');
  });

  it('закрытое и бессрочное не тревожит', () => {
    const ids = reminders(list, 7, '2026-07-25').map((x) => x.record.id);
    expect(ids).not.toContain('d');
    expect(ids).not.toContain('e');
  });

  it('запас дней настраивается', () => {
    expect(reminders(list, 60, '2026-07-25').map((x) => x.record.id))
      .toEqual(['a', 'b', 'c']);
  });
});

describe('ofKind', () => {
  const list = [
    r({ id: 'a', kind: 'permit', until: '2026-09-01' }),
    r({ id: 'b', kind: 'permit', until: '2026-07-28' }),
    r({ id: 'c', kind: 'contact', title: 'Яковлев' }),
    r({ id: 'd', kind: 'contact', title: 'Абенов' }),
  ];

  it('срочное — сверху', () => {
    expect(ofKind(list, 'permit').map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('контакты — по алфавиту: у них срока нет', () => {
    expect(ofKind(list, 'contact').map((x) => x.title)).toEqual(['Абенов', 'Яковлев']);
  });

  it('чужой вид не попадает', () => {
    expect(ofKind(list, 'task')).toEqual([]);
  });
});

describe('countByKind', () => {
  it('считает всё и отдельно то, что требует внимания', () => {
    const counts = countByKind([
      r({ id: 'a', kind: 'permit', until: '2026-07-20' }),
      r({ id: 'b', kind: 'permit', until: '2026-12-01' }),
      r({ id: 'c', kind: 'task', until: '2026-07-26' }),
    ], '2026-07-25');
    const permits = counts.find((c) => c.kind === 'permit')!;
    expect(permits.total).toBe(2);
    expect(permits.attention).toBe(1);
    expect(counts.find((c) => c.kind === 'task')?.attention).toBe(1);
  });

  it('все виды перечислены, даже пустые', () => {
    expect(countByKind([]).map((c) => c.kind)).toEqual(RECORD_KIND_LIST);
  });
});

describe('contactsText', () => {
  it('контакты пересылают целиком', () => {
    const text = contactsText([
      r({ id: 'a', kind: 'contact', title: 'Аким с/о', who: 'Абенов Б.', phone: '+7 777 000 00 00' }),
      r({ id: 'b', kind: 'permit', title: 'не контакт' }),
    ]);
    expect(text).toContain('Аким с/о');
    expect(text).toContain('+7 777 000 00 00');
    expect(text).not.toContain('не контакт');
  });
});

describe('виды записей', () => {
  it('у каждого своя подпись поля «кто»', () => {
    expect(RECORD_KINDS.permit.whoLabel).toBe('Кто выдал');
    expect(RECORD_KINDS.clearance.whoLabel).toBe('Кому');
  });

  it('у контакта срока нет', () => {
    expect(RECORD_KINDS.contact.dated).toBe(false);
  });
});
