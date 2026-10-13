import { describe, it, expect } from 'vitest';
import {
  slug, docPath, expiresAt, linkMessage, stillValid, validFor,
  lifeByKey, LINK_LIVES, DEFAULT_LINK_LIFE, DOC_BUCKET,
} from './docLink';

const NOW = new Date('2026-09-25T09:00:00.000Z');

describe('имя в складе', () => {
  it('кириллица переводится побуквенно и участок остаётся узнаваем', () => {
    expect(slug('Зеренда — Серафимовка')).toBe('zerenda-serafimovka');
  });

  it('казахские буквы тоже', () => {
    expect(slug('Ақмола облысы')).toBe('aqmola-oblysy');
  });

  it('кавычки, пробелы и номера не ломают адрес', () => {
    expect(slug('ТОО «Дозер» № 14/2')).toBe('too-dozer-14-2');
    expect(slug('Акт Аксу 2026-05-20')).toBe('akt-aksu-2026-05-20');
  });

  it('не оставляет дефисов по краям и подряд', () => {
    expect(slug('  —— Зеренда ——  ')).toBe('zerenda');
    expect(slug('а!!!б')).toBe('a-b');
  });

  it('очень длинное имя обрезает, но не в пустоту', () => {
    const long = slug('Зеренда '.repeat(30));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.startsWith('zerenda')).toBe(true);
  });

  it('из одних знаков препинания имени не выходит', () => {
    expect(slug('!!!')).toBe('');
    expect(slug('')).toBe('');
  });
});

