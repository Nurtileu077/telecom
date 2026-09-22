import { describe, it, expect } from 'vitest';
import { lookup, searchGlossary, termsIn, GLOSSARY } from './glossary';

describe('lookup', () => {
  it('находит по самому слову', () => {
    expect(lookup('ККС')?.short).toContain('канализац');
  });

  it('регистр и ё не мешают', () => {
    expect(lookup('ккс')).toBeTruthy();
    expect(lookup(' МКТ ')).toBeTruthy();
  });

  it('находит по тому, как это ещё называют', () => {
    expect(lookup('прокол')?.term).toBe('ГНБ');
    expect(lookup('плуг')?.term).toBe('кабелеукладчик');
  });

  it('чужого слова в словаре нет — и выдумывать нечего', () => {
    expect(lookup('редуктор')).toBeNull();
    expect(lookup('')).toBeNull();
  });
});

describe('searchGlossary', () => {
  it('пустой запрос — весь словарь', () => {
    expect(searchGlossary('')).toHaveLength(GLOSSARY.length);
  });

  it('ищет и по пояснению, а не только по слову', () => {
    const hits = searchGlossary('мёрзлый');
    expect(hits.map((t) => t.term)).toContain('бар');
  });

  it('ничего не нашлось — пустой список', () => {
    expect(searchGlossary('квазар')).toEqual([]);
  });
});

describe('termsIn', () => {
  it('находит слова словаря в тексте', () => {
    const terms = termsIn('Задувка ОК по МКТ, прокол под дорогой');
    expect(terms.map((t) => t.term)).toContain('задувка');
    expect(terms.map((t) => t.term)).toContain('МКТ');
    expect(terms.map((t) => t.term)).toContain('ГНБ');
  });

  it('одно и то же слово не повторяется', () => {
    const terms = termsIn('ГНБ, прокол, ГНБ');
    expect(terms.filter((t) => t.term === 'ГНБ')).toHaveLength(1);
  });

  it('в тексте без терминов ничего не находит', () => {
    expect(termsIn('приехали и уехали')).toEqual([]);
  });
});

describe('словарь', () => {
  it('у каждого слова есть короткое пояснение', () => {
    for (const t of GLOSSARY) {
      expect(t.short.length, t.term).toBeGreaterThan(10);
    }
  });

  it('слова не задваиваются', () => {
    const names = GLOSSARY.map((t) => t.term.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
