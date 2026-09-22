'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download, Upload, AlertTriangle, Bug, HardDrive, Wifi, WifiOff, History,
} from 'lucide-react';
import type { JournalState } from './journalStore';
import {
  makeBackup, backupFileName, readBackup, restoreBackup, restoreWarning,
  journalCounts, backupAge, loadImports, type ImportRecord,
} from './backup';
import {
  loadErrors, saveErrors, noteError, watchErrors, storageInfo, fmtBytes,
  problemReport, statusLine, type Diagnostics, type ErrorNote, type StorageInfo,
} from '@/lib/diagnostics';
import { pendingPhotos } from './photoStore';
import { downloadText } from '@/lib/download';
import { APP_VERSION, WHATS_NEW } from '@/lib/version';

/**
 * Обслуживание: копия, состояние, ошибки.
 *
 * Журнал живёт в браузере. Браузер чистят, телефон меняют, вкладку
 * закрывают «чтобы не мешала» — и сезон работы исчезает без следа.
 *
 * А когда у прораба «не сохраняется», разбираться приходится по
 * телефону и на ощупь: какой браузер, сколько места, ушли ли фото.
 * Система знает это про себя сама.
 */

interface Props {
  journal: JournalState;
  author?: string;
  lastSyncAt?: string;
  onRestore: (j: JournalState) => void;
  onFlash?: (text: string) => void;
}

