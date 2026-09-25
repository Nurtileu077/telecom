'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Pencil, Trash2, CloudOff, MapPin, Copy, Printer, Flag, ChevronUp, ChevronDown,
  Stamp, CopyPlus,
} from 'lucide-react';
import type { DailyWorkEntry } from '@/types/construction';
import type { JournalState } from './journalStore';
import { hasPendingCorrection } from './journalStore';
import ExportButton, { type ExportColumn } from '@/components/Layout/ExportButton';
import { useT } from '@/components/Layout/LangProvider';
import {
  entryMeters, filterEntries, sortEntries, groupByWeek, tableTotals, rowsToText,
  SORT_LABEL, type SortKey, type SortDir,
} from './entriesTable';

/**
 * Записи журнала таблицей.
 *
 * Записей за сезон тысячи, и смотрят в них не подряд, а по вопросу:
 * «сколько дал Дозер в июле», «где мы просели», «что за смена на 4 800
 * метров». Поэтому поиск, порядок по любой колонке, недели и итоги —
 * не украшение таблицы, а способ вообще её читать.
 *
 * Выделение нужно для того же: бригаду переименовали — и двадцать строк
 * надо привести к одному виду, а по одной это двадцать открытых форм.
 */

interface Props {
  rows: DailyWorkEntry[];
  journal: JournalState;
  onDelete: (id: string) => void;
  onEdit: (e: DailyWorkEntry) => void;
  /** Показать участок на карте: журнал закрывается, карта едет туда. */
  onShowOnMap?: (e: DailyWorkEntry) => void;
  /** Правка сразу у многих: подрядчик, колонна, СМУ. */
  onBulkPatch?: (ids: string[], patch: Partial<DailyWorkEntry>) => void;
  onDispute?: (e: DailyWorkEntry) => void;
  /** Отметить, что смены предъявлены технадзору. */
  onPresent?: (ids: string[]) => void;
  /** Повторить смену: те же цифры на другой день. */
  onRepeat?: (e: DailyWorkEntry) => void;
  onCopied?: (n: number) => void;
  onFlash?: (text: string) => void;
}

/**
 * Колонки для выгрузки — те же, что на экране, и в том же порядке.
 *
 * Метры остаются числом: в Excel по ним считают, а «1 240 м» строкой
 * сложить нельзя.
 */
const ENTRY_COLUMNS: ExportColumn<DailyWorkEntry>[] = [
  { header: 'Дата', value: (e) => e.date ?? '' },
  { header: 'Область', value: (e) => e.oblast ?? '' },
  { header: 'Район', value: (e) => e.rayon ?? '' },
  { header: 'Участок', value: (e) => e.uchastok ?? '' },
  { header: 'Подрядчик', value: (e) => e.contractor ?? '' },
  { header: 'Колонна', value: (e) => e.column ?? '' },
  { header: 'Метры', value: (e) => Math.round(entryMeters(e)) },
  { header: 'ГНБ, м', value: (e) => Math.round(e.drillM ?? 0) },
  { header: 'Простой', value: (e) => e.downtime ?? '' },
];

const COLUMNS: { key: SortKey; className: string }[] = [
  { key: 'date', className: 'w-[92px]' },
  { key: 'uchastok', className: '' },
  { key: 'contractor', className: 'w-[120px] hidden md:table-cell' },
  { key: 'smu', className: 'w-[70px] hidden lg:table-cell' },
  { key: 'meters', className: 'w-[92px] text-right' },
];

const fmtM = (v: number) => `${Math.round(v).toLocaleString('ru')} м`;

