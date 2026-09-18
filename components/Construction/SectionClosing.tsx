'use client';
import { useState, useMemo } from 'react';
import { Printer, AlertTriangle, FileCheck2 } from 'lucide-react';
import { LAY_METHODS, LAY_METHOD_LABEL } from '@/types/construction';
import { JournalState, documentContractor } from './journalStore';
import {
  computeSectionAct, entriesOfSection, deviationsOfSection, actKm,
  SectionActManual, DEFAULT_ACT_MANUAL, Recultivation, PavementRestore,
} from './sectionAct';

/**
 * Закрытие участка: таблица АСР/ОСР, заполненная из дневных записей.
 *
 * Показывается столько актов, сколько фактических глубин на участке:
 * основной по проекту и по одному на каждое отклонение. Строки, которые
 * считаются из журнала, подставлены; те, которых в дневном отчёте нет,
 * остаются полями для заполнения и подписаны как ручные.
 *
 * Печать — обычная печать браузера: так получается и бумага, и PDF, и не
 * нужен внешний генератор документов.
 */

interface Props {
  journal: JournalState;
  onChangeFields: (uchastok: string, fields: SectionActManual) => void;
}

const RECULT: Recultivation[] = ['выполнена', 'не выполнена'];
const PAVEMENT: PavementRestore[] = ['выполнено', 'не выполнено', 'не предусматривается проектом'];

