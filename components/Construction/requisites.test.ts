import { describe, it, expect } from 'vitest';
import {
  withDefaults, emptyRequisites, binLooksWrong, missingForPayment,
  partyLine, signatureLine, contractLine, PARTY_FIELDS, DEFAULT_REQUISITES,
  type Requisites, type Party,
} from './requisites';

const FAVORIT: Party = {
  name: 'ТОО «СК Фаворит Инжиниринг»',
  bin: '123456789012',
  signer: 'Иванов И. И.',
  signerPosition: 'Директор',
  inPersonOf: 'Директора Иванова И. И.',
  basis: 'Устава',
};

describe('withDefaults', () => {
  it('пустой журнал получает названия по умолчанию', () => {
    const r = withDefaults(undefined);
    expect(r.contractor.name).toBe(DEFAULT_REQUISITES.contractor.name);
    expect(r.customer.name).toBe(DEFAULT_REQUISITES.customer.name);
  });

  it('заполненное не перебивает', () => {
    const r = withDefaults({ customer: { name: 'Акимат Ескельдинского района' } });
    expect(r.customer.name).toBe('Акимат Ескельдинского района');
    expect(r.contractor.name).toBe(DEFAULT_REQUISITES.contractor.name);
  });

  it('достраивает половину стороны, не теряя другую', () => {
    const r = withDefaults({ contractor: { name: 'ТОО «Дозер»', bin: '111111111111' } });
    expect(r.contractor.bin).toBe('111111111111');
    expect(r.contractor.name).toBe('ТОО «Дозер»');
  });

  it('номер договора переносит как есть', () => {
    expect(withDefaults({ contractNumber: '14', contractDate: '2026-03-12' }))
      .toMatchObject({ contractNumber: '14', contractDate: '2026-03-12' });
  });
});

describe('binLooksWrong', () => {
  it('двенадцать цифр — это БИН', () => {
    expect(binLooksWrong('123456789012')).toBe(false);
    expect(binLooksWrong('1234 5678 9012')).toBe(false);
  });

  it('всё остальное — опечатка', () => {
    expect(binLooksWrong('12345678901')).toBe(true);
    expect(binLooksWrong('1234567890123')).toBe(true);
    expect(binLooksWrong('12345678901а')).toBe(true);
  });

  it('пустое поле опечаткой не считается: его просто не заполнили', () => {
    expect(binLooksWrong('')).toBe(false);
    expect(binLooksWrong(undefined)).toBe(false);
  });
});

describe('missingForPayment', () => {
  it('полный комплект вопросов не вызывает', () => {
    const r: Requisites = {
      contractor: FAVORIT,
      customer: { name: 'АО «Транстелеком»', bin: '210987654321', signer: 'Петров П. П.' },
      contractNumber: '14',
    };
    expect(missingForPayment(r)).toEqual([]);
  });

  it('называет, чего не хватает, и у кого', () => {
    const missing = missingForPayment(emptyRequisites());
    expect(missing).toContain('подрядчик: название');
    expect(missing).toContain('заказчик: БИН');
    expect(missing).toContain('номер договора');
  });

  it('одного названия для акта на оплату мало', () => {
    const r = withDefaults(undefined);
    expect(missingForPayment(r).length).toBeGreaterThan(0);
    expect(missingForPayment(r)).not.toContain('подрядчик: название');
  });
});

describe('partyLine', () => {
  it('собирает шапку так, как её пишут в договоре', () => {
    expect(partyLine(FAVORIT)).toBe(
      'ТОО «СК Фаворит Инжиниринг», БИН 123456789012, '
      + 'в лице директора Иванова И. И., действующего на основании Устава',
    );
  });

  it('«в лице» пишет со строчной, как в середине фразы', () => {
    expect(partyLine({ name: 'ТОО', inPersonOf: 'Главного инженера Сериковой А. Б.' }))
      .toContain('в лице главного инженера Сериковой А. Б.');
  });

  /**
   * Сложить «в лице» из должности и фамилии нельзя: склонение зависит и
   * от должности, и от фамилии, и от того, чья она. Поэтому поле не
   * заполнено — фразы нет, а не «в лице директор Иванов И. И.».
   */
  it('без отдельного поля фразу не выдумывает', () => {
    expect(partyLine({ name: 'ТОО', signer: 'Иванов И. И.', signerPosition: 'Директор' }))
      .toBe('ТОО');
  });

  it('незаполненное не оставляет пустых запятых', () => {
    expect(partyLine({ name: 'ТОО «Дозер»' })).toBe('ТОО «Дозер»');
    expect(partyLine({ name: '' })).toBe('');
  });
});

describe('signatureLine', () => {
  it('должность, росчерк, фамилия', () => {
    expect(signatureLine(FAVORIT)).toBe('Директор _______________ Иванов И. И.');
  });

  it('без фамилии оставляет место под неё', () => {
    expect(signatureLine({ name: 'ТОО' })).toBe('_______________');
  });
});

describe('contractLine', () => {
  it('номер с датой', () => {
    expect(contractLine({ ...emptyRequisites(), contractNumber: '14', contractDate: '2026-03-12' }))
      .toBe('по договору № 14 от 12.03.2026');
  });

  it('номер без даты', () => {
    expect(contractLine({ ...emptyRequisites(), contractNumber: '14' }))
      .toBe('по договору № 14');
  });

  it('без номера строки нет вовсе', () => {
    expect(contractLine(emptyRequisites())).toBe('');
  });

  it('битая дата не попадает в документ', () => {
    expect(contractLine({ ...emptyRequisites(), contractNumber: '14', contractDate: 'вчера' }))
      .toBe('по договору № 14');
  });
});

describe('PARTY_FIELDS', () => {
  it('название спрашивают первым: без него документа нет', () => {
    expect(PARTY_FIELDS[0].key).toBe('name');
  });

  it('каждое поле подписано', () => {
    for (const f of PARTY_FIELDS) expect(f.label.length).toBeGreaterThan(0);
  });
});

/**
 * Реквизиты — общие данные: их заводят один раз и они уезжают на обмен
 * вместе с журналом. Проверяем, что ничего не теряется по дороге.
 */
describe('реквизиты переживают перенос', () => {
  it('после разбора и сборки те же', () => {
    const r: Requisites = {
      contractor: FAVORIT,
      customer: { name: 'АО «Транстелеком»', bin: '210987654321' },
      contractNumber: '14',
      contractDate: '2026-03-12',
    };
    expect(withDefaults(JSON.parse(JSON.stringify(r)) as Requisites)).toMatchObject(r);
  });
});
