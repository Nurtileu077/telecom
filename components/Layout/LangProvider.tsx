'use client';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import {
  makeT, loadLang, saveLang, loadLangTerms, saveLangTerms, type Lang,
} from '@/lib/i18n';

/**
 * Язык — для всего дерева сразу.
 *
 * Иначе каждый экран читал бы настройку сам, и при переключении половина
 * успевала бы перерисоваться, а половина нет. Здесь язык один, и меняется
 * он для всех в один момент.
 *
 * Экраны переводятся по мере готовности: непереведённый берёт `t()` и
 * получает русскую фразу, которую и так писал. Ничего не ломается, пока
 * словарь дописывается.
 */

interface LangValue {
  lang: Lang;
  t: (key: string) => string;
  setLang: (v: Lang) => void;
  terms: Record<string, string>;
  setTerm: (key: string, value: string) => void;
}

const FALLBACK: LangValue = {
  lang: 'ru',
  t: (k) => k,
  setLang: () => {},
  terms: {},
  setTerm: () => {},
};

const Ctx = createContext<LangValue>(FALLBACK);

/**
 * Взять переводчик.
 *
 * Вне провайдера возвращает русский: экран, вырванный из дерева (в
 * тесте, в предпросмотре), должен работать, а не падать.
 */
export function useT(): LangValue {
  return useContext(Ctx);
}

export default function LangProvider({ children }: { children: ReactNode }) {
  // На сервере настройки нет: начинаем с русского и поправляем после
  // первой отрисовки, иначе разметка сервера и браузера разойдутся.
  const [lang, setLangState] = useState<Lang>('ru');
  const [terms, setTerms] = useState<Record<string, string>>({});

  useEffect(() => {
    setLangState(loadLang());
    setTerms(loadLangTerms());
  }, []);

  const setLang = useCallback((v: Lang) => {
    setLangState(v);
    saveLang(v);
    if (typeof document !== 'undefined') document.documentElement.lang = v;
  }, []);

  const setTerm = useCallback((key: string, value: string) => {
    setTerms((prev) => {
      const next = { ...prev };
      if (!value.trim()) delete next[key];
      else next[key] = value;
      saveLangTerms(next);
      return next;
    });
  }, []);

  const value = useMemo<LangValue>(
    () => ({ lang, t: makeT(lang, terms), setLang, terms, setTerm }),
    [lang, terms, setLang, setTerm],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
