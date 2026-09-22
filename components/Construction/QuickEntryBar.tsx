'use client';
import { useMemo, useRef, useState } from 'react';
import { Mic, MicOff, CornerDownLeft, Check, AlertTriangle } from 'lucide-react';
import type { DailyWorkEntry } from '@/types/construction';
import type { JournalState } from './journalStore';
import { parseQuickEntry, quickEntryReady, type QuickParse } from './quickEntry';
import { checkEntry, hasBlocking } from './entryChecks';
import { entryMeters } from './entriesTable';

/**
 * Смена одной строкой.
 *
 * Отчёт с объекта приходит текстом: «25.07 Дозер 480 м кабелеукладчик,
 * Зеренда — Серафимовка, ГНБ 72». До сих пор его переписывали в форму
 * руками — десять полей ради строки, которую человек уже написал.
 *
 * Показываем разобранное до записи: угадывать молча хуже, чем не
 * угадать, а проверить глазами одну строку — секунда.
 */

interface Props {
  journal: JournalState;
  author: string;
  onSubmit: (entry: DailyWorkEntry) => void;
  /** Открыть полную форму, перенеся в неё разобранное. */
  onOpenForm?: (parsed: QuickParse) => void;
}

/**
 * Распознавание речи.
 *
 * Оно есть не во всех браузерах, и объявлений его типов в сборке тоже
 * нет. Описываем ровно то, чем пользуемся: чужой полный тип сюда тянуть
 * незачем, а кнопки там, где речи нет, просто не будет.
 */
interface SpeechLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function speechCtor(): (new () => SpeechLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechLike;
    webkitSpeechRecognition?: new () => SpeechLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function QuickEntryBar({ journal, author, onSubmit, onOpenForm }: Props) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechLike | null>(null);

  const ctx = useMemo(() => ({
    contractors: [
      ...new Set([
        ...journal.contractors.map((c) => c.name),
        ...journal.ground.map((e) => e.contractor).filter((v): v is string => !!v),
      ]),
    ],
    uchastki: [
      ...new Set([
        ...journal.ground.map((e) => e.uchastok).filter(Boolean),
        ...journal.planRoutes.map((r) => r.uchastok || r.name).filter(Boolean),
      ]),
    ],
    columns: [
      ...new Set([
        ...journal.crews.map((c) => c.name),
        ...journal.ground.map((e) => e.column).filter((v): v is string => !!v),
      ]),
    ],
  }), [journal]);

  const parsed = useMemo(() => parseQuickEntry(text, ctx), [text, ctx]);
  const ready = quickEntryReady(parsed);

  const draftEntry = useMemo<DailyWorkEntry | null>(() => {
    if (!ready) return null;
    const now = new Date().toISOString();
    return {
      kind: 'ground',
      id: `ge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      date: parsed.date ?? new Date().toISOString().slice(0, 10),
      smu: parsed.smu ?? '',
      contractor: parsed.contractor,
      column: parsed.column,
      oblast: journal.ground.find((e) => e.uchastok === parsed.uchastok)?.oblast ?? '',
      kato: journal.ground.find((e) => e.uchastok === parsed.uchastok)?.kato ?? '',
      uchastok: parsed.uchastok ?? '',
      tech: parsed.tech,
      byMethod: parsed.byMethod,
      drillM: parsed.drillM,
      drillCount: parsed.drillCount,
      blowingM: parsed.blowingM,
      materials: {},
      note: parsed.note,
      author,
      createdAt: now,
      updatedAt: now,
      sync: 'local',
    };
  }, [ready, parsed, journal.ground, author]);

  const warnings = useMemo(
    () => (draftEntry ? checkEntry(draftEntry, journal.ground) : []),
    [draftEntry, journal.ground],
  );
  const blocked = hasBlocking(warnings);

  function toggleVoice() {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev) => {
      let said = '';
      for (let i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
      setText(said);
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function submit() {
    if (!draftEntry || blocked) return;
    onSubmit(draftEntry);
    setText('');
  }

  const hasVoice = !!speechCtor();

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          id="quick-entry"
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && ready && !blocked) submit(); }}
          placeholder="25.07 Дозер 480 м кабелеукладчик, Зеренда — Серафимовка, ГНБ 72"
          aria-label="Смена одной строкой"
          className="flex-1 min-w-0 bg-[var(--bg-canvas)] border border-[var(--border)]
                     rounded-md px-2 py-1.5 text-[12.5px] text-[var(--text)]
                     placeholder:text-[var(--text-muted)] focus:outline-none
                     focus:border-[var(--accent)]"
        />
        {hasVoice && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-pressed={listening}
            title={listening ? 'Остановить запись' : 'Наговорить смену'}
            className={`btn btn-ghost btn-icon ${listening ? 'text-[var(--danger)]' : ''}`}
          >
            {listening ? <MicOff size={15} /> : <Mic size={15} />}
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!ready || blocked}
          className="btn btn-primary text-[11.5px] disabled:opacity-40"
          title={ready ? 'Записать смену' : 'Нужны хотя бы участок и метры'}
        >
          <CornerDownLeft size={14} />
          <span className="hidden sm:inline">Записать</span>
        </button>
      </div>

      {text.trim() && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {parsed.matched.map((m) => (
            <span key={m} className="px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)]
                                     inline-flex items-center gap-1">
              <Check size={10} />{m}
            </span>
          ))}
          {parsed.leftover.map((m) => (
            <span key={m} className="px-1.5 py-0.5 rounded border border-[var(--warn)]/50
                                     text-[var(--warn)]">
              не понял: {m}
            </span>
          ))}
          {onOpenForm && (
            <button
              type="button"
              onClick={() => onOpenForm(parsed)}
              className="ml-auto text-[11px] text-[var(--text-muted)] underline underline-offset-2
                         hover:text-[var(--text)]"
            >
              Открыть форму
            </button>
          )}
        </div>
      )}

      {warnings.map((w) => (
        <div
          key={w.text}
          className={`flex items-start gap-1.5 text-[11.5px] rounded px-2 py-1 ${
            w.level === 'stop'
              ? 'bg-[var(--danger)]/10 text-[var(--danger)]'
              : 'bg-[var(--warn)]/10 text-[var(--warn)]'}`}
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            {w.text}
            {w.hint && <span className="block text-[var(--text-muted)]">{w.hint}</span>}
          </span>
        </div>
      ))}

      {draftEntry && !blocked && (
        <div className="text-[11px] text-[var(--text-muted)]">
          Запишем {Math.round(entryMeters(draftEntry)).toLocaleString('ru')} м
          {draftEntry.drillM ? ` и ГНБ ${draftEntry.drillM} м` : ''}
          {' по участку «'}{draftEntry.uchastok}{'» за '}
          {new Date(`${draftEntry.date}T00:00:00Z`).toLocaleDateString('ru')}.
        </div>
      )}
    </div>
  );
}
