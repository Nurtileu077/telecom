import { describe, it, expect, beforeEach } from 'vitest';
import {
  DICT, DICT_KEYS, LANGS, LANG_LABEL, translate, missing, coverage, makeT,
  loadLang, saveLang, loadLangTerms, saveLangTerms,
  missedKeys, clearMisses, type Lang,
} from './i18n';

/** В node нет window: подкладываем ровно то, чем пользуется модуль. */
function fakeWindow(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  };
  return store;
}

describe('словарь', () => {
  it('ключ — это русская фраза, а не код', () => {
    // «common.save» в непереведённом месте выглядит сломанным, а
    // «Сохранить» — просто непереведённым.
    for (const k of DICT_KEYS) {
      expect(k).not.toMatch(/^[a-z]+\.[a-z]/);
      expect(k).toMatch(/[А-Яа-яЁё]/);
    }
  });

  it('русская сторона совпадает с ключом', () => {
    for (const k of DICT_KEYS) expect(DICT[k].ru).toBe(k);
  });

  it('у каждого ключа есть обе стороны', () => {
    for (const k of DICT_KEYS) {
      for (const l of LANGS) expect(typeof DICT[k][l]).toBe('string');
    }
  });

  it('подпись языка написана на нём самом', () => {
    expect(LANG_LABEL.kk).toBe('Қазақша');
    expect(LANG_LABEL.ru).toBe('Русский');
  });

  it('отраслевые слова не переведены — их и в речи говорят по-русски', () => {
    for (const k of ['Колонна', 'Бригада', 'Паспорт', 'Телефон', 'Табель']) {
      expect(DICT[k]?.kk).toBe(DICT[k]?.ru);
    }
  });
});

describe('translate', () => {
  it('русский отдаёт как есть', () => {
    expect(translate('Сохранить', 'ru')).toBe('Сохранить');
  });

  it('казахский отдаёт перевод', () => {
    expect(translate('Сохранить', 'kk')).toBe('Сақтау');
    expect(translate('Дата', 'kk')).toBe('Күні');
  });

  it('незнакомая фраза возвращается собой, а не пустотой', () => {
    expect(translate('Задувка по трубе', 'kk')).toBe('Задувка по трубе');
    expect(translate('Задувка по трубе', 'ru')).toBe('Задувка по трубе');
  });

  it('несверенный перевод откатывается на русский', () => {
    const backup = DICT['Сохранить'].kk;
    DICT['Сохранить'].kk = '   ';
    expect(translate('Сохранить', 'kk')).toBe('Сохранить');
    DICT['Сохранить'].kk = backup;
  });
});

describe('makeT', () => {
  it('свой перевод важнее словарного', () => {
    const t = makeT('kk', { 'Участок': 'Телім' });
    expect(t('Участок')).toBe('Телім');
  });

  it('на русском свои правки не применяются: там правок и не просили', () => {
    const t = makeT('ru', { 'Участок': 'Телім' });
    expect(t('Участок')).toBe('Участок');
  });

  it('пустая правка не стирает словарный перевод', () => {
    const t = makeT('kk', { 'Дата': '   ' });
    expect(t('Дата')).toBe('Күні');
  });

  it('незнакомый ключ проходит насквозь', () => {
    expect(makeT('kk')('Пропорка')).toBe('Пропорка');
  });
});

describe('что ещё не переведено', () => {
  it('на русском не хватать нечему', () => {
    expect(missing('ru')).toEqual([]);
    expect(coverage('ru')).toBe(1);
  });

  it('в поставляемом словаре пропусков нет', () => {
    expect(missing('kk')).toEqual([]);
    expect(coverage('kk')).toBe(1);
  });

  it('пропуск виден поимённо', () => {
    const backup = DICT['Отмена'].kk;
    DICT['Отмена'].kk = '';
    expect(missing('kk')).toEqual(['Отмена']);
    expect(coverage('kk')).toBeLessThan(1);
    DICT['Отмена'].kk = backup;
  });

  it('свой перевод закрывает пропуск', () => {
    const backup = DICT['Отмена'].kk;
    DICT['Отмена'].kk = '';
    expect(missing('kk', { 'Отмена': 'Болдырмау' })).toEqual([]);
    DICT['Отмена'].kk = backup;
  });
});