describe('постоянный адрес документа', () => {
  const org = 'a3f8c2e1-9b4d-4f1a-8c6e-2d7b9e4f1a03';
  const act = (section: string, project = 'snp') =>
    ({ project, kind: 'акт', parts: [section] });
  const report = (period: string, oblast: string, contractor: string, project = 'snp') =>
    ({ project, kind: 'отчёт за период', parts: [period, oblast, contractor] });

  it('первый кусок — организация: по нему построены права', () => {
    expect(docPath(org, act('Зеренда'), 'docx').startsWith(`${org}/`)).toBe(true);
  });

  it('второй кусок — проект: у каждого договора своя папка', () => {
    expect(docPath(org, act('Зеренда'), 'docx').startsWith(`${org}/snp/`)).toBe(true);
    expect(docPath(org, act('Зеренда', 'p1abc'), 'docx').startsWith(`${org}/p1abc/`)).toBe(true);
  });

  it('тот же документ того же участка ложится туда же', () => {
    // Иначе в облаке накопится та же пачка файлов, что и в почте.
    expect(docPath(org, act('Зеренда — Серафимовка'), 'docx'))
      .toBe(docPath(org, act('Зеренда — Серафимовка'), 'docx'));
  });

  it('участок, записанный с маленькой буквы или с лишним пробелом, ссылку не меняет', () => {
    // Список участков берёт первое встреченное написание, и после правки
    // старой смены «Аксу» становится «аксу ». Отданная ссылка прыгать не должна.
    expect(docPath(org, act('аксу '), 'docx')).toBe(docPath(org, act('Аксу'), 'docx'));
    expect(docPath(org, act('ТОО «Дозер»'), 'docx')).toBe(docPath(org, act('ТОО Дозер'), 'docx'));
  });

  it('разные виды документов не затирают друг друга', () => {
    expect(docPath(org, act('Зеренда'), 'docx'))
      .not.toBe(docPath(org, { ...act('Зеренда'), kind: 'ведомость' }, 'docx'));
  });

  it('разные участки — разные адреса', () => {
    expect(docPath(org, act('Зеренда'), 'docx'))
      .not.toBe(docPath(org, act('Щучинск'), 'docx'));
  });

  it('отчёт за те же даты по другой области ложится в другой файл', () => {
    // Ссылку на Акмолинскую уже отправили заказчику — Костанайская за
    // сентябрь не должна открыться по ней.
    const sep = '2026-09-01..2026-09-30';
    expect(docPath(org, report(sep, 'Акмолинская область', ''), 'docx'))
      .not.toBe(docPath(org, report(sep, 'Костанайская область', ''), 'docx'));
    expect(docPath(org, report(sep, 'Акмолинская область', ''), 'docx'))
      .not.toBe(docPath(org, report(sep, '', ''), 'docx'));
  });

  it('отчёт для другого подрядчика ложится в другой файл', () => {
    const sep = '2026-09-01..2026-09-30';
    expect(docPath(org, report(sep, '', 'TERRA TECH'), 'docx'))
      .not.toBe(docPath(org, report(sep, '', 'Дозер'), 'docx'));
    expect(docPath(org, report(sep, '', 'TERRA TECH'), 'docx'))
      .not.toBe(docPath(org, report(sep, '', ''), 'docx'));
  });

  it('тот же отчёт другого проекта не ложится поверх: чужой договор', () => {
    const sep = '2026-09-01..2026-09-30';
    expect(docPath(org, report(sep, '', '', 'snp'), 'docx'))
      .not.toBe(docPath(org, report(sep, '', '', 'p1abc'), 'docx'));
  });

  it('пустое место в наборе — тоже различие: «вся область, один подрядчик» не равно «одна область, все»', () => {
    const sep = '2026-09-01..2026-09-30';
    expect(docPath(org, report(sep, '', 'Дозер'), 'docx'))
      .not.toBe(docPath(org, report(sep, 'Дозер', ''), 'docx'));
  });

  it('длинные названия с общим началом не сливаются после обрезки', () => {
    const base = 'Зеренда — Серафимовка — Чаглинка — Кокшетау — Красный Яр — ';
    const a = docPath(org, act(`${base}Акколь`), 'docx');
    const b = docPath(org, act(`${base}Степняк`), 'docx');
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThan(220);
  });

  it('имена, которые побуквенно пишутся одинаково, всё равно различаются', () => {
    // «е», «ё» и «э» в адресе — одна буква, а сёла разные.
    expect(slug('Мерке')).toBe(slug('Мэрке'));
    expect(docPath(org, act('Мерке'), 'docx')).not.toBe(docPath(org, act('Мэрке'), 'docx'));
  });

  it('по адресу видно, что за документ', () => {
    expect(docPath(org, report('2026-09-01..2026-09-30', 'Акмолинская область', 'TERRA TECH'), 'docx'))
      .toMatch(/^[^/]+\/snp\/otchet-za-period\/2026-09-01-2026-09-30_akmolinskaya-oblast_terra-tech_[0-9a-z]{11}\.docx$/);
  });

  it('расширение нормализуется, а не удваивается', () => {
    expect(docPath(org, act('Зеренда'), '.PDF')).toMatch(/\.pdf$/);
    expect(docPath(org, act('Зеренда'), 'docx')).toMatch(/\.docx$/);
  });

  it('в адресе не остаётся ничего, что ломает склад и почту', () => {
    const p = docPath(org, act('ТОО «Дозер» №14'), 'docx');
    expect(p).not.toMatch(/[«»"'\s]/);
    expect(p).toMatch(/^[\w/.-]+$/);
  });

  it('безымянный документ всё равно получает адрес', () => {
    expect(docPath(org, { project: 'snp', kind: '', parts: [] }, 'doc'))
      .toMatch(new RegExp(`^${org}/snp/doc/dokument_[0-9a-z]{11}\\.doc$`));
  });

  it('без проекта не кладёт документ к сёлам', () => {
    const p = docPath(org, { project: '', kind: 'акт', parts: ['Зеренда'] }, 'doc');
    expect(p.startsWith(`${org}/bez-proekta/`)).toBe(true);
  });

  it('без организации адрес не рассыпается', () => {
    expect(docPath('', act('Зеренда'), 'doc').startsWith('default/')).toBe(true);
  });
});

describe('срок ссылки', () => {
  it('по умолчанию неделя — обычный срок «посмотрите и подпишите»', () => {
    expect(DEFAULT_LINK_LIFE.key).toBe('week');
    expect(DEFAULT_LINK_LIFE.seconds).toBe(7 * 24 * 3600);
  });

  it('у каждого срока есть подпись и объяснение', () => {
    for (const l of LINK_LIVES) {
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.hint.length).toBeGreaterThan(0);
    }
  });

  it('незнакомый срок откатывается на неделю, а не на вечность', () => {
    expect(lifeByKey('навсегда')).toBe(DEFAULT_LINK_LIFE);
  });

  it('считает, когда ссылка перестанет открываться', () => {
    expect(expiresAt(lifeByKey('week'), NOW)).toBe('2026-10-02T09:00:00.000Z');
    expect(expiresAt(lifeByKey('day'), NOW)).toBe('2026-09-26T09:00:00.000Z');
  });
});

describe('жива ли ссылка', () => {
  it('до срока — жива, после — нет', () => {
    expect(stillValid('2026-10-02T09:00:00.000Z', NOW)).toBe(true);
    expect(stillValid('2026-09-24T09:00:00.000Z', NOW)).toBe(false);
  });

  it('битый срок живым не считается', () => {
    expect(stillValid('когда-нибудь', NOW)).toBe(false);
    expect(stillValid('', NOW)).toBe(false);
  });

  it('остаток называет по-человечески', () => {
    expect(validFor('2026-10-02T09:00:00.000Z', NOW)).toBe('действует ещё 7 дн');
    expect(validFor('2026-09-25T14:00:00.000Z', NOW)).toBe('действует ещё 5 ч');
    expect(validFor('2026-09-24T09:00:00.000Z', NOW)).toBe('срок вышел');
  });
});

describe('письмо со ссылкой', () => {
  const msg = () => linkMessage(
    'Акт скрытых работ, Зеренда — Серафимовка',
    'https://пример/подписанная-ссылка',
    lifeByKey('week'),
    '2026-10-02T09:00:00.000Z',
  );

  it('несёт название, ссылку и срок', () => {
    const t = msg();
    expect(t).toContain('Акт скрытых работ');
    expect(t).toContain('https://пример/подписанная-ссылка');
    expect(t).toContain('02.10.2026');
  });

  it('объясняет, что версия всегда текущая', () => {
    expect(msg()).toContain('текущая версия');
  });

  it('срок называет прямо: молча переставшая ссылка читается как отзыв', () => {
    expect(msg()).toContain('открывается до');
  });

  it('без внятного срока не выдумывает дату', () => {
    const t = linkMessage('Акт', 'https://x', lifeByKey('week'), 'никогда');
    expect(t).not.toContain('Invalid');
    expect(t).toContain('текущая версия');
  });
});

describe('склад', () => {
  it('документы лежат отдельно от снимков', () => {
    expect(DOC_BUCKET).toBe('documents');
    expect(DOC_BUCKET).not.toBe('field-photos');
  });
});