export default function MaintenanceView({
  journal, author, lastSyncAt, onRestore, onFlash,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<ErrorNote[]>([]);
  const [storage, setStorage] = useState<StorageInfo>({});
  const [online, setOnline] = useState(true);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    setErrors(loadErrors());
    setImports(loadImports());
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    void storageInfo().then(setStorage);

    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);

    // Ошибки копим здесь: без них сообщение «сломалось» не расследуется.
    const stop = watchErrors((n) => {
      setErrors((prev) => {
        const next = noteError(prev, n);
        saveErrors(next);
        return next;
      });
    });

    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
      stop();
    };
  }, []);

  const counts = useMemo(() => journalCounts(journal), [journal]);
  const pendingEntries = useMemo(
    () => journal.ground.filter((e) => e.sync === 'local').length,
    [journal.ground],
  );
  const photos = useMemo(() => pendingPhotos(journal.photos), [journal.photos]);

  const diagnostics: Diagnostics = {
    version: APP_VERSION,
    online,
    agent: typeof navigator === 'undefined' ? '—' : navigator.userAgent.slice(0, 120),
    screen: typeof window === 'undefined' ? '—' : `${window.innerWidth}×${window.innerHeight}`,
    storage,
    pendingEntries,
    pendingPhotos: photos.count,
    lastSyncAt,
    errors,
  };

  function saveBackup() {
    const file = makeBackup(journal, author);
    downloadText(backupFileName(), JSON.stringify(file, null, 1),
      'application/json;charset=utf-8', false);
    onFlash?.('Копия сохранена');
  }

  async function loadBackup(f: File) {
    const check = readBackup(await f.text());
    if (!check.ok || !check.file) {
      onFlash?.(check.problem ?? 'Файл не читается');
      return;
    }
    const warn = restoreWarning(journal, check.file);
    const when = backupAge(check.file.at);
    const what = Object.entries(check.file.counts ?? {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    if (!window.confirm(
      `Развернуть копию от ${when}?\n\nВ ней: ${what || 'пусто'}.\n`
      + (warn ? `\n${warn}\n` : '')
      + '\nЖурнал будет заменён целиком.',
    )) return;
    onRestore(restoreBackup(check.file));
    onFlash?.('Копия развёрнута');
  }

  async function copyReport() {
    const text = problemReport(diagnostics, problem);
    try {
      await navigator.clipboard.writeText(text);
      onFlash?.('Отчёт скопирован — вставьте его в сообщение');
    } catch {
      window.prompt('Скопируйте отчёт вручную:', text);
    }
  }

  return (
    <div className="p-3 space-y-3">
      {/* Состояние */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1.5">
        <div className="flex items-center gap-2">
          {online
            ? <Wifi size={15} className="text-[var(--success)]" />
            : <WifiOff size={15} className="text-[var(--warn)]" />}
          <span className="text-[13px] font-semibold text-[var(--text)]">Состояние</span>
          <span className="ml-auto text-[11px] text-[var(--text-muted)]">{APP_VERSION}</span>
        </div>
        <div className="text-[11.5px] text-[var(--text-muted)]">{statusLine(diagnostics)}</div>
        <div className="flex items-baseline gap-2 text-[11.5px]">
          <HardDrive size={12} className="text-[var(--text-muted)]" />
          <span className="text-[var(--text-muted)]">
            Хранилище: {fmtBytes(storage.usedBytes)} из {fmtBytes(storage.quotaBytes)}
          </span>
        </div>
        {(pendingEntries > 0 || photos.count > 0) && (
          <div className="text-[11.5px] text-[var(--warn)]">
            Ждёт отправки: записей {pendingEntries}, фотографий {photos.count}
            {photos.bytes > 0 ? ` (${fmtBytes(photos.bytes)})` : ''}
          </div>
        )}
        {lastSyncAt && (
          <div className="text-[11px] text-[var(--text-muted)]">
            Последний обмен: {new Date(lastSyncAt).toLocaleString('ru')}
          </div>
        )}
      </div>

      {/* Копия */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
        <div className="text-[13px] font-semibold text-[var(--text)]">Копия журнала</div>
        <div className="text-[11.5px] text-[var(--text-muted)]">
          Журнал живёт в браузере. Браузер чистят, телефон меняют, вкладку
          закрывают «чтобы не мешала». Выгрузка в Excel спасает цифры, но не
          обводки, объекты, расценки и фотографии — копия спасает всё.
        </div>
        <div className="text-[11px] text-[var(--text-muted)]">
          Сейчас в журнале:{' '}
          {Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ')
            || 'пусто'}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" className="btn btn-primary text-[11.5px]" onClick={saveBackup}>
            <Download size={14} />Сохранить копию
          </button>
          <button type="button" className="btn btn-ghost text-[11.5px]"
                  onClick={() => fileRef.current?.click()}>
            <Upload size={14} />Развернуть копию
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadBackup(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* История импортов */}
      {imports.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1">
          <div className="flex items-center gap-2">
            <History size={14} className="text-[var(--text-muted)]" />
            <span className="text-[13px] font-semibold text-[var(--text)]">Что загружали</span>
          </div>
          {imports.slice(0, 10).map((r) => (
            <div key={r.id} className="flex items-baseline gap-2 text-[11.5px]">
              <span className="font-mono tabular-nums text-[var(--text-muted)] w-[86px] shrink-0">
                {new Date(r.at).toLocaleDateString('ru')}
              </span>
              <span className="min-w-0 flex-1 text-[var(--text)] truncate">{r.file}</span>
              <span className="text-[10.5px] text-[var(--text-muted)] shrink-0">
                {Object.entries(r.counts).filter(([, v]) => v > 0)
                  .map(([k, v]) => `${k} ${v}`).join(', ')}
              </span>
            </div>
          ))}
          <p className="text-[10.5px] text-[var(--text-muted)]">
            «Откуда это взялось» спрашивают через месяц, когда файла уже нет.
          </p>
        </div>
      )}

      {/* Сообщить о проблеме */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Bug size={14} className="text-[var(--text-muted)]" />
          <span className="text-[13px] font-semibold text-[var(--text)]">Сообщить о проблеме</span>
        </div>
        <textarea
          id="problem-text"
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          placeholder="Что случилось и что вы делали перед этим"
          rows={3}
          className="w-full bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md
                     px-2 py-1.5 text-[12px] text-[var(--text)] resize-none
                     placeholder:text-[var(--text-muted)] focus:outline-none
                     focus:border-[var(--accent)]"
        />
        <div className="flex gap-1.5">
          <button type="button" className="btn btn-ghost text-[11.5px]" onClick={copyReport}>
            Скопировать отчёт
          </button>
        </div>
        <p className="text-[10.5px] text-[var(--text-muted)]">
          К вашим словам добавятся версия, связь, место в хранилище и последние
          ошибки. Без них «не работает» не расследуется.
        </p>
      </div>

      {/* Ошибки */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-[var(--warn)]" />
            <span className="text-[13px] font-semibold text-[var(--text)]">
              Ошибки: {errors.length}
            </span>
            <button type="button" className="btn btn-ghost text-[11px] ml-auto"
                    onClick={() => { setErrors([]); saveErrors([]); }}>
              Очистить
            </button>
          </div>
          {errors.slice(0, 8).map((e) => (
            <div key={`${e.at}-${e.message}`} className="text-[11px] text-[var(--text-muted)]">
              <span className="font-mono tabular-nums">
                {new Date(e.at).toLocaleString('ru')}
              </span>
              {' — '}{e.message}
              {e.where && <span className="text-[10px]"> ({e.where})</span>}
            </div>
          ))}
        </div>
      )}

      {/* Что нового */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 space-y-1">
        <div className="text-[13px] font-semibold text-[var(--text)]">
          Что нового · {APP_VERSION}
        </div>
        <ul className="text-[11.5px] text-[var(--text-muted)] space-y-0.5 list-disc pl-4">
          {WHATS_NEW.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
    </div>
  );
}