describe('настройка языка', () => {
  beforeEach(() => { fakeWindow(); });

  it('по умолчанию русский: на нём сейчас весь журнал', () => {
    expect(loadLang()).toBe('ru');
  });

  it('выбранный язык переживает перезагрузку', () => {
    saveLang('kk');
    expect(loadLang()).toBe('kk');
  });

  it('мусор в настройке читается как русский', () => {
    const store = fakeWindow();
    store.set('optiq-lang', 'турецкий');
    expect(loadLang()).toBe('ru');
  });

  it('свои переводы сохраняются и читаются', () => {
    saveLangTerms({ 'Участок': 'Телім' });
    expect(loadLangTerms()['Участок']).toBe('Телім');
  });

  it('испорченный словарь не роняет интерфейс', () => {
    const store = fakeWindow();
    store.set('optiq-lang-terms', '{это не json');
    expect(loadLangTerms()).toEqual({});
  });

  it('нестроковые значения в правках отбрасываются', () => {
    const store = fakeWindow();
    store.set('optiq-lang-terms', JSON.stringify({ 'Дата': 42, 'Участок': 'Телім' }));
    expect(loadLangTerms()).toEqual({ 'Участок': 'Телім' });
  });

  it('массив вместо словаря не проходит', () => {
    const store = fakeWindow();
    store.set('optiq-lang-terms', '["Телім"]');
    expect(loadLangTerms()).toEqual({});
  });
});

/**
 * Разделы журнала — самая видимая поверхность: их читают в первую
 * очередь. Новый раздел без перевода покажет русское слово посреди
 * казахского ряда, и заметят это не сразу.
 */
describe('разделы журнала переведены все', () => {
  const VIEWS = [
    'Сегодня', 'Сводка', 'Руководству', 'Записи', 'Колонны', 'Этапы',
    'Проколы', 'Объекты', 'Паспорт', 'Аварии', 'Отклонения', 'Материалы',
    'Закрытие', 'Заявки', 'Изменения', 'План', 'Документы', 'Расчёты',
    'Ресурсы', 'Допуски', 'Реквизиты', 'Язык', 'Обслуживание', 'Проверки',
    'Табель',
  ];

  it('каждый есть в словаре', () => {
    for (const v of VIEWS) expect(DICT_KEYS).toContain(v);
  });

  it('и у каждого есть казахская сторона', () => {
    for (const v of VIEWS) expect(translate(v, 'kk').trim().length).toBeGreaterThan(0);
  });
});

/**
 * Словарь заполнен не до конца, и сказать «переведено 40%» мало: человеку
 * нужно знать, какие именно слова он увидит по-русски — и увидеть их там
 * же, где может вписать перевод.
 */
describe('чего не хватило на экране', () => {
  beforeEach(() => { clearMisses(); });

  it('незнакомое слово запоминается', () => {
    const t = makeT('kk');
    t('Пропорка');
    expect(missedKeys()).toEqual(['Пропорка']);
  });

  it('переведённое не запоминается', () => {
    const t = makeT('kk');
    t('Сохранить');
    expect(missedKeys()).toEqual([]);
  });

  it('на русском промахов не бывает: там и переводить нечего', () => {
    const t = makeT('ru');
    t('Пропорка');
    expect(missedKeys()).toEqual([]);
  });

  it('свой перевод закрывает промах', () => {
    const t = makeT('kk', { 'Пропорка': 'Кесу' });
    t('Пропорка');
    expect(missedKeys()).toEqual([]);
  });

  it('одно и то же слово не копится', () => {
    const t = makeT('kk');
    for (let i = 0; i < 10; i += 1) t('Пропорка');
    expect(missedKeys()).toHaveLength(1);
  });

  it('список отсортирован по-русски, а не по кодам', () => {
    const t = makeT('kk');
    ['Ярлык', 'Барабан', 'Ёмкость'].forEach(t);
    expect(missedKeys()).toEqual(['Барабан', 'Ёмкость', 'Ярлык']);
  });

  it('слово без перевода в словаре тоже считается промахом', () => {
    const backup = DICT['Отмена'].kk;
    DICT['Отмена'].kk = '';
    makeT('kk')('Отмена');
    expect(missedKeys()).toContain('Отмена');
    DICT['Отмена'].kk = backup;
  });
});
