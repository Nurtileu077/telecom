'use client';
import { useMemo, useState } from 'react';
import { Languages, Check, RotateCcw, AlertTriangle } from 'lucide-react';
import {
  DICT, DICT_KEYS, LANGS, LANG_LABEL, translate, coverage, missedKeys, type Lang,
} from '@/lib/i18n';
import { useT } from './LangProvider';

/**
 * Язык интерфейса и сверка терминов.
 *
 * Переключатель без этого экрана предлагать нельзя: перевод сделан по
 * обиходной терминологии, но подписью его никто не заверял, а человек,
 * который здесь работает, знает своё дело лучше.
 *
 * Поэтому все пары видны сразу, правятся на месте и сохраняются на
 * устройстве. Свой перевод важнее словарного — всегда.
 */

interface Props {
  onFlash?: (text: string) => void;
}

export default function LangView({ onFlash }: Props) {
  const { lang, setLang, terms, setTerm } = useT();
  const [q, setQ] = useState('');

  const edited = useMemo(() => Object.keys(terms).length, [terms]);
  const done = useMemo(() => Math.round(coverage('kk', terms) * 100), [terms]);

  /**
   * Слова, которые встретились на экране и остались по-русски.
   *
   * Их и показываем первыми: весь словарь разом никто читать не станет,
   * а полтора десятка слов, только что увиденных своими глазами, —
   * вполне. Список собирается по ходу хождения по журналу, поэтому
   * пересчитываем при каждом заходе сюда.
   */
  const missed = useMemo(() => (lang === 'kk' ? missedKeys() : []), [lang, terms]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return DICT_KEYS;
    return DICT_KEYS.filter((k) => {
      const kk = terms[k] ?? DICT[k].kk;
      return k.toLowerCase().includes(needle) || kk.toLowerCase().includes(needle);
    });
  }, [q, terms]);

  /**
   * Стёртая правка — не пустой перевод, а отказ от правки: возвращаем
   * словарный. Иначе поле, очищенное случайно, обнулило бы слово. То же
   * и когда правка совпала со словарной: хранить её незачем.
   */
  function edit(key: string, value: string) {
    // У слова, которого нет в словаре, словарной пары не существует:
    // сравнивать не с чем, и правка всегда своя.
    setTerm(key, value.trim() === DICT[key]?.kk ? '' : value);
  }

  function pick(v: Lang) {
    setLang(v);
    onFlash?.(v === 'kk' ? 'Интерфейс на қазақша' : 'Интерфейс на русском');
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Languages size={15} className="text-[var(--accent)]" />
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => pick(l)}
            aria-pressed={l === lang}
            className={`chip ${l === lang ? 'chip-on' : ''}`}
          >
            {l === lang && <Check size={12} />}
            {LANG_LABEL[l]}
          </button>
        ))}
        <span className="text-[10.5px] text-[var(--text-muted)] ml-auto">
          переведено {done}%{edited > 0 ? ` · своих правок ${edited}` : ''}
        </span>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/40
                      bg-[var(--warn)]/10 px-3 py-2 text-[11.5px] text-[var(--warn)]">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>
          Перевод сделан по обиходной терминологии и подписью не заверен.
          <span className="block text-[var(--text-muted)]">
            Правьте прямо здесь — ваш вариант важнее словарного. Отраслевые слова
            (МКТ, ГНБ, ККС, бар, кабелеукладчик) оставлены как есть: их и в
            казахской речи произносят по-русски.
          </span>
        </span>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Найти слово"
        aria-label="Найти слово в словаре"
        className="w-full bg-[var(--bg-canvas)] border border-[var(--border)] rounded
                   px-2 py-1.5 text-[12px] text-[var(--text)]"
      />

      {missed.length > 0 && !q && (
        <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)]
                        p-3 space-y-2">
          <div className="text-[12.5px] font-semibold text-[var(--text)]">
            Встретилось на экране и осталось по-русски: {missed.length}
          </div>
          <div className="text-[10.5px] text-[var(--text-muted)]">
            Ровно те слова, что попались вам на глаза. Впишите перевод — и в
            следующий раз они будут на қазақша.
          </div>
          {missed.slice(0, 20).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-[42%] shrink-0 text-[12px] text-[var(--text)] truncate"
                    title={k}>
                {k}
              </span>
              <input
                value={terms[k] ?? ''}
                onChange={(ev) => edit(k, ev.target.value)}
                placeholder="перевод"
                aria-label={`Перевод: ${k}`}
                className="min-w-0 flex-1 bg-[var(--bg-canvas)] border border-[var(--border)]
                           rounded px-2 py-1 text-[12px] text-[var(--text)]"
              />
            </div>
          ))}
          {missed.length > 20 && (
            <div className="text-[10.5px] text-[var(--text-muted)]">
              и ещё {missed.length - 20} — они появятся здесь, когда эти будут
              переведены.
            </div>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="p-6 text-center text-[12.5px] text-[var(--text-muted)]">
          Такого слова в словаре нет. Непереведённые места показывают русскую фразу —
          так их и видно.
        </div>
      ) : (
        <div className="space-y-1">
          {shown.map((k) => {
            const own = terms[k];
            const value = own ?? DICT[k].kk;
            const untouched = !own;
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="w-[42%] shrink-0 text-[12px] text-[var(--text-muted)] truncate"
                      title={k}>
                  {k}
                </span>
                <input
                  value={value}
                  onChange={(e) => edit(k, e.target.value)}
                  aria-label={`Перевод: ${k}`}
                  className={`min-w-0 flex-1 bg-[var(--bg-canvas)] border rounded px-2 py-1
                              text-[12px] text-[var(--text)] ${
                    untouched ? 'border-[var(--border)]' : 'border-[var(--accent)]'}`}
                />
                {!untouched && (
                  <button type="button" className="btn btn-ghost btn-icon"
                          aria-label="Вернуть словарный перевод"
                          title="Вернуть словарный перевод"
                          onClick={() => edit(k, '')}>
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[10.5px] text-[var(--text-muted)]">
        Правки живут на этом устройстве и в общий журнал не уезжают: язык — дело
        того, кто смотрит в экран, а не всей стройки. Пример перевода:{' '}
        «{translate('Участок', 'ru')}» → «{terms['Участок'] ?? translate('Участок', 'kk')}».
      </div>
    </div>
  );
}
