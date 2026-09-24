import { describe, it, expect, beforeEach } from 'vitest';
import {
  DOC_TERMS, TERM_KEYS, BILINGUAL_LABEL, term, heading, untranslated, needsReview,
  loadBilingual, saveBilingual, loadTerms, saveTerms,
  type Bilingual, type TermPair,
} from './bilingual';

describe('словарь бланка', () => {
  it('у каждого термина есть обе стороны', () => {
    for (const k of TERM_KEYS) {
      expect(DOC_TERMS[k].ru.trim().length).toBeGreaterThan(0);
      expect(typeof DOC_TERMS[k].kk).toBe('string');
    }
  });

  it('в нём только шапки и подписи, а не текст актов', () => {
    for (const k of TERM_KEYS) {
      // Длинная фраза — признак того, что сюда попал текст документа.
      expect(DOC_TERMS[k].ru.length).toBeLessThan(40);
    }
  });

  it('у каждого режима есть подпись на своём языке', () => {
    expect(BILINGUAL_LABEL['kk-ru']).toContain('Қазақша');
    expect(BILINGUAL_LABEL.off).toContain('русский');
  });
});

describe('term', () => {
  it('выключенный режим оставляет только русский', () => {
    expect(term('customer', 'off')).toBe('Заказчик');
  });

  it('государственный язык впереди — как на бланке', () => {
    expect(term('customer', 'kk-ru')).toBe('Тапсырыс беруші / Заказчик');
  });

  it('и наоборот, если так привычнее', () => {
    expect(term('customer', 'ru-kk')).toBe('Заказчик / Тапсырыс беруші');
  });

  it('совпадающий перевод второй раз не пишет', () => {
    // «АКТ» и есть «АКТ»: «АКТ / АКТ» выглядит опечаткой.
    expect(term('act', 'kk-ru')).toBe('АКТ');
  });

  it('несверенный термин остаётся русским, а не пустым', () => {
    const mine: Record<string, TermPair> = { customer: { ru: 'Заказчик', kk: '  ' } };
    expect(term('customer', 'kk-ru', mine)).toBe('Заказчик');
  });

  it('свой перевод важнее словарного', () => {
    const mine: Record<string, TermPair> = { uchastok: { ru: 'Участок', kk: 'Телім' } };
    expect(term('uchastok', 'kk-ru', mine)).toBe('Телім / Участок');
  });

  it('незнакомый ключ не роняет документ', () => {
    expect(term('такого-нет' as never, 'kk-ru')).toBe('такого-нет');
  });
});

describe('heading', () => {
  it('в заголовке разделяет переводом строки — там место есть', () => {
    expect(heading('customer', 'kk-ru')).toBe('Тапсырыс беруші<br/>Заказчик');
  });

  it('в выключенном режиме лишнего переноса не ставит', () => {
    expect(heading('customer', 'off')).toBe('Заказчик');
  });
});

describe('что сверить перед первым документом', () => {
  it('несверенные термины называет поимённо', () => {
    const mine: Record<string, TermPair> = {
      customer: { ru: 'Заказчик', kk: '' },
      contractor: { ru: 'Подрядчик', kk: '' },
    };
    const out = untranslated(mine);
    expect(out).toContain('customer');
    expect(out).toContain('contractor');
  });

  it('в поставляемом словаре непереведённых нет', () => {
    expect(untranslated()).toEqual([]);
  });

  it('совпадающие с русским просит посмотреть глазами', () => {
    // Их может быть и правильно — «АКТ», — но различить может только человек.
    expect(needsReview()).toContain('act');
  });

  it('разные слова сверять не просит', () => {
    expect(needsReview()).not.toContain('customer');
  });
});

describe('все режимы дают читаемую строку', () => {
  it('ни в одном не остаётся висящей косой черты', () => {
    for (const mode of ['off', 'kk-ru', 'ru-kk'] as Bilingual[]) {
      for (const k of TERM_KEYS) {
        const t = term(k, mode);
        expect(t.trim().length).toBeGreaterThan(0);
        expect(t).not.toMatch(/^\s*\/|\/\s*$/);
        expect(t).not.toContain('//');
      }
    }
  });
});

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

describe('настройка бланка', () => {
  beforeEach(() => { fakeWindow(); });

  it('по умолчанию выключено: термины сначала сверяют', () => {
    expect(loadBilingual()).toBe('off');
  });

  it('выбранный режим переживает перезагрузку', () => {
    saveBilingual('kk-ru');
    expect(loadBilingual()).toBe('kk-ru');
  });

  it('мусор в настройке читается как «выключено»', () => {
    const store = fakeWindow();
    store.set('optiq-bilingual', 'французский');
    expect(loadBilingual()).toBe('off');
  });

  it('свои переводы сохраняются и читаются', () => {
    saveTerms({ uchastok: { ru: 'Участок', kk: 'Телім' } });
    expect(loadTerms().uchastok?.kk).toBe('Телім');
  });

  it('испорченный словарь не роняет документы', () => {
    const store = fakeWindow();
    store.set('optiq-doc-terms', '{это не json');
    expect(loadTerms()).toEqual({});
  });
});