export default function EntriesTable({
  rows, journal, onDelete, onEdit, onShowOnMap, onBulkPatch, onDispute, onPresent,
  onRepeat, onCopied, onFlash,
}: Props) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [byWeek, setByWeek] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const found = useMemo(() => filterEntries(rows, q), [rows, q]);
  const ordered = useMemo(() => sortEntries(found, sortKey, sortDir), [found, sortKey, sortDir]);
  const weeks = useMemo(() => (byWeek ? groupByWeek(ordered) : []), [byWeek, ordered]);
  const totals = useMemo(() => tableTotals(found), [found]);

  // Выбор живёт, пока строки на экране: отфильтровали — и выбранного
  // больше нет, иначе правка уедет не туда, куда смотрит человек.
  useEffect(() => {
    setPicked((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(found.map((r) => r.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [found]);

  const pickedRows = useMemo(
    () => found.filter((r) => picked.has(r.id)),
    [found, picked],
  );

  /** Что уйдёт в файл: отмеченное, а если ничего не отмечено — всё найденное. */
  const exported = useMemo(
    () => (pickedRows.length ? pickedRows : found),
    [pickedRows, found],
  );
  const exportedTotals = useMemo(() => tableTotals(exported), [exported]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    // Метры и дату интереснее смотреть с конца, названия — с начала.
    setSortDir(key === 'meters' || key === 'date' ? 'desc' : 'asc');
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function copyPicked() {
    const list = pickedRows.length > 0 ? pickedRows : found;
    const text = rowsToText(list);
    try {
      await navigator.clipboard.writeText(text);
      onCopied?.(list.length);
    } catch {
      window.prompt('Скопируйте строки вручную:', text);
    }
  }

  function bulkAsk(field: 'contractor' | 'column' | 'smu') {
    if (!onBulkPatch || pickedRows.length === 0) return;
    const titles = { contractor: 'Подрядчик', column: 'Колонна', smu: 'СМУ' };
    const value = window.prompt(
      `${titles[field]} для ${pickedRows.length} строк:`,
      pickedRows[0][field] ?? '',
    );
    if (value === null) return;
    onBulkPatch(pickedRows.map((r) => r.id), { [field]: value.trim() });
    setPicked(new Set());
  }

  if (rows.length === 0) {
    return (
      <p className="text-[12px] text-[var(--text-muted)] text-center py-10">
        За выбранный период записей нет
      </p>
    );
  }

  const Row = ({ e }: { e: DailyWorkEntry }) => {
    const meters = entryMeters(e);
    const on = picked.has(e.id);
    return (
      <tr
        key={e.id}
        className={`border-t border-[var(--border)] ${
          on ? 'bg-[var(--accent-dim)]' : 'hover:bg-white/[0.03]'}`}
      >
        <td className="px-2 py-1.5 align-top">
          <input
            type="checkbox"
            checked={on}
            onChange={() => togglePick(e.id)}
            aria-label="Выбрать строку"
            className="accent-[var(--accent)]"
          />
        </td>
        <td className="px-2 py-1.5 align-top font-mono text-[11px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
          {e.date ? new Date(`${e.date}T00:00:00Z`).toLocaleDateString('ru') : '—'}
        </td>
        <td className="px-2 py-1.5 align-top min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[12.5px] text-[var(--text)] font-medium">{e.uchastok || '—'}</span>
            {e.tech && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)]">
                {e.tech}
              </span>
            )}
            {e.presentedAt && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)]"
                title={`Предъявлено ${new Date(e.presentedAt).toLocaleDateString('ru')}`
                  + (e.presentedTo ? `, ${e.presentedTo}` : '')}
              >
                предъявлено
              </span>
            )}
            {e.disputed && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--warn)] text-[var(--warn)]"
                title={e.disputeNote || 'Заказчик не согласен'}
              >
                спорно
              </span>
            )}
            {e.sync === 'local' && (
              <span className="text-[10px] text-[var(--text-muted)] inline-flex items-center gap-1"
                    title="Сохранено локально">
                <CloudOff size={11} />
              </span>
            )}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] truncate md:hidden">
            {[e.contractor, e.column, e.smu].filter(Boolean).join(' · ')}
          </div>
          {e.note && (
            <div className="text-[11px] text-[var(--text-muted)] truncate">{e.note}</div>
          )}
        </td>
        <td className="px-2 py-1.5 align-top text-[11.5px] text-[var(--text-muted)] hidden md:table-cell truncate">
          {e.contractor || '—'}
          {e.column && <span className="block text-[10px]">{e.column}</span>}
        </td>
        <td className="px-2 py-1.5 align-top text-[11.5px] text-[var(--text-muted)] hidden lg:table-cell">
          {e.smu || '—'}
        </td>
        <td className="px-2 py-1.5 align-top text-right">
          <div className="font-mono tabular-nums text-[13px] text-[var(--text)]">{fmtM(meters)}</div>
          {!!e.drillM && (
            <div className="text-[10px] text-[var(--text-muted)]">ГНБ {Math.round(e.drillM)} м</div>
          )}
        </td>
        <td className="px-1 py-1.5 align-top whitespace-nowrap">
          <div className="flex items-center justify-end">
            {onShowOnMap && (
              <button type="button" onClick={() => onShowOnMap(e)} title="Показать участок на карте"
                      className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--accent)]">
                <MapPin size={14} />
              </button>
            )}
            {onRepeat && (
              <button type="button" onClick={() => onRepeat(e)}
                      title="Повторить смену: те же цифры на другой день"
                      className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--accent)]">
                <CopyPlus size={14} />
              </button>
            )}
            {onDispute && (
              <button type="button" onClick={() => onDispute(e)}
                      title={e.disputed ? 'Снять пометку «спорно»' : 'Заказчик не согласен'}
                      className={`btn btn-ghost btn-icon ${
                        e.disputed ? 'text-[var(--warn)]' : 'text-[var(--text-muted)] hover:text-[var(--warn)]'}`}>
                <Flag size={14} />
              </button>
            )}
            {hasPendingCorrection(journal, e.id) ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--warn)] text-[var(--warn)]"
                    title="По записи уже есть заявка на исправление">
                на согласовании
              </span>
            ) : (
              <button type="button" onClick={() => onEdit(e)} title="Исправить отчёт"
                      className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--accent)]">
                <Pencil size={14} />
              </button>
            )}
            <button type="button" onClick={() => onDelete(e.id)} title="Удалить — строка уйдёт в корзину"
                    className="btn btn-ghost btn-icon text-[var(--text-muted)] hover:text-[var(--danger)]">
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Поиск и вид */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          id="entries-search"
          type="search"
          value={q}
          onChange={(ev) => setQ(ev.target.value)}
          placeholder="Поиск: бригада, участок, «скальный»…"
          className="flex-1 min-w-[160px] bg-[var(--bg-surface)] border border-[var(--border)]
                     rounded-md px-2 py-1.5 text-[12px] text-[var(--text)]
                     placeholder:text-[var(--text-muted)] focus:outline-none
                     focus:border-[var(--accent)]"
        />
        <button type="button" onClick={() => setByWeek((v) => !v)}
                aria-pressed={byWeek}
                className={`btn btn-ghost text-[11px] ${byWeek ? 'text-[var(--accent)]' : ''}`}>
          По неделям
        </button>
        <button type="button" onClick={copyPicked} className="btn btn-ghost btn-icon"
                title={pickedRows.length ? `Скопировать ${pickedRows.length} строк` : 'Скопировать всё найденное'}>
          <Copy size={14} />
        </button>
        <ExportButton
          compact
          name="Журнал"
          rows={exported}
          columns={ENTRY_COLUMNS}
          /*
            Итог считаем по тому, что выгружается, а не по всему
            найденному. Отметили двадцать строк из двухсот — в файле
            двадцать строк, и «Итого» под ними должно быть их, иначе
            сумма не сходится со строками прямо на глазах у того, кто
            этот файл открыл.
          */
          footer={{
            'Дата': 'Итого',
            'Метры': Math.round(exportedTotals.meters),
            'ГНБ, м': Math.round(exportedTotals.drillM),
          }}
          onFlash={onFlash}
        />
        <button type="button" onClick={() => window.print()} className="btn btn-ghost btn-icon"
                title="Напечатать журнал">
          <Printer size={14} />
        </button>
      </div>

      {/* Правка сразу у многих */}
      {pickedRows.length > 0 && onBulkPatch && (
        <div className="flex items-center gap-1.5 flex-wrap rounded-lg border border-[var(--accent)]/40
                        bg-[var(--accent-dim)] px-2 py-1.5">
          <span className="text-[11.5px] text-[var(--text)]">
            Выбрано {pickedRows.length} · {fmtM(pickedRows.reduce((s, r) => s + entryMeters(r), 0))}
          </span>
          <button type="button" className="btn btn-ghost text-[11px]" onClick={() => bulkAsk('contractor')}>
            Подрядчик…
          </button>
          <button type="button" className="btn btn-ghost text-[11px]" onClick={() => bulkAsk('column')}>
            Колонна…
          </button>
          <button type="button" className="btn btn-ghost text-[11px]" onClick={() => bulkAsk('smu')}>
            СМУ…
          </button>
          {onPresent && (
            <button type="button" className="btn btn-ghost text-[11px]"
                    onClick={() => { onPresent(pickedRows.map((r) => r.id)); setPicked(new Set()); }}>
              <Stamp size={13} />Предъявлено технадзору
            </button>
          )}
          <button type="button" className="btn btn-ghost text-[11px] ml-auto"
                  onClick={() => setPicked(new Set())}>
            Снять выбор
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[var(--bg-canvas)]">
            <tr>
              <th className="px-2 py-1.5 w-[28px]">
                <input
                  type="checkbox"
                  aria-label="Выбрать все найденные"
                  checked={picked.size > 0 && picked.size === found.length}
                  onChange={() => setPicked(
                    picked.size === found.length ? new Set() : new Set(found.map((r) => r.id)),
                  )}
                  className="accent-[var(--accent)]"
                />
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key}
                    className={`px-2 py-1.5 text-[10px] uppercase tracking-wide
                                text-[var(--text-muted)] font-medium ${c.className}`}>
                  <button type="button" onClick={() => toggleSort(c.key)}
                          className="inline-flex items-center gap-0.5 hover:text-[var(--text)]">
                    {t(SORT_LABEL[c.key])}
                    {sortKey === c.key && (sortDir === 'asc'
                      ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                  </button>
                </th>
              ))}
              <th className="px-1 py-1.5 w-[110px]" />
            </tr>
          </thead>

          {byWeek ? weeks.map((w) => (
            <tbody key={w.week}>
              <tr className="bg-[var(--bg-surface)]">
                <td colSpan={7} className="px-2 py-1 text-[11px] text-[var(--text-muted)]">
                  <b className="text-[var(--text)]">{w.label}</b>
                  {' · '}{w.rows.length} смен{' · '}
                  <span className="font-mono tabular-nums">{fmtM(w.meters)}</span>
                </td>
              </tr>
              {w.rows.map((e) => <Row key={e.id} e={e} />)}
            </tbody>
          )) : (
            <tbody>
              {ordered.slice(0, 500).map((e) => <Row key={e.id} e={e} />)}
            </tbody>
          )}

          {/* Итоги внизу — их спрашивают по тому, что на экране, а не по
              всему журналу. */}
          <tfoot className="sticky bottom-0 bg-[var(--bg-canvas)]">
            <tr className="border-t-2 border-[var(--border)]">
              <td colSpan={2} className="px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                {totals.shifts} смен · {totals.days} дней
                {totals.disputed > 0 && (
                  <span className="text-[var(--warn)]"> · спорных {totals.disputed}</span>
                )}
              </td>
              <td colSpan={3} className="px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                в среднем <span className="font-mono tabular-nums">{fmtM(totals.perShift)}</span> за смену
                {totals.drillM > 0 && (
                  <span> · ГНБ <span className="font-mono tabular-nums">{fmtM(totals.drillM)}</span></span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[13px]
                             font-semibold text-[var(--text)]">
                {fmtM(totals.meters)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {!byWeek && ordered.length > 500 && (
        <p className="text-[11px] text-[var(--text-muted)] text-center py-2">
          Показаны первые 500 из {ordered.length}. Сузьте период или поиск —
          итоги внизу посчитаны по всем найденным.
        </p>
      )}
    </div>
  );
}