export default function SectionClosing({ journal, onChangeFields }: Props) {
  const sections = useMemo(() => {
    const s = new Set<string>();
    for (const e of journal.ground) if (e.uchastok) s.add(e.uchastok);
    return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [journal.ground]);

  const [uchastok, setUchastok] = useState(sections[0] ?? '');

  const entries = useMemo(() => entriesOfSection(journal.ground, uchastok), [journal.ground, uchastok]);
  const devs = useMemo(() => deviationsOfSection(journal.deviations, uchastok), [journal.deviations, uchastok]);
  const totals = useMemo(() => computeSectionAct(entries, devs), [entries, devs]);

  const fields: SectionActManual = { ...DEFAULT_ACT_MANUAL, ...(journal.actFields?.[uchastok] ?? {}) };
  const setField = <K extends keyof SectionActManual>(k: K, v: SectionActManual[K]) => {
    onChangeFields(uchastok, { ...fields, [k]: v });
  };

  const first = entries[0];
  const performerName = totals.performers[0] ?? first?.contractor ?? '';
  const docContractor = performerName
    ? documentContractor(journal.contractors, performerName)
    : undefined;

  if (sections.length === 0) {
    return (
      <div className="text-center py-12 flex flex-col items-center gap-2">
        <FileCheck2 size={22} className="text-[var(--text-muted)]" />
        <p className="text-[12.5px] text-[var(--text-muted)]">
          Нет участков: загрузите журнал или внесите дневные отчёты
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Выбор участка — на печать не идёт */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <select id="sc-uchastok" value={uchastok} onChange={(e) => setUchastok(e.target.value)}
                className="flex-1 min-w-[220px] bg-[var(--bg-canvas)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)]">
          {sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="btn btn-primary text-[11px]" onClick={() => window.print()}>
          <Printer size={14} />Печать
        </button>
      </div>

      {totals.openDeviations.length > 0 && (
        <div className="no-print flex items-start gap-2 p-2.5 rounded-lg border border-[var(--warn)]/50 bg-[var(--warn)]/10 text-[12px] text-[var(--text)]">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
          <span>
            Участок нельзя закрыть: <b>{totals.openDeviations.length}</b> отклонений без протокола
            мобильной группы. Его номер должен попасть в пункт об отклонениях от ПСД.
          </span>
        </div>
      )}

      {/* Ручные поля — их нет в дневном отчёте */}
      <details className="no-print rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
        <summary className="px-3 py-2 text-[11.5px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)]">
          Поля акта, которых нет в журнале — заполните вручную
        </summary>
        <div className="p-3 pt-0 grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Num label="ГНБ с ПЭТ-63, м" value={fields.gnbPet63M} onChange={(v) => setField('gnbPet63M', v)} />
          <Num label="ГНБ с ПЭТ-110, м" value={fields.gnbPet110M} onChange={(v) => setField('gnbPet110M', v)} />
          <Num label="Открытый, ПЭТ-63, м" value={fields.openPet63M} onChange={(v) => setField('openPet63M', v)} />
          <Num label="Открытый, ст. труба, м" value={fields.openSteel63M} onChange={(v) => setField('openSteel63M', v)} />
          <Num label="Столбиков, шт" value={fields.markerPosts} onChange={(v) => setField('markerPosts', v)} />
          <Num label="Шаровых маркеров, шт" value={fields.ballMarkers} onChange={(v) => setField('ballMarkers', v)} />
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-[var(--text-muted)]">Рекультивация</span>
            <select value={fields.recultivation} onChange={(e) => setField('recultivation', e.target.value as Recultivation)}
                    className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)]">
              {RECULT.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-[var(--text-muted)]">А/бетонные покрытия</span>
            <select value={fields.pavement} onChange={(e) => setField('pavement', e.target.value as PavementRestore)}
                    className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)]">
              {PAVEMENT.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
      </details>

      {/* Акты */}
      <div className="print-area flex flex-col gap-4">
        {totals.variants.map((v, i) => (
          <article key={i} className="act-sheet rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
            <header className="mb-3">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="text-[13px] font-semibold text-[var(--text)]">
                  {v.isMain ? 'Акт освидетельствования скрытых работ' : 'Акт на участок с отклонением'}
                </h3>
                {!v.isMain && (
                  <span className="no-print text-[10px] px-1.5 py-0.5 rounded"
                        style={{ color: v.blocked ? 'var(--warn)' : 'var(--success)',
                                 border: `1px solid ${v.blocked ? 'var(--warn)' : 'var(--success)'}` }}>
                    {v.blocked ? 'нет протокола МГ' : 'протокол есть'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {uchastok}
                {first?.oblast ? ` · ${first.oblast}` : ''}
                {first?.rayon ? `, ${withRayonWord(first.rayon)}` : ''}
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {docContractor
                  ? <>Подрядчик: <b className="text-[var(--text)]">{docContractor.fullName ?? docContractor.name}</b></>
                  : 'Подрядчик не указан'}
                {performerName && docContractor && performerName !== docContractor.name && (
                  <> · работы вёл {performerName}</>
                )}
              </p>
              {totals.dateFrom && (
                <p className="text-[11px] text-[var(--text-muted)]">
                  Работы: {fmtDate(totals.dateFrom)} — {fmtDate(totals.dateTo)}
                </p>
              )}
            </header>

            <table className="w-full text-[11.5px] border-collapse">
              <tbody>
                <Row n="1" label="Защитной МКТ проложено всего" value={actKm(v.lengthM)} unit="км" strong />
                {LAY_METHODS.map((m) => (
                  <Row key={m} label={methodActLabel(m)}
                       value={actKm(share(totals.byMethod[m], totals.totalM, v.lengthM))} unit="км" indent />
                ))}
                <Row label="Переходы ГНБ с защитой ПЭТ-63мм" value={actKm(fields.gnbPet63M ?? 0)} unit="км" indent manual />
                <Row label="Переходы ГНБ с защитой ПЭТ-110мм" value={actKm(fields.gnbPet110M ?? 0)} unit="км" indent manual />
                <Row label="Переходы открытым способом, ПЭТ-63мм" value={actKm(fields.openPet63M ?? 0)} unit="км" indent manual />
                <Row label="Переходы открытым способом, ст. труба 63мм" value={actKm(fields.openSteel63M ?? 0)} unit="км" indent manual />
                <Row n="2" label="Глубина прокладки защитной МКТ"
                     value={`по проекту — ${fmtDepth(v.designDepthM)} м, фактически — ${fmtDepth(v.actualDepthM)} м`} />
                <Row n="3" label="Комплектов для сращивания защитной МКТ (фитинги)"
                     value={String(shareInt(totals.splicingKits, totals.totalM, v.lengthM))} unit="шт" />
                <Row n="4" label="Прокладка предупредительно-сигнальной ленты на глубине ½ от МКТ"
                     value={actKm(share(totals.tapeM, totals.totalM, v.lengthM))} unit="км" />
                <Row n="5" label="На участке выполнено переходов"
                     value={String(v.isMain ? totals.crossingsTotal : 0)} unit="пер." />
                <Row n="6" label="Рекультивация" value={fields.recultivation ?? '—'} manual />
                <Row n="7" label="Восстановление а/бетонных покрытий" value={fields.pavement ?? '—'} manual />
                {(fields.markerPosts || fields.ballMarkers) && (
                  <>
                    <Row label="Установлено идентификационных столбиков" value={String(fields.markerPosts ?? 0)} unit="шт" manual />
                    <Row label="Установлено шаровых маркеров" value={String(fields.ballMarkers ?? 0)} unit="шт" manual />
                  </>
                )}
                {!v.isMain && (
                  <Row label="Отклонения от ПСД"
                       value={v.protocols.length
                         ? v.protocols.map((p) => `Протокол МГ №${p.number} от ${fmtDate(p.date)}`).join('; ')
                         : 'протокол мобильной группы не оформлен'} />
                )}
              </tbody>
            </table>

            {!v.isMain && v.deviations.length > 0 && (
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                Причины: {[...new Set(v.deviations.map((d) => d.reason))].join(', ')}
              </p>
            )}
          </article>
        ))}
      </div>

      <p className="no-print text-[10.5px] text-[var(--text-muted)]">
        Объёмы по способам, лента и фитинги делятся между актами пропорционально
        протяжённости — журнал ведётся по дням, а не по глубине, поэтому точное
        распределение знает только исполнитель. Проверьте перед подписанием.
      </p>

      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; inset: 0; padding: 0; }
          .no-print { display: none !important; }
          .act-sheet {
            page-break-after: always;
            border: none !important;
            background: #fff !important;
            color: #000 !important;
          }
          .act-sheet * { color: #000 !important; }
          .act-sheet td { border-bottom: 1px solid #ccc; }
        }
      `}</style>
    </div>
  );
}

/** Доля показателя, приходящаяся на этот акт по длине. */
function share(value: number, total: number, part: number): number {
  if (!total) return 0;
  return Math.round((value * part) / total);
}
function shareInt(value: number, total: number, part: number): number {
  if (!total) return 0;
  return Math.round((value * part) / total);
}

function methodActLabel(m: string): string {
  // В акте у кабелеукладчика формулировка своя, остальные совпадают.
  if (m === 'кабелеукладчик') return 'Кабелеукладчиком с двукратной пропоркой';
  return LAY_METHOD_LABEL[m as never] ?? m;
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru');
}

function fmtDepth(m: number): string {
  return String(m).replace('.', ',');
}

/** В журнале район пишут и с словом «район», и без — не удваиваем. */
function withRayonWord(rayon: string): string {
  const r = rayon.trim();
  return /район/i.test(r) ? r : `${r} район`;
}

function Row({ n, label, value, unit, indent, strong, manual }: {
  n?: string; label: string; value: string; unit?: string;
  indent?: boolean; strong?: boolean; manual?: boolean;
}) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className={`py-1 pr-2 align-top ${indent ? 'pl-4' : ''} ${strong ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
        {n && <span className="text-[var(--text)] mr-1">{n}.</span>}
        {label}
        {manual && <span className="no-print text-[9px] text-[var(--warn)] ml-1">вручную</span>}
      </td>
      <td className={`py-1 text-right font-mono tabular-nums whitespace-nowrap ${strong ? 'font-semibold text-[var(--text)]' : 'text-[var(--text)]'}`}>
        {value}{unit ? ` ${unit}` : ''}
      </td>
    </tr>
  );
}

function Num({ label, value, onChange }: {
  label: string; value?: number; onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-[var(--text-muted)] truncate" title={label}>{label}</span>
      <input inputMode="decimal" value={value === undefined ? '' : String(value)}
             onChange={(e) => {
               const raw = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
               const n = parseFloat(raw);
               onChange(raw === '' || !Number.isFinite(n) ? undefined : n);
             }}
             placeholder="0"
             className="bg-[var(--bg-canvas)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)] font-mono tabular-nums" />
    </label>
  );
}
