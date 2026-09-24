/**
 * Реквизиты сторон.
 *
 * Пока заказчик один, его название можно держать в коде. Но подряд
 * меняется: сегодня работы идут под Транстелекомом, завтра — под другим
 * заказчиком, а рядом свой объект напрямую с акиматом. И каждый раз
 * приходится либо править каждый документ руками после выгрузки, либо
 * просить переписать программу.
 *
 * Поэтому реквизиты — данные, а не код. Они лежат в журнале рядом со
 * сменами, уезжают на обмен вместе с ним и попадают в каждый документ
 * сами.
 *
 * Заполнять всё необязательно: документ печатается и с одним названием.
 * БИН и адрес нужны там, где документ уходит на оплату, — в остальных
 * случаях их и не спрашивают.
 */

export interface Party {
  /** Как подписывают: «ТОО «СК Фаворит Инжиниринг»». */
  name: string;
  /** БИН — его спрашивают в актах на оплату. */
  bin?: string;
  address?: string;
  phone?: string;
  /** Кто подписывает: фамилия с инициалами, как под подписью. */
  signer?: string;
  /** Должность подписывающего: «Директор», «Главный инженер». */
  signerPosition?: string;
  /**
   * «В лице кого» — родительным падежом, как в договоре.
   *
   * Отдельным полем, а не выводом из должности и фамилии: «директора
   * Иванова И. И.», «главного инженера Сериковой А. Б.», «и. о.
   * директора Ким В. С.» — склонение зависит и от должности, и от
   * фамилии, и от того, чья она. Выводить это по правилам значит
   * ошибаться в документе, который подписывают.
   */
  inPersonOf?: string;
  /** По какому документу действует: «на основании Устава», доверенность. */
  basis?: string;
}

export interface Requisites {
  /** Наша сторона: от чьего имени сдаются работы. */
  contractor: Party;
  /** Кому сдаются. */
  customer: Party;
  /** Номер и дата договора — их пишут в шапке акта. */
  contractNumber?: string;
  contractDate?: string;
  updatedAt?: string;
}

export const EMPTY_PARTY: Party = { name: '' };

export const DEFAULT_REQUISITES: Requisites = {
  contractor: { name: 'ТОО «СК Фаворит Инжиниринг»' },
  customer: { name: 'АО «Транстелеком»' },
};

/** Поля стороны в том порядке, в каком их спрашивают. */
export const PARTY_FIELDS: { key: keyof Party; label: string; hint?: string }[] = [
  { key: 'name', label: 'Название', hint: 'как в договоре, с организационной формой' },
  { key: 'bin', label: 'БИН', hint: 'двенадцать цифр' },
  { key: 'address', label: 'Адрес' },
  { key: 'phone', label: 'Телефон' },
  { key: 'signerPosition', label: 'Должность подписывающего' },
  { key: 'signer', label: 'Кто подписывает', hint: 'фамилия с инициалами, как под подписью' },
  {
    key: 'inPersonOf',
    label: 'В лице кого',
    hint: 'родительным падежом: «директора Иванова И. И.»',
  },
  { key: 'basis', label: 'Действует на основании', hint: 'Устава, доверенности №…' },
];

export function emptyRequisites(): Requisites {
  return { contractor: { ...EMPTY_PARTY }, customer: { ...EMPTY_PARTY } };
}

/**
 * Достроить то, чего не хватает.
 *
 * Журнал мог быть заведён до того, как реквизиты появились, или прийти
 * с устройства, где их не заполняли. Пустое место в документе хуже
 * названия по умолчанию: по нему не видно, чего не хватает.
 */
export function withDefaults(r?: Partial<Requisites> | null): Requisites {
  return {
    contractor: { ...DEFAULT_REQUISITES.contractor, ...(r?.contractor ?? {}) },
    customer: { ...DEFAULT_REQUISITES.customer, ...(r?.customer ?? {}) },
    contractNumber: r?.contractNumber,
    contractDate: r?.contractDate,
    updatedAt: r?.updatedAt,
  };
}

/** БИН — двенадцать цифр. Ошибку в нём находят в бухгалтерии заказчика. */
export function binLooksWrong(bin: string | undefined): boolean {
  const v = (bin ?? '').replace(/\s/g, '');
  if (!v) return false;
  return !/^\d{12}$/.test(v);
}

/**
 * Чего не хватает для акта на оплату.
 *
 * Отдельно от «чего не хватает вообще»: для наряда бригаде хватает
 * названия, а вот акт без БИН в бухгалтерии развернут.
 */
export function missingForPayment(r: Requisites): string[] {
  const out: string[] = [];
  for (const [who, party] of [['подрядчик', r.contractor], ['заказчик', r.customer]] as const) {
    if (!party.name.trim()) out.push(`${who}: название`);
    if (!party.bin?.trim()) out.push(`${who}: БИН`);
    if (!party.signer?.trim()) out.push(`${who}: кто подписывает`);
  }
  if (!r.contractNumber?.trim()) out.push('номер договора');
  return out;
}

/**
 * Сторона одной строкой — как её пишут в шапке документа.
 *
 * «ТОО «СК Фаворит Инжиниринг», БИН 123456789012, в лице директора
 * Иванова И. И., действующего на основании Устава».
 */
export function partyLine(p: Party): string {
  const parts: string[] = [p.name.trim()].filter(Boolean);
  if (p.bin?.trim()) parts.push(`БИН ${p.bin.trim()}`);
  // «В лице» пишем только если это поле заполнили: сложить фразу из
  // должности и фамилии без склонения — значит написать «в лице
  // директор Иванов И. И.» в документе, который подписывают.
  if (p.inPersonOf?.trim()) parts.push(`в лице ${lowerFirst(p.inPersonOf.trim())}`);
  if (p.basis?.trim()) parts.push(`действующего на основании ${p.basis.trim()}`);
  return parts.join(', ');
}

/** «Директора» в середине фразы пишется со строчной. */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Подпись внизу листа: должность, место для росчерка, фамилия. */
export function signatureLine(p: Party): string {
  const pos = p.signerPosition?.trim() || '';
  const who = p.signer?.trim() || '';
  return [pos, '_______________', who].filter(Boolean).join(' ');
}

/** Строка о договоре: «по договору № 14 от 12.03.2026». */
export function contractLine(r: Requisites): string {
  const num = r.contractNumber?.trim();
  if (!num) return '';
  const date = r.contractDate?.trim();
  const shown = date ? new Date(`${date}T00:00:00Z`) : null;
  const dateText = shown && !Number.isNaN(shown.getTime())
    ? ` от ${shown.toLocaleDateString('ru')}`
    : '';
  return `по договору № ${num}${dateText}`;
}
